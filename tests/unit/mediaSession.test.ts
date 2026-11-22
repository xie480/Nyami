import type {PlaybackSnapshot} from '../../desktop/shared/types';
import {
  createMediaSessionMetadata,
  getMediaSessionPlaybackState,
  getMediaSessionPositionState,
} from '../../desktop/renderer/mediaSession';

/** 创建媒体会话测试所需的最小播放快照。 */
function createSnapshot(
  overrides: Partial<PlaybackSnapshot> = {},
): PlaybackSnapshot {
  return {
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
    ...overrides,
  };
}

describe('desktop media session', () => {
  it('为系统面板构造歌曲元数据和封面', () => {
    const metadata = createMediaSessionMetadata(
      createSnapshot({
        trackId: 'track-1',
        trackTitle: '  歌曲 A ',
        trackArtist: '  作者 A ',
        artwork: 'https://image.example.test/cover.jpg',
      }),
    );

    expect(metadata).toEqual({
      title: '歌曲 A',
      artist: '作者 A',
      album: 'Nyami',
      artwork: [
        {
          src: 'https://image.example.test/cover.jpg',
        },
      ],
    });
  });

  it('没有当前曲目时不残留旧元数据', () => {
    expect(createMediaSessionMetadata(createSnapshot())).toBeNull();
  });

  it('将系统进度限制在歌曲时长内', () => {
    expect(
      getMediaSessionPositionState(
        createSnapshot({
          trackId: 'track-1',
          position: 240,
          duration: 180,
        }),
      ),
    ).toEqual({
      duration: 180,
      position: 180,
      playbackRate: 1,
    });
  });

  it('将播放状态映射为 Media Session 状态', () => {
    expect(
      getMediaSessionPlaybackState(
        createSnapshot({state: 'playing'}),
      ),
    ).toBe('playing');
    expect(
      getMediaSessionPlaybackState(
        createSnapshot({state: 'paused'}),
      ),
    ).toBe('paused');
    expect(
      getMediaSessionPlaybackState(
        createSnapshot({state: 'ready'}),
      ),
    ).toBe('none');
  });
});
