/**
 * Windows 桌面端的跨进程数据契约。
 * 这些类型只描述安全的命令、事件和探测结果，不包含 Cookie 或 refresh token。
 */

export const IPC_CHANNELS = {
  auth: {
    startQrLogin: 'auth:start-qr-login',
    cancelQrLogin: 'auth:cancel-qr-login',
    getStatus: 'auth:get-status',
    getProfile: 'auth:get-profile',
    openWebLogin: 'auth:open-web-login',
    renew: 'auth:renew',
    closeWebLogin: 'auth:close-web-login',
    logout: 'auth:logout',
    qrStatus: 'auth:qr-status',
    webViewState: 'auth:webview-state',
  },
  playback: {
    getState: 'playback:get-state',
    loadQueue: 'playback:load-queue',
    addToQueue: 'playback:add-to-queue',
    removeFromQueue: 'playback:remove-from-queue',
    reorderQueue: 'playback:reorder-queue',
    setMode: 'playback:set-mode',
    setSleepTimer: 'playback:set-sleep-timer',
    reportAudioEvent: 'playback:report-audio-event',
    play: 'playback:play',
    pause: 'playback:pause',
    stop: 'playback:stop',
    seek: 'playback:seek',
    skipNext: 'playback:skip-next',
    skipPrevious: 'playback:skip-previous',
    setVolume: 'playback:set-volume',
    stateChanged: 'playback:state-changed',
    sourceChanged: 'playback:source-changed',
    command: 'playback:command',
  },
  sync: {
    getStatus: 'sync:get-status',
    start: 'sync:start',
    cancel: 'sync:cancel',
    stateChanged: 'sync:state-changed',
  },
  content: {
    getHome: 'content:get-home',
    getDiscover: 'content:get-discover',
    search: 'content:search',
    getFavoriteFolders: 'content:get-favorite-folders',
    getFavoriteSources: 'content:get-favorite-sources',
    getFavoriteIndex: 'content:get-favorite-index',
    getFavoriteSourceVideos: 'content:get-favorite-source-videos',
    refreshFavoriteSources: 'content:refresh-favorite-sources',
    deleteFavoriteSourceIndexes: 'content:delete-favorite-source-indexes',
    getFavoriteVideos: 'content:get-favorite-videos',
    searchFavorites: 'content:search-favorites',
    cancel: 'content:cancel',
  },
  cache: {
    getSummary: 'cache:get-summary',
    clear: 'cache:clear',
    progress: 'cache:progress',
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
    changed: 'settings:changed',
  },
  logs: {
    getRecent: 'logs:get-recent',
    clear: 'logs:clear',
    export: 'logs:export',
    reportRendererError: 'logs:report-renderer-error',
  },
  updates: {
    getStatus: 'updates:get-status',
    check: 'updates:check',
    openDownload: 'updates:open-download',
  },
  window: {
    getState: 'window:get-state',
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
    stateChanged: 'window:state-changed',
  },
  probes: {
    inspectAudio: 'probe:inspect-audio',
    getSampleUrl: 'probe:get-sample-url',
    getRequestLog: 'probe:get-request-log',
    clearRequestLog: 'probe:clear-request-log',
  },
} as const;

export type IpcChannel =
  (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS][keyof (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]];

export type QrLoginStatus =
  | 'idle'
  | 'waiting'
  | 'scanned'
  | 'success'
  | 'expired'
  | 'error'
  | 'cancelled';

export type AuthStatus = {
  loggedIn: boolean;
  uid: string | null;
  profile?: UserProfile | null;
  refreshAvailable?: boolean;
};

/** Renderer 可见的 Bilibili 账号资料，不包含任何凭证字段。 */
export type UserProfile = {
  uid: string;
  name: string;
  avatar: string;
  vipStatus: {
    type: number;
    status: number;
    dueDate?: number;
  };
};

export type QrSessionStartResult = {
  qrImageDataUrl: string;
  expiresAt: number;
};

export type QrStatusEvent = {
  status: QrLoginStatus;
  message: string;
  expiresAt?: number;
  auth?: AuthStatus;
};

export type AudioProbeRequest = {
  url: string;
  retryUrl?: string;
};

