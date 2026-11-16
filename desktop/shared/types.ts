/**
 * Windows 桌面 spike 的跨进程数据契约。
 * 这些类型只描述安全的命令、事件和探测结果，不包含 Cookie 或 refresh token。
 */

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
  qrUrl: string;
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
};
