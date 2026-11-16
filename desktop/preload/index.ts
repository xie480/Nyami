import {contextBridge, ipcRenderer} from 'electron';
import type {
  AudioProbeRequest,
  NyamiDesktopApi,
  QrStatusEvent,
} from '../shared/types';

/**
 * 将主进程白名单命令暴露给 Renderer。
 * 不导出 ipcRenderer、Node 模块、完整 Cookie 或二维码轮询密钥。
 */
const api: NyamiDesktopApi = {
  auth: {
    startQrLogin: () => ipcRenderer.invoke('auth:start-qr-login'),
    cancelQrLogin: () => ipcRenderer.invoke('auth:cancel-qr-login'),
    getStatus: () => ipcRenderer.invoke('auth:get-status'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    onQrStatus: listener => {
      const handler = (_event: Electron.IpcRendererEvent, data: QrStatusEvent) =>
        listener(data);
      ipcRenderer.on('auth:qr-status', handler);
      return () => {
        ipcRenderer.removeListener('auth:qr-status', handler);
      };
    },
  },
  probes: {
    inspectAudio: (request: AudioProbeRequest) =>
      ipcRenderer.invoke('probe:inspect-audio', request),
    getSampleAudioUrl: () => ipcRenderer.invoke('probe:get-sample-url'),
    getRecentAudioRequests: () => ipcRenderer.invoke('probe:get-request-log'),
    clearRecentAudioRequests: () =>
      ipcRenderer.invoke('probe:clear-request-log'),
  },
};

contextBridge.exposeInMainWorld('nyamiDesktop', api);
