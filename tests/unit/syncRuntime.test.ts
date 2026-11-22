import {SyncRuntime} from '../../desktop/main/runtime/syncRuntime';

function createRuntimeFixture() {
  const credentials = {
    getStatus: jest.fn().mockResolvedValue({
      loggedIn: true,
      uid: '1',
    }),
  };
  const library = {
    hasLocalIndex: jest.fn().mockReturnValue(true),
    synchronize: jest.fn().mockResolvedValue({
      completedTasks: 1,
      totalTasks: 1,
      processedVideos: 1,
      totalVideos: 1,
      skippedTasks: 0,
      failedTasks: 0,
    }),
  };
  const logger = {
    error: jest.fn(),
  };
  const runtime = new SyncRuntime(
    credentials as never,
    library as never,
    logger as never,
  );
  return {library, runtime};
}

describe('SyncRuntime 来源选择', () => {
  it('没有勾选来源时拒绝启动全量同步', async () => {
    const fixture = createRuntimeFixture();

    await expect(fixture.runtime.start()).rejects.toThrow(
      '请先勾选收藏夹后再同步',
    );
    expect(fixture.library.synchronize).not.toHaveBeenCalled();
  });

  it('同步请求会把去重后的来源键传给收藏运行时', async () => {
    const fixture = createRuntimeFixture();

    await fixture.runtime.start({
      sourceKeys: [' ownedFavorite:7 ', 'ownedFavorite:7'],
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fixture.library.synchronize).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        sourceKeys: ['ownedFavorite:7'],
      }),
    );
  });
});
