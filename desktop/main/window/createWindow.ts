import {BrowserWindow, session} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AudioProbe} from '../audio/audioProbe';
import {AudioRequestRecorder} from '../audio/audioRequestRecorder';
import {registerAudioInterception} from '../audio/registerAudioInterception';
import {QrLoginController} from '../auth/qrLoginController';
import {registerIpcHandlers} from '../ipc/registerIpc';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

/**
 * 创建受安全边界保护的桌面主窗口。
 * @returns 主窗口和阶段 0 运行时资源
 */
export function createMainWindow(): {
  window: BrowserWindow;
  dispose: () => void;
} {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#10131a',
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  const recorder = new AudioRequestRecorder();
  registerAudioInterception(session.defaultSession, recorder);
  const qrLogin = new QrLoginController(window);
  const audioProbe = new AudioProbe();
  const disposeIpc = registerIpcHandlers(
    window,
    qrLogin,
    audioProbe,
    recorder,
  );

  window.once('ready-to-show', () => {
    window.show();
  });
  window.on('closed', () => {
    disposeIpc();
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(currentDir, '../renderer/index.html'));
  }

  return {
    window,
    dispose: disposeIpc,
  };
}
