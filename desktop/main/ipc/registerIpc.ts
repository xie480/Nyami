import {
  BrowserWindow,
  IpcMainInvokeEvent,
  ipcMain,
} from 'electron';
import {
  IPC_CHANNELS,
  type AudioProbeRequest,
  type ContentRequestBase,
  type DesktopSettingsPatch,
  type DiscoverContentRequest,
  type FavoriteFolderContentRequest,
  type FavoriteVideoContentRequest,
  type PlaybackSeekRequest,
  type PlaybackVolumeRequest,
  type RendererErrorReport,
  type SearchContentRequest,
} from '../../shared/types';
import {AudioProbe} from '../audio/audioProbe';
import {AudioRequestRecorder} from '../audio/audioRequestRecorder';
import {getSampleAudioUrl} from '../audio/localAudioProtocol';
import {QrLoginController} from '../auth/qrLoginController';
import {BiliContentRuntime} from '../content/biliContentRuntime';
import {AppLogger} from '../logging/appLogger';
import {CacheManager} from '../runtime/cacheManager';
import {PlaybackRuntime} from '../runtime/playbackRuntime';
import {SyncRuntime} from '../runtime/syncRuntime';
import {SettingsStore} from '../storage/settingsStore';

/**
 * IPC 处理器依赖。
 * 主进程在组合根创建这些实现，Renderer 只能通过类型化命令访问它们。
 */
export type IpcRuntimeDependencies = {
  settingsStore: SettingsStore;
  logger: AppLogger;
  cacheManager: CacheManager;
  playbackRuntime: PlaybackRuntime;
  syncRuntime: SyncRuntime;
  contentRuntime: BiliContentRuntime;
};

/**
 * 注册桌面端白名单 IPC 命令和事件。
 * @param window 当前桌面主窗口
 * @param qrLogin 二维码登录控制器
 * @param audioProbe 音频探测器
 * @param recorder 音频请求脱敏记录器
 * @param dependencies 阶段 2 运行时依赖
 * @returns 清理 IPC handler 和主进程资源的函数
 */
