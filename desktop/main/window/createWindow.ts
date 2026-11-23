import {
  app,
  BrowserWindow,
  session,
  type BrowserWindowConstructorOptions,
} from 'electron';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {AudioProbe} from '../audio/audioProbe';
import {
  BiliAudioResolver,
  type AudioQuality,
} from '../audio/biliAudioResolver';
import {AudioRequestRecorder} from '../audio/audioRequestRecorder';
import {registerAudioCacheHandler} from '../audio/localAudioProtocol';
import {registerAudioInterception} from '../audio/registerAudioInterception';
import {QrLoginController} from '../auth/qrLoginController';
import {CredentialStore} from '../auth/credentialStore';
import {BiliContentRuntime} from '../content/biliContentRuntime';
import {DesktopLibraryRuntime} from '../content/desktopLibraryRuntime';
import {AppLogger} from '../logging/appLogger';
import {registerIpcHandlers} from '../ipc/registerIpc';
import {CacheManager} from '../runtime/cacheManager';
import {AudioCacheStore} from '../runtime/audioCacheStore';
import {PlaybackRuntime} from '../runtime/playbackRuntime';
import {SyncRuntime} from '../runtime/syncRuntime';
import {DesktopShell} from '../tray/desktopShell';
import type {AppDirectories} from '../storage/appDirectories';
import {DesktopLibraryRepository} from '../storage/desktopLibraryRepository';
import {SqliteDatabase} from '../storage/sqliteDatabase';
import {SettingsStore} from '../storage/settingsStore';
import {UpdateService} from '../updater/updateService';
import type {
  DesktopPlaybackQuality,
  PlaybackQueueContext,
  PlaybackQueueItem,
} from '../../shared/types';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

/**
 * 创建主窗口时由应用组合根注入的运行时依赖。
 */
export type MainWindowDependencies = {
  directories: AppDirectories;
  logger: AppLogger;
  settingsStore: SettingsStore;
};

/**
 * 创建受安全边界保护的桌面主窗口。
 * @param dependencies 主进程运行时依赖
 * @returns 主窗口和运行时资源清理函数
 */
