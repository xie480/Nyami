import RNFS from 'react-native-fs';
import { storage } from '../core/storage';
import LoggerService from './LoggerService';
import type { Quality } from '../types/domain';

const CACHE_DIR = `${RNFS.DocumentDirectoryPath}/audio_cache`;
const LEGACY_META_KEY = 'audioCache:meta';
// 旧版本元数据没有可靠的媒体来源信息，曾可能把错误 URL 下载到曲目缓存中。
// 使用新索引版本使旧缓存不再命中；旧媒体文件保留在目录中，避免无提示地批量删除用户文件。
const META_KEY = 'audioCache:meta:v2';
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB

interface CacheItem {
  bvid: string;
  quality: Quality;
  sourceId?: number;
  mimeType?: string;
  path: string;
  size: number;
  lastAccess: number;
}
type MetaMap = Record<string, CacheItem>;

class AudioCache {
  private ready: Promise<void>;
  private downloading = new Map<string, Promise<string>>();

  constructor() {
    this.ready = this.init();
  }
  private async init() {
    if (!(await RNFS.exists(CACHE_DIR))) {
      await RNFS.mkdir(CACHE_DIR);
    }
  }
  private getMeta = (): MetaMap => storage.getJSON<MetaMap>(META_KEY) || {};
  private setMeta = (m: MetaMap) => storage.setJSON(META_KEY, m);
  /** 生成包含实际音轨身份的严格缓存键。 */
  private key = (
    b: string,
    q: Quality,
    sourceId?: number,
    mimeType?: string,
  ) =>
    `${b}:${q}:${sourceId == null ? 'unknown' : sourceId}:${
      mimeType ? encodeURIComponent(mimeType) : 'unknown'
    }`;

  /** 判断缓存项是否包含完整的实际音轨身份。 */
  private hasIdentity = (item: CacheItem): boolean =>
    Number.isSafeInteger(item.sourceId) && Boolean(item.mimeType);

  /** 判断缓存项是否属于当前请求且键符合严格身份格式。 */
  private matchesStrictKey = (key: string, item: CacheItem): boolean =>
    this.hasIdentity(item) &&
    key === this.key(item.bvid, item.quality, item.sourceId, item.mimeType);

  async has(
    bvid: string,
    quality: Quality,
    sourceId?: number,
    mimeType?: string,
  ): Promise<string | null> {
    await this.ready;
    const meta = this.getMeta();
    const hasRequestedIdentity =
      Number.isSafeInteger(sourceId) && Boolean(mimeType);
    const candidates = Object.entries(meta)
      .filter(([key, item]) => {
        if (
          item.bvid !== bvid ||
          item.quality !== quality ||
          !this.matchesStrictKey(key, item)
        ) {
          return false;
        }
        return hasRequestedIdentity
          ? key === this.key(bvid, quality, sourceId, mimeType)
          : true;
      })
      .sort(([, left], [, right]) => right.lastAccess - left.lastAccess);
    for (const [key, item] of candidates) {
      if (!(await RNFS.exists(item.path))) {
        delete meta[key];
        continue;
      }
      item.lastAccess = Date.now();
      this.setMeta(meta);
      return item.path;
    }
    if (candidates.length > 0) {
      this.setMeta(meta);
    }
    return null;
  }