export function registerIpcHandlers(
  window: BrowserWindow,
  qrLogin: QrLoginController,
  audioProbe: AudioProbe,
  recorder: AudioRequestRecorder,
  dependencies: IpcRuntimeDependencies,
): () => void {
  const channels = Object.values(IPC_CHANNELS).flatMap(group =>
    Object.values(group),
  );
  const register = (
    channel: string,
    handler: (
      event: IpcMainInvokeEvent,
      ...args: unknown[]
    ) => unknown | Promise<unknown>,
  ): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertRendererSender(event, window);
      try {
        return await handler(event, ...args);
      } catch (error) {
        dependencies.logger.error('ipc.handler-failed', {
          channel,
          error,
        });
        throw error;
      }
    });
  };
  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  };

  register(IPC_CHANNELS.auth.startQrLogin, () => qrLogin.start());
  register(IPC_CHANNELS.auth.cancelQrLogin, () => {
    qrLogin.stopSession();
  });
  register(IPC_CHANNELS.auth.getStatus, () => qrLogin.getStatus());
  register(IPC_CHANNELS.auth.getProfile, () =>
    dependencies.contentRuntime.getProfile(),
  );
  register(IPC_CHANNELS.auth.openWebLogin, () => qrLogin.openWebLogin());
  register(IPC_CHANNELS.auth.renew, () => qrLogin.renew());
  register(IPC_CHANNELS.auth.closeWebLogin, () => qrLogin.closeWebLogin());
  register(IPC_CHANNELS.auth.logout, () => qrLogin.logout());

  register(IPC_CHANNELS.probes.inspectAudio, (_event, request) => {
    assertAudioProbeRequest(request);
    return audioProbe.inspect(request);
  });
  register(IPC_CHANNELS.probes.getSampleUrl, () => getSampleAudioUrl());
  register(IPC_CHANNELS.probes.getRequestLog, () => recorder.list());
  register(IPC_CHANNELS.probes.clearRequestLog, () => recorder.clear());

  register(IPC_CHANNELS.playback.getState, () =>
    dependencies.playbackRuntime.getState(),
  );
  register(IPC_CHANNELS.playback.play, () => {
    const snapshot = dependencies.playbackRuntime.play();
    send(IPC_CHANNELS.playback.stateChanged, {snapshot});
    return snapshot;
  });
  register(IPC_CHANNELS.playback.pause, () => {
    const snapshot = dependencies.playbackRuntime.pause();
    send(IPC_CHANNELS.playback.stateChanged, {snapshot});
    return snapshot;
  });
  register(IPC_CHANNELS.playback.stop, () => {
    const snapshot = dependencies.playbackRuntime.stop();
    send(IPC_CHANNELS.playback.stateChanged, {snapshot});
    return snapshot;
  });
  register(IPC_CHANNELS.playback.seek, (_event, request) => {
    assertPlaybackSeekRequest(request);
    const snapshot = dependencies.playbackRuntime.seek(request);
    send(IPC_CHANNELS.playback.stateChanged, {snapshot});
    return snapshot;
  });
  register(IPC_CHANNELS.playback.skipNext, () => {
    const snapshot = dependencies.playbackRuntime.skipNext();
    send(IPC_CHANNELS.playback.stateChanged, {snapshot});
    return snapshot;
  });
  register(IPC_CHANNELS.playback.skipPrevious, () => {
    const snapshot = dependencies.playbackRuntime.skipPrevious();
    send(IPC_CHANNELS.playback.stateChanged, {snapshot});
    return snapshot;
  });
  register(IPC_CHANNELS.playback.setVolume, (_event, request) => {
    assertPlaybackVolumeRequest(request);
    const snapshot = dependencies.playbackRuntime.setVolume(request);
    send(IPC_CHANNELS.playback.stateChanged, {snapshot});
    return snapshot;
  });

  register(IPC_CHANNELS.sync.getStatus, () =>
    dependencies.syncRuntime.getStatus(),
  );
  register(IPC_CHANNELS.sync.start, () => {
    const snapshot = dependencies.syncRuntime.start();
    send(IPC_CHANNELS.sync.stateChanged, {snapshot});
    return snapshot;
  });
  register(IPC_CHANNELS.sync.cancel, () => {
    const snapshot = dependencies.syncRuntime.cancel();
    send(IPC_CHANNELS.sync.stateChanged, {snapshot});
    return snapshot;
  });

  register(IPC_CHANNELS.content.getHome, (_event, request) => {
    assertContentRequestBase(request);
    return dependencies.contentRuntime.getHome(request);
  });
  register(IPC_CHANNELS.content.getDiscover, (_event, request) => {
    assertDiscoverContentRequest(request);
    return dependencies.contentRuntime.getDiscover(request);
  });
  register(IPC_CHANNELS.content.search, (_event, request) => {
    assertSearchContentRequest(request);
    return dependencies.contentRuntime.search(request);
  });
  register(IPC_CHANNELS.content.getFavoriteFolders, (_event, request) => {
    assertFavoriteFolderContentRequest(request);
    return dependencies.contentRuntime.getFavoriteFolders(request);
  });
  register(IPC_CHANNELS.content.getFavoriteVideos, (_event, request) => {
    assertFavoriteVideoContentRequest(request);
    return dependencies.contentRuntime.getFavoriteVideos(request);
  });
  register(IPC_CHANNELS.content.cancel, (_event, request) => {
    assertContentRequestBase(request);
    dependencies.contentRuntime.cancel(request);
  });

  register(IPC_CHANNELS.cache.getSummary, () =>
    dependencies.cacheManager.getSummary(),
  );
  register(IPC_CHANNELS.cache.clear, async () => {
    send(IPC_CHANNELS.cache.progress, {
      operation: 'clear',
      completed: 0,
      total: 1,
    });
    const summary = await dependencies.cacheManager.clear();
    send(IPC_CHANNELS.cache.progress, {
      operation: 'clear',
      completed: 1,
      total: 1,
    });
    return summary;
  });

  register(IPC_CHANNELS.settings.get, () => dependencies.settingsStore.get());
  register(IPC_CHANNELS.settings.update, async (_event, patch) => {
    assertSettingsPatch(patch);
    const settings = await dependencies.settingsStore.update(patch);
    send(IPC_CHANNELS.settings.changed, settings);
    dependencies.logger.info('settings.updated', {
      theme: settings.theme,
      closeToTray: settings.closeToTray,
    });
    return settings;
  });

  register(IPC_CHANNELS.logs.getRecent, (_event, limit) => {
    const normalizedLimit = normalizeLogLimit(limit);
    return dependencies.logger.readRecent(normalizedLimit);
  });
  register(IPC_CHANNELS.logs.clear, () => dependencies.logger.clear());
  register(IPC_CHANNELS.logs.reportRendererError, (_event, report) => {
    assertRendererErrorReport(report);
    dependencies.logger.error('renderer.error-boundary', {
      source: 'renderer',
      ...report,
    });
  });

  return (): void => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel);
    }
    qrLogin.dispose();
  };
}

