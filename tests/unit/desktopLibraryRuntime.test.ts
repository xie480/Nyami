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
    getSourceVideos: jest.fn().mockReturnValue({items: [], total: 0}),
    getPlaylistMeta: jest.fn().mockResolvedValue(null),
    upsertPlaylistMeta: jest.fn().mockResolvedValue(undefined),
    createSyncJob: jest.fn().mockResolvedValue('job-1'),
    syncPlaylistVideosPage: jest.fn().mockResolvedValue({
      existingBvids: new Set<string>(),
      videosToUpsert: [],
      syncedCount: 0,
    }),
    finishSyncJob: jest.fn().mockResolvedValue(undefined),
    markPlaylistSyncSuccess: jest.fn().mockResolvedValue(undefined),
    softDeleteMissingVideos: jest.fn().mockResolvedValue(undefined),
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

  it('远端目录暂时不可用时仍展示已持久化的本地索引来源', async () => {
    const fixture = createRuntimeFixture();
    fixture.repository.getSourceSummaries.mockReturnValue([
      {
        sourceKey: 'ownedFavorite:7',
        kind: 'owned',
        remoteId: 7,
        ownerMid: 1,
        ownerName: '',
        title: '已同步收藏夹',
        cover: 'https://i0.hdslb.com/local.jpg',
        mediaCount: 12,
        description: '',
        syncStatus: 'success',
        lastSyncedAt: 1,
      },
    ]);
    fixture.api.getFavoriteFolders.mockRejectedValue(
      new Error('Bilibili 暂时不可用'),
    );

    const sources = await fixture.runtime.getSourceSummaries('1');

    expect(sources).toMatchObject([
      expect.objectContaining({
        sourceKey: 'ownedFavorite:7',
        syncStatus: 'success',
        mediaCount: 12,
      }),
    ]);
    expect(fixture.logger.warn).toHaveBeenCalledWith(
      'library.source-catalog-fallback-local',
      expect.anything(),
    );
  });

  it('本地读取模式展示索引来源时不会访问远端目录', async () => {
    const fixture = createRuntimeFixture();
    fixture.repository.getSourceSummaries.mockReturnValue([
      {
        sourceKey: 'ownedFavorite:7',
        kind: 'owned',
        remoteId: 7,
        ownerMid: 1,
        ownerName: '',
        title: '本地收藏夹',
        cover: '',
        mediaCount: 2,
        description: '本地简介',
        syncStatus: 'success',
        lastSyncedAt: 1,
      },
    ]);

    const sources = await fixture.runtime.getSourceSummaries(
      '1',
      undefined,
      undefined,
      true,
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]?.title).toBe('本地收藏夹');
    expect(fixture.api.getFavoriteFolders).not.toHaveBeenCalled();
    expect(fixture.api.getCollectedPlaylists).not.toHaveBeenCalled();
  });

  it('本地读取模式加载收藏夹内容时不会回退远端分页', async () => {
    const fixture = createRuntimeFixture();
    fixture.repository.getSourceSummaries.mockReturnValue([
      {
        sourceKey: 'ownedFavorite:7',
        kind: 'owned',
        remoteId: 7,
        ownerMid: 1,
        ownerName: '',
        title: '本地收藏夹',
        cover: '',
        mediaCount: 0,
        description: '',
        syncStatus: 'idle',
        lastSyncedAt: null,
      },
    ]);

    const result = await fixture.runtime.getSourceVideos(
      '1',
      'ownedFavorite:7',
      1,
      undefined,
      true,
    );

    expect(result).toEqual({
      items: [],
      page: 1,
      hasMore: false,
      total: 0,
    });
    expect(fixture.api.getFavoriteVideos).not.toHaveBeenCalled();
    expect(fixture.api.getSeasonArchives).not.toHaveBeenCalled();
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

  it('未同步来源详情会回退读取远端歌曲', async () => {
    const fixture = createRuntimeFixture();
    fixture.api.getFavoriteVideos.mockResolvedValue({
      info: {
        media_count: 1,
        intro: '远端简介',
      },
      has_more: false,
      medias: [
        {
          aid: 42,
          bvid: 'BV1remote',
          title: '远端歌曲',
          cover: '//i0.hdslb.com/remote.jpg',
          duration: 120,
          page: 1,
          pub_time: 0,
          pubdate: 1700000000,
          fav_time: 1700000000,
          attr: 0,
          upper: {
            mid: 2,
            name: 'UP 主',
          },
        },
      ],
    });

    const result = await fixture.runtime.getSourceVideos(
      '1',
      'collectedFavorite:2:7',
      1,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      bvid: 'BV1remote',
      cover: 'https://i0.hdslb.com/remote.jpg',
      sourceKeys: ['collectedFavorite:2:7'],
    });
    expect(result.total).toBe(1);
    expect(fixture.api.getFavoriteVideos).toHaveBeenCalledWith(
      7,
      1,
      20,
      expect.any(AbortSignal),
      'normal',
    );
  });

  it('仅同步自有收藏夹时不会额外读取全部外部收藏目录', async () => {
    const fixture = createRuntimeFixture();
    fixture.api.getFavoriteFolders.mockResolvedValue({
      list: [
        {
          id: 7,
          mid: 1,
          title: '自有收藏夹',
          media_count: 0,
        },
      ],
    });
    fixture.api.getFavoriteVideos.mockResolvedValue({
      medias: [],
      has_more: false,
    });

    await fixture.runtime.synchronize('1', {
      sourceKeys: ['ownedFavorite:7'],
    });

    expect(fixture.api.getCollectedPlaylists).not.toHaveBeenCalled();
    expect(fixture.repository.markPlaylistSyncSuccess).toHaveBeenCalledWith(
      'ownedFavorite:7',
    );
  });

  it('同步写入失败后重试会复用五分钟内的分页快照', async () => {
    const fixture = createRuntimeFixture();
    let meta: Record<string, unknown> | null = null;
    let writeAttempts = 0;
    fixture.repository.getPlaylistMeta.mockImplementation(async () => meta);
    fixture.repository.upsertPlaylistMeta.mockImplementation(async data => {
      meta = {
        playlistId: data.playlistId,
        title: data.title,
        remoteVideoCount: data.remoteVideoCount,
        localSyncedCount: 0,
        syncCursor: null,
        playlistSyncStatus: data.playlistSyncStatus ?? 'idle',
        needResync: data.needResync ?? false,
      };
    });
    fixture.repository.syncPlaylistVideosPage.mockImplementation(async () => {
      if (writeAttempts++ === 0) {
        throw new Error('数据库写入失败');
      }
      return {
        existingBvids: new Set<string>(),
        videosToUpsert: [],
        syncedCount: 1,
      };
    });
    fixture.api.getFavoriteFolders.mockResolvedValue({
      list: [
        {
          id: 7,
          mid: 1,
          title: '自有收藏夹',
          media_count: 1,
        },
      ],
    });
    fixture.api.getFavoriteVideos.mockResolvedValue({
      info: {media_count: 1},
      medias: [
        {
          aid: 1,
          bvid: 'BV1cache',
          title: '缓存测试',
          cover: '//i0.hdslb.com/cache.jpg',
          duration: 60,
          page: 1,
          pubdate: 1,
          fav_time: 1,
          attr: 0,
          upper: {mid: 1, name: 'UP 主'},
        },
      ],
      has_more: false,
    });

    await expect(
      fixture.runtime.synchronize('1', {
        force: true,
        sourceKeys: ['ownedFavorite:7'],
      }),
    ).rejects.toThrow('有 1 个收藏夹同步失败');
    await fixture.runtime.synchronize('1', {
      sourceKeys: ['ownedFavorite:7'],
    });

    expect(fixture.api.getFavoriteVideos).toHaveBeenCalledTimes(1);
    expect(fixture.repository.markPlaylistSyncSuccess).toHaveBeenCalledWith(
      'ownedFavorite:7',
    );
  });
});