  async download(
    bvid: string,
    quality: Quality,
    streamUrl: string,
    headers?: Record<string, string>,
    sourceId?: number,
    mimeType?: string,
  ): Promise<string> {
    await this.ready;
    if (!Number.isSafeInteger(sourceId) || !mimeType) {
      throw new Error('严格缓存写入缺少实际音轨身份');
    }
    const cacheKey = this.key(bvid, quality, sourceId, mimeType);

    // 防止同一音频并发下载导致重复写入文件或缓存冲突
    if (this.downloading.has(cacheKey)) {
      return this.downloading.get(cacheKey)!;
    }

    // 检查是否已有缓存
    const existing = await this.has(bvid, quality, sourceId, mimeType);
    if (existing) return existing;

    const downloadPromise = (async () => {
      const safeName = cacheKey.replace(/[^A-Za-z0-9._-]/g, '_');
      const filePath = `${CACHE_DIR}/${safeName}.m4a`;
      try {
        const result = await RNFS.downloadFile({
          fromUrl: streamUrl,
          toFile: filePath,
          headers,
          background: true,
          discretionary: true,
        }).promise;

        if (result.statusCode !== 200 && result.statusCode !== 206) {
          // 清理可能的残留文件以防止缓存误判
          try {
            if (await RNFS.exists(filePath)) {
              await RNFS.unlink(filePath);
            }
          } catch {}
          throw new Error(`下载失败 ${result.statusCode}`);
        }

        const stat = await RNFS.stat(filePath);
        const meta = this.getMeta();
        meta[cacheKey] = {
          bvid,
          quality,
          sourceId,
          mimeType,
          path: filePath,
          size: Number(stat.size),
          lastAccess: Date.now(),
        };
        this.setMeta(meta);
        // 触发空间回收（不需要 await，后台执行即可）
        this.tryEvict();
        return filePath;
      } catch (error) {
        // 下载异常，清理残余文件
        try {
          if (await RNFS.exists(filePath)) {
            await RNFS.unlink(filePath);
          }
        } catch (cleanupError) {
          LoggerService.error('audioCache', 'download', '清理残余缓存文件失败:', cleanupError);
        }
        throw error;
      } finally {
        // 下载结束后移除记录，确保后续请求能重新触发下载（若失败则会重新尝试）
        this.downloading.delete(cacheKey);
      }
    })();

    this.downloading.set(cacheKey, downloadPromise);
    return downloadPromise;
  }

  async remove(bvid: string, quality: Quality, cid?: number): Promise<void> {
    await this.ready;
    const meta = this.getMeta();
    const cacheIdentity = cid == null ? bvid : `${bvid}-${cid}`;
    const entries = Object.entries(meta).filter(
      ([, item]) =>
        item.bvid === cacheIdentity && item.quality === quality,
    );
    for (const [key, item] of entries) {
      delete meta[key];
      try {
        if (await RNFS.exists(item.path)) {
          await RNFS.unlink(item.path);
        }
      } catch (error) {
        LoggerService.error('audioCache', 'remove', '移除失败音频缓存失败:', error);
      }
    }
    this.setMeta(meta);
  }

  getTotalSize(): number {
    return Object.values(this.getMeta()).reduce((s, it) => s + (it.size || 0), 0);
  }
  getCount(): number {
    return Object.keys(this.getMeta()).length;
  }

  private async tryEvict() {
    let total = this.getTotalSize();
    if (total <= MAX_BYTES) return;
    const meta = this.getMeta();
    const items = Object.entries(meta).sort(
      ([, a], [, b]) => a.lastAccess - b.lastAccess
    );
    for (const [key, item] of items) {
      if (total <= MAX_BYTES * 0.9) break;
      try {
        if (await RNFS.exists(item.path)) await RNFS.unlink(item.path);
      } catch {}
      total -= item.size;
      delete meta[key];
    }
    this.setMeta(meta);
  }

  async clearAll() {
    await this.ready;
    // 一并清理旧索引引用的文件，保持设置页“清理缓存”的既有语义。
    const legacyMeta = storage.getJSON<MetaMap>(LEGACY_META_KEY) || {};
    const meta = {...legacyMeta, ...this.getMeta()};
    for (const item of Object.values(meta)) {
      try {
        if (await RNFS.exists(item.path)) await RNFS.unlink(item.path);
      } catch {}
    }
    this.setMeta({});
    storage.delete(LEGACY_META_KEY);
  }
}

export const audioCache = new AudioCache();
