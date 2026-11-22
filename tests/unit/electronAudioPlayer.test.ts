jest.mock('../../desktop/renderer/audio/audioEffectsController', () => ({
  AudioEffectsController: class AudioEffectsController {
    async setup(): Promise<void> {}

    async resume(): Promise<void> {}

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
});
