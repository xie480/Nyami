import {net} from 'electron';
import {promises as fs, createWriteStream} from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {randomUUID} from 'node:crypto';
import type {PlaybackQueueItem} from '../../shared/types';
import {BILIBILI_REFERER, DESKTOP_USER_AGENT} from '../constants';
import {AppLogger} from '../logging/appLogger';
import type {AppDirectories} from '../storage/appDirectories';
import {isPathInside} from '../storage/appDirectories';

const AUDIO_CACHE_INDEX = 'index.json';
const AUDIO_CACHE_MAX_BYTES = 500 * 1024 * 1024;
const AUDIO_CACHE_TARGET_BYTES = Math.floor(AUDIO_CACHE_MAX_BYTES * 0.9);

export type AudioCacheRequest = {
  track: PlaybackQueueItem;
  quality: string;
  /** 实际命中的 Bilibili 音轨 ID，仅用于索引留痕，不改变请求档位键。 */
  sourceId?: number;
  /** 实际响应的 MIME 类型，便于定位解码和缓存问题。 */
  codec?: string;
};

export type AudioCacheEntry = {
  key: string;
  bvid: string;
  cid: number;
  quality: string;
  sourceId?: number;
  codec?: string;
  path: string;
  size: number;
  mimeType: string;
  createdAt: number;
  lastAccess: number;
};

type AudioCacheIndex = Record<string, AudioCacheEntry>;

/**
 * 管理桌面端音频文件、临时下载和索引元数据。
 * 该类只接受由主进程解析出的 BVID、CID 和音质，文件路径始终由应用目录派生。
 */
export class AudioCacheStore {
  private readonly indexPath: string;

  private readonly pending = new Map<string, Promise<AudioCacheEntry>>();

  private indexWriteQueue: Promise<void> = Promise.resolve();

  private readonly ready: Promise<void>;

  constructor(
    private readonly directories: AppDirectories,
    private readonly logger: AppLogger,
  ) {
    this.indexPath = path.join(directories.audioCache, AUDIO_CACHE_INDEX);
    this.ready = this.initialize();
  }

  /** 生成稳定的音频缓存键，不包含 URL 查询参数。 */
  static getKey(request: AudioCacheRequest): string {
    const cid = Number.isSafeInteger(request.track.cid)
      ? String(request.track.cid)
      : 'default';
    return `${encodeURIComponent(request.track.bvid)}-${encodeURIComponent(
      cid,
    )}-${encodeURIComponent(request.quality)}`;
  }

  /** 返回缓存文件的自定义协议地址。 */
  static getProtocolUrl(key: string): string {
    return `nyami-cache://audio/${encodeURIComponent(key)}`;
  }

  /** 读取并更新缓存命中项的最近访问时间。 */
  async get(request: AudioCacheRequest): Promise<AudioCacheEntry | null> {
    await this.ready;
    const key = AudioCacheStore.getKey(request);
    const index = await this.readIndex();
    const entry = index[key];
    if (!entry || !(await this.fileExists(entry.path))) {
      if (entry) {
        delete index[key];
        await this.writeIndex(index);
      }
      return null;
    }
    entry.lastAccess = Date.now();
    await this.writeIndex(index);
    return {...entry};
  }

  /** 根据协议键解析缓存文件，供 nyami-cache 协议处理器使用。 */
  async resolveByKey(key: string): Promise<AudioCacheEntry | null> {
    await this.ready;
    if (!/^[A-Za-z0-9%._~-]+$/.test(key)) {
      return null;
    }
    const index = await this.readIndex();
    const entry = index[key];
    if (
      !entry ||
      !isPathInside(entry.path, this.directories.audioCache) ||
      !(await this.fileExists(entry.path))
    ) {
      return null;
    }
    entry.lastAccess = Date.now();
    await this.writeIndex(index);
    return {...entry};
  }