export type AudioProbeAttempt = {
  url: string;
  status: number | null;
  statusText: string;
  contentType: string | null;
  contentLength: string | null;
  contentRange: string | null;
  acceptRanges: string | null;
  error: string | null;
};

export type AudioProbeResult = {
  ok: boolean;
  finalUrl: string | null;
  rangeSupported: boolean;
  retried: boolean;
  attempts: AudioProbeAttempt[];
};

export type AudioRequestRecord = {
  requestId: string;
  host: string;
  pathname: string;
  method: string;
  range: string | null;
  status: number | null;
  contentRange: string | null;
  contentType: string | null;
  timestamp: number;
};

export type PlaybackState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'error';

export type PlaybackSnapshot = {
  state: PlaybackState;
  trackId: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
  artwork: string | null;
  position: number;
  duration: number;
  volume: number;
  queueLength: number;
  queueIndex: number;
  queue: PlaybackQueueItem[];
  mode: PlaybackQueueMode;
  queueContext: PlaybackQueueContext | null;
  sleepTimerSeconds: number | null;
  networkOnline: boolean;
  cached: boolean;
  error: string | null;
  diagnostic: PlaybackDiagnostic | null;
};

export type PlaybackQueueMode = 'sequential' | 'shuffle';

/** 播放队列的来源上下文，用于保持收藏夹、搜索和热门列表的来源边界。 */
export type PlaybackQueueContext =
  | {
      kind: 'popular';
      page: number;
    }
  | {
      kind: 'favorite';
      sourceKey: string;
    }
  | {
      kind: 'search';
      keyword: string;
      page: number;
    };

/** Renderer 可见的队列项，不包含签名后的 CDN 地址。 */
export type PlaybackQueueItem = {
  id: string;
  bvid: string;
  cid?: number;
  page?: number;
  title: string;
  artist: string;
  artwork: string;
  duration: number;
  source?: DesktopVideo['source'];
};

export type PlaybackQueueRequest = {
  items: PlaybackQueueItem[];
  startIndex?: number;
  autoplay?: boolean;
  expandParts?: boolean;
  context?: PlaybackQueueContext | null;
};

export type PlaybackQueueItemRequest = {
  item: PlaybackQueueItem;
  autoplay?: boolean;
  context?: PlaybackQueueContext | null;
};

export type PlaybackRemoveRequest = {
  trackId: string;
};

export type PlaybackReorderRequest = {
  trackIds: string[];
};

export type PlaybackModeRequest = {
  mode: PlaybackQueueMode;
};

export type PlaybackSleepTimerRequest = {
  seconds: number | null;
};

export type PlaybackSource = {
  trackId: string;
  url: string;
  cached: boolean;
  revision: number;
};

export type PlaybackSourceEvent = {
  source: PlaybackSource;
};

export type PlaybackCommand =
  | {
      type: 'play' | 'pause' | 'stop';
      trackId: string | null;
      revision: number;
    }
  | {
      type: 'seek';
      trackId: string | null;
      position: number;
      revision: number;
    }
  | {
      type: 'set-volume';
      trackId: string | null;
      volume: number;
      revision: number;
    }
  | {
      type: 'fade-in' | 'fade-out';
      trackId: string | null;
      volume: number;
      durationMs: number;
      revision: number;
    };

export type PlaybackCommandEvent = {
  command: PlaybackCommand;
};

export type PlaybackAudioEvent = {
  type:
    | 'loadedmetadata'
    | 'canplay'
    | 'playing'
    | 'pause'
    | 'waiting'
    | 'stalled'
    | 'timeupdate'
    | 'ended'
    | 'error'
    | 'network-online'
    | 'network-offline';
  trackId?: string | null;
  position?: number;
  duration?: number;
  buffered?: number;
  message?: string;
  code?: number;
};

export type PlaybackDiagnostic = {
  kind:
    | 'request-headers'
    | 'url-expired'
    | 'decode-failure'
    | 'disk-failure'
    | 'network-offline'
    | 'playback-error';
  message: string;
  retrying: boolean;
  timestamp: number;
};

