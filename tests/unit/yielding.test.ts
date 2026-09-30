import {forEachInYieldingBatches} from '../../src/utils/yielding';

describe('forEachInYieldingBatches', () => {
  it('lets queued event-loop work run between item batches', async () => {
    const events: string[] = [];

    await forEachInYieldingBatches(
      [0, 1, 2],
      item => {
        events.push(`item-${item}`);
        if (item === 0) {
          setTimeout(() => events.push('timer'), 0);
        }
      },
      undefined,
      1,
    );

    expect(events).toEqual(['item-0', 'timer', 'item-1', 'item-2']);
  });

  it('stops processing after the request is aborted', async () => {
    const controller = new AbortController();
    const visited: number[] = [];

    await expect(
      forEachInYieldingBatches(
        [0, 1, 2],
        item => {
          visited.push(item);
          if (item === 0) controller.abort();
        },
        controller.signal,
        1,
      ),
    ).rejects.toMatchObject({name: 'AbortError'});

    expect(visited).toEqual([0]);
  });
});