  /**
   * 下载音频并原子更新索引。
   * 同一个缓存键只允许一个下载任务，失败时临时文件会被删除。
   */
  async download(
    request: AudioCacheRequest,
    urls: string[],
    signal?: AbortSignal,
  ): Promise<AudioCacheEntry> {
    await this.ready;
    const key = AudioCacheStore.getKey(request);
    const existing = await this.get(request);
    if (existing) {
      return existing;
    }
    const pending = this.pending.get(key);
    if (pending) {
      return pending;
    }
    const task = this.downloadOnce(request, key, urls, signal);
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      if (this.pending.get(key) === task) {
        this.pending.delete(key);
      }
    }
  }

  /** 删除单个音频缓存及其索引项。 */
  async remove(request: AudioCacheRequest): Promise<void> {
    await this.ready;
    const key = AudioCacheStore.getKey(request);
    const index = await this.readIndex();
    const entry = index[key];
    delete index[key];
    if (entry) {
      await fs.rm(entry.path, {force: true});
    }
    await this.writeIndex(index);
  }

  /** 清空音频缓存，并保留目录和空索引文件。 */
  async clear(): Promise<void> {
    await this.ready;
    const entries = await fs.readdir(this.directories.audioCache, {
      withFileTypes: true,
    });
    await Promise.all(
      entries
        .filter(entry => entry.name !== AUDIO_CACHE_INDEX)
        .map(entry =>
          fs.rm(path.join(this.directories.audioCache, entry.name), {
            recursive: true,
            force: true,
          }),
        ),
    );
    await this.writeIndex({});
  }

  /** 按最近访问时间淘汰音频，保留调用方指定的当前队列缓存。 */
  async evict(protectedKeys: ReadonlySet<string> = new Set()): Promise<void> {
    await this.ready;
    const index = await this.readIndex();
    let total = Object.values(index).reduce(
      (sum, entry) => sum + entry.size,
      0,
    );
    if (total <= AUDIO_CACHE_MAX_BYTES) {
      return;
    }
    const candidates = Object.values(index)
      .filter(entry => !protectedKeys.has(entry.key))
      .sort((left, right) => left.lastAccess - right.lastAccess);
    for (const entry of candidates) {
      if (total <= AUDIO_CACHE_TARGET_BYTES) {
        break;
      }
      await fs.rm(entry.path, {force: true});
      delete index[entry.key];
      total -= entry.size;
    }
    await this.writeIndex(index);
  }

  /** 初始化目录并清理上次异常退出留下的临时文件。 */
  private async initialize(): Promise<void> {
    await fs.mkdir(this.directories.audioCache, {recursive: true});
    const entries = await fs.readdir(this.directories.audioCache, {
      withFileTypes: true,
    });
    await Promise.all(
      entries
        .filter(entry => entry.name.startsWith('.nyami-audio-'))
        .map(entry =>
          fs.rm(path.join(this.directories.audioCache, entry.name), {
            force: true,
            recursive: true,
          }),
        ),
    );
  }

  /** 执行一次带备用 URL 的流式下载。 */
  private async downloadOnce(
    request: AudioCacheRequest,
    key: string,
    urls: string[],
    signal?: AbortSignal,
  ): Promise<AudioCacheEntry> {
    const candidates = [...new Set(urls.filter(Boolean))];
    if (candidates.length === 0) {
      throw new Error('没有可下载的音频地址');
    }
    const finalPath = path.join(
      this.directories.audioCache,
      `${key}-${randomUUID()}.audio`,
    );
    let lastError: unknown = new Error('音频下载失败');
    for (const url of candidates) {
      const temporaryPath = path.join(
        this.directories.audioCache,
        `.nyami-audio-${randomUUID()}.tmp`,
      );
      try {
        const response = await net.fetch(url, {
          headers: {
            Referer: BILIBILI_REFERER,
            'User-Agent': DESKTOP_USER_AGENT,
          },
          signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`音频下载响应异常：${response.status}`);
        }
        await pipeline(
          Readable.fromWeb(response.body as any),
          createWriteStream(temporaryPath),
        );
        const stat = await fs.stat(temporaryPath);
        if (stat.size <= 0) {
          throw new Error('音频下载结果为空');
        }
        await fs.rename(temporaryPath, finalPath);
        const now = Date.now();
        const entry: AudioCacheEntry = {
          key,
          bvid: request.track.bvid,
          cid: request.track.cid ?? 0,
          quality: request.quality,
          sourceId: request.sourceId,
          codec: request.codec,
          path: finalPath,
          size: stat.size,
          mimeType: response.headers.get('content-type') ?? 'audio/mp4',
          createdAt: now,
          lastAccess: now,
        };
        const index = await this.readIndex();
        const previous = index[key];
        index[key] = entry;
        await this.writeIndex(index);
        if (previous && previous.path !== finalPath) {
          await fs.rm(previous.path, {force: true});
        }
        await this.evict();
        return entry;
      } catch (error) {
        lastError = error;
        await fs.rm(temporaryPath, {force: true});
        this.logger.warn('audio.cache-download-failed', {
          bvid: request.track.bvid,
          cid: request.track.cid,
          error,
        });
      }
    }
    throw lastError instanceof Error ? lastError : new Error('音频下载失败');
  }

  /** 读取损坏或不存在时回退为空索引。 */
  private async readIndex(): Promise<AudioCacheIndex> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as AudioCacheIndex;
      }
    } catch {
      // 首次运行或索引损坏时由下一次写入重建索引。
    }
    return {};
  }

  /** 使用临时文件替换索引，避免中断时留下半个 JSON。 */
  private async writeIndex(index: AudioCacheIndex): Promise<void> {
    const operation = this.indexWriteQueue.then(() =>
      this.writeIndexFile(index),
    );
    this.indexWriteQueue = operation.catch(() => undefined);
    return operation;
  }

  /** 串行写入索引，降低 Windows 文件句柄竞争导致的替换失败。 */
  private async writeIndexFile(index: AudioCacheIndex): Promise<void> {
    await fs.mkdir(this.directories.audioCache, {recursive: true});
    const temporaryPath = `${this.indexPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(index), 'utf8');
      await replaceFileWithRetry(temporaryPath, this.indexPath, this.logger);
    } finally {
      await fs.rm(temporaryPath, {force: true});
    }
  }

  /** 安全检查缓存文件是否存在。 */
  private async fileExists(filePath: string): Promise<boolean> {
    if (!isPathInside(filePath, this.directories.audioCache)) {
      return false;
    }
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }
}

/**
 * 在 Windows 文件仍被短暂占用时重试替换，并为最终兜底保留可读索引。
 * @param source 临时索引路径
 * @param destination 正式索引路径
 * @param logger 脱敏日志器
 */
async function replaceFileWithRetry(
  source: string,
  destination: string,
  logger: AppLogger,
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableRenameError(error)) {
        throw error;
      }
      await delay(20 * (attempt + 1));
    }
  }

  try {
    await fs.copyFile(source, destination);
    logger.warn('audio.cache-index-non-atomic-replace', {
      destination,
    });
    return;
  } catch (error) {
    throw lastError ?? error;
  }
}

/** 判断是否属于可以等待后重试的 Windows 文件占用错误。 */
function isRetryableRenameError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

/** 等待文件句柄释放，避免忙等占用主进程事件循环。 */
function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}
