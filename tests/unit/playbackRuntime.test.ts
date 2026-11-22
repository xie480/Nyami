let mockNetworkOnline = true;

jest.mock('electron', () => ({
  net: {
    isOnline: () => mockNetworkOnline,
  },
}));

jest.mock('../../desktop/main/runtime/audioCacheStore', () => ({
  AudioCacheStore: class AudioCacheStore {
    static getKey(): string {
      return 'test-cache-key';
    }
  },
}));

afterEach(() => {
  mockNetworkOnline = true;
});

import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PlaybackRuntime} from '../../desktop/main/runtime/playbackRuntime';

function createQueueItem(id: string) {
  return {
    id,
    bvid: id,
    title: id,
    artist: '测试作者',
    artwork: '',
    duration: 60,
  };
}

function createRuntime(
  statePath: string,
  cacheOverrides: Record<string, unknown> = {},
  resolverOverrides: Record<string, unknown> = {},
): PlaybackRuntime {
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    download: jest.fn().mockResolvedValue(undefined),
    evict: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  Object.assign(cache, cacheOverrides);
  return new PlaybackRuntime({
    resolver: {
      resolve: jest.fn().mockResolvedValue({
        track: createQueueItem('BV1'),
        cid: 1,
        url: 'https://audio.example.test/BV1.m4s',
        backupUrls: [],
        mimeType: 'audio/mp4',
        duration: 60,
        parts: [],
      }),
      ...resolverOverrides,
    } as never,
    cache: cache as never,
    logger: {
      warn: jest.fn(),
      info: jest.fn(),
    } as never,
    statePath,
  });
}

