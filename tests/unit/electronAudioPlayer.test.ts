let mockEffectsSetupPromise: Promise<void> = Promise.resolve();

jest.mock('../../desktop/renderer/audio/audioEffectsController', () => ({
  AudioEffectsController: class AudioEffectsController {
    async setup(): Promise<void> {
      await mockEffectsSetupPromise;
    }

    async resume(): Promise<void> {}

    resetLoudness(): void {}

    dispose(): void {}

    setSettings(): void {}

    subscribeSpectrum(): () => void {
      return () => undefined;
    }
  },
}));

import {ElectronAudioPlayerAdapter} from '../../desktop/renderer/audio/electronAudioPlayer';

type AudioEventHandler = () => void;

/** 创建只覆盖本测试所需行为的媒体元素替身。 */
function createAudioStub(): {
  audio: HTMLAudioElement;
  emit: (name: string) => void;
} {
  const handlers = new Map<string, AudioEventHandler>();
  const audio = {
    currentTime: 42,
    duration: 180,
    paused: true,
    readyState: 0,
    volume: 1,
    preload: '',
    src: 'https://audio.example.test/old.m4s',
    pause: jest.fn(),
    load: jest.fn(),
    play: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn(
      (name: string, handler: AudioEventHandler) => {
        handlers.set(name, handler);
      },
    ),
    removeEventListener: jest.fn(),
    removeAttribute: jest.fn(),
    buffered: {
      length: 0,
    },
    error: null,
    seeking: false,
  } as unknown as HTMLAudioElement;

  return {
    audio,
    emit: name => handlers.get(name)?.(),
  };
}

describe('ElectronAudioPlayerAdapter', () => {
  afterEach(() => {
    mockEffectsSetupPromise = Promise.resolve();
  });

  it('切换资源后即使浏览器暂时保留旧时间线也从零开始', async () => {
    const {audio, emit} = createAudioStub();
    const adapter = new ElectronAudioPlayerAdapter(audio, jest.fn());

    await adapter.setup();
    adapter.loadSource({
      trackId: 'BV2',
      url: 'https://audio.example.test/BV2.m4s',
      cached: false,
      revision: 2,
    });

    // 某些浏览器在新资源元数据到达前会暂时保留旧 currentTime。
    audio.currentTime = 42;
    emit('loadedmetadata');

    expect(audio.currentTime).toBe(0);
  });

  it('初始化尚未完成时也能接收首次媒体错误', async () => {
    let resolveSetup: (() => void) | null = null;
    mockEffectsSetupPromise = new Promise<void>(resolve => {
      resolveSetup = resolve;
    });
    const {audio, emit} = createAudioStub();
    const report = jest.fn();
    const adapter = new ElectronAudioPlayerAdapter(audio, report);
    const setupPromise = adapter.setup();

    await Promise.resolve();
    adapter.loadSource({
      trackId: 'BV1',
      url: 'https://audio.example.test/BV1.m4s',
      cached: false,
      revision: 1,
    });
    emit('error');

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        trackId: 'BV1',
      }),
    );

    resolveSetup?.();
    await setupPromise;
  });

  it('将高频 timeupdate 限制为约 10fps，避免重复 IPC 和 React 更新', async () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
      const {audio, emit} = createAudioStub();
      const report = jest.fn();
      const adapter = new ElectronAudioPlayerAdapter(audio, report);

      await adapter.setup();
      emit('timeupdate');
      now = 1050;
      emit('timeupdate');
      now = 1100;
      emit('timeupdate');

      expect(report).toHaveBeenCalledTimes(2);
      adapter.dispose();
    } finally {
      Date.now = originalNow;
    }
  });

  it('首次播放会等待淡入完成后再调用媒体播放', async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const frames: Array<(time: number) => void> = [];
    globalThis.requestAnimationFrame = callback => {
      frames.push(callback);
      return frames.length;
    };
    globalThis.cancelAnimationFrame = () => undefined;

    try {
      const {audio} = createAudioStub();
      const adapter = new ElectronAudioPlayerAdapter(audio, jest.fn());

      await adapter.setup();
      adapter.loadSource({
        trackId: 'BV1',
        url: 'https://audio.example.test/BV1.m4s',
        cached: false,
        revision: 1,
      });
      audio.play.mockClear();

      const fadePromise = adapter.handleCommand({
        type: 'fade-in',
        trackId: 'BV1',
        volume: 1,
        durationMs: 180,
        revision: 1,
      });
      const playPromise = adapter.handleCommand({
        type: 'play',
        trackId: 'BV1',
        revision: 1,
      });

      await Promise.resolve();
      expect(audio.play).not.toHaveBeenCalled();
      expect(frames).toHaveLength(1);

      frames.shift()?.(performance.now() + 180);
      await Promise.all([fadePromise, playPromise]);

      expect(audio.volume).toBe(1);
      expect(audio.play).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  it('暂停会等待淡出完成后再暂停媒体', async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const frames: Array<(time: number) => void> = [];
    globalThis.requestAnimationFrame = callback => {
      frames.push(callback);
      return frames.length;
    };
    globalThis.cancelAnimationFrame = () => undefined;

    try {
      const {audio} = createAudioStub();
      const adapter = new ElectronAudioPlayerAdapter(audio, jest.fn());

      await adapter.setup();
      adapter.loadSource({
        trackId: 'BV1',
        url: 'https://audio.example.test/BV1.m4s',
        cached: false,
        revision: 1,
      });
      audio.pause.mockClear();
      audio.volume = 1;

      const fadePromise = adapter.handleCommand({
        type: 'fade-out',
        trackId: 'BV1',
        volume: 0,
        durationMs: 120,
        revision: 1,
      });
      const pausePromise = adapter.handleCommand({
        type: 'pause',
        trackId: 'BV1',
        revision: 1,
      });

      await Promise.resolve();
      expect(audio.pause).not.toHaveBeenCalled();
      expect(frames).toHaveLength(1);

      frames.shift()?.(performance.now() + 120);
      await Promise.all([fadePromise, pausePromise]);

      expect(audio.volume).toBe(0);
      expect(audio.pause).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });
});
