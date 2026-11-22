jest.mock('electron', () => ({
  net: {
    isOnline: () => true,
  },
}));

jest.mock('../../desktop/main/runtime/audioCacheStore', () => ({
  AudioCacheStore: class AudioCacheStore {
    static getKey(): string {
      return 'test-cache-key';
    }
  },
}));

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

function createRuntime(statePath: string): PlaybackRuntime {
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
    } as never,
    cache: {
      get: jest.fn().mockResolvedValue(null),
      download: jest.fn().mockResolvedValue(undefined),
      evict: jest.fn().mockResolvedValue(undefined),
    } as never,
    logger: {
      warn: jest.fn(),
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
});
