import type {
  AudioPlaybackState,
  AudioPlayer,
  AudioProgress,
  AudioTrackLike,
} from '../../../packages/platform-contracts/src';
import type {
  PlaybackAudioEvent,
  PlaybackCommand,
  PlaybackSource,
} from '../../shared/types';
import type {DesktopAudioSettings} from '../../shared/types';
import {AudioEffectsController} from './audioEffectsController';

type EventListener = (event: PlaybackAudioEvent) => void;

/**
 * 基于 HTMLAudioElement 的 Electron 播放器适配器。
 * 主进程负责队列和 URL，Renderer 只负责媒体元素、淡入淡出和浏览器事件转发。
 */
export class ElectronAudioPlayerAdapter
  implements AudioPlayer<AudioTrackLike>
{
  private readonly listeners = new Set<EventListener>();

  private readonly eventHandlers: Array<{
    name: keyof HTMLMediaElementEventMap;
    handler: EventListener;
  }> = [];

  private activeTrackId: string | null = null;

  private activeRevision = 0;

  private targetVolume = 1;

  private fadeFrame: number | null = null;

  private pendingSeekPosition: number | null = null;

  private setupDone = false;

  private readonly effects: AudioEffectsController;

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly report: (event: PlaybackAudioEvent) => void,
  ) {
    this.effects = new AudioEffectsController(audio);
  }

  /** 绑定媒体事件并设置初始音量。 */
  async setup(): Promise<void> {
    if (this.setupDone) {
      return;
    }
    this.setupDone = true;
    this.audio.preload = 'auto';
    this.audio.volume = this.targetVolume;
    await this.effects.setup();
    this.bind('loadedmetadata', () => {
      this.applyPendingSeek();
      this.emitProgress('loadedmetadata');
    });
    this.bind('canplay', () => this.emitProgress('canplay'));
    this.bind('playing', () => this.emitSimple('playing'));
    this.bind('pause', () => this.emitSimple('pause'));
    this.bind('waiting', () => this.emitSimple('waiting'));
    this.bind('stalled', () => this.emitSimple('stalled'));
    this.bind('timeupdate', () => this.emitProgress('timeupdate'));
    this.bind('ended', () => this.emitSimple('ended'));
    this.bind('error', () => this.emitError());
  }

  /** 加载共享 AudioPlayer 契约中的队列项目。 */
  async load(queue: AudioTrackLike[], startIndex = 0): Promise<void> {
    const track = queue[Math.min(Math.max(0, startIndex), queue.length - 1)];
    if (!track) {
      this.audio.removeAttribute('src');
      this.audio.load();
      this.activeTrackId = null;
      return;
    }
    this.activeTrackId = track.id;
    this.audio.src = track.url;
    this.audio.load();
  }

  /** 接收主进程发来的当前音频来源。 */
  loadSource(source: PlaybackSource): void {
    if (source.revision < this.activeRevision) {
      return;
    }
    this.activeRevision = source.revision;
    this.activeTrackId = source.trackId;
    // 新资源的元数据到达前，部分浏览器会暂时沿用旧时间线；先挂起零点跳转，避免切歌继承旧进度。
    this.pendingSeekPosition = 0;
    this.cancelFade();
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.src = source.url;
    this.audio.load();
  }

  /** 执行主进程发来的播放命令。 */
  async handleCommand(command: PlaybackCommand): Promise<void> {
    if (command.revision < this.activeRevision) {
      return;
    }
    this.activeRevision = command.revision;
    if (
      command.trackId &&
      this.activeTrackId &&
      command.trackId !== this.activeTrackId
    ) {
      return;
    }
    switch (command.type) {
      case 'play':
        await this.play();
        return;
      case 'pause':
        await this.pause();
        return;
      case 'stop':
        await this.stop();
        return;
      case 'seek':
        await this.seek(command.position);
        return;
      case 'set-volume':
        await this.setVolume(command.volume);
        return;
      case 'fade-in':
        await this.fadeTo(command.volume, command.durationMs);
        return;
      case 'fade-out':
        await this.fadeTo(command.volume, command.durationMs);
        return;
      default:
        return;
    }
  }

  /** 开始 HTMLAudioElement 播放。 */
  async play(): Promise<void> {
    await this.effects.resume();
    await this.audio.play();
  }

  /** 暂停 HTMLAudioElement。 */
  async pause(): Promise<void> {
    this.audio.pause();
  }

  /** 停止并重置 HTMLAudioElement 进度。 */
  async stop(): Promise<void> {
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  /** 跳转到指定秒数。 */
  async seek(position: number): Promise<void> {
    const normalizedPosition = Math.max(0, position);
    this.pendingSeekPosition = normalizedPosition;
    if (Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = Math.min(
        normalizedPosition,
        Math.max(0, this.audio.duration),
      );
      this.pendingSeekPosition = null;
      return;
    }
    if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      this.audio.currentTime = normalizedPosition;
      this.pendingSeekPosition = null;
    }
  }

  /** 队列切换由主进程 QueueController 负责。 */
  async skipToNext(): Promise<void> {}

  /** 队列切换由主进程 QueueController 负责。 */
  async skipToPrevious(): Promise<void> {}

  /** 设置 HTMLAudioElement 的目标音量。 */
  async setVolume(volume: number): Promise<void> {
    this.cancelFade();
    this.targetVolume = Math.min(1, Math.max(0, volume));
    this.audio.volume = this.targetVolume;
  }

  /** 同步主进程设置页保存的 EQ、Limiter 和频谱参数。 */
  setAudioSettings(settings: DesktopAudioSettings): void {
    this.effects.setSettings(settings);
  }

  /** 订阅 AudioWorklet 输出的归一化频谱。 */
  subscribeSpectrum(listener: (values: number[]) => void): () => void {
    return this.effects.subscribeSpectrum(listener);
  }

  /** 读取标准化播放器状态。 */
  async getState(): Promise<AudioPlaybackState> {
    if (this.audio.error) {
      return 'error';
    }
    if (this.audio.seeking || this.audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      return 'loading';
    }
    if (!this.audio.paused) {
      return 'playing';
    }
    if (this.audio.currentTime > 0) {
      return 'paused';
    }
    return 'idle';
  }

  /** 读取当前位置、时长和缓冲区末端。 */
  async getProgress(): Promise<AudioProgress> {
    const buffered = this.audio.buffered.length > 0
      ? this.audio.buffered.end(this.audio.buffered.length - 1)
      : 0;
    return {
      position: Number.isFinite(this.audio.currentTime)
        ? this.audio.currentTime
        : 0,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      buffered,
    };
  }

  /** 订阅适配器内部的标准播放器事件。 */
  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 释放媒体事件和动画帧。 */
  dispose(): void {
    this.cancelFade();
    this.effects.dispose();
    this.eventHandlers.forEach(({name, handler}) => {
      this.audio.removeEventListener(name, handler as EventListenerOrEventListenerObject);
    });
    this.eventHandlers.length = 0;
    this.listeners.clear();
  }

  /** 注册 HTMLAudioElement 事件并统一转发给主进程。 */
  private bind(
    name: keyof HTMLMediaElementEventMap,
    handler: EventListener,
  ): void {
    this.eventHandlers.push({name, handler});
    this.audio.addEventListener(name, handler as EventListenerOrEventListenerObject);
  }

  /** 上报没有数值的媒体事件。 */
  private emitSimple(type: PlaybackAudioEvent['type']): void {
    const event: PlaybackAudioEvent = {
      type,
      trackId: this.activeTrackId,
    };
    this.report(event);
    this.listeners.forEach(listener => listener(event));
  }

  /** 上报媒体进度事件。 */
  private emitProgress(type: PlaybackAudioEvent['type']): void {
    const progress = this.audio.buffered.length > 0
      ? this.audio.buffered.end(this.audio.buffered.length - 1)
      : 0;
    const event: PlaybackAudioEvent = {
      type,
      trackId: this.activeTrackId,
      position: Number.isFinite(this.audio.currentTime)
        ? this.audio.currentTime
        : 0,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      buffered: progress,
    };
    this.report(event);
    this.listeners.forEach(listener => listener(event));
  }

  /** 上报浏览器媒体错误，不记录完整 URL。 */
  private emitError(): void {
    const code = this.audio.error?.code;
    const message = code === 3
      ? '媒体解码失败'
      : code === 4
        ? '媒体源不受支持或地址已过期'
        : '媒体加载失败';
    const event: PlaybackAudioEvent = {
      type: 'error',
      trackId: this.activeTrackId,
      code,
      message,
    };
    this.report(event);
    this.listeners.forEach(listener => listener(event));
  }

  /** 在媒体元数据可用后应用重启恢复或提前到达的跳转位置。 */
  private applyPendingSeek(): void {
    if (this.pendingSeekPosition === null) {
      return;
    }
    const duration = Number.isFinite(this.audio.duration)
      ? Math.max(0, this.audio.duration)
      : null;
    if (duration === null) {
      return;
    }
    this.audio.currentTime = Math.min(this.pendingSeekPosition, duration);
    this.pendingSeekPosition = null;
  }

  /** 在指定时长内平滑调整音量，失败时回退到目标音量。 */
  private async fadeTo(volume: number, durationMs: number): Promise<void> {
    this.cancelFade();
    const target = Math.min(1, Math.max(0, volume));
    const start = this.audio.volume;
    if (durationMs <= 0 || Math.abs(target - start) < 0.001) {
      this.audio.volume = target;
      return;
    }
    await new Promise<void>(resolve => {
      const startedAt = performance.now();
      const step = (now: number): void => {
        const ratio = Math.min(1, (now - startedAt) / durationMs);
        this.audio.volume = start + (target - start) * ratio;
        if (ratio >= 1) {
          this.fadeFrame = null;
          resolve();
          return;
        }
        this.fadeFrame = requestAnimationFrame(step);
      };
      this.fadeFrame = requestAnimationFrame(step);
    });
  }

  /** 取消尚未完成的淡入淡出。 */
  private cancelFade(): void {
    if (this.fadeFrame !== null) {
      cancelAnimationFrame(this.fadeFrame);
      this.fadeFrame = null;
    }
  }
}
