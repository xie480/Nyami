import TrackPlayer, {Event, State, type Track} from 'react-native-track-player';
import type {
  AudioPlaybackState,
  AudioTrackLike,
  AudioPlayer,
  AudioProgress,
} from '../../../packages/platform-contracts/src';

/**
 * React Native TrackPlayer 适配器。
 * 共享核心和桌面端只依赖 AudioPlayer 契约，移动端原生播放器调用集中在这里。
 */
export class MobileAudioPlayerAdapter implements AudioPlayer<AudioTrackLike> {
  /** 初始化 TrackPlayer 原生会话。 */
  async setup(): Promise<void> {
    await TrackPlayer.setupPlayer();
  }

  /** 替换原生队列并定位到指定索引。 */
  async load(queue: AudioTrackLike[], startIndex = 0): Promise<void> {
    await TrackPlayer.reset();
    if (queue.length > 0) {
      await TrackPlayer.add(queue as Track[]);
      if (startIndex > 0) {
        await TrackPlayer.skip(Math.min(startIndex, queue.length - 1));
      }
    }
  }

  /** 开始播放。 */
  async play(): Promise<void> {
    await TrackPlayer.play();
  }

  /** 暂停播放。 */
  async pause(): Promise<void> {
    await TrackPlayer.pause();
  }

  /** 停止播放。 */
  async stop(): Promise<void> {
    await TrackPlayer.stop();
  }

  /** 跳转到指定秒数。 */
  async seek(position: number): Promise<void> {
    await TrackPlayer.seekTo(position);
  }

  /** 切换到下一首。 */
  async skipToNext(): Promise<void> {
    await TrackPlayer.skipToNext();
  }

  /** 切换到上一首。 */
  async skipToPrevious(): Promise<void> {
    await TrackPlayer.skipToPrevious();
  }

  /** 设置播放器音量。 */
  async setVolume(volume: number): Promise<void> {
    await TrackPlayer.setVolume(Math.max(0, Math.min(1, volume)));
  }

  /** 读取共享播放状态。 */
  async getState(): Promise<AudioPlaybackState> {
    const playbackState = await TrackPlayer.getPlaybackState();
    return this.mapState(playbackState.state);
  }

  /** 读取当前进度。 */
  async getProgress(): Promise<AudioProgress> {
    const progress = await TrackPlayer.getProgress();
    return {
      position: progress.position,
      duration: progress.duration,
      buffered: progress.buffered,
    };
  }

  /** 订阅 TrackPlayer 事件并转换为平台无关事件。 */
  subscribe(
    listener: (event: {
      state?: AudioPlaybackState;
      progress?: AudioProgress;
      trackId?: string | null;
      error?: Error;
    }) => void,
  ): () => void {
    const stateSubscription = TrackPlayer.addEventListener(
      Event.PlaybackState,
      event => listener({state: this.mapState(event.state)}),
    );
    const progressSubscription = TrackPlayer.addEventListener(
      Event.PlaybackProgressUpdated,
      event =>
        listener({
          progress: {
            position: event.position,
            duration: event.duration,
            buffered: event.buffered,
          },
        }),
    );
    const errorSubscription = TrackPlayer.addEventListener(
      Event.PlaybackError,
      event => listener({error: new Error(event.message)}),
    );

    return () => {
      stateSubscription.remove();
      progressSubscription.remove();
      errorSubscription.remove();
    };
  }

  private mapState(state: State): AudioPlaybackState {
    switch (state) {
      case State.Loading:
      case State.Buffering:
        return 'loading';
      case State.Ready:
        return 'ready';
      case State.Playing:
        return 'playing';
      case State.Paused:
        return 'paused';
      case State.Stopped:
        return 'stopped';
      case State.Error:
        return 'error';
      default:
        return 'idle';
    }
  }
}

/** 默认移动端播放器实例，供平台组合根按需注入。 */
export const mobileAudioPlayer = new MobileAudioPlayerAdapter();
