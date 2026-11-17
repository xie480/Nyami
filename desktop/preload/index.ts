import {contextBridge, ipcRenderer} from 'electron';
import type {
  AudioProbeRequest,
  CacheProgressEvent,
  DesktopSettings,
  DesktopSettingsPatch,
  NyamiDesktopApi,
  PlaybackSeekRequest,
  PlaybackStateEvent,
  PlaybackVolumeRequest,
  QrStatusEvent,
  RendererErrorReport,
  SyncStateEvent,
} from '../shared/types';
import {IPC_CHANNELS as CHANNELS} from '../shared/types';

/**
 * 将主进程白名单命令暴露给 Renderer。
 * 不导出 ipcRenderer、Node 模块、完整 Cookie 或二维码轮询密钥。
 */
/**
 * 创建类型化的主进程事件订阅器。
 * @param channel 白名单事件频道
 * @param listener Renderer 回调
 * @returns 取消订阅函数
 */
function subscribe<T>(
  channel: string,
  listener: (event: T) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T): void => {
    listener(data);
  };
  ipcRenderer.on(channel, handler);
  return (): void => {
    ipcRenderer.removeListener(channel, handler);
  };
}

/**
 * 将主进程白名单命令暴露给 Renderer。
 * 不导出 ipcRenderer、Node 模块、完整 Cookie 或二维码轮询密钥。
 */
const api: NyamiDesktopApi = {
  auth: {
    startQrLogin: () => ipcRenderer.invoke(CHANNELS.auth.startQrLogin),
    cancelQrLogin: () => ipcRenderer.invoke(CHANNELS.auth.cancelQrLogin),
    getStatus: () => ipcRenderer.invoke(CHANNELS.auth.getStatus),
    logout: () => ipcRenderer.invoke(CHANNELS.auth.logout),
    onQrStatus: listener =>
      subscribe<QrStatusEvent>(CHANNELS.auth.qrStatus, listener),
  },
  probes: {
    inspectAudio: (request: AudioProbeRequest) =>
      ipcRenderer.invoke(CHANNELS.probes.inspectAudio, request),
    getSampleAudioUrl: () => ipcRenderer.invoke(CHANNELS.probes.getSampleUrl),
    getRecentAudioRequests: () =>
      ipcRenderer.invoke(CHANNELS.probes.getRequestLog),
    clearRecentAudioRequests: () =>
      ipcRenderer.invoke(CHANNELS.probes.clearRequestLog),
  },
  playback: {
    getState: () => ipcRenderer.invoke(CHANNELS.playback.getState),
    play: () => ipcRenderer.invoke(CHANNELS.playback.play),
    pause: () => ipcRenderer.invoke(CHANNELS.playback.pause),
    stop: () => ipcRenderer.invoke(CHANNELS.playback.stop),
    seek: (request: PlaybackSeekRequest) =>
      ipcRenderer.invoke(CHANNELS.playback.seek, request),
    skipNext: () => ipcRenderer.invoke(CHANNELS.playback.skipNext),
    skipPrevious: () => ipcRenderer.invoke(CHANNELS.playback.skipPrevious),
    setVolume: (request: PlaybackVolumeRequest) =>
      ipcRenderer.invoke(CHANNELS.playback.setVolume, request),
    onStateChanged: listener =>
      subscribe<PlaybackStateEvent>(
        CHANNELS.playback.stateChanged,
        listener,
      ),
  },
  sync: {
    getStatus: () => ipcRenderer.invoke(CHANNELS.sync.getStatus),
    start: () => ipcRenderer.invoke(CHANNELS.sync.start),
    cancel: () => ipcRenderer.invoke(CHANNELS.sync.cancel),
    onStateChanged: listener =>
      subscribe<SyncStateEvent>(CHANNELS.sync.stateChanged, listener),
  },
  cache: {
    getSummary: () => ipcRenderer.invoke(CHANNELS.cache.getSummary),
    clear: () => ipcRenderer.invoke(CHANNELS.cache.clear),
    onProgress: listener =>
      subscribe<CacheProgressEvent>(CHANNELS.cache.progress, listener),
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settings.get),
    update: (patch: DesktopSettingsPatch) =>
      ipcRenderer.invoke(CHANNELS.settings.update, patch),
    onChanged: listener =>
      subscribe<DesktopSettings>(CHANNELS.settings.changed, listener),
  },
  logs: {
    getRecent: (limit?: number) =>
      ipcRenderer.invoke(CHANNELS.logs.getRecent, limit),
    clear: () => ipcRenderer.invoke(CHANNELS.logs.clear),
    reportRendererError: (report: RendererErrorReport) =>
      ipcRenderer.invoke(CHANNELS.logs.reportRendererError, report),
  },
};

contextBridge.exposeInMainWorld('nyamiDesktop', api);
