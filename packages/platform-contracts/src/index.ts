/**
 * Nyami 平台能力契约。
 * 共享业务核心只依赖这些接口，不直接依赖 React Native、Electron 或具体存储驱动。
 */

export type RequestPriority = 'index' | 'normal' | 'background';

export type CredentialSnapshot = {
  cookie: string;
  refreshToken: string | null;
};

/** 凭证保存、读取和清理能力。 */
export interface CredentialStore {
  getCredentials(): Promise<CredentialSnapshot>;
  saveCredentials(
    cookie: string,
    refreshToken: string | null,
  ): Promise<void>;
  clearCredentials(): Promise<void>;
}

/** 轻量键值存储能力，供 WBI、设置和缓存元数据使用。 */
export interface KeyValueStore {
  getString(key: string): string | null;
  setString(key: string, value: string): void;
  delete(key: string): void;
  contains(key: string): boolean;
}

/** 文件系统能力，路径解析由平台实现负责。 */
export interface FileStore {
  getAppDirectories(): Promise<{
    root: string;
    cache: string;
    logs: string;
    settings: string;
  }>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

export type HttpParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export type HttpHeaders = Record<string, string>;

/** Bilibili HTTP 请求选项。 */
export type BiliHttpRequestOptions = {
  signal?: AbortSignal;
  params?: HttpParams;
  headers?: HttpHeaders;
  silent?: boolean;
  rateLimitPriority?: RequestPriority;
};

/** 共享 API 层使用的 HTTP 端口。 */
export interface BiliHttpPort {
  get<T>(
    url: string,
    options?: BiliHttpRequestOptions,
    retries?: number,
  ): Promise<T>;
  post<T>(
    url: string,
    body: string,
    options?: BiliHttpRequestOptions,
  ): Promise<T>;
}

/** WBI 签名端口。 */
export interface WbiSignerPort {
  getKeys(): Promise<{imgKey: string; subKey: string}>;
  sign(params: Record<string, unknown>): Promise<string> | string;
}

/** 音频适配层使用的最小轨道模型。 */
export type AudioTrackLike = {
  id: string;
  url: string;
  title?: string;
  artist?: string;
  artwork?: string;
  duration?: number;
};

export type AudioPlaybackState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'error';

export type AudioProgress = {
  position: number;
  duration: number;
  buffered: number;
};

/** 跨平台音频播放器接口。 */
export interface AudioPlayer<TTrack extends AudioTrackLike = AudioTrackLike> {
  setup(): Promise<void>;
  load(queue: TTrack[], startIndex?: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(position: number): Promise<void>;
  skipToNext(): Promise<void>;
  skipToPrevious(): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getState(): Promise<AudioPlaybackState>;
  getProgress(): Promise<AudioProgress>;
  subscribe(listener: (event: {
    state?: AudioPlaybackState;
    progress?: AudioProgress;
    trackId?: string | null;
    error?: Error;
  }) => void): () => void;
}

/** 本地数据库只暴露事务边界，业务仓储在上层定义具体语义。 */
export interface LocalDatabase {
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

/** 受控网页会话能力。 */
export interface WebSession {
  openTrustedPage(url: string): Promise<void>;
  readCookies(hosts: readonly string[]): Promise<string>;
  seedCookies(cookie: string): Promise<void>;
  runRefreshFlow(taskId: string): Promise<CredentialSnapshot>;
}

/** 系统通知能力。 */
export interface NotificationPort {
  show(title: string, body: string): Promise<void>;
}

/** 网络状态能力。 */
export interface NetworkStatusPort {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

/** 系统媒体键和媒体会话能力。 */
export interface MediaControlPort {
  setMetadata(metadata: {
    title: string;
    artist: string;
    artwork?: string;
  }): Promise<void>;
  subscribe(listener: (action: 'play' | 'pause' | 'next' | 'previous') => void): () => void;
}