export type PlaybackSeekRequest = {
  position: number;
};

export type PlaybackVolumeRequest = {
  volume: number;
};

export type SyncState =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SyncPhase = 'idle' | 'catalog' | 'favorites' | 'completed';

export type SyncSnapshot = {
  state: SyncState;
  taskId: string | null;
  completed: number;
  total: number;
  phase: SyncPhase;
  uid: string | null;
  processedVideos: number;
  totalVideos: number;
  skippedTasks: number;
  failedTasks: number;
  message: string | null;
  canRetry: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
};

export type SyncStartRequest = {
  force?: boolean;
  automatic?: boolean;
  sourceKeys?: readonly string[];
};

export type CacheSummary = {
  audioBytes: number;
  imageBytes: number;
  fileCount: number;
  updatedAt: number;
};

export type DesktopTheme = 'system' | 'light' | 'dark' | 'glass';

export type DesktopEqMode = 'graphic' | 'parametric';

export type DesktopGraphicPreset =
  | 'flat'
  | 'nyami'
  | 'cat_bass'
  | 'girl_band'
  | 'idol_stage'
  | 'midnight_radio'
  | 'vaporwave'
  | 'custom';

export type DesktopPeqFilterType =
  | 'Peak'
  | 'LowShelf'
  | 'HighShelf'
  | 'LowPass'
  | 'HighPass'
  | 'Notch'
  | 'BandPass';

export type DesktopPeqBand = {
  enabled: boolean;
  type: DesktopPeqFilterType;
  frequency: number;
  gain: number;
  q: number;
};

export type DesktopAudioSettings = {
  enabled: boolean;
  mode: DesktopEqMode;
  graphicPreset: DesktopGraphicPreset;
  graphicGains: number[];
  peqBands: DesktopPeqBand[];
  limiterEnabled: boolean;
  limiterThreshold: number;
  spectrumEnabled: boolean;
};

export type WindowSettings = {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
};

/** Renderer 可见的窗口状态，只描述自绘窗口控制所需信息。 */
export type DesktopWindowState = {
  isMaximized: boolean;
};

export type DesktopSettings = {
  version: 3;
  theme: DesktopTheme;
  closeToTray: boolean;
  autoSyncIndex: boolean;
  window: WindowSettings;
  audio: DesktopAudioSettings;
};

export type DesktopSettingsPatch = {
  theme?: DesktopTheme;
  closeToTray?: boolean;
  autoSyncIndex?: boolean;
  window?: Partial<WindowSettings>;
  audio?: Partial<DesktopAudioSettings> & {
    graphicGains?: number[];
    peqBands?: DesktopPeqBand[];
  };
};

export type DesktopLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type DesktopLogEntry = {
  timestamp: string;
  level: DesktopLogLevel;
  event: string;
  details?: Record<string, unknown>;
};

export type LogExportResult = {
  cancelled: boolean;
  path: string | null;
  bytes: number;
};

export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'disabled'
  | 'error';

/** Renderer 可见的更新检查结果，不包含更新源认证信息。 */
export type DesktopUpdateInfo = {
  status: DesktopUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseDate: string | null;
  notes: string | null;
  downloadUrl: string | null;
  portableUrl: string | null;
  sha256: string | null;
  blockmapUrl: string | null;
  source: string | null;
  checkedAt: number | null;
  error: string | null;
};

export type RendererErrorReport = {
  message: string;
  stack?: string;
  componentStack?: string;
};

export type PlaybackStateEvent = {
  snapshot: PlaybackSnapshot;
};

export type SyncStateEvent = {
  snapshot: SyncSnapshot;
};

/** 受控 Bilibili WebContentsView 的展示状态。 */
export type AuthWebViewState = {
  open: boolean;
  mode: 'login' | 'refresh' | null;
};

/** 统一的可取消内容请求基类。 */
export type ContentRequestBase = {
  requestId: string;
};

export type SearchContentRequest = ContentRequestBase & {
  keyword: string;
  page: number;
  /** B 站搜索排序值；筛选变化时由 Renderer 重新请求。 */
  order?: 'totalrank' | 'click' | 'pubdate' | 'danmaku' | 'stow';
  /** B 站时长筛选值，0 表示不限。 */
  duration?: 0 | 1 | 2 | 3 | 4;
  startDate?: number;
  endDate?: number;
  minDuration?: number;
  maxDuration?: number;
};