describe('PlaybackRuntime 大队列窗口', () => {
  it('只接受当前窗口的分批追加请求', async () => {
    const statePath = path.join(
      os.tmpdir(),
      `nyami-playback-${randomUUID()}.json`,
    );
    const runtime = createRuntime(statePath);

    try {
      await runtime.loadQueue({
        items: [createQueueItem('BV1')],
        autoplay: false,
        expandParts: false,
        queueKey: 'window-a',
      });
      const appended = await runtime.appendQueue({
        items: [createQueueItem('BV2'), createQueueItem('BV3')],
        queueKey: 'window-a',
      });
      expect(appended.queue.map(item => item.bvid)).toEqual([
        'BV1',
        'BV2',
        'BV3',
      ]);

      const stale = await runtime.appendQueue({
        items: [createQueueItem('BV4')],
        queueKey: 'window-old',
      });
      expect(stale.queue.map(item => item.bvid)).toEqual([
        'BV1',
        'BV2',
        'BV3',
      ]);
    } finally {
      await fs.rm(statePath, {force: true});
      await fs.rm(`${statePath}.tmp`, {force: true});
    }
  });

  it('重启后恢复播放进度，并在重新解析地址后发出跳转命令', async () => {
    const statePath = path.join(
      os.tmpdir(),
      `nyami-playback-${randomUUID()}.json`,
    );
    const firstRuntime = createRuntime(statePath);

    try {
      await firstRuntime.loadQueue({
        items: [createQueueItem('BV1')],
        autoplay: false,
        expandParts: false,
      });
      await firstRuntime.reportAudioEvent({
        type: 'timeupdate',
        trackId: 'BV1',
        position: 23,
        duration: 60,
      });
      await firstRuntime.flush();

      expect(JSON.parse(await fs.readFile(statePath, 'utf8'))).toMatchObject({
        currentTrackId: 'BV1',
        position: 23,
      });
      const secondRuntime = createRuntime(statePath);
      expect(secondRuntime.getState()).toMatchObject({
        trackId: 'BV1',
        position: 23,
      });

      const events: Array<{type: string; command?: {type: string; position?: number}}> = [];
      secondRuntime.subscribe(event => {
        if (event.type === 'command') {
          events.push(event);
        }
      });
      await secondRuntime.play();

      expect(
        events.find(
          event => event.type === 'command' && event.command?.type === 'seek',
        ),
      ).toMatchObject({
        command: {
          type: 'seek',
          position: 23,
        },
      });
    } finally {
      await fs.rm(statePath, {force: true});
      await fs.rm(`${statePath}.tmp`, {force: true});
    }
  });

  it('缓存音频源加载失败后删除缓存并回退到新的远程地址', async () => {
    const statePath = path.join(
      os.tmpdir(),
      `nyami-playback-${randomUUID()}.json`,
    );
    const remove = jest.fn().mockResolvedValue(undefined);
    const runtime = createRuntime(statePath, {
      get: jest.fn().mockResolvedValue({key: 'broken-cache'}),
      remove,
    });
    const sources: string[] = [];
    runtime.subscribe(event => {
      if (event.type === 'source') {
        sources.push(event.source.url);
      }
    });

    try {
      await runtime.loadQueue({
        items: [createQueueItem('BV1')],
        autoplay: true,
        expandParts: false,
      });
      const recovered = await runtime.reportAudioEvent({
        type: 'error',
        trackId: 'BV1',
        code: 4,
        message: '媒体源不受支持或地址已过期',
      });

      expect(remove).toHaveBeenCalledTimes(1);
      expect(recovered.cached).toBe(false);
      expect(sources).toEqual([
        'nyami-cache://audio/broken-cache',
        'https://audio.example.test/BV1.m4s',
      ]);
    } finally {
      await fs.rm(statePath, {force: true});
      await fs.rm(`${statePath}.tmp`, {force: true});
    }
  });

  it('连续获取音频地址失败时耗尽重试次数并停止循环', async () => {
    const statePath = path.join(
      os.tmpdir(),
      `nyami-playback-${randomUUID()}.json`,
    );
    const resolve = jest.fn().mockImplementation(
      async (track: ReturnType<typeof createQueueItem>) => ({
        track,
        cid: 1,
        url: `https://audio.example.test/${track.id}.m4s`,
        backupUrls: [],
        mimeType: 'audio/mp4',
        duration: track.duration,
        parts: [],
      }),
    );
    const runtime = createRuntime(statePath, {}, {resolve});

    try {
      await runtime.loadQueue({
        items: [createQueueItem('BV1')],
        autoplay: true,
        expandParts: false,
      });

      await runtime.reportAudioEvent({
        type: 'error',
        trackId: 'BV1',
        code: 4,
        message: '媒体源不受支持或地址已过期',
      });
      await runtime.reportAudioEvent({
        type: 'error',
        trackId: 'BV1',
        code: 4,
        message: '媒体源不受支持或地址已过期',
      });
      const failed = await runtime.reportAudioEvent({
        type: 'error',
        trackId: 'BV1',
        code: 4,
        message: '媒体源不受支持或地址已过期',
      });

      expect(resolve).toHaveBeenCalledTimes(3);
      expect(failed).toMatchObject({
        state: 'error',
        trackId: 'BV1',
      });
    } finally {
      await fs.rm(statePath, {force: true});
      await fs.rm(`${statePath}.tmp`, {force: true});
    }
  });

  it('终止后手动播放会重新解析当前歌曲', async () => {
    const statePath = path.join(
      os.tmpdir(),
      `nyami-playback-${randomUUID()}.json`,
    );
    const resolve = jest.fn().mockImplementation(
      async (track: ReturnType<typeof createQueueItem>) => ({
        track,
        cid: 1,
        url: `https://audio.example.test/${track.id}.m4s`,
        backupUrls: [],
        mimeType: 'audio/mp4',
        duration: track.duration,
        parts: [],
      }),
    );
    const runtime = createRuntime(statePath, {}, {resolve});

    try {
      await runtime.loadQueue({
        items: [createQueueItem('BV1')],
        autoplay: true,
        expandParts: false,
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await runtime.reportAudioEvent({
          type: 'error',
          trackId: 'BV1',
          code: 4,
          message: '媒体源不受支持或地址已过期',
        });
      }

      expect(runtime.getState().state).toBe('error');
      await runtime.play();

      expect(resolve).toHaveBeenCalledTimes(4);
      expect(runtime.getState().state).toBe('loading');
    } finally {
      await fs.rm(statePath, {force: true});
      await fs.rm(`${statePath}.tmp`, {force: true});
    }
  });

  it('重启后的首次播放绕过未验证缓存并直接解析远程地址', async () => {
    const statePath = path.join(
      os.tmpdir(),
      `nyami-playback-${randomUUID()}.json`,
    );
    const cacheGet = jest.fn().mockResolvedValue({key: 'stale-cache'});
    const queueItem = createQueueItem('BV1');

    await fs.writeFile(
      statePath,
      JSON.stringify({
        queue: [queueItem],
        currentTrackId: queueItem.id,
        mode: 'sequential',
        context: null,
        position: 18,
        duration: 60,
        volume: 1,
      }),
      'utf8',
    );

    const runtime = createRuntime(statePath, {
      get: cacheGet,
    });
    const sources: string[] = [];
    runtime.subscribe(event => {
      if (event.type === 'source') {
        sources.push(event.source.url);
      }
    });

    try {
      const snapshot = await runtime.play();

      expect(cacheGet).not.toHaveBeenCalled();
      expect(snapshot.cached).toBe(false);
      expect(sources).toEqual(['https://audio.example.test/BV1.m4s']);
    } finally {
      await fs.rm(statePath, {force: true});
      await fs.rm(`${statePath}.tmp`, {force: true});
    }
  });

  it('重启后网络探测尚未就绪时仍尝试解析未缓存音频', async () => {
    const statePath = path.join(
      os.tmpdir(),
      `nyami-playback-${randomUUID()}.json`,
    );
    const queueItem = createQueueItem('BV1');
    await fs.writeFile(
      statePath,
      JSON.stringify({
        queue: [queueItem],
        currentTrackId: queueItem.id,
        mode: 'sequential',
        context: {kind: 'search', keyword: '重启歌曲', page: 1},
        position: 9,
        duration: 60,
        volume: 1,
      }),
      'utf8',
    );
    mockNetworkOnline = false;
    const resolve = jest.fn().mockResolvedValue({
      track: queueItem,
      cid: 1,
      url: 'https://audio.example.test/BV1.m4s',
      backupUrls: [],
      mimeType: 'audio/mp4',
      duration: 60,
      parts: [],
    });
    const runtime = createRuntime(statePath, {}, {resolve});

    try {
      const snapshot = await runtime.play();

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(snapshot).toMatchObject({
        state: 'loading',
        trackId: 'BV1',
        position: 9,
      });
    } finally {
      await fs.rm(statePath, {force: true});
      await fs.rm(`${statePath}.tmp`, {force: true});
    }
  });

  it('重启后从搜索队列恢复时保留搜索上下文并重新解析音频地址', async () => {
    const statePath = path.join(
      os.tmpdir(),
      `nyami-playback-${randomUUID()}.json`,
    );
    const queueItem = {
      ...createQueueItem('BV-search'),
      source: 'search' as const,
    };
    const context = {
      kind: 'search' as const,
      keyword: '测试歌曲',
      page: 1,
    };
    await fs.writeFile(
      statePath,
      JSON.stringify({
        queue: [queueItem],
        currentTrackId: queueItem.id,
        mode: 'sequential',
        context,
        position: 12,
        duration: 60,
        volume: 1,
      }),
      'utf8',
    );

    const resolve = jest.fn().mockResolvedValue({
      track: queueItem,
      cid: 1,
      url: 'https://audio.example.test/BV-search.m4s',
      backupUrls: [],
      mimeType: 'audio/mp4',
      duration: 60,
      parts: [],
    });
    const runtime = createRuntime(statePath, {}, {resolve});

    try {
      const snapshot = await runtime.play();

      expect(resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          bvid: 'BV-search',
          source: 'search',
        }),
        expect.any(AbortSignal),
        'high',
      );
      expect(snapshot).toMatchObject({
        state: 'loading',
        trackId: 'BV-search',
        queueContext: context,
        position: 12,
      });
    } finally {
      await fs.rm(statePath, {force: true});
      await fs.rm(`${statePath}.tmp`, {force: true});
    }
  });

  it('重启恢复时跳过损坏队列项而保留可用的搜索歌曲', async () => {
    const statePath = path.join(
      os.tmpdir(),
      `nyami-playback-${randomUUID()}.json`,
    );
    const resolve = jest.fn().mockResolvedValue({
      track: createQueueItem('BV-legacy'),
      cid: 1,
      url: 'https://audio.example.test/BV-legacy.m4s',
      backupUrls: [],
      mimeType: 'audio/mp4',
      duration: 60,
      parts: [],
    });
    await fs.writeFile(
      statePath,
      JSON.stringify({
        queue: [
          null,
          {
            bvid: 'BV-legacy',
            title: '历史搜索结果',
            artist: '测试作者',
            artwork: '',
            duration: 60,
          },
        ],
        currentTrackId: 'BV-legacy',
        context: {
          kind: 'search',
          keyword: '历史搜索',
          page: 1,
        },
        position: 0,
        duration: 60,
        volume: 1,
      }),
      'utf8',
    );

    const runtime = createRuntime(statePath, {}, {resolve});

    try {
      expect(runtime.getState()).toMatchObject({
        trackId: 'BV-legacy',
        queueLength: 1,
      });
      await runtime.play();
      expect(resolve).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(statePath, {force: true});
      await fs.rm(`${statePath}.tmp`, {force: true});
    }
  });

  it('切换到下一首时清零上一首的播放进度', async () => {
    const statePath = path.join(
      os.tmpdir(),
      `nyami-playback-${randomUUID()}.json`,
    );
    const runtime = createRuntime(statePath, {}, {
      resolve: jest.fn().mockImplementation(
        async (track: ReturnType<typeof createQueueItem>) => ({
          track,
          cid: 1,
          url: `https://audio.example.test/${track.id}.m4s`,
          backupUrls: [],
          mimeType: 'audio/mp4',
          duration: track.duration,
          parts: [],
        }),
      ),
    });
    const commands: Array<{type: string; position?: number}> = [];
    runtime.subscribe(event => {
      if (event.type === 'command') {
        commands.push(event.command);
      }
    });

    try {
      await runtime.loadQueue({
        items: [createQueueItem('BV1'), createQueueItem('BV2')],
        autoplay: false,
        expandParts: false,
      });
      await runtime.reportAudioEvent({
        type: 'timeupdate',
        trackId: 'BV1',
        position: 25,
        duration: 60,
      });

      const next = await runtime.skipNext();

      expect(next.trackId).toBe('BV2');
      expect(next.position).toBe(0);
      expect(
        commands.filter(command => command.type === 'seek'),
      ).toHaveLength(0);

      // 切歌后的旧媒体事件可能被 Renderer 误标记为新曲，不能把旧进度写回主进程。
      await runtime.reportAudioEvent({
        type: 'timeupdate',
        trackId: 'BV2',
        position: 25,
        duration: 60,
      });
      expect(runtime.getState().position).toBe(0);

      await runtime.reportAudioEvent({
        type: 'playing',
        trackId: 'BV2',
      });
      await runtime.reportAudioEvent({
        type: 'timeupdate',
        trackId: 'BV2',
        position: 3,
        duration: 60,
      });
      expect(runtime.getState().position).toBe(3);
    } finally {
      await fs.rm(statePath, {force: true});
      await fs.rm(`${statePath}.tmp`, {force: true});
    }
  });
});
