jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../src/core/storage', () => ({
  storage: {
    getString: jest.fn(() => null),
    setString: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../src/store/progressStore', () => ({
  useProgressStore: {
    getState: () => ({resetProgress: jest.fn()}),
  },
}));

jest.mock('../../src/services/trackPlayer', () => ({
  loadQueue: jest.fn(),
  insertNext: jest.fn(),
  removeFromQueue: jest.fn(),
  reorderQueue: jest.fn(() => Promise.resolve()),
  appendQueue: jest.fn(),
}));

import {usePlayerStore} from '../../src/store/playerStore';
import {reorderQueue as syncTrackPlayerQueue} from '../../src/services/trackPlayer';

const sourceQueue = [
  {bvid: 'BV1source001'},
  {bvid: 'BV1source002'},
  {bvid: 'BV1source003'},
  {bvid: 'BV1source004'},
] as any[];

describe('player queue mode transitions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    usePlayerStore.setState({
      queue: [...sourceQueue],
      originalQueue: [...sourceQueue],
      currentBvid: sourceQueue[1].bvid,
      playMode: 'sequential',
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('restores the original order after shuffle and preserves it during native sync', () => {
    usePlayerStore.getState().togglePlayMode();
    jest.runOnlyPendingTimers();

    const shuffledState = usePlayerStore.getState();
    expect(shuffledState.playMode).toBe('shuffle');
    expect(shuffledState.queue[0].bvid).toBe(sourceQueue[1].bvid);
    expect(shuffledState.queue.map(video => video.bvid).sort()).toEqual(
      sourceQueue.map(video => video.bvid).sort(),
    );
    expect(shuffledState.originalQueue).toEqual(sourceQueue);
    expect(syncTrackPlayerQueue).toHaveBeenCalledTimes(1);

    usePlayerStore.getState().togglePlayMode();
    jest.runOnlyPendingTimers();

    const sequentialState = usePlayerStore.getState();
    expect(sequentialState.playMode).toBe('sequential');
    expect(sequentialState.queue).toEqual(sourceQueue);
    expect(sequentialState.originalQueue).toEqual(sourceQueue);
    expect(syncTrackPlayerQueue).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest mode switch when taps happen before the queued reorder', () => {
    const togglePlayMode = usePlayerStore.getState().togglePlayMode;
    togglePlayMode();
    togglePlayMode();
    jest.runOnlyPendingTimers();

    expect(usePlayerStore.getState().playMode).toBe('sequential');
    expect(usePlayerStore.getState().queue).toEqual(sourceQueue);
    expect(syncTrackPlayerQueue).toHaveBeenCalledTimes(1);
    expect(syncTrackPlayerQueue).toHaveBeenCalledWith(
      sourceQueue,
      sourceQueue[1].bvid,
    );
  });

  it('replaces the baseline only when a new source queue is set', () => {
    const nextQueue = [{bvid: 'BV1next0001'}, {bvid: 'BV1next0002'}] as any[];
    usePlayerStore.getState().setQueue(nextQueue, nextQueue[1].bvid);
    usePlayerStore.getState().setCurrentQueue([...nextQueue].reverse());

    expect(usePlayerStore.getState().queue).toEqual([...nextQueue].reverse());
    expect(usePlayerStore.getState().originalQueue).toEqual(nextQueue);
  });
});