/**
 * 只允许当前主窗口的 Renderer 调用 IPC。
 * @param event Electron IPC 调用事件
 * @param window 当前主窗口
 * @returns 无返回值；非法来源直接抛出异常
 */
function assertRendererSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
): void {
  if (event.sender !== window.webContents) {
    throw new Error('拒绝来自未知 Renderer 的 IPC 调用');
  }
}

/**
 * 校验音频探测请求，限制 URL 长度并拒绝多余结构。
 * @param value 未知 IPC 参数
 * @returns 类型收窄后的请求
 */
function assertAudioProbeRequest(value: unknown): asserts value is AudioProbeRequest {
  if (!isRecord(value)) {
    throw new Error('音频探测参数格式无效');
  }
  if (!isBoundedString(value.url, 4096)) {
    throw new Error('音频探测 URL 无效');
  }
  if (
    value.retryUrl !== undefined &&
    !isBoundedString(value.retryUrl, 4096)
  ) {
    throw new Error('音频重试 URL 无效');
  }
}

/** 校验所有可取消内容请求的请求 ID。 */
function assertContentRequestBase(
  value: unknown,
): asserts value is ContentRequestBase {
  if (!isRecord(value) || !isBoundedString(value.requestId, 128)) {
    throw new Error('内容请求 ID 无效');
  }
}

/** 校验搜索请求，限制关键词长度和页码范围。 */
function assertSearchContentRequest(
  value: unknown,
): asserts value is SearchContentRequest {
  assertContentRequestBase(value);
  const request = value as ContentRequestBase & {
    keyword?: unknown;
    page?: unknown;
  };
  if (!isBoundedString(request.keyword, 128) || !request.keyword.trim()) {
    throw new Error('搜索关键词无效');
  }
  if (!isPositiveInteger(request.page) || request.page > 1000) {
    throw new Error('搜索页码无效');
  }
}

/** 校验发现页请求。 */
function assertDiscoverContentRequest(
  value: unknown,
): asserts value is DiscoverContentRequest {
  assertContentRequestBase(value);
  const request = value as ContentRequestBase & {page?: unknown};
  if (!isPositiveInteger(request.page) || request.page > 1000) {
    throw new Error('发现页码无效');
  }
}

/** 校验收藏夹目录请求。 */
function assertFavoriteFolderContentRequest(
  value: unknown,
): asserts value is FavoriteFolderContentRequest {
  assertContentRequestBase(value);
  const request = value as ContentRequestBase & {uid?: unknown};
  if (!isBoundedString(request.uid, 64) || !request.uid.trim()) {
    throw new Error('收藏账号 UID 无效');
  }
}

/** 校验收藏夹视频请求。 */
function assertFavoriteVideoContentRequest(
  value: unknown,
): asserts value is FavoriteVideoContentRequest {
  assertContentRequestBase(value);
  const request = value as ContentRequestBase & {
    uid?: unknown;
    mediaId?: unknown;
    page?: unknown;
  };
  if (!isBoundedString(request.uid, 64) || !request.uid.trim()) {
    throw new Error('收藏账号 UID 无效');
  }
  if (
    !isPositiveInteger(request.mediaId) ||
    request.mediaId > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error('收藏夹 ID 无效');
  }
  if (!isPositiveInteger(request.page) || request.page > 1000) {
    throw new Error('收藏视频页码无效');
  }
}