export type DiscoverContentRequest = ContentRequestBase & {
  page: number;
};

export type FavoriteFolderContentRequest = ContentRequestBase & {
  uid: string;
};

export type FavoriteSourceRequest = ContentRequestBase & {
  uid: string;
  sourceKeys?: string[];
  /** 只读取本地已持久化的来源元数据，不访问 Bilibili。 */
  localOnly?: boolean;
};

export type FavoriteIndexRequest = ContentRequestBase & {
  uid: string;
  sourceKeys?: string[];
};

export type FavoriteSourceVideoRequest = ContentRequestBase & {
  uid: string;
  sourceKey: string;
  page: number;
  /** 只读取本地已持久化的视频，不回退请求 Bilibili。 */
  localOnly?: boolean;
};

export type FavoriteVideoContentRequest = ContentRequestBase & {
  uid: string;
  mediaId: number;
  page: number;
};

export type FavoriteSearchContentRequest = ContentRequestBase & {
  uid: string;
  keyword: string;
  page: number;
};

/** 桌面内容卡片使用的统一视频模型。 */
export type DesktopVideo = {
  aid?: number;
  bvid: string;
  title: string;
  cover: string;
  duration: number;
  pubtime: number;
  authorId: number;
  author: string;
  tags: string[];
  page?: number;
  favTime?: number;
  sourceKeys?: string[];
  source?: 'search' | 'popular' | 'favorite';
};

export type DesktopPage<T> = {
  items: T[];
  page: number;
  hasMore: boolean;
  total: number | null;
  description?: string;
};

export type FavoriteFolderSummary = {
  id: number;
  fid: number;
  title: string;
  mediaCount: number;
  cover: string;
};

export type FavoriteSourceKind =
  | 'owned'
  | 'collectedFavorite'
  | 'subscribedSeason';

export type FavoriteSourceSyncStatus =
  | 'idle'
  | 'syncing'
  | 'success'
  | 'failed'
  | 'running';

export type FavoriteSourceSummary = {
  sourceKey: string;
  kind: FavoriteSourceKind;
  remoteId: number;
  ownerMid: number;
  ownerName: string;
  title: string;
  cover: string;
  mediaCount: number;
  description: string;
  syncStatus: FavoriteSourceSyncStatus;
  lastSyncedAt: number | null;
};

export type HomeSnapshot = {
  featured: DesktopVideo[];
  popular: DesktopVideo[];
};

export type CacheProgressEvent = {
  operation: 'clear' | 'scan';
  completed: number;
  total: number;
};

