import {net} from 'electron';
import {promises as fs, readFileSync} from 'node:fs';
import path from 'node:path';
import {QueueController} from '../../../packages/core/src/player/queueController';
import type {
  PlaybackAudioEvent,
  PlaybackCommand,
  PlaybackDiagnostic,
  PlaybackModeRequest,
  PlaybackQueueContext,
  PlaybackQueueItem,
  PlaybackQueueItemRequest,
  PlaybackQueueMode,
  PlaybackQueueRequest,
  PlaybackRemoveRequest,
  PlaybackReorderRequest,
  PlaybackSeekRequest,
  PlaybackSleepTimerRequest,
  PlaybackSnapshot,
  PlaybackSource,
  PlaybackVolumeRequest,
} from '../../shared/types';
import {getCachedAudioUrl} from '../audio/localAudioProtocol';
import {
  BiliAudioResolver,
  type ResolvedPlaybackAudio,
} from '../audio/biliAudioResolver';
import {AppLogger} from '../logging/appLogger';
import {AudioCacheStore, type AudioCacheRequest} from './audioCacheStore';
import {normalizeBiliAssetUrl} from '../security/urlPolicy';

const AUDIO_CACHE_QUALITY = 'high';
const FADE_IN_MS = 180;
const FADE_OUT_MS = 120;
const MAX_RETRY_COUNT = 2;
const PROGRESS_EVENT_INTERVAL_MS = 120;

const DEFAULT_PLAYBACK_SNAPSHOT: PlaybackSnapshot = {
  state: 'idle',
  trackId: null,
  trackTitle: null,
  trackArtist: null,
  artwork: null,
  position: 0,
  duration: 0,
  volume: 1,
  queueLength: 0,
  queueIndex: -1,
  queue: [],
  mode: 'sequential',
  queueContext: null,
  sleepTimerSeconds: null,
  networkOnline: true,
  cached: false,
  error: null,
  diagnostic: null,
};

export type PlaybackRuntimeEvent =
  | {type: 'state'; snapshot: PlaybackSnapshot}
  | {type: 'source'; source: PlaybackSource}
  | {type: 'command'; command: PlaybackCommand};

type PlaybackRuntimeOptions = {
  resolver: BiliAudioResolver;
  cache: AudioCacheStore;
  logger: AppLogger;
  statePath: string;
  popularContinuation?: (
    context: PlaybackQueueContext,
    signal: AbortSignal,
  ) => Promise<{
    items: PlaybackQueueItem[];
    context: PlaybackQueueContext;
  }>;
};

type PersistedPlaybackState = {
  queue: PlaybackQueueItem[];
  currentTrackId: string | null;
  mode: PlaybackQueueMode;
  context: PlaybackQueueContext | null;
};

/**
 * 桌面播放器主进程运行时。
 * 负责队列状态机、音频地址解析、离线缓存、恢复重试和 Renderer 命令事件。
 */
export class PlaybackRuntime {
  private readonly queueController = new QueueController<PlaybackQueueItem>({
    idOf: item => item.id,
  });

  private readonly listeners = new Set<
    (event: PlaybackRuntimeEvent) => void
  >();

  private snapshot: PlaybackSnapshot = {
    ...DEFAULT_PLAYBACK_SNAPSHOT,
  };

  private currentSource: PlaybackSource | null = null;

  private operationController: AbortController | null = null;

  private retryCount = 0;

  private lastProgressEventAt = 0;

  private sleepTimer: NodeJS.Timeout | null = null;

  private sleepTimerExpiresAt: number | null = null;

  constructor(private readonly options: PlaybackRuntimeOptions) {
    this.restoreState();
    this.snapshot = this.snapshotFromQueue('idle');
  }

