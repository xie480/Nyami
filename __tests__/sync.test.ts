import { favoriteService } from '../src/services/favoriteService';
import { biliApi } from '../src/services/biliApi';
import * as dbOperations from '../src/db/operations';

// Mock dependencies
jest.mock('../src/services/biliApi', () => ({
  biliApi: {
    getFavoriteFolders: jest.fn(),
    getFavoriteVideos: jest.fn(),
  }
}));

jest.mock('../src/core/cache', () => ({
  cache: {
    getOrSet: jest.fn((key, ttl, fetcher) => fetcher()),
    delete: jest.fn(),
    deletePrefix: jest.fn(),
  }
}));

jest.mock('../src/db/operations', () => {
  let globalVideos: any[] = [];
  const syncMetaMap: Record<number, any> = {};

  return {
    batchUpsertGlobalVideos: jest.fn(async (videos) => {
      globalVideos.push(...videos);
    }),
    getGlobalIndex: jest.fn(async () => globalVideos),
    getAllSyncMetaMap: jest.fn(async () => syncMetaMap),
    updateSyncMeta: jest.fn(async (meta) => {
      syncMetaMap[meta.folderId] = meta;
    }),
    clearAllIndexes: jest.fn(async () => {
      globalVideos = [];
    }),
    removeFolderIdFromAllVideos: jest.fn(async (folderId) => {
      globalVideos = globalVideos.filter(v => !v.folderIds?.includes(folderId));
    }),
  };
});

describe('syncGlobalIndex', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should sync global index and report progress', async () => {
    // Setup mock data
    (biliApi.getFavoriteFolders as jest.Mock).mockResolvedValue({
      list: [
        { id: 111, title: 'Folder 1', media_count: 25 },
        { id: 222, title: 'Folder 2', media_count: 5 }
      ]
    });

    (biliApi.getFavoriteVideos as jest.Mock).mockImplementation(async (mediaId, pn) => {
      if (mediaId === 111) {
        if (pn === 1) {
          return {
            has_more: true,
            medias: Array.from({ length: 20 }).map((_, i) => ({ id: i, bvid: `BV111_1_${i}`, title: `Video 111_1_${i}`, attr: 0 }))
          };
        } else if (pn === 2) {
          return {
            has_more: false,
            medias: Array.from({ length: 5 }).map((_, i) => ({ id: 20+i, bvid: `BV111_2_${i}`, title: `Video 111_2_${i}`, attr: 0 }))
          };
        }
      } else if (mediaId === 222) {
        return {
          has_more: false,
          medias: Array.from({ length: 5 }).map((_, i) => ({ id: i, bvid: `BV222_1_${i}`, title: `Video 222_1_${i}`, attr: 0 }))
        };
      }
      return { has_more: false, medias: [] };
    });

    const progressEvents: any[] = [];
    
    await favoriteService.syncGlobalIndex('test_uid', [], true, (event) => {
      progressEvents.push(event);
    });
    
    expect(dbOperations.batchUpsertGlobalVideos).toHaveBeenCalled();
    // 25 + 5 = 30 videos should be upserted in total
    const upsertCalls = (dbOperations.batchUpsertGlobalVideos as jest.Mock).mock.calls;
    const totalUpserted = upsertCalls.reduce((sum, call) => sum + call[0].length, 0);
    expect(totalUpserted).toBe(30);
    
    expect(progressEvents.length).toBeGreaterThan(0);
    const lastEvent = progressEvents[progressEvents.length - 1];
    expect(lastEvent.completedTasks).toBe(lastEvent.totalTasks);
    expect(lastEvent.processedVideos).toBe(30);
    expect(lastEvent.totalVideos).toBe(30);
  });

  it('should always use incremental sync when mediaCount increases, regardless of missing count', async () => {
    // Setup mock data
    (biliApi.getFavoriteFolders as jest.Mock).mockResolvedValue({
      list: [
        { id: 333, title: 'Folder 3', media_count: 100 }
      ]
    });

    // Mock sync meta to simulate an existing folder with fewer videos
    (dbOperations.getAllSyncMetaMap as jest.Mock).mockResolvedValueOnce({
      333: {
        folderId: 333,
        mediaCount: 50, // 50 videos missing (100 - 50 = 50 > 20 threshold)
        latestBvid: 'BV_OLD',
        needsFullSync: false
      }
    });

    (biliApi.getFavoriteVideos as jest.Mock).mockImplementation(async (mediaId, pn) => {
      if (pn === 1) {
        return {
          has_more: true,
          medias: Array.from({ length: 20 }).map((_, i) => ({ id: i, bvid: i === 19 ? 'BV_OLD' : `BV_NEW_${i}`, title: `New Video ${i}`, attr: 0 }))
        };
      }
      return { has_more: false, medias: [] };
    });

    await favoriteService.syncGlobalIndex('test_uid', [], false);

    // Should not call removeFolderIdFromAllVideos (which is called in full sync)
    expect(dbOperations.removeFolderIdFromAllVideos).not.toHaveBeenCalled();
    
    // Should only fetch the first page because it hits the cursor 'BV_OLD'
    expect(biliApi.getFavoriteVideos).toHaveBeenCalledTimes(1);
    expect(biliApi.getFavoriteVideos).toHaveBeenCalledWith(333, 1, 20, undefined);
  });
});
