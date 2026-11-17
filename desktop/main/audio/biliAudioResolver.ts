import {
  config,
  createBiliApi,
  createBiliHttpClient,
  normalizeAudio,
  ResourceUnavailableError,
  WbiSigner,
  type BiliApi,
  type BiliVideoInfo,
} from '../../../packages/core/src';
import type {
  CredentialStore as CredentialStorePort,
  KeyValueStore,
} from '../../../packages/platform-contracts/src';
import type {PlaybackQueueItem} from '../../shared/types';
import {CredentialStore} from '../auth/credentialStore';
import {AppLogger} from '../logging/appLogger';
import {isAllowedBiliAudioUrl} from '../security/urlPolicy';

type AudioQuality = 'low' | 'medium' | 'high';

type AudioCandidate = {
  id: number;
  bandwidth: number;
  mimeType: string;
  baseUrl: string;
  backupUrl: string[];
};

export type ResolvedPlaybackAudio = {
  track: PlaybackQueueItem;
  cid: number;
  url: string;
  backupUrls: string[];
  mimeType: string;
  duration: number;
  parts: PlaybackQueueItem[];
};

/**
 * 将共享 Bilibili API 适配为桌面播放器的音频解析端口。
 * 解析出的 URL 只在主进程内部短暂使用，Renderer 只接收当前播放所需地址。
 */
export class BiliAudioResolver {
  private readonly api: BiliApi;

  constructor(
    private readonly credentials: CredentialStore,
    private readonly logger: AppLogger,
  ) {
    const credentialPort: CredentialStorePort = {
      getCredentials: () => this.credentials.getCredentials(),
      saveCredentials: (cookie, refreshToken) =>
        this.credentials.saveCredentials(cookie, refreshToken),
      clearCredentials: () => this.credentials.clearCredentials(),
    };
    const http = createBiliHttpClient({
      baseUrl: config.biliBaseURL,
      userAgent: config.userAgent,
      referer: config.referer,
      timeoutMs: config.httpTimeout,
      retries: 2,
      retryDelayMs: config.retry.delayMs,
      totalTimeoutMs: config.retry.totalTimeoutMs,
      credentials: credentialPort,
      onAuthRequired: () => {
        this.logger.warn('audio.auth-required');
      },
    });
    const keyValueStore = new MemoryKeyValueStore();
    const wbi = new WbiSigner(
      async () => {
        const response = await http.get<{
          wbi_img?: {
            img_url?: string;
            sub_url?: string;
          };
        }>(
          '/x/web-interface/nav',
          {
            silent: true,
          },
          1,
        );
        const imgKey = extractWbiKey(response.wbi_img?.img_url);
        const subKey = extractWbiKey(response.wbi_img?.sub_url);
        if (!imgKey || !subKey) {
          throw new Error('获取 WBI 密钥失败');
        }
        return {imgKey, subKey};
      },
      keyValueStore,
      config.cacheTTL.wbiKeys,
    );
    this.api = createBiliApi({
      http,
      wbi,
      credentials: credentialPort,
    });
  }

  /** 获取视频详情中的所有分 P，失败由调用方决定是否保留原项目。 */
  async getParts(
    bvid: string,
    signal?: AbortSignal,
  ): Promise<PlaybackQueueItem[]> {
    const info = await this.api.getVideoInfo(bvid, signal);
    return toQueueParts(info, bvid);
  }

  /** 解析当前队列项的 DASH 或 durl 音频地址。 */
  async resolve(
    track: PlaybackQueueItem,
    signal?: AbortSignal,
    quality: AudioQuality = 'high',
  ): Promise<ResolvedPlaybackAudio> {
    const info = await this.api.getVideoInfo(track.bvid, signal);
    const cid = track.cid ?? info.cid;
    const playUrl = await this.api.getPlayUrl(track.bvid, cid, signal);
    const audios = (playUrl.dash?.audio ?? []).map(normalizeAudio);
    const candidates = audios.length
      ? audios
      : (playUrl.durl ?? []).map(item => ({
          id: 30216,
          bandwidth: 0,
          mimeType: 'audio/mp4',
          baseUrl: item.url,
          backupUrl: item.backup_url ?? [],
        }));
    if (candidates.length === 0) {
      throw new ResourceUnavailableError('该视频无可用音频流');
    }
    const audio = pickAudio(candidates, quality);
    const url = audio.baseUrl;
    if (!isAllowedBiliAudioUrl(url)) {
      throw new Error('Bilibili 返回了不受支持的音频地址');
    }
    const backupUrls = audio.backupUrl.filter(isAllowedBiliAudioUrl);
    return {
      track: {
        ...track,
        id: track.id || buildTrackId(track.bvid, track.cid),
        cid,
        duration: track.duration || info.duration,
        title: track.title || info.title,
        artist: track.artist || info.owner?.name || '未知 UP 主',
        artwork: track.artwork || info.pic,
      },
      cid,
      url,
      backupUrls,
      mimeType: audio.mimeType,
      duration: track.duration || info.duration,
      parts: toQueueParts(info, track.bvid),
    };
  }
}

/** 共享 API 所需的桌面内存键值存储。 */
class MemoryKeyValueStore implements KeyValueStore {
  private readonly values = new Map<string, string>();

  /** 读取字符串值。 */
  getString(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  /** 写入字符串值。 */
  setString(key: string, value: string): void {
    this.values.set(key, value);
  }

  /** 删除字符串值。 */
  delete(key: string): void {
    this.values.delete(key);
  }

  /** 判断键是否存在。 */
  contains(key: string): boolean {
    return this.values.has(key);
  }
}

/** 从 Bilibili 图片地址提取 WBI 文件名。 */
function extractWbiKey(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const fileName = value.slice(value.lastIndexOf('/') + 1);
  const extensionIndex = fileName.lastIndexOf('.');
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
}

/** 将视频详情分 P 转换为独立队列项。 */
function toQueueParts(
  info: BiliVideoInfo,
  bvid: string,
): PlaybackQueueItem[] {
  const parts = info.pages ?? [];
  if (parts.length <= 1) {
    return [];
  }
  return parts.map(part => ({
    id: buildTrackId(bvid, part.cid),
    bvid,
    cid: part.cid,
    page: part.page,
    title: part.part || info.title,
    artist: info.owner?.name || '未知 UP 主',
    artwork: info.pic,
    duration: part.duration,
  }));
}

/** 根据当前项的 BVID 和 CID 生成不会冲突的队列 ID。 */
function buildTrackId(bvid: string, cid?: number): string {
  return cid ? `${bvid}:c${cid}` : bvid;
}

/** 按音质优先级选择可用的音频流。 */
function pickAudio<T extends AudioCandidate>(
  audios: T[],
  quality: AudioQuality,
): T {
  const qualityIds: Record<AudioQuality, number[]> = {
    high: [30280, 30232, 30216],
    medium: [30232, 30216, 30280],
    low: [30216, 30232, 30280],
  };
  for (const id of qualityIds[quality]) {
    const matched = audios.find(audio => audio.id === id);
    if (matched) {
      return matched;
    }
  }
  return [...audios].sort((left, right) => right.bandwidth - left.bandwidth)[0];
}