  /** 订阅主进程播放器事件。 */
  subscribe(listener: (event: PlaybackRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 返回不含可变引用的播放快照。 */
  getState(): PlaybackSnapshot {
    return this.snapshotFromQueue(this.snapshot.state);
  }

  /** 替换队列，按需展开多 P，并开始指定项目。 */
  async loadQueue(request: PlaybackQueueRequest): Promise<PlaybackSnapshot> {
    const items = normalizeQueueItems(request.items);
    this.abortCurrentOperation();
    if (items.length === 0) {
      this.queueController.replaceQueue([]);
      this.currentSource = null;
      this.snapshot = this.snapshotFromQueue('idle');
      await this.persistState();
      this.emitState();
      return this.getState();
    }

    const startIndex = Math.min(
      Math.max(0, request.startIndex ?? 0),
      items.length - 1,
    );
    const initialItem = items[startIndex];
    const revision = this.queueController.replaceQueue(
      items,
      initialItem.id,
      request.context ?? null,
    );
    const controller = new AbortController();
    this.operationController = controller;
    this.currentSource = null;
    this.retryCount = 0;
    this.snapshot.cached = false;
    this.snapshot = this.snapshotFromQueue('loading');
    this.emitState();

    try {
      const prepared = request.expandParts === false
        ? {items, currentId: initialItem.id}
        : await this.prepareQueue(items, initialItem.id, controller.signal);
      if (!this.queueController.isCurrent(revision)) {
        return this.getState();
      }
      this.queueController.syncSnapshot(prepared.items, prepared.currentId);
      await this.persistState();
      return await this.activateCurrent(
        revision,
        request.autoplay !== false,
        controller.signal,
      );
    } catch (error) {
      if (isAbortError(error) || !this.queueController.isCurrent(revision)) {
        return this.getState();
      }
      const kind = !net.isOnline() ? 'network-offline' : 'playback-error';
      return this.failPlayback(error, kind, false);
    } finally {
      if (this.operationController === controller) {
        this.operationController = null;
      }
    }
  }

  /** 将一首歌加入当前队列；空队列时直接开始播放。 */
  async addToQueue(
    request: PlaybackQueueItemRequest,
  ): Promise<PlaybackSnapshot> {
    const item = normalizeQueueItems([request.item])[0];
    if (!item) {
      throw new Error('播放队列项目无效');
    }
    const currentQueue = this.queueController.getSnapshot().queue;
    if (currentQueue.length === 0) {
      return this.loadQueue({
        items: [item],
        autoplay: request.autoplay !== false,
        context: request.context ?? null,
      });
    }
    this.queueController.append([item]);
    this.snapshot = this.snapshotFromQueue(this.snapshot.state);
    await this.persistState();
    this.emitState();
    if (request.autoplay === true && this.snapshot.trackId !== item.id) {
      return this.activateTrack(item.id, true);
    }
    return this.getState();
  }

  /** 从当前队列删除项目，并在删除当前项时恢复到下一项。 */
  async removeFromQueue(
    request: PlaybackRemoveRequest,
  ): Promise<PlaybackSnapshot> {
    const wasCurrent = this.snapshot.trackId === request.trackId;
    this.queueController.remove(request.trackId);
    this.currentSource = wasCurrent ? null : this.currentSource;
    this.snapshot = this.snapshotFromQueue(
      wasCurrent ? 'loading' : this.snapshot.state,
    );
    await this.persistState();
    this.emitState();
    if (wasCurrent && this.snapshot.trackId) {
      return this.activateTrack(this.snapshot.trackId, true);
    }
    if (!this.snapshot.trackId) {
      this.snapshot = this.snapshotFromQueue('idle');
      this.emitState();
    }
    return this.getState();
  }

  /** 根据 Renderer 提交的新顺序更新队列。 */
  async reorderQueue(
    request: PlaybackReorderRequest,
  ): Promise<PlaybackSnapshot> {
    const current = this.queueController.getSnapshot().queue;
    const byId = new Map(current.map(item => [item.id, item]));
    const reordered = request.trackIds
      .map(id => byId.get(id))
      .filter((item): item is PlaybackQueueItem => Boolean(item));
    current.forEach(item => {
      if (!request.trackIds.includes(item.id)) {
        reordered.push(item);
      }
    });
    this.queueController.reorder(reordered, this.snapshot.trackId);
    this.snapshot = this.snapshotFromQueue(this.snapshot.state);
    await this.persistState();
    this.emitState();
    return this.getState();
  }

  /** 切换顺序或随机模式。 */
  async setMode(request: PlaybackModeRequest): Promise<PlaybackSnapshot> {
    this.queueController.setMode(request.mode);
    this.snapshot = this.snapshotFromQueue(this.snapshot.state);
    await this.persistState();
    this.emitState();
    return this.getState();
  }

  /** 设置或取消睡眠定时器，到期后停止播放并清除定时器。 */
  async setSleepTimer(
    request: PlaybackSleepTimerRequest,
  ): Promise<PlaybackSnapshot> {
    this.clearSleepTimer();
    if (request.seconds !== null) {
      this.sleepTimerExpiresAt = Date.now() + request.seconds * 1000;
      this.sleepTimer = setTimeout(
        () => {
          void this.stop().catch(error => {
            this.options.logger.warn('playback.sleep-stop-failed', {error});
          });
        },
        request.seconds * 1000,
      );
    }
    this.snapshot = this.snapshotFromQueue(this.snapshot.state);
    this.emitState();
    return this.getState();
  }

  /** 开始当前项目，必要时先解析 URL 或切换到离线缓存。 */
  async play(): Promise<PlaybackSnapshot> {
    if (!this.snapshot.trackId) {
      return this.getState();
    }
    if (!this.currentSource) {
      return this.activateTrack(this.snapshot.trackId, true);
    }
    this.snapshot = this.snapshotFromQueue('playing');
    this.emitCommand({
      type: 'fade-in',
      trackId: this.snapshot.trackId,
      volume: this.snapshot.volume,
      durationMs: FADE_IN_MS,
      revision: this.queueController.getRevision(),
    });
    this.emitCommand({
      type: 'play',
      trackId: this.snapshot.trackId,
      revision: this.queueController.getRevision(),
    });
    this.emitState();
    return this.getState();
  }

  /** 暂停当前项目，并先执行短淡出。 */
  async pause(): Promise<PlaybackSnapshot> {
    if (this.snapshot.trackId) {
      this.emitCommand({
        type: 'fade-out',
        trackId: this.snapshot.trackId,
        volume: 0,
        durationMs: FADE_OUT_MS,
        revision: this.queueController.getRevision(),
      });
      this.emitCommand({
        type: 'pause',
        trackId: this.snapshot.trackId,
        revision: this.queueController.getRevision(),
      });
    }
    this.snapshot = this.snapshotFromQueue('paused');
    this.emitState();
    return this.getState();
  }

  /** 停止当前项目并将进度归零。 */
  async stop(): Promise<PlaybackSnapshot> {
    this.abortCurrentOperation();
    this.clearSleepTimer();
    if (this.snapshot.trackId) {
      this.emitCommand({
        type: 'fade-out',
        trackId: this.snapshot.trackId,
        volume: 0,
        durationMs: FADE_OUT_MS,
        revision: this.queueController.getRevision(),
      });
      this.emitCommand({
        type: 'stop',
        trackId: this.snapshot.trackId,
        revision: this.queueController.getRevision(),
      });
    }
    this.currentSource = null;
    this.snapshot = this.snapshotFromQueue('stopped');
    this.snapshot.position = 0;
    this.emitState();
    return this.getState();
  }

  /** 调整当前项目播放位置。 */
  async seek(request: PlaybackSeekRequest): Promise<PlaybackSnapshot> {
    const maximum = this.snapshot.duration > 0
      ? this.snapshot.duration
      : Number.MAX_SAFE_INTEGER;
    const position = Math.min(
      maximum,
      Math.max(0, Math.round(request.position * 1000) / 1000),
    );
    this.snapshot.position = position;
    this.emitCommand({
      type: 'seek',
      trackId: this.snapshot.trackId,
      position,
      revision: this.queueController.getRevision(),
    });
    this.emitState();
    return this.getState();
  }

  /** 切换到下一首，不让旧 URL 解析覆盖新队列。 */
  async skipNext(): Promise<PlaybackSnapshot> {
    return this.skipTo(this.queueController.next());
  }

  /** 切换到上一首，不让旧 URL 解析覆盖新队列。 */
  async skipPrevious(): Promise<PlaybackSnapshot> {
    return this.skipTo(this.queueController.previous());
  }

  /** 设置主音量并同步到 Renderer 音频元素。 */
  setVolume(request: PlaybackVolumeRequest): PlaybackSnapshot {
    const volume = Math.min(1, Math.max(0, request.volume));
    this.snapshot.volume = volume;
    this.emitCommand({
      type: 'set-volume',
      trackId: this.snapshot.trackId,
      volume,
      revision: this.queueController.getRevision(),
    });
    this.emitState();
    return this.getState();
  }

  /** 接收 Renderer HTMLAudioElement 事件并更新主进程状态。 */
  async reportAudioEvent(
    event: PlaybackAudioEvent,
  ): Promise<PlaybackSnapshot> {
    if (
      event.trackId &&
      this.snapshot.trackId &&
      event.trackId !== this.snapshot.trackId
    ) {
      return this.getState();
    }
    if (event.type === 'network-online') {
      this.snapshot.networkOnline = true;
      if (
        this.snapshot.diagnostic?.kind === 'network-offline' &&
        this.snapshot.trackId
      ) {
        return this.activateTrack(this.snapshot.trackId, true);
      }
      this.emitState();
      return this.getState();
    }
    if (event.type === 'network-offline') {
      this.snapshot.networkOnline = false;
      this.snapshot.diagnostic = this.createDiagnostic(
        'network-offline',
        '网络已断开，等待恢复后继续播放',
        false,
      );
      this.emitState();
      return this.getState();
    }
    this.snapshot.networkOnline = net.isOnline();
    if (event.type === 'timeupdate') {
      this.snapshot.position = clampNumber(event.position, 0, 86400);
      this.snapshot.duration = clampNumber(
        event.duration ?? this.snapshot.duration,
        0,
        86400,
      );
      if (Date.now() - this.lastProgressEventAt < PROGRESS_EVENT_INTERVAL_MS) {
        return this.getState();
      }
      this.lastProgressEventAt = Date.now();
      this.emitState();
      return this.getState();
    }
    if (event.type === 'loadedmetadata' || event.type === 'canplay') {
      if (event.duration !== undefined) {
        this.snapshot.duration = clampNumber(event.duration, 0, 86400);
      }
      this.snapshot.state = event.type === 'canplay' ? 'ready' : 'loading';
      this.emitState();
      return this.getState();
    }
    if (event.type === 'playing') {
      this.snapshot.state = 'playing';
      this.snapshot.error = null;
      this.snapshot.diagnostic = null;
      this.emitState();
      return this.getState();
    }
    if (event.type === 'pause') {
      if (this.snapshot.state !== 'stopped') {
        this.snapshot.state = 'paused';
      }
      this.emitState();
      return this.getState();
    }
    if (event.type === 'waiting' || event.type === 'stalled') {
      this.snapshot.state = 'loading';
      this.emitState();
      return this.getState();
    }
    if (event.type === 'ended') {
      return this.skipNext();
    }
    if (event.type === 'error') {
      return this.recoverAfterError(event);
    }
    return this.getState();
  }

  /** 按当前队列项目准备下一首播放。 */
  private async skipTo(
    item: PlaybackQueueItem | null,
  ): Promise<PlaybackSnapshot> {
    if (!item) {
      return this.continuePopular();
    }
    return this.activateTrack(item.id, true);
  }

  /** 在热门队列播放到末尾时请求下一页并追加到当前队列。 */
  private async continuePopular(): Promise<PlaybackSnapshot> {
    const context = this.queueController.getSnapshot().context;
    if (
      !this.options.popularContinuation ||
      !isPopularContext(context)
    ) {
      this.snapshot = this.snapshotFromQueue('stopped');
      this.emitState();
      return this.getState();
    }

    this.abortCurrentOperation();
    const revision = this.queueController.beginOperation();
    const controller = new AbortController();
    this.operationController = controller;
    try {
      const result = await this.options.popularContinuation(
        context,
        controller.signal,
      );
      if (!this.queueController.isCurrent(revision)) {
        return this.getState();
      }
      const items = normalizeQueueItems(result.items);
      if (items.length === 0) {
        this.queueController.syncSnapshot(
          this.queueController.getSnapshot().queue,
          this.queueController.getSnapshot().currentBvid,
          result.context,
        );
        await this.persistState();
        this.snapshot = this.snapshotFromQueue('stopped');
        this.emitState();
        return this.getState();
      }
      this.queueController.append(items);
      const appended = this.queueController.getSnapshot();
      this.queueController.syncSnapshot(
        appended.queue,
        appended.currentBvid,
        result.context,
      );
      await this.persistState();
      const next = this.queueController.next();
      return next ? this.activateTrack(next.id, true) : this.getState();
    } catch (error) {
      if (isAbortError(error)) {
        return this.getState();
      }
      const kind = !net.isOnline() ? 'network-offline' : 'playback-error';
      return this.failPlayback(error, kind, false);
    } finally {
      if (this.operationController === controller) {
        this.operationController = null;
      }
    }
  }

  /** 以指定项目为当前项建立新 revision。 */
  private async activateTrack(
    trackId: string,
    autoplay: boolean,
  ): Promise<PlaybackSnapshot> {
    const queue = this.queueController.getSnapshot().queue;
    if (!queue.some(item => item.id === trackId)) {
      return this.getState();
    }
    this.abortCurrentOperation();
    const revision = this.queueController.replaceQueue(queue, trackId);
    const controller = new AbortController();
    this.operationController = controller;
    this.currentSource = null;
    this.snapshot.cached = false;
    try {
      return await this.activateCurrent(
        revision,
        autoplay,
        controller.signal,
      );
    } catch (error) {
      if (isAbortError(error) || !this.queueController.isCurrent(revision)) {
        return this.getState();
      }
      const kind = !net.isOnline() ? 'network-offline' : 'playback-error';
      return this.failPlayback(error, kind, false);
    } finally {
      if (this.operationController === controller) {
        this.operationController = null;
      }
    }
  }

  /** 解析当前项目并选择本地缓存或远程 URL。 */
  private async activateCurrent(
    revision: number,
    autoplay: boolean,
    signal: AbortSignal,
  ): Promise<PlaybackSnapshot> {
    const queueSnapshot = this.queueController.getSnapshot();
    const track = queueSnapshot.queue.find(
      item => item.id === queueSnapshot.currentBvid,
    );
    if (!track || !this.queueController.isCurrent(revision)) {
      return this.getState();
    }
    this.snapshot = this.snapshotFromQueue('loading');
    this.snapshot.error = null;
    this.snapshot.diagnostic = null;
    this.emitState();
    const cacheRequest = this.toCacheRequest(track);
    const cached = await this.options.cache.get(cacheRequest);
    if (cached && this.queueController.isCurrent(revision)) {
      this.currentSource = {
        trackId: track.id,
        url: getCachedAudioUrl(cached.key),
        cached: true,
        revision,
      };
      this.snapshot.cached = true;
      this.snapshot.duration = track.duration;
      this.retryCount = 0;
      this.emitSource(this.currentSource);
      this.emitPlayCommand(track.id, revision, autoplay);
      this.emitState();
      return this.getState();
    }
    if (!net.isOnline()) {
      return this.failPlayback(
        new Error('当前处于离线状态，且该音频尚未缓存'),
        'network-offline',
        false,
      );
    }
    const resolved = await this.options.resolver.resolve(track, signal);
    if (!this.queueController.isCurrent(revision)) {
      return this.getState();
    }
    let resolvedTrack = resolved.track;
    if (track.cid === undefined && resolved.parts.length > 1) {
      const firstPart = resolved.parts[0];
      const expandedQueue = this.queueController
        .getSnapshot()
        .queue.flatMap(item =>
          item.id === track.id ? resolved.parts : [item],
        );
      this.queueController.syncSnapshot(expandedQueue, firstPart.id);
      resolvedTrack = {
        ...firstPart,
        artwork: resolved.track.artwork,
        duration: resolved.duration,
      };
    } else {
      this.queueController.syncSnapshot(
        this.queueController
          .getSnapshot()
          .queue.map(item => item.id === track.id ? resolvedTrack : item),
        resolvedTrack.id,
      );
    }
    await this.persistState();
    this.snapshot = this.snapshotFromQueue('loading');
    this.snapshot.duration = resolved.duration;
    this.snapshot.cached = false;
    this.retryCount = 0;
    this.currentSource = {
      trackId: resolvedTrack.id,
      url: resolved.url,
      cached: false,
      revision,
    };
    this.emitSource(this.currentSource);
    this.emitPlayCommand(resolvedTrack.id, revision, autoplay);
    this.cacheInBackground(this.toCacheRequest(resolvedTrack), resolved);
    this.emitState();
    return this.getState();
  }

  /** 在解析失败时按错误类型重试一次，并保留当前队列意图。 */
  private async recoverAfterError(
    event: PlaybackAudioEvent,
  ): Promise<PlaybackSnapshot> {
    const kind = classifyPlaybackError(event.message, event.code);
    if (kind === 'network-offline' || !net.isOnline()) {
      this.snapshot.networkOnline = false;
      return this.failPlayback(
        new Error('网络不可用，等待恢复后继续播放'),
        'network-offline',
        false,
      );
    }
    if (!this.snapshot.trackId || this.retryCount >= MAX_RETRY_COUNT) {
      return this.failPlayback(
        new Error(event.message || '音频播放失败'),
        kind,
        false,
      );
    }
    this.retryCount += 1;
    const trackId = this.snapshot.trackId;
    this.snapshot.diagnostic = this.createDiagnostic(
      kind,
      '正在重新获取音频地址',
      true,
    );
    this.emitState();
    return this.activateTrack(trackId, true);
  }

  /** 预加载队列详情并展开多 P，单个详情失败时保留原项目。 */
  private async prepareQueue(
    items: PlaybackQueueItem[],
    currentId: string,
    signal: AbortSignal,
  ): Promise<{items: PlaybackQueueItem[]; currentId: string}> {
    const prepared: PlaybackQueueItem[] = [];
    let selectedId = currentId;
    for (const item of items) {
      if (signal.aborted) {
        throw createAbortError();
      }
      if (item.cid !== undefined) {
        prepared.push(item);
        continue;
      }
      try {
        const parts = await this.options.resolver.getParts(item.bvid, signal);
        if (parts.length > 1) {
          prepared.push(...parts);
          if (item.id === currentId) {
            selectedId = parts[0].id;
          }
          continue;
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        this.options.logger.warn('playback.parts-resolve-failed', {
          bvid: item.bvid,
          error,
        });
      }
      prepared.push(item);
    }
    return {
      items: prepared,
      currentId: selectedId,
    };
  }

  /** 按最新的队列快照组装跨进程状态。 */
  private snapshotFromQueue(
    state: PlaybackSnapshot['state'],
  ): PlaybackSnapshot {
    const queueSnapshot = this.queueController.getSnapshot();
    const current = queueSnapshot.queue.find(
      item => item.id === queueSnapshot.currentBvid,
    );
    const queueIndex = current
      ? queueSnapshot.queue.findIndex(item => item.id === current.id)
      : -1;
    const sleepTimerSeconds = this.sleepTimerExpiresAt === null
      ? null
      : Math.max(
          0,
          Math.ceil((this.sleepTimerExpiresAt - Date.now()) / 1000),
        );
    return {
      ...this.snapshot,
      state,
      trackId: current?.id ?? null,
      trackTitle: current?.title ?? null,
      trackArtist: current?.artist ?? null,
      artwork: current?.artwork ?? null,
      queue: [...queueSnapshot.queue],
      queueLength: queueSnapshot.queue.length,
      queueIndex,
      mode: queueSnapshot.mode,
      queueContext: isQueueContext(queueSnapshot.context)
        ? queueSnapshot.context
        : null,
      sleepTimerSeconds,
    };
  }

  /** 将当前项目提交为后台缓存，缓存失败不会阻断在线播放。 */
  private cacheInBackground(
    request: AudioCacheRequest,
    resolved: ResolvedPlaybackAudio,
  ): void {
    void this.options.cache
      .download(
        request,
        [resolved.url, ...resolved.backupUrls],
      )
      .then(() => this.options.cache.evict(this.getProtectedCacheKeys()))
      .catch(error => {
        this.options.logger.warn('audio.cache-background-failed', {
          bvid: request.track.bvid,
          cid: request.track.cid,
          error,
        });
        if (isDiskFailure(error)) {
          this.snapshot.diagnostic = this.createDiagnostic(
            'disk-failure',
            '本地磁盘缓存失败，请检查磁盘空间',
            false,
          );
          this.emitState();
        }
      });
  }

  /** 保留当前队列对应的缓存文件，避免后台淘汰正在使用的音频。 */
  private getProtectedCacheKeys(): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const track of this.queueController.getSnapshot().queue) {
      keys.add(
        AudioCacheStore.getKey({
          track,
          quality: AUDIO_CACHE_QUALITY,
        }),
      );
    }
    return keys;
  }

  /** 清理旧的解析任务。 */
  private abortCurrentOperation(): void {
    this.operationController?.abort();
    this.operationController = null;
  }

  /** 将队列项转换为缓存身份。 */
  private toCacheRequest(track: PlaybackQueueItem): AudioCacheRequest {
    return {
      track,
      quality: AUDIO_CACHE_QUALITY,
    };
  }

  /** 生成并发布播放命令。 */
  private emitPlayCommand(
    trackId: string,
    revision: number,
    autoplay: boolean,
  ): void {
    if (!autoplay) {
      return;
    }
    this.emitCommand({
      type: 'fade-in',
      trackId,
      volume: this.snapshot.volume,
      durationMs: FADE_IN_MS,
      revision,
    });
    this.emitCommand({
      type: 'play',
      trackId,
      revision,
    });
  }

  /** 将错误转换为脱敏诊断信息并发布。 */
  private failPlayback(
    error: unknown,
    kind: PlaybackDiagnostic['kind'],
    retrying: boolean,
  ): PlaybackSnapshot {
    const message = error instanceof Error && error.message
      ? error.message
      : '音频播放失败';
    this.snapshot = this.snapshotFromQueue('error');
    this.snapshot.error = message;
    this.snapshot.diagnostic = this.createDiagnostic(
      kind,
      toDiagnosticMessage(kind, message),
      retrying,
    );
    this.emitState();
    return this.getState();
  }

  /** 创建统一的播放器诊断对象。 */
  private createDiagnostic(
    kind: PlaybackDiagnostic['kind'],
    message: string,
    retrying: boolean,
  ): PlaybackDiagnostic {
    return {
      kind,
      message,
      retrying,
      timestamp: Date.now(),
    };
  }

  /** 发布状态事件。 */
  private emitState(): void {
    const snapshot = this.getState();
    this.snapshot = snapshot;
    this.emit({type: 'state', snapshot});
  }

  /** 发布 Renderer 音频来源事件。 */
  private emitSource(source: PlaybackSource): void {
    this.emit({type: 'source', source});
  }

  /** 发布 Renderer 音频控制命令。 */
  private emitCommand(command: PlaybackCommand): void {
    this.emit({type: 'command', command});
  }

  /** 通知所有订阅者，单个监听器异常不影响其他监听器。 */
  private emit(event: PlaybackRuntimeEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        this.options.logger.warn('playback.listener-failed', {error});
      }
    });
  }

  /** 从设置目录恢复上次的队列，恢复失败时使用空队列。 */
  private restoreState(): void {
    try {
      const raw = readFileSync(this.options.statePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedPlaybackState>;
      const queue = normalizeQueueItems(parsed.queue ?? []);
      if (queue.length === 0) {
        return;
      }
      this.queueController.replaceQueue(
        queue,
        typeof parsed.currentTrackId === 'string'
          ? parsed.currentTrackId
          : queue[0].id,
        parsed.context ?? null,
      );
      if (parsed.mode === 'shuffle') {
        this.queueController.setMode('shuffle');
      }
    } catch {
      // 首次启动没有播放恢复文件，直接从空队列开始。
    }
  }

  /** 使用原子替换保存不含签名 URL 的队列状态。 */
  private async persistState(): Promise<void> {
    const snapshot = this.queueController.getSnapshot();
    const state: PersistedPlaybackState = {
      queue: snapshot.queue,
      currentTrackId: snapshot.currentBvid,
      mode: snapshot.mode,
      context: isQueueContext(snapshot.context)
        ? snapshot.context
        : null,
    };
    const temporaryPath = `${this.options.statePath}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(this.options.statePath), {recursive: true});
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(state), 'utf8');
      await fs.rename(temporaryPath, this.options.statePath);
    } finally {
      await fs.rm(temporaryPath, {force: true});
    }
  }

  /** 清理睡眠定时器。 */
  private clearSleepTimer(): void {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    this.sleepTimerExpiresAt = null;
  }
}

/** 清理外部队列项，避免 IPC 把任意数据带入主进程。 */
function normalizeQueueItems(items: PlaybackQueueItem[]): PlaybackQueueItem[] {
  const normalized: PlaybackQueueItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const bvid = item.bvid.trim();
    const id = item.id.trim() || bvid;
    if (!bvid || !id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      bvid,
      ...(item.cid !== undefined ? {cid: item.cid} : {}),
      ...(item.page !== undefined ? {page: item.page} : {}),
      title: item.title.trim() || bvid,
      artist: item.artist.trim() || '未知 UP 主',
      artwork: normalizeBiliAssetUrl(item.artwork),
      duration: clampNumber(item.duration, 0, 86400),
      ...(item.source ? {source: item.source} : {}),
    });
  }
  return normalized;
}

/** 判断队列上下文是否为受支持的热门续页游标。 */
function isPopularContext(
  value: unknown,
): value is Extract<PlaybackQueueContext, {kind: 'popular'}> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as {kind?: unknown}).kind === 'popular' &&
    Number.isSafeInteger((value as {page?: unknown}).page) &&
    Number((value as {page: number}).page) >= 1
  );
}

/** 校验可持久化的播放来源上下文，保留收藏夹和搜索队列的来源边界。 */
function isQueueContext(value: unknown): value is PlaybackQueueContext {
  if (isPopularContext(value)) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as {
    kind?: unknown;
    sourceKey?: unknown;
    keyword?: unknown;
    page?: unknown;
  };
  if (candidate.kind === 'favorite') {
    return typeof candidate.sourceKey === 'string' && candidate.sourceKey.length > 0;
  }
  return (
    candidate.kind === 'search' &&
    typeof candidate.keyword === 'string' &&
    candidate.keyword.length > 0 &&
    Number.isSafeInteger(candidate.page) &&
    Number(candidate.page) >= 1
  );
}

/** 将可能的浮点输入限制到播放器允许的范围。 */
function clampNumber(
  value: number | undefined,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

/** 判断是否为请求中止错误。 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** 创建统一中止错误。 */
function createAbortError(): Error {
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
}

/** 根据媒体错误文本分类诊断类型。 */
function classifyPlaybackError(
  message: string | undefined,
  code: number | undefined,
): PlaybackDiagnostic['kind'] {
  const normalized = (message ?? '').toLocaleLowerCase();
  if (
    normalized.includes('disk') ||
    normalized.includes('space') ||
    normalized.includes('enospc')
  ) {
    return 'disk-failure';
  }
  if (
    normalized.includes('decode') ||
    normalized.includes('not supported') ||
    code === 3
  ) {
    return 'decode-failure';
  }
  if (
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('404') ||
    normalized.includes('expired') ||
    code === 4
  ) {
    return 'url-expired';
  }
  if (
    normalized.includes('header') ||
    normalized.includes('cors') ||
    normalized.includes('referer')
  ) {
    return 'request-headers';
  }
  if (!net.isOnline()) {
    return 'network-offline';
  }
  return 'playback-error';
}

/** 判断文件系统错误是否应展示为磁盘诊断。 */
function isDiskFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLocaleLowerCase();
  return (
    message.includes('enospc') ||
    message.includes('disk') ||
    message.includes('space')
  );
}

/** 将内部错误转换为用户可理解且不泄露 URL 的诊断文案。 */
function toDiagnosticMessage(
  kind: PlaybackDiagnostic['kind'],
  fallback: string,
): string {
  switch (kind) {
    case 'request-headers':
      return '音频请求头未通过 CDN 校验';
    case 'url-expired':
      return '音频地址已过期，正在尝试重新获取';
    case 'decode-failure':
      return '当前音频格式无法解码';
    case 'disk-failure':
      return '本地磁盘缓存失败，请检查磁盘空间';
    case 'network-offline':
      return '网络不可用，等待恢复后继续播放';
    default:
      return fallback;
  }
}
