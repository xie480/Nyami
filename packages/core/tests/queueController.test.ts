import {QueueController, expandVideoParts} from '../src/player/queueController';

type Video = {
  bvid: string;
  title?: string;
  parts?: Array<{
    cid: number;
    page: number;
    title: string;
    duration: number;
  }>;
};

const video = (bvid: string): Video => ({bvid, title: bvid});

describe('共享队列控制器', () => {
  it('保持当前项并在随机模式下保留顺序基线', () => {
    const controller = new QueueController<Video>({random: () => 0});
    controller.replaceQueue([video('a'), video('b'), video('c')], 'b');
    controller.setMode('shuffle');

    const snapshot = controller.getSnapshot();
    expect(snapshot.queue[0].bvid).toBe('b');
    expect(snapshot.originalQueue.map(item => item.bvid)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('过期异步操作不会返回结果', async () => {
    const controller = new QueueController<Video>();
    let resolveFirst: ((value: string) => void) | undefined;
    const first = controller.runLatest(
      () =>
        new Promise<string>(resolve => {
          resolveFirst = resolve;
        }),
    );
    controller.replaceQueue([video('new')], 'new');
    resolveFirst?.('old');

    await expect(first).resolves.toBeUndefined();
  });

  it('按 P 展开时保留 CID 和稳定队列键', () => {
    const result = expandVideoParts(
      [
        {
          ...video('multi'),
          parts: [
            {cid: 11, page: 1, title: 'P1', duration: 10},
            {cid: 12, page: 2, title: 'P2', duration: 20},
          ],
        },
      ],
      true,
    );

    expect(result.map(item => item.queueId)).toEqual(['multi:p1', 'multi:p2']);
    expect(result[1].cid).toBe(12);
  });
});
