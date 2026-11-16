import {app} from 'electron';
import {DESKTOP_APP_ID} from './constants';
import {
  registerLocalAudioHandler,
  registerLocalAudioScheme,
} from './audio/localAudioProtocol';
import {createMainWindow} from './window/createWindow';

registerLocalAudioScheme();

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  let disposeWindow: (() => void) | null = null;

  app.on('second-instance', () => {
    const current = globalThis.__nyamiMainWindow;
    if (current && !current.isDestroyed()) {
      if (current.isMinimized()) {
        current.restore();
      }
      current.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId(DESKTOP_APP_ID);
    registerLocalAudioHandler();
    const runtime = createMainWindow();
    globalThis.__nyamiMainWindow = runtime.window;
    disposeWindow = runtime.dispose;
  });

  app.on('before-quit', () => {
    disposeWindow?.();
    disposeWindow = null;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

declare global {
  var __nyamiMainWindow: Electron.BrowserWindow | undefined;
}
