jest.mock('../../desktop/main/storage/desktopLibraryRepository', () => ({
  DesktopLibraryRepository: class DesktopLibraryRepository {},
}));

import {DesktopLibraryRuntime} from '../../desktop/main/content/desktopLibraryRuntime';

type RuntimeFixture = {
  api: Record<string, jest.Mock>;
  logger: Record<string, jest.Mock>;
  repository: Record<string, jest.Mock>;
  runtime: DesktopLibraryRuntime;
};

/** 创建只覆盖来源目录读取路径的桌面收藏运行时测试夹具。 */
function createRuntimeFixture(): RuntimeFixture {
  const api = {
    getFavoriteFolders: jest.fn().mockResolvedValue({list: []}),
    getCollectedPlaylists: jest.fn(),
    getFavoriteVideos: jest.fn(),
    getSeasonArchives: jest.fn(),
  };
  const repository = {
    switchAccount: jest.fn(),
    getSourceSummaries: jest.fn().mockReturnValue([]),
  };
  const credentials = {
    getStatus: jest.fn().mockResolvedValue({
      loggedIn: true,
      uid: '1',
    }),
  };
  const logger = {
    warn: jest.fn(),
  };
  const runtime = new DesktopLibraryRuntime(
    api as never,
    credentials as never,
    repository as never,
    logger as never,
  );
  return {api, logger, repository, runtime};
}

describe('DesktopLibraryRuntime 来源目录读取', () => {
  it('全量目录读取不会为每个来源追加封面请求', async () => {
    const fixture = createRuntimeFixture();
    fixture.api.getCollectedPlaylists.mockResolvedValue({
      count: 1,
      list: [
        {
          id: 2,
          mid: 2,
          title: '导入来源',
          media_count: 3,
        },
      ],
    });

    const sources = await fixture.runtime.getSourceSummaries('1');

    expect(sources).toHaveLength(1);
    expect(fixture.api.getFavoriteVideos).not.toHaveBeenCalled();
  });

  it('读取单个来源时才补齐缺失封面', async () => {
    const fixture = createRuntimeFixture();
    fixture.api.getCollectedPlaylists.mockResolvedValue({
      count: 1,
      list: [
        {
          id: 2,
          mid: 2,
          title: '导入来源',
          media_count: 3,
        },
      ],
    });
    fixture.api.getFavoriteVideos.mockResolvedValue({
      medias: [
        {
          attr: 0,
          cover: '//i0.hdslb.com/cover.jpg',
        },
      ],
    });

    const sources = await fixture.runtime.getSourceSummaries(
      '1',
      ['collectedFavorite:2:2'],
    );

    expect(sources[0]?.cover).toBe('https://i0.hdslb.com/cover.jpg');
    expect(fixture.api.getFavoriteVideos).toHaveBeenCalledTimes(1);
  });

  it('接口重复返回同一页时停止继续翻页', async () => {
    const fixture = createRuntimeFixture();
    const repeatedPage = Array.from({length: 50}, (_item, index) => ({
      id: index + 1,
      mid: 2,
      title: `来源 ${index + 1}`,
      media_count: 1,
    }));
    fixture.api.getCollectedPlaylists.mockResolvedValue({
      list: repeatedPage,
    });

    const sources = await fixture.runtime.getSourceSummaries('1');

    expect(sources).toHaveLength(50);
    expect(fixture.api.getCollectedPlaylists).toHaveBeenCalledTimes(2);
    expect(fixture.logger.warn).toHaveBeenCalledWith(
      'library.source-catalog-repeated-page',
      expect.objectContaining({page: 2}),
    );
  });
});