export function createMainWindow(
  dependencies: MainWindowDependencies,
): {
  window: BrowserWindow;
  shell: DesktopShell;
  flushPlaybackState: () => Promise<void>;
  dispose: () => void;
} {
  const settings = dependencies.settingsStore.get();
  const windowOptions: BrowserWindowConstructorOptions = {
    width: settings.window.width,
    height: settings.window.height,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#10131a',
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      // 最小化后仍需及时派发 HTMLAudioElement 的 ended 事件，保证自动切歌不中断。
      backgroundThrottling: false,
    },
  };
  if (settings.window.x !== null) {
    windowOptions.x = settings.window.x;
  }
  if (settings.window.y !== null) {
    windowOptions.y = settings.window.y;
  }

  const window = new BrowserWindow(windowOptions);
  const recorder = new AudioRequestRecorder();
  registerAudioInterception(session.defaultSession, recorder);
  const credentialStore = new CredentialStore();
  const contentRuntime = new BiliContentRuntime(
    credentialStore,
    dependencies.logger,
  );
  const database = new SqliteDatabase(
    path.join(dependencies.directories.db, 'nyami.sqlite'),
    dependencies.logger,
  );
  const libraryRepository = new DesktopLibraryRepository(
    database,
    dependencies.logger,
  );
  const libraryRuntime = new DesktopLibraryRuntime(
    contentRuntime.getApiForMainProcess(),
    credentialStore,
    libraryRepository,
    dependencies.logger,
  );
  const syncRuntime = new SyncRuntime(
    credentialStore,
    libraryRuntime,
    dependencies.logger,
  );
  const updateService = new UpdateService(dependencies.logger);
  const qrLogin = new QrLoginController(
    window,
    credentialStore,
    undefined,
    async (previousUid, nextUid) => {
      if (previousUid !== nextUid) {
        await syncRuntime.cancel();
      }
      libraryRuntime.handleAccountChanged(previousUid, nextUid);
    },
    () => contentRuntime.getProfile(),
  );
  const audioProbe = new AudioProbe();
  const audioCache = new AudioCacheStore(
    dependencies.directories,
    dependencies.logger,
  );
  registerAudioCacheHandler(audioCache);
  const cacheManager = new CacheManager(
    dependencies.directories,
    audioCache,
  );
  const playbackRuntime = new PlaybackRuntime({
    resolver: new BiliAudioResolver(credentialStore, dependencies.logger),
    cache: audioCache,
    logger: dependencies.logger,
    statePath: path.join(dependencies.directories.settings, 'playback.json'),
    quality: () => toAudioQuality(dependencies.settingsStore.get().quality),
    popularContinuation: async (
      context: PlaybackQueueContext,
      signal: AbortSignal,
    ) => {
      if (context.kind !== 'popular') {
        throw new Error('当前播放来源不支持热门列表续页');
      }
      const page = await contentRuntime.getDiscover({
        requestId: `playback-popular-${randomUUID()}`,
        page: context.page + 1,
      });
      if (signal.aborted) {
        const error = new Error('热门续页请求已取消');
        error.name = 'AbortError';
        throw error;
      }
      return {
        items: page.items.map(toPlaybackQueueItem),
        context: {
          kind: 'popular',
          page: page.page,
        },
      };
    },
  });
  const shell = new DesktopShell(
    window,
    dependencies.settingsStore,
    playbackRuntime,
    syncRuntime,
    dependencies.logger,
  );
  const disposeIpc = registerIpcHandlers(
    window,
    qrLogin,
    audioProbe,
    recorder,
    {
      settingsStore: dependencies.settingsStore,
      logger: dependencies.logger,
      cacheManager,
      playbackRuntime,
      syncRuntime,
      contentRuntime,
      libraryRuntime,
      updateService,
    },
  );
  let disposed = false;

  window.once('ready-to-show', () => {
    // 窗口保持隐藏到最大化完成，避免启动时先显示还原尺寸再跳转到最大化。
    if (!window.isMaximized()) {
      window.maximize();
    }
    window.show();
  });
  window.on('close', event => {
    if (shell.shouldHideOnClose()) {
      event.preventDefault();
      window.hide();
      dependencies.logger.info('window.minimized-to-tray');
      return;
    }
    if (!window.isDestroyed()) {
      void dependencies.settingsStore
        .updateWindowBounds(window.getBounds())
        .catch(error => {
          dependencies.logger.warn('window.bounds-save-failed', {
            error,
          });
        });
    }
  });
  window.on('unresponsive', () => {
    dependencies.logger.warn('window.unresponsive');
  });
  window.on('responsive', () => {
    dependencies.logger.info('window.responsive');
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    dependencies.logger.error('renderer.process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    dependencies.logger.error('renderer.load-failed', {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererNavigation(url)) {
      event.preventDefault();
      dependencies.logger.warn('renderer.navigation-blocked', {
        url,
      });
    }
  });
  window.webContents.setWindowOpenHandler(({url}) => {
    dependencies.logger.warn('renderer.window-open-blocked', {
      url,
    });
    return {action: 'deny'};
  });
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    event.preventDefault();
    dependencies.logger.warn('renderer.webview-blocked', {
      src: params.src,
      preload: webPreferences.preload,
    });
  });

  const rendererUrl = getRendererUrl();
  if (rendererUrl) {
    void window.webContents.loadURL(rendererUrl).catch(error => {
      dependencies.logger.error('renderer.load-url-failed', {
        error,
      });
    });
  } else {
    void window.webContents
      .loadFile(path.join(currentDir, '../renderer/index.html'))
      .catch(error => {
        dependencies.logger.error('renderer.load-file-failed', {
          error,
        });
      });
  }

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    disposeIpc();
    syncRuntime.dispose();
    libraryRepository.close();
    shell.dispose();
  };
  window.on('closed', dispose);

  return {
    window,
    shell,
    flushPlaybackState: () => playbackRuntime.flush(),
    dispose,
  };
}

/** 将桌面设置映射为共享解析器的音质优先级。 */
function toAudioQuality(quality: DesktopPlaybackQuality): AudioQuality {
  if (quality === 'best') {
    return 'hires';
  }
  if (quality === 'standard') {
    return 'medium';
  }
  return 'high';
}

/**
 * 读取并校验开发 Renderer 地址。
 * @returns 仅允许本机 HTTP/HTTPS 的开发地址；生产环境返回 null
 */
function getRendererUrl(): string | null {
  if (app.isPackaged) {
    return null;
  }
  const value = process.env.ELECTRON_RENDERER_URL?.trim();
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 判断 Renderer 是否只能在当前本地入口内导航。
 * @param value 待校验地址
 * @returns 是否允许导航
 */
function isAllowedRendererNavigation(value: string): boolean {
  const developmentUrl = getRendererUrl();
  if (developmentUrl) {
    try {
      const expected = new URL(developmentUrl);
      const actual = new URL(value);
      return (
        actual.protocol === expected.protocol &&
        actual.hostname === expected.hostname &&
        actual.port === expected.port
      );
    } catch {
      return false;
    }
  }
  const rendererFile = path.join(currentDir, '../renderer/index.html');
  return value === pathToFileURL(rendererFile).toString();
}

/** 将内容运行时返回的热门视频转换为播放队列项目。 */
function toPlaybackQueueItem(video: {
  bvid: string;
  title: string;
  author: string;
  cover: string;
  duration: number;
  source?: 'search' | 'popular' | 'favorite';
  page?: number;
}): PlaybackQueueItem {
  return {
    id: video.bvid,
    bvid: video.bvid,
    title: video.title,
    artist: video.author,
    artwork: video.cover,
    duration: video.duration,
    ...(video.page !== undefined ? {page: video.page} : {}),
    ...(video.source ? {source: video.source} : {}),
  };
}
