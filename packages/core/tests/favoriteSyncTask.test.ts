import {FavoriteSyncTask} from '../src/favorites/syncTask';
import type {
  FavoritePlaylistMeta,
  FavoriteRepository,
} from '../src/favorites/contracts';
import type {FavoriteVideo, PageResult} from '../src/types/domain';

const makeVideo = (bvid: string): FavoriteVideo => ({
  bvid,
  title: bvid,
  cover: '',
  duration: 10,
  page: 1,
  pubtime: 1,
  favTime: 1,
  upper: {mid: 1, name: 'author'},
  attr: 0,
});

function createRepository(): FavoriteRepository & {
  pages: string[];
  statuses: string[];
} {
  const metas = new Map<string, FavoritePlaylistMeta>();
  const repository = {
    pages: [] as string[],
    statuses: [] as string[],
    async getPlaylistMeta(playlistId: string) {
      return metas.get(playlistId) ?? null;
    },
    async upsertPlaylistMeta(data: {
      playlistId: string;
      title: string;
      remoteVideoCount: number;
      playlistSyncStatus?: FavoritePlaylistMeta['playlistSyncStatus'];
      needResync?: boolean;
    }) {
      metas.set(data.playlistId, {
        playlistId: data.playlistId,
        title: data.title,
        remoteVideoCount: data.remoteVideoCount,
        localSyncedCount: metas.get(data.playlistId)?.localSyncedCount ?? 0,
        syncCursor: metas.get(data.playlistId)?.syncCursor ?? null,
        playlistSyncStatus: data.playlistSyncStatus ?? 'idle',
        needResync: data.needResync ?? false,
      });
    },
    async createSyncJob() {
      return 'job-1';
    },
    async syncPlaylistVideosPage(
      playlistId: string,
      videos: FavoriteVideo[],
      options: {
        force: boolean;
        cursor: string;
        previousSyncedCount: number;
      },
    ) {
      repository.pages.push(`${playlistId}:${options.cursor}`);
      const current = metas.get(playlistId);
      if (current) {
        metas.set(playlistId, {
          ...current,
          localSyncedCount: options.previousSyncedCount + videos.length,
          syncCursor: options.cursor,
        });
      }
      return {
        existingBvids: new Set<string>(),
        videosToUpsert: videos,
        syncedCount: options.previousSyncedCount + videos.length,
      };
    },
    async finishSyncJob(_jobId: string, status: string) {
      repository.statuses.push(status);
    },
    async markPlaylistSyncSuccess(playlistId: string) {
      const current = metas.get(playlistId);
      if (current) {
        metas.set(playlistId, {
          ...current,
          playlistSyncStatus: 'success',
          syncCursor: null,
        });
      }
    },
    async softDeleteMissingVideos() {
      return undefined;
    },
  };
  return repository;
}

describe('共享收藏同步任务', () => {
  it('按页写入、报告进度并完成同步状态', async () => {
    const repository = createRepository();
    const page = async (
      pageNumber: number,
    ): Promise<PageResult<FavoriteVideo>> => ({
      list: pageNumber === 1 ? [makeVideo('BV1')] : [makeVideo('BV2')],
      hasMore: pageNumber === 1,
      rawCount: 1,
    });
    const progress: number[] = [];

    const result = await new FavoriteSyncTask(repository).run(
      [
        {
          playlistId: 'folder-1',
          title: '收藏夹',
          remoteVideoCount: 2,
          fetchPage: page,
        },
      ],
      {force: true, onProgress: event => progress.push(event.processedVideos)},
    );

    expect(repository.pages).toEqual(['folder-1:page_1', 'folder-1:page_2']);
    expect(repository.statuses).toEqual(['success']);
    expect(result.completedTasks).toBe(1);
    expect(result.processedVideos).toBe(2);
    expect(progress.at(-1)).toBe(2);
  });

  it('已有成功且远端数量未变化时跳过分页请求', async () => {
    const repository = createRepository();
    await repository.upsertPlaylistMeta({
      playlistId: 'folder-1',
      title: '收藏夹',
      remoteVideoCount: 1,
      playlistSyncStatus: 'success',
    });
    const fetchPage = jest.fn();

    const result = await new FavoriteSyncTask(repository).run([
      {
        playlistId: 'folder-1',
        title: '收藏夹',
        remoteVideoCount: 1,
        fetchPage,
      },
    ]);

    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.skippedTasks).toBe(1);
  });

  it('使用分页响应中的远端总量更新进度和收藏夹元数据', async () => {
    const repository = createRepository();
    const page = async (
      pageNumber: number,
    ): Promise<PageResult<FavoriteVideo>> => ({
      list: [makeVideo(`BV${pageNumber}`)],
      hasMore: pageNumber < 3,
      rawCount: 1,
      remoteVideoCount: 3,
    });

    const result = await new FavoriteSyncTask(repository).run(
      [
        {
          playlistId: 'folder-1',
          title: '收藏夹',
          remoteVideoCount: 1,
          fetchPage: page,
        },
      ],
      {force: true},
    );

    expect(result.totalVideos).toBe(3);
    expect(
      await repository.getPlaylistMeta('folder-1'),
    ).toMatchObject({remoteVideoCount: 3});
  });

  it('全量扫描按分页批次并发拉取，但按页顺序写入', async () => {
    const repository = createRepository();
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const page = async (
      pageNumber: number,
    ): Promise<PageResult<FavoriteVideo>> => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise(resolve => setTimeout(resolve, 1));
      activeRequests -= 1;
      return {
        list: [makeVideo(`BV${pageNumber}`)],
        hasMore: pageNumber < 4,
        rawCount: 1,
      };
    };

    await new FavoriteSyncTask(repository).run(
      [
        {
          playlistId: 'folder-1',
          title: '收藏夹',
          remoteVideoCount: 4,
          fetchPage: page,
        },
      ],
      {force: true, pageConcurrency: 2},
    );

    expect(maxActiveRequests).toBe(2);
    expect(repository.pages).toEqual([
      'folder-1:page_1',
      'folder-1:page_2',
      'folder-1:page_3',
      'folder-1:page_4',
    ]);
  });

  it('增量扫描保持逐页请求，避免提前拉取无关分页', async () => {
    const repository = createRepository();
    await repository.upsertPlaylistMeta({
      playlistId: 'folder-1',
      title: '收藏夹',
      remoteVideoCount: 1,
      playlistSyncStatus: 'success',
    });
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const page = async (
      pageNumber: number,
    ): Promise<PageResult<FavoriteVideo>> => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise(resolve => setTimeout(resolve, 1));
      activeRequests -= 1;
      return {
        list: [makeVideo(`BV${pageNumber}`)],
        hasMore: pageNumber < 2,
        rawCount: 1,
      };
    };

    await new FavoriteSyncTask(repository).run(
      [
        {
          playlistId: 'folder-1',
          title: '收藏夹',
          remoteVideoCount: 2,
          fetchPage: page,
        },
      ],
      {pageConcurrency: 3},
    );

    expect(maxActiveRequests).toBe(1);
    expect(repository.pages).toEqual([
      'folder-1:page_1',
      'folder-1:page_2',
    ]);
  });
});
