import {
  BrowserWindow,
  dialog,
  IpcMainInvokeEvent,
  ipcMain,
} from 'electron';
import {
  IPC_CHANNELS,
  type AudioProbeRequest,
  type ContentRequestBase,
  type DesktopSettingsPatch,
  type DesktopAudioSettings,
  type DesktopPeqBand,
  type DiscoverContentRequest,
  type FavoriteFolderContentRequest,
  type FavoriteVideoContentRequest,
  type PlaybackAudioEvent,
  type PlaybackQueueContext,
  type PlaybackModeRequest,
  type PlaybackQueueItemRequest,
  type PlaybackQueueRequest,
  type PlaybackRemoveRequest,
  type PlaybackReorderRequest,
  type PlaybackSeekRequest,
  type PlaybackSleepTimerRequest,
  type PlaybackVolumeRequest,
  type RecommendationContentRequest,
  type RendererErrorReport,
  type SearchContentRequest,
  type SyncStartRequest,
} from '../../shared/types';
import {AudioProbe} from '../audio/audioProbe';
import {AudioRequestRecorder} from '../audio/audioRequestRecorder';
import {getSampleAudioUrl} from '../audio/localAudioProtocol';
import {QrLoginController} from '../auth/qrLoginController';
import {BiliContentRuntime} from '../content/biliContentRuntime';
import {DesktopLibraryRuntime} from '../content/desktopLibraryRuntime';
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
  libraryRuntime: DesktopLibraryRuntime;
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
  const disposePlaybackEvents = dependencies.playbackRuntime.subscribe(event => {
    if (event.type === 'state') {
      send(IPC_CHANNELS.playback.stateChanged, {
        snapshot: event.snapshot,
      });
      return;
    }
    if (event.type === 'source') {
      send(IPC_CHANNELS.playback.sourceChanged, {
        source: event.source,
      });
      return;
    }
    send(IPC_CHANNELS.playback.command, {
      command: event.command,
    });
  });
  const disposeSyncEvents = dependencies.syncRuntime.subscribe(snapshot => {
    send(IPC_CHANNELS.sync.stateChanged, {snapshot});
  });

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
  register(IPC_CHANNELS.playback.loadQueue, async (_event, request) => {
    assertPlaybackQueueRequest(request);
    return dependencies.playbackRuntime.loadQueue(request);
  });
  register(IPC_CHANNELS.playback.addToQueue, async (_event, request) => {
    assertPlaybackQueueItemRequest(request);
    return dependencies.playbackRuntime.addToQueue(request);
  });
  register(IPC_CHANNELS.playback.removeFromQueue, async (_event, request) => {
    assertPlaybackRemoveRequest(request);
    return dependencies.playbackRuntime.removeFromQueue(request);
  });
  register(IPC_CHANNELS.playback.reorderQueue, async (_event, request) => {
    assertPlaybackReorderRequest(request);
    return dependencies.playbackRuntime.reorderQueue(request);
  });
  register(IPC_CHANNELS.playback.setMode, async (_event, request) => {
    assertPlaybackModeRequest(request);
    return dependencies.playbackRuntime.setMode(request);
  });
  register(IPC_CHANNELS.playback.setSleepTimer, async (_event, request) => {
    assertPlaybackSleepTimerRequest(request);
    return dependencies.playbackRuntime.setSleepTimer(request);
  });
  register(IPC_CHANNELS.playback.reportAudioEvent, async (_event, event) => {
    assertPlaybackAudioEvent(event);
    return dependencies.playbackRuntime.reportAudioEvent(event);
  });
  register(IPC_CHANNELS.playback.play, () =>
    dependencies.playbackRuntime.play(),
  );
  register(IPC_CHANNELS.playback.pause, () =>
    dependencies.playbackRuntime.pause(),
  );
  register(IPC_CHANNELS.playback.stop, () =>
    dependencies.playbackRuntime.stop(),
  );
  register(IPC_CHANNELS.playback.seek, (_event, request) => {
    assertPlaybackSeekRequest(request);
    return dependencies.playbackRuntime.seek(request);
  });
  register(IPC_CHANNELS.playback.skipNext, () =>
    dependencies.playbackRuntime.skipNext(),
  );
  register(IPC_CHANNELS.playback.skipPrevious, () =>
    dependencies.playbackRuntime.skipPrevious(),
  );
  register(IPC_CHANNELS.playback.setVolume, (_event, request) => {
    assertPlaybackVolumeRequest(request);
    return dependencies.playbackRuntime.setVolume(request);
  });

  register(IPC_CHANNELS.sync.getStatus, () =>
    dependencies.syncRuntime.getStatus(),
  );
  register(IPC_CHANNELS.sync.start, (_event, request) => {
    assertSyncStartRequest(request);
    return dependencies.syncRuntime.start(request);
  });
  register(IPC_CHANNELS.sync.cancel, () => {
    return dependencies.syncRuntime.cancel();
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
  register(IPC_CHANNELS.content.getRecommendations, (_event, request) => {
    assertRecommendationContentRequest(request);
    return dependencies.libraryRuntime.getRecommendations(request);
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
    dependencies.libraryRuntime.cancel(request.requestId);
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
  register(IPC_CHANNELS.logs.export, async () => {
    const result = await dialog.showSaveDialog(window, {
      title: '导出 Nyami 日志',
      defaultPath: `Nyami-logs-${new Date().toISOString().slice(0, 10)}.jsonl`,
      filters: [{name: '日志文件', extensions: ['jsonl', 'log']}],
    });
    if (result.canceled || !result.filePath) {
      return {
        cancelled: true,
        path: null,
        bytes: 0,
      };
    }
    const bytes = await dependencies.logger.exportTo(result.filePath);
    dependencies.logger.info('logs.exported', {
      bytes,
    });
    return {
      cancelled: false,
      path: result.filePath,
      bytes,
    };
  });
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
    disposePlaybackEvents();
    disposeSyncEvents();
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

/** 校验推荐请求，保证推荐数据只为当前登录账号生成。 */
function assertRecommendationContentRequest(
  value: unknown,
): asserts value is RecommendationContentRequest {
  assertContentRequestBase(value);
  const request = value as ContentRequestBase & {
    uid?: unknown;
    page?: unknown;
  };
  if (!isBoundedString(request.uid, 64) || !request.uid.trim()) {
    throw new Error('推荐账号 UID 无效');
  }
  if (
    request.page !== undefined &&
    (!isPositiveInteger(request.page) || request.page > 1000)
  ) {
    throw new Error('推荐页码无效');
  }
}

/** 校验同步启动参数，拒绝 Renderer 传入未知结构。 */
function assertSyncStartRequest(
  value: unknown,
): asserts value is SyncStartRequest {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new Error('同步启动参数格式无效');
  }
  if (value.force !== undefined && typeof value.force !== 'boolean') {
    throw new Error('同步全量参数无效');
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

/** 校验替换播放队列请求，限制项目数量和文本长度。 */
function assertPlaybackQueueRequest(
  value: unknown,
): asserts value is PlaybackQueueRequest {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('播放队列参数格式无效');
  }
  if (value.items.length > 500) {
    throw new Error('播放队列一次最多包含 500 项');
  }
  value.items.forEach(assertPlaybackQueueItem);
  if (
    value.startIndex !== undefined &&
    (!Number.isSafeInteger(value.startIndex) || value.startIndex < 0)
  ) {
    throw new Error('播放起始索引无效');
  }
  if (value.autoplay !== undefined && typeof value.autoplay !== 'boolean') {
    throw new Error('播放自动开始参数无效');
  }
  if (
    value.expandParts !== undefined &&
    typeof value.expandParts !== 'boolean'
  ) {
    throw new Error('多 P 展开参数无效');
  }
  if (value.context !== undefined && value.context !== null) {
    assertPlaybackQueueContext(value.context);
  }
}

/** 校验追加单项队列请求。 */
function assertPlaybackQueueItemRequest(
  value: unknown,
): asserts value is PlaybackQueueItemRequest {
  if (!isRecord(value)) {
    throw new Error('播放队列项目参数格式无效');
  }
  assertPlaybackQueueItem(value.item);
  if (value.autoplay !== undefined && typeof value.autoplay !== 'boolean') {
    throw new Error('播放自动开始参数无效');
  }
  if (value.context !== undefined && value.context !== null) {
    assertPlaybackQueueContext(value.context);
  }
}

/** 校验推荐续页上下文，避免主进程接受任意游标。 */
function assertPlaybackQueueContext(
  value: unknown,
): asserts value is PlaybackQueueContext {
  if (
    !isRecord(value) ||
    value.kind !== 'recommendation' ||
    !isPositiveInteger(value.page) ||
    value.page > 1000
  ) {
    throw new Error('推荐续页上下文无效');
  }
}

/** 校验单个播放队列项目。 */
function assertPlaybackQueueItem(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('播放队列项目格式无效');
  }
  for (const key of ['id', 'bvid', 'title', 'artist']) {
    if (!isBoundedString(value[key], 512)) {
      throw new Error('播放队列文本字段无效');
    }
  }
  if (typeof value.artwork !== 'string') {
    throw new Error('播放封面地址无效');
  }
  if (
    value.duration !== undefined &&
    (typeof value.duration !== 'number' ||
      !Number.isFinite(value.duration) ||
      value.duration < 0 ||
      value.duration > 86400)
  ) {
    throw new Error('播放时长无效');
  }
  for (const key of ['cid', 'page']) {
    if (
      value[key] !== undefined &&
      (!Number.isSafeInteger(value[key]) || value[key] < 1)
    ) {
      throw new Error('播放分 P 参数无效');
    }
  }
  if (
    value.source !== undefined &&
    !['search', 'popular', 'favorite'].includes(String(value.source))
  ) {
    throw new Error('播放来源无效');
  }
}

/** 校验删除队列项目请求。 */
function assertPlaybackRemoveRequest(
  value: unknown,
): asserts value is PlaybackRemoveRequest {
  if (!isRecord(value) || !isBoundedString(value.trackId, 512)) {
    throw new Error('待删除播放项目无效');
  }
}

/** 校验队列重排请求。 */
function assertPlaybackReorderRequest(
  value: unknown,
): asserts value is PlaybackReorderRequest {
  if (!isRecord(value) || !Array.isArray(value.trackIds)) {
    throw new Error('播放队列排序参数无效');
  }
  if (value.trackIds.length > 500 || value.trackIds.some(id => !isBoundedString(id, 512))) {
    throw new Error('播放队列排序项目无效');
  }
}

/** 校验播放模式切换请求。 */
function assertPlaybackModeRequest(
  value: unknown,
): asserts value is PlaybackModeRequest {
  if (
    !isRecord(value) ||
    !['sequential', 'shuffle'].includes(String(value.mode))
  ) {
    throw new Error('播放模式无效');
  }
}

/** 校验睡眠定时器请求，最多允许 24 小时。 */
function assertPlaybackSleepTimerRequest(
  value: unknown,
): asserts value is PlaybackSleepTimerRequest {
  if (!isRecord(value)) {
    throw new Error('睡眠定时器参数无效');
  }
  if (
    value.seconds !== null &&
    (!Number.isSafeInteger(value.seconds) ||
      value.seconds < 1 ||
      value.seconds > 86400)
  ) {
    throw new Error('睡眠定时器必须是 1 到 86400 秒或 null');
  }
}

/** 校验 Renderer 音频元素事件，拒绝未知字段以外的危险内容。 */
function assertPlaybackAudioEvent(
  value: unknown,
): asserts value is PlaybackAudioEvent {
  const allowedTypes = [
    'loadedmetadata',
    'canplay',
    'playing',
    'pause',
    'waiting',
    'stalled',
    'timeupdate',
    'ended',
    'error',
    'network-online',
    'network-offline',
  ];
  if (!isRecord(value) || !allowedTypes.includes(String(value.type))) {
    throw new Error('播放器事件类型无效');
  }
  if (
    value.trackId !== undefined &&
    value.trackId !== null &&
    !isBoundedString(value.trackId, 512)
  ) {
    throw new Error('播放器事件项目无效');
  }
  for (const key of ['position', 'duration', 'buffered']) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'number' ||
        !Number.isFinite(value[key]) ||
        value[key] < 0 ||
        value[key] > 86400)
    ) {
      throw new Error('播放器进度参数无效');
    }
  }
  if (value.message !== undefined && !isBoundedString(value.message, 1000)) {
    throw new Error('播放器错误信息无效');
  }
  if (
    value.code !== undefined &&
    (!Number.isSafeInteger(value.code) || value.code < 0)
  ) {
    throw new Error('播放器错误码无效');
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
  const allowedKeys = new Set(['theme', 'closeToTray', 'window', 'audio']);
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
  if (value.audio !== undefined) {
    assertAudioSettingsPatch(value.audio);
  }
}

/** 校验音频设置补丁，阻止异常数组和滤波器参数进入主进程存储。 */
function assertAudioSettingsPatch(
  value: unknown,
): asserts value is Partial<DesktopAudioSettings> {
  if (!isRecord(value)) {
    throw new Error('音频设置格式无效');
  }
  const allowedKeys = new Set([
    'enabled',
    'mode',
    'graphicPreset',
    'graphicGains',
    'peqBands',
    'limiterEnabled',
    'limiterThreshold',
    'spectrumEnabled',
  ]);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw new Error('音频设置包含不支持的字段');
  }
  for (const key of ['enabled', 'limiterEnabled', 'spectrumEnabled']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      throw new Error('音频开关参数无效');
    }
  }
  if (
    value.mode !== undefined &&
    !['graphic', 'parametric'].includes(String(value.mode))
  ) {
    throw new Error('EQ 模式无效');
  }
  if (
    value.graphicPreset !== undefined &&
    ![
      'flat',
      'nyami',
      'cat_bass',
      'girl_band',
      'idol_stage',
      'midnight_radio',
      'vaporwave',
      'custom',
    ].includes(String(value.graphicPreset))
  ) {
    throw new Error('Graphic EQ 预设无效');
  }
  if (value.graphicGains !== undefined) {
    if (
      !Array.isArray(value.graphicGains) ||
      value.graphicGains.length !== 10 ||
      value.graphicGains.some(
        gain =>
          typeof gain !== 'number' ||
          !Number.isFinite(gain) ||
          gain < -12 ||
          gain > 12,
      )
    ) {
      throw new Error('Graphic EQ 参数无效');
    }
  }
  if (value.peqBands !== undefined) {
    if (
      !Array.isArray(value.peqBands) ||
      value.peqBands.length !== 8
    ) {
      throw new Error('PEQ 参数数量无效');
    }
    value.peqBands.forEach(assertPeqBand);
  }
  if (
    value.limiterThreshold !== undefined &&
    (typeof value.limiterThreshold !== 'number' ||
      !Number.isFinite(value.limiterThreshold) ||
      value.limiterThreshold < 0.5 ||
      value.limiterThreshold > 1)
  ) {
    throw new Error('Limiter 阈值无效');
  }
}

/** 校验单个 PEQ 滤波器参数。 */
function assertPeqBand(value: unknown): asserts value is DesktopPeqBand {
  if (!isRecord(value)) {
    throw new Error('PEQ 滤波器格式无效');
  }
  const allowedKeys = new Set(['enabled', 'frequency', 'gain', 'q']);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw new Error('PEQ 滤波器包含不支持的字段');
  }
  if (typeof value.enabled !== 'boolean') {
    throw new Error('PEQ 开关参数无效');
  }
  if (
    typeof value.frequency !== 'number' ||
    !Number.isFinite(value.frequency) ||
    value.frequency < 20 ||
    value.frequency > 20000
  ) {
    throw new Error('PEQ 频率无效');
  }
  if (
    typeof value.gain !== 'number' ||
    !Number.isFinite(value.gain) ||
    value.gain < -18 ||
    value.gain > 18
  ) {
    throw new Error('PEQ 增益无效');
  }
  if (
    typeof value.q !== 'number' ||
    !Number.isFinite(value.q) ||
    value.q < 0.1 ||
    value.q > 20
  ) {
    throw new Error('PEQ Q 值无效');
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
