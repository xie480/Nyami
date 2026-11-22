import {app} from 'electron';
import path from 'node:path';
import {DESKTOP_APP_ID} from './constants';
import {
  registerLocalAudioHandler,
  registerLocalAudioScheme,
} from './audio/localAudioProtocol';
import {AppLogger} from './logging/appLogger';
import {
  installProcessErrorBoundary,
} from './process/errorBoundary';
import {
  ensureAppDirectories,
  getAppDirectories,
} from './storage/appDirectories';
import {SettingsStore} from './storage/settingsStore';
import {createMainWindow} from './window/createWindow';

registerLocalAudioScheme();

const logger = new AppLogger();
const disposeProcessErrorBoundary = installProcessErrorBoundary(logger);
const hasSingleInstance = app.requestSingleInstanceLock();

let mainWindow: Electron.BrowserWindow | null = null;
let desktopShell: import('./tray/desktopShell').DesktopShell | null = null;
let disposeWindow: (() => void) | null = null;
let flushPlaybackState: (() => Promise<void>) | null = null;
let flushingPlaybackState = false;
let shouldFocusWhenReady = false;
let pendingAssociatedFile: string | null = findAssociatedFile(process.argv);
let localAudioHandlerRegistered = false;
let bootstrapPromise: Promise<void> | null = null;

if (!hasSingleInstance) {
  disposeProcessErrorBoundary();
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const associatedFile = findAssociatedFile(commandLine);
    if (associatedFile) {
      pendingAssociatedFile = associatedFile;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      focusMainWindow(mainWindow);
      return;
    }
    shouldFocusWhenReady = true;
  });

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      void startBootstrap();
    }
  });

  app.whenReady().then(() => startBootstrap()).catch(error => {
    logger.error('app.bootstrap-failed', {
      error,
    });
    app.quit();
  });

  app.on('before-quit', event => {
    desktopShell?.markQuitting();
    if (flushPlaybackState && !flushingPlaybackState) {
      event.preventDefault();
      flushingPlaybackState = true;
      const flush = flushPlaybackState;
      void flush()
        .catch(error => {
          logger.warn('playback.state-flush-failed', {error});
        })
        .finally(() => {
          flushPlaybackState = null;
          app.quit();
        });
      return;
    }
    disposeWindow?.();
    disposeWindow = null;
    mainWindow = null;
    desktopShell = null;
    disposeProcessErrorBoundary();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

/**
 * 初始化数据目录、设置和主窗口。
 * @returns 初始化完成后的 Promise
 */
async function bootstrap(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow(mainWindow);
    return;
  }

  app.setAppUserModelId(DESKTOP_APP_ID);
  const directories = getAppDirectories();
  await ensureAppDirectories(directories);
  await logger.initialize(directories.logs);
  if (pendingAssociatedFile) {
    logger.info('app.file-association-opened', {
      extension: path.extname(pendingAssociatedFile).toLowerCase(),
    });
    pendingAssociatedFile = null;
  }
  const settingsStore = new SettingsStore(directories);
  const settings = await settingsStore.load();
  logger.info('app.ready', {
    settingsVersion: settings.version,
    theme: settings.theme,
  });
  if (!localAudioHandlerRegistered) {
    registerLocalAudioHandler();
    localAudioHandlerRegistered = true;
  }

  const runtime = createMainWindow({
    directories,
    logger,
    settingsStore,
  });
  mainWindow = runtime.window;
  desktopShell = runtime.shell;
  flushPlaybackState = runtime.flushPlaybackState;
  disposeWindow = runtime.dispose;
  globalThis.__nyamiMainWindow = runtime.window;

  if (shouldFocusWhenReady) {
    shouldFocusWhenReady = false;
    focusMainWindow(runtime.window);
  }
}

/**
 * 串行化窗口初始化，避免系统重复激活时创建多个主窗口。
 * @returns 当前初始化任务
 */
function startBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap().finally(() => {
      bootstrapPromise = null;
    });
  }
  return bootstrapPromise;
}

/**
 * 将已存在的主窗口恢复到前台并取得焦点。
 * @param window 目标主窗口
 * @returns 无返回值
 */
function focusMainWindow(window: Electron.BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }
  if (!window.isVisible()) {
    window.show();
  }
  window.focus();
}

/**
 * 从启动参数中提取 Nyami 播放队列文件，避免将任意参数当作文件打开。
 * @param commandLine Electron 启动参数
 * @returns 受支持的 .nyami 文件路径；没有时返回 null
 */
function findAssociatedFile(commandLine: readonly string[]): string | null {
  return (
    commandLine.find(argument => {
      if (!argument || argument.startsWith('-')) {
        return false;
      }
      return path.extname(argument).toLowerCase() === '.nyami';
    }) ?? null
  );
}

declare global {
  var __nyamiMainWindow: Electron.BrowserWindow | undefined;
}