export type NyamiDesktopApi = {
  auth: {
    startQrLogin: () => Promise<QrSessionStartResult>;
    cancelQrLogin: () => Promise<void>;
    getStatus: () => Promise<AuthStatus>;
    getProfile: () => Promise<UserProfile | null>;
    openWebLogin: () => Promise<void>;
    renew: () => Promise<AuthStatus>;
    closeWebLogin: () => Promise<void>;
    logout: () => Promise<void>;
    onQrStatus: (listener: (event: QrStatusEvent) => void) => () => void;
    onWebViewState: (listener: (event: AuthWebViewState) => void) => () => void;
  };
  probes: {
    inspectAudio: (request: AudioProbeRequest) => Promise<AudioProbeResult>;
    getSampleAudioUrl: () => Promise<string>;
    getRecentAudioRequests: () => Promise<AudioRequestRecord[]>;
    clearRecentAudioRequests: () => Promise<void>;
  };
  playback: {
    getState: () => Promise<PlaybackSnapshot>;
    loadQueue: (request: PlaybackQueueRequest) => Promise<PlaybackSnapshot>;
    addToQueue: (
      request: PlaybackQueueItemRequest,
    ) => Promise<PlaybackSnapshot>;
    removeFromQueue: (
      request: PlaybackRemoveRequest,
    ) => Promise<PlaybackSnapshot>;
    reorderQueue: (
      request: PlaybackReorderRequest,
    ) => Promise<PlaybackSnapshot>;
    setMode: (request: PlaybackModeRequest) => Promise<PlaybackSnapshot>;
    setSleepTimer: (
      request: PlaybackSleepTimerRequest,
    ) => Promise<PlaybackSnapshot>;
    reportAudioEvent: (event: PlaybackAudioEvent) => Promise<PlaybackSnapshot>;
    play: () => Promise<PlaybackSnapshot>;
    pause: () => Promise<PlaybackSnapshot>;
    stop: () => Promise<PlaybackSnapshot>;
    seek: (request: PlaybackSeekRequest) => Promise<PlaybackSnapshot>;
    skipNext: () => Promise<PlaybackSnapshot>;
    skipPrevious: () => Promise<PlaybackSnapshot>;
    setVolume: (request: PlaybackVolumeRequest) => Promise<PlaybackSnapshot>;
    onStateChanged: (
      listener: (event: PlaybackStateEvent) => void,
    ) => () => void;
    onSourceChanged: (
      listener: (event: PlaybackSourceEvent) => void,
    ) => () => void;
    onCommand: (listener: (event: PlaybackCommandEvent) => void) => () => void;
  };
  sync: {
    getStatus: () => Promise<SyncSnapshot>;
    start: (request?: SyncStartRequest) => Promise<SyncSnapshot>;
    cancel: () => Promise<SyncSnapshot>;
    onStateChanged: (listener: (event: SyncStateEvent) => void) => () => void;
  };
  content: {
    getHome: (request: ContentRequestBase) => Promise<HomeSnapshot>;
    getDiscover: (
      request: DiscoverContentRequest,
    ) => Promise<DesktopPage<DesktopVideo>>;
    search: (
      request: SearchContentRequest,
    ) => Promise<DesktopPage<DesktopVideo>>;
    getFavoriteFolders: (
      request: FavoriteFolderContentRequest,
    ) => Promise<FavoriteFolderSummary[]>;
    getFavoriteSources: (
      request: FavoriteSourceRequest,
    ) => Promise<FavoriteSourceSummary[]>;
    getFavoriteIndex: (
      request: FavoriteIndexRequest,
    ) => Promise<DesktopVideo[]>;
    getFavoriteSourceVideos: (
      request: FavoriteSourceVideoRequest,
    ) => Promise<DesktopPage<DesktopVideo>>;
    refreshFavoriteSources: (
      request: FavoriteSourceRequest,
    ) => Promise<FavoriteSourceSummary[]>;
    deleteFavoriteSourceIndexes: (
      request: FavoriteSourceRequest,
    ) => Promise<void>;
    getFavoriteVideos: (
      request: FavoriteVideoContentRequest,
    ) => Promise<DesktopPage<DesktopVideo>>;
    searchFavorites: (
      request: FavoriteSearchContentRequest,
    ) => Promise<DesktopPage<DesktopVideo>>;
    cancel: (request: ContentRequestBase) => Promise<void>;
  };
  cache: {
    getSummary: () => Promise<CacheSummary>;
    clear: () => Promise<CacheSummary>;
    onProgress: (listener: (event: CacheProgressEvent) => void) => () => void;
  };
  settings: {
    get: () => Promise<DesktopSettings>;
    update: (patch: DesktopSettingsPatch) => Promise<DesktopSettings>;
    onChanged: (listener: (settings: DesktopSettings) => void) => () => void;
  };
  logs: {
    getRecent: (limit?: number) => Promise<DesktopLogEntry[]>;
    clear: () => Promise<void>;
    export: () => Promise<LogExportResult>;
    reportRendererError: (report: RendererErrorReport) => Promise<void>;
  };
  updates: {
    getStatus: () => Promise<DesktopUpdateInfo>;
    check: () => Promise<DesktopUpdateInfo>;
    openDownload: () => Promise<boolean>;
  };
  window: {
    getState: () => Promise<DesktopWindowState>;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<DesktopWindowState>;
    close: () => Promise<void>;
    onStateChanged: (
      listener: (state: DesktopWindowState) => void,
    ) => () => void;
  };
};
