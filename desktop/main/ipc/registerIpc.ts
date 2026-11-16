import {ipcMain, BrowserWindow} from 'electron';
import type {AudioProbeRequest} from '../../shared/types';
import {AudioProbe} from '../audio/audioProbe';
import {AudioRequestRecorder} from '../audio/audioRequestRecorder';
import {getSampleAudioUrl} from '../audio/localAudioProtocol';
import {QrLoginController} from '../auth/qrLoginController';

/**
 * 注册阶段 0 的类型化 IPC 命令。
 * Renderer 只能调用白名单方法，不能直接接触 ipcRenderer、Cookie 或 Node API。
 */
export function registerIpcHandlers(
  window: BrowserWindow,
  qrLogin: QrLoginController,
  audioProbe: AudioProbe,
  recorder: AudioRequestRecorder,
): () => void {
  const channels = [
    'auth:start-qr-login',
    'auth:cancel-qr-login',
    'auth:get-status',
    'auth:logout',
    'probe:inspect-audio',
    'probe:get-sample-url',
    'probe:get-request-log',
    'probe:clear-request-log',
  ];

  ipcMain.handle('auth:start-qr-login', () => qrLogin.start());
  ipcMain.handle('auth:cancel-qr-login', () => {
    qrLogin.stopSession();
  });
  ipcMain.handle('auth:get-status', () => qrLogin.getStatus());
  ipcMain.handle('auth:logout', () => qrLogin.logout());
  ipcMain.handle('probe:inspect-audio', (_event, request: AudioProbeRequest) =>
    audioProbe.inspect(request),
  );
  ipcMain.handle('probe:get-sample-url', () => getSampleAudioUrl());
  ipcMain.handle('probe:get-request-log', () => recorder.list());
  ipcMain.handle('probe:clear-request-log', () => recorder.clear());

  return () => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel);
    }
    if (!window.isDestroyed()) {
      qrLogin.dispose();
    }
  };
}
