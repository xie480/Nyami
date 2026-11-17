import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  nativeImage,
  Notification,
  Tray,
} from 'electron';
import type {SyncSnapshot} from '../../shared/types';
import {AppLogger} from '../logging/appLogger';
import {PlaybackRuntime, type PlaybackRuntimeEvent} from '../runtime/playbackRuntime';
import {SyncRuntime} from '../runtime/syncRuntime';
import {SettingsStore} from '../storage/settingsStore';

const GLOBAL_ACCELERATORS = [
  'CommandOrControl+Alt+Space',
  'CommandOrControl+Alt+Left',
  'CommandOrControl+Alt+Right',
  'MediaPlayPause',
  'MediaNextTrack',
  'MediaPreviousTrack',
] as const;

const TRAY_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="9" fill="#84b8ff"/>
  <path d="M9 9h4v10.5c0 2.2 1.7 3.8 3.8 3.8s3.8-1.6 3.8-3.8V9h4v10.5c0 4.4-3.4 7.8-7.8 7.8S9 23.9 9 19.5V9Z" fill="#06111f"/>
</svg>`;

/**
 * Windows 桌面系统能力聚合器。
 * 负责托盘、全局快捷键、媒体键和同步完成通知，不让 Renderer 直接访问系统 API。
 */
export class DesktopShell {
  private readonly tray: Tray;

  private readonly registeredAccelerators = new Set<string>();

  private readonly disposePlayback: () => void;

  private readonly disposeSync: () => void;

  private quitting = false;

  private lastSyncNotificationKey: string | null = null;

  private lastSyncSnapshot: SyncSnapshot;

  constructor(
    private readonly window: BrowserWindow,
    private readonly settingsStore: SettingsStore,
    private readonly playbackRuntime: PlaybackRuntime,
    private readonly syncRuntime: SyncRuntime,
    private readonly logger: AppLogger,
  ) {
    this.lastSyncSnapshot = syncRuntime.getStatus();
    this.tray = new Tray(createTrayIcon());
    this.tray.setToolTip('Nyami');
    this.tray.on('double-click', () => this.showWindow());
    this.disposePlayback = playbackRuntime.subscribe(event => {
      this.handlePlaybackEvent(event);
    });
    this.disposeSync = syncRuntime.subscribe(snapshot => {
      this.handleSyncSnapshot(snapshot);
    });
    this.registerGlobalShortcuts();
    this.refreshTrayMenu();
  }

  /** 将应用标记为主动退出，防止 closeToTray 拦截 app.quit。 */
  markQuitting(): void {
    this.quitting = true;
  }

  /** 判断窗口关闭动作是否应转换为隐藏到托盘。 */
  shouldHideOnClose(): boolean {
    return !this.quitting && this.settingsStore.get().closeToTray;
  }

  /** 释放托盘、快捷键和运行时订阅。 */
  dispose(): void {
    this.disposePlayback();
    this.disposeSync();
    for (const accelerator of this.registeredAccelerators) {
      globalShortcut.unregister(accelerator);
    }
    this.registeredAccelerators.clear();
    this.tray.destroy();
  }

  /** 显示主窗口并取得焦点。 */
  showWindow(): void {
    if (this.window.isDestroyed()) {
      return;
    }
    if (this.window.isMinimized()) {
      this.window.restore();
    }
    if (!this.window.isVisible()) {
      this.window.show();
    }
    this.window.focus();
  }

  /** 切换当前歌曲播放状态，供托盘和媒体播放键共用。 */
  async togglePlayback(): Promise<void> {
    const snapshot = this.playbackRuntime.getState();
    if (!snapshot.trackId) {
      return;
    }
    if (snapshot.state === 'playing') {
      await this.playbackRuntime.pause();
      return;
    }
    await this.playbackRuntime.play();
  }

  /** 注册 Windows 全局快捷键和媒体键。 */
  private registerGlobalShortcuts(): void {
    const actions: Record<string, () => void> = {
      'CommandOrControl+Alt+Space': () => {
        void this.togglePlayback().catch(error => {
          this.logger.warn('desktop.shortcut-playback-failed', {error});
        });
      },
      'CommandOrControl+Alt+Left': () => {
        void this.playbackRuntime.skipPrevious().catch(error => {
          this.logger.warn('desktop.shortcut-previous-failed', {error});
        });
      },
      'CommandOrControl+Alt+Right': () => {
        void this.playbackRuntime.skipNext().catch(error => {
          this.logger.warn('desktop.shortcut-next-failed', {error});
        });
      },
      MediaPlayPause: () => {
        void this.togglePlayback().catch(error => {
          this.logger.warn('desktop.media-playback-failed', {error});
        });
      },
      MediaNextTrack: () => {
        void this.playbackRuntime.skipNext().catch(error => {
          this.logger.warn('desktop.media-next-failed', {error});
        });
      },
      MediaPreviousTrack: () => {
        void this.playbackRuntime.skipPrevious().catch(error => {
          this.logger.warn('desktop.media-previous-failed', {error});
        });
      },
    };
    for (const accelerator of GLOBAL_ACCELERATORS) {
      const action = actions[accelerator];
      if (globalShortcut.register(accelerator, action)) {
        this.registeredAccelerators.add(accelerator);
        continue;
      }
      this.logger.warn('desktop.shortcut-register-failed', {accelerator});
    }
  }

  /** 播放状态变化后更新托盘标题和菜单。 */
  private handlePlaybackEvent(event: PlaybackRuntimeEvent): void {
    if (event.type !== 'state') {
      return;
    }
    const snapshot = event.snapshot;
    const title = snapshot.trackTitle
      ? `${snapshot.trackTitle}${snapshot.trackArtist ? ` · ${snapshot.trackArtist}` : ''}`
      : '未播放';
    this.tray.setToolTip(`Nyami · ${title}`);
    this.refreshTrayMenu();
  }

  /** 同步状态变化后刷新托盘并在完成或失败时发送 Windows 通知。 */
  private handleSyncSnapshot(snapshot: SyncSnapshot): void {
    this.lastSyncSnapshot = snapshot;
    this.refreshTrayMenu();
    if (
      (snapshot.state !== 'completed' && snapshot.state !== 'failed') ||
      !snapshot.taskId
    ) {
      return;
    }
    const notificationKey = `${snapshot.taskId}:${snapshot.state}`;
    if (notificationKey === this.lastSyncNotificationKey) {
      return;
    }
    this.lastSyncNotificationKey = notificationKey;
    const body =
      snapshot.state === 'completed'
        ? '收藏、标签和推荐索引同步完成'
        : snapshot.error || '同步失败，可以从任务面板重试';
    this.showNotification(
      snapshot.state === 'completed' ? '同步完成' : '同步失败',
      body,
    );
  }

  /** 构造托盘菜单，菜单动作复用主进程播放运行时。 */
  private refreshTrayMenu(): void {
    const snapshot = this.playbackRuntime.getState();
    const syncLabel = getSyncLabel(this.lastSyncSnapshot);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示 Nyami',
          click: () => this.showWindow(),
        },
        {type: 'separator'},
        {
          label: snapshot.state === 'playing' ? '暂停播放' : '继续播放',
          enabled: Boolean(snapshot.trackId),
          click: () => {
            void this.togglePlayback();
          },
        },
        {
          label: '上一首',
          enabled: Boolean(snapshot.trackId),
          click: () => {
            void this.playbackRuntime.skipPrevious();
          },
        },
        {
          label: '下一首',
          enabled: Boolean(snapshot.trackId),
          click: () => {
            void this.playbackRuntime.skipNext();
          },
        },
        {type: 'separator'},
        {
          label: `同步：${syncLabel}`,
          enabled: false,
        },
        {
          label: '退出 Nyami',
          click: () => {
            this.markQuitting();
            app.quit();
          },
        },
      ]),
    );
  }

  /** 发送脱敏 Windows 通知，系统不支持时只记录日志。 */
  private showNotification(title: string, body: string): void {
    if (!Notification.isSupported()) {
      this.logger.info('desktop.notification-unavailable', {title});
      return;
    }
    try {
      new Notification({title: `Nyami · ${title}`, body}).show();
    } catch (error) {
      this.logger.warn('desktop.notification-failed', {error});
    }
  }
}

/** 创建独立的 SVG 托盘图标，避免依赖用户磁盘上的外部文件。 */
function createTrayIcon(): Electron.NativeImage {
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(TRAY_ICON_SVG)}`,
  );
}

/** 将同步快照转换成托盘菜单的短状态文案。 */
function getSyncLabel(snapshot: SyncSnapshot): string {
  if (snapshot.state === 'running') {
    return `${snapshot.phase} ${snapshot.completed}/${snapshot.total}`;
  }
  if (snapshot.state === 'completed') {
    return '已完成';
  }
  if (snapshot.state === 'failed') {
    return '失败';
  }
  if (snapshot.state === 'cancelled') {
    return '已取消';
  }
  return '未启动';
}
