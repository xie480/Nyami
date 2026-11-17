import type {
  PlaybackSeekRequest,
  PlaybackSnapshot,
  PlaybackVolumeRequest,
} from '../../shared/types';

const DEFAULT_PLAYBACK_SNAPSHOT: PlaybackSnapshot = {
  state: 'idle',
  trackId: null,
  position: 0,
  duration: 0,
  volume: 1,
  queueLength: 0,
  error: null,
};

/**
 * 阶段 2 的播放控制状态适配器。
 * 当前只承载跨进程状态和参数校验，真实音频加载由阶段 4 的 Adapter 接管。
 */
export class PlaybackRuntime {
  private snapshot: PlaybackSnapshot = {
    ...DEFAULT_PLAYBACK_SNAPSHOT,
  };

  /**
   * 读取当前播放状态。
   * @returns 播放状态快照
   */
  getState(): PlaybackSnapshot {
    return this.clone();
  }

  /**
   * 请求播放。
   * @returns 更新后的状态快照
   */
  play(): PlaybackSnapshot {
    if (this.snapshot.trackId) {
      this.snapshot.state = 'playing';
    }
    return this.clone();
  }

  /**
   * 请求暂停。
   * @returns 更新后的状态快照
   */
  pause(): PlaybackSnapshot {
    if (this.snapshot.state === 'playing') {
      this.snapshot.state = 'paused';
    }
    return this.clone();
  }

  /**
   * 请求停止。
   * @returns 更新后的状态快照
   */
  stop(): PlaybackSnapshot {
    this.snapshot.state = 'stopped';
    this.snapshot.position = 0;
    return this.clone();
  }

  /**
   * 更新播放位置。
   * @param request 目标位置
   * @returns 更新后的状态快照
   */
  seek(request: PlaybackSeekRequest): PlaybackSnapshot {
    const duration = this.snapshot.duration;
    const maximum = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    this.snapshot.position = Math.min(
      maximum,
      Math.max(0, Math.round(request.position * 1000) / 1000),
    );
    return this.clone();
  }

  /**
   * 跳转下一首，阶段 2 只保持状态不变。
   * @returns 当前状态快照
   */
  skipNext(): PlaybackSnapshot {
    return this.clone();
  }

  /**
   * 跳转上一首，阶段 2 只保持状态不变。
   * @returns 当前状态快照
   */
  skipPrevious(): PlaybackSnapshot {
    return this.clone();
  }

  /**
   * 设置主音量。
   * @param request 音量值
   * @returns 更新后的状态快照
   */
  setVolume(request: PlaybackVolumeRequest): PlaybackSnapshot {
    this.snapshot.volume = Math.min(1, Math.max(0, request.volume));
    return this.clone();
  }

  /**
   * 返回独立快照，防止 Renderer 修改主进程状态。
   * @returns 播放状态副本
   */
  private clone(): PlaybackSnapshot {
    return {
      ...this.snapshot,
    };
  }
}
