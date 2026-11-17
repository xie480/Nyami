/**
 * Windows 桌面端的跨进程数据契约。
 * 这些类型只描述安全的命令、事件和探测结果，不包含 Cookie 或 refresh token。
 */

export const IPC_CHANNELS = {
  auth: {
    startQrLogin: 'auth:start-qr-login',
    cancelQrLogin: 'auth:cancel-qr-login',
    getStatus: 'auth:get-status',
    logout: 'auth:logout',
    qrStatus: 'auth:qr-status',
  },
  playback: {
    getState: 'playback:get-state',
    play: 'playback:play',
    pause: 'playback:pause',
    stop: 'playback:stop',
    seek: 'playback:seek',
    skipNext: 'playback:skip-next',
    skipPrevious: 'playback:skip-previous',
    setVolume: 'playback:set-volume',
    stateChanged: 'playback:state-changed',
  },
  sync: {
    getStatus: 'sync:get-status',
    start: 'sync:start',
    cancel: 'sync:cancel',
    stateChanged: 'sync:state-changed',
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
    reportRendererError: 'logs:report-renderer-error',
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
  position: number;
  duration: number;
  volume: number;
  queueLength: number;
  error: string | null;
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

export type SyncSnapshot = {
  state: SyncState;
  taskId: string | null;
  completed: number;
  total: number;
  error: string | null;
};

export type CacheSummary = {
  audioBytes: number;
  imageBytes: number;
  fileCount: number;
  updatedAt: number;
};

export type DesktopTheme = 'system' | 'light' | 'dark' | 'glass';

export type WindowSettings = {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
};

export type DesktopSettings = {
  version: 1;
  theme: DesktopTheme;
  closeToTray: boolean;
  window: WindowSettings;
};

export type DesktopSettingsPatch = Partial<
  Omit<DesktopSettings, 'version' | 'window'>
> & {
  window?: Partial<WindowSettings>;
};

export type DesktopLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type DesktopLogEntry = {
  timestamp: string;
  level: DesktopLogLevel;
  event: string;
  details?: Record<string, unknown>;
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
    logout: () => Promise<void>;
    onQrStatus: (listener: (event: QrStatusEvent) => void) => () => void;
  };
  probes: {
    inspectAudio: (request: AudioProbeRequest) => Promise<AudioProbeResult>;
    getSampleAudioUrl: () => Promise<string>;
    getRecentAudioRequests: () => Promise<AudioRequestRecord[]>;
    clearRecentAudioRequests: () => Promise<void>;
  };
  playback: {
    getState: () => Promise<PlaybackSnapshot>;
    play: () => Promise<PlaybackSnapshot>;
    pause: () => Promise<PlaybackSnapshot>;
    stop: () => Promise<PlaybackSnapshot>;
    seek: (request: PlaybackSeekRequest) => Promise<PlaybackSnapshot>;
    skipNext: () => Promise<PlaybackSnapshot>;
    skipPrevious: () => Promise<PlaybackSnapshot>;
    setVolume: (request: PlaybackVolumeRequest) => Promise<PlaybackSnapshot>;
    onStateChanged: (listener: (event: PlaybackStateEvent) => void) => () => void;
  };
  sync: {
    getStatus: () => Promise<SyncSnapshot>;
    start: () => Promise<SyncSnapshot>;
    cancel: () => Promise<SyncSnapshot>;
    onStateChanged: (listener: (event: SyncStateEvent) => void) => () => void;
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
    reportRendererError: (report: RendererErrorReport) => Promise<void>;
  };
};