/** 判断未知输入是否为正整数。 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * 校验播放跳转参数。
 * @param value 未知 IPC 参数
 * @returns 类型收窄后的请求
 */
function assertPlaybackSeekRequest(
  value: unknown,
): asserts value is PlaybackSeekRequest {
  if (
    !isRecord(value) ||
    typeof value.position !== 'number' ||
    !Number.isFinite(value.position) ||
    value.position < 0 ||
    value.position > 86400
  ) {
    throw new Error('播放位置必须是 0 到 86400 秒之间的数字');
  }
}

/**
 * 校验播放音量参数。
 * @param value 未知 IPC 参数
 * @returns 类型收窄后的请求
 */
function assertPlaybackVolumeRequest(
  value: unknown,
): asserts value is PlaybackVolumeRequest {
  if (
    !isRecord(value) ||
    typeof value.volume !== 'number' ||
    !Number.isFinite(value.volume) ||
    value.volume < 0 ||
    value.volume > 1
  ) {
    throw new Error('播放音量必须是 0 到 1 之间的数字');
  }
}

/**
 * 校验设置补丁，只接受公开偏好字段。
 * @param value 未知 IPC 参数
 * @returns 类型收窄后的设置补丁
 */
function assertSettingsPatch(
  value: unknown,
): asserts value is DesktopSettingsPatch {
  if (!isRecord(value)) {
    throw new Error('设置参数格式无效');
  }
  const allowedKeys = new Set(['theme', 'closeToTray', 'window']);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw new Error('设置包含不支持的字段');
  }
  if (
    value.theme !== undefined &&
    !['system', 'light', 'dark', 'glass'].includes(String(value.theme))
  ) {
    throw new Error('设置主题无效');
  }
  if (value.closeToTray !== undefined && typeof value.closeToTray !== 'boolean') {
    throw new Error('closeToTray 必须是布尔值');
  }
  if (value.window !== undefined) {
    if (!isRecord(value.window)) {
      throw new Error('窗口设置格式无效');
    }
    const windowKeys = new Set(['width', 'height', 'x', 'y']);
    if (Object.keys(value.window).some(key => !windowKeys.has(key))) {
      throw new Error('窗口设置包含不支持的字段');
    }
    for (const key of ['width', 'height', 'x', 'y']) {
      const field = value.window[key];
      if (
        field !== undefined &&
        field !== null &&
        (typeof field !== 'number' || !Number.isFinite(field))
      ) {
        throw new Error('窗口设置必须使用有限数字');
      }
    }
  }
}

/**
 * 校验 Renderer 错误上报，避免恶意大 payload 写入日志。
 * @param value 未知 IPC 参数
 * @returns 类型收窄后的错误上报
 */
function assertRendererErrorReport(
  value: unknown,
): asserts value is RendererErrorReport {
  if (!isRecord(value) || !isBoundedString(value.message, 2000)) {
    throw new Error('Renderer 错误上报格式无效');
  }
  for (const key of ['stack', 'componentStack']) {
    const field = value[key];
    if (field !== undefined && !isBoundedString(field, 4000)) {
      throw new Error('Renderer 错误堆栈过长');
    }
  }
}

/**
 * 限制日志查询条数。
 * @param value 未知 IPC 参数
 * @returns 1 到 500 之间的整数
 */
function normalizeLogLimit(value: unknown): number {
  if (value === undefined) {
    return 100;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 500
  ) {
    throw new Error('日志条数必须是 1 到 500 之间的整数');
  }
  return value;
}

/**
 * 判断字符串是否非空且不超过长度限制。
 * @param value 待判断值
 * @param maximum 最大长度
 * @returns 是否为合法字符串
 */
function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

/**
 * 判断未知值是否为普通对象。
 * @param value 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
