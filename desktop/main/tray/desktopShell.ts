import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  Notification,
  Tray,
} from 'electron';
import type {SyncSnapshot} from '../../shared/types';
import {getDesktopIconPath} from '../appIcon';
import type {CredentialStore} from '../auth/credentialStore';
import type {DesktopLibraryRuntime} from '../content/desktopLibraryRuntime';
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

  private firstGlobalIndexReminderPromise: Promise<void> | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly settingsStore: SettingsStore,
    private readonly credentials: CredentialStore,
    private readonly library: DesktopLibraryRuntime,
    private readonly playbackRuntime: PlaybackRuntime,
    private readonly syncRuntime: SyncRuntime,
    private readonly logger: AppLogger,
  ) {
    this.lastSyncSnapshot = syncRuntime.getStatus();
    this.tray = new Tray(getDesktopIconPath());
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
    void this.notifyFirstGlobalIndexSyncRequired();
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

  /** 首次登录且尚未建立全局索引时发送一次同步提醒。 */
  notifyFirstGlobalIndexSyncRequired(): Promise<void> {
    if (this.firstGlobalIndexReminderPromise) {
      return this.firstGlobalIndexReminderPromise;
    }
    const reminderPromise = this.checkFirstGlobalIndexReminder()
      .catch(error => {
        this.logger.warn('desktop.global-index-reminder-failed', {error});
      })
      .finally(() => {
        this.firstGlobalIndexReminderPromise = null;
      });
    this.firstGlobalIndexReminderPromise = reminderPromise;
    return reminderPromise;
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
        ? '收藏索引同步完成'
        : snapshot.error || '同步失败，可以从任务面板重试';
    this.showNotification(
      snapshot.state === 'completed' ? '同步完成' : '同步失败',
      body,
    );
  }

  /** 检查登录账号是否需要首次全局索引同步提醒。 */
  private async checkFirstGlobalIndexReminder(): Promise<void> {
    if (await this.settingsStore.hasShownGlobalIndexReminder()) {
      return;
    }
    const status = await this.credentials.getStatus();
    if (!status.loggedIn || !status.uid) {
      return;
    }
    if (this.library.hasLocalIndex(status.uid)) {
      await this.settingsStore.markGlobalIndexReminderShown();
      return;
    }
    await this.settingsStore.markGlobalIndexReminderShown();
    this.showNotification(
      '首次使用提醒',
      '首次使用前，请先同步全局索引，再浏览和播放收藏内容',
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
      const notification = new Notification({
        title: `Nyami · ${title}`,
        body,
        icon: getDesktopIconPath(),
      });
      notification.on('click', () => this.showWindow());
      notification.on('failed', (_event, error) => {
        this.logger.warn('desktop.notification-failed', {error});
      });
      notification.show();
    } catch (error) {
      this.logger.warn('desktop.notification-failed', {error});
    }
  }
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
