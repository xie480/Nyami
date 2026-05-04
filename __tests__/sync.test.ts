import { favoriteService } from '../src/services/favoriteService';
import { storage } from '../src/core/storage';
import { biliApi } from '../src/services/biliApi';

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

/** Mock storage implementation that tracks folder shards and rebuilds a global index. */
jest.mock('../src/core/storage', () => {
  // In‑memory storage for folder shards
  const folderShards: Record<number, any[]> = {};

  const storage = {
    setJSON: jest.fn(),
    getJSON: jest.fn(),
    delete: jest.fn(),
    getSyncMetaMap: jest.fn(() => ({})),
    setSyncMetaMap: jest.fn(),
    updateSyncMeta: jest.fn(),
    // Store a folder's shard
    setFolderIndex: (folderId: number, videos: any[]) => {
      folderShards[folderId] = videos;
    },
    // Retrieve a folder's shard
    getFolderIndex: (folderId: number) => folderShards[folderId] || [],
    // Rebuild global index by merging all stored shards and deduplicating by bvid
    rebuildGlobalCache: () => {
      const videoMap = new Map<string, any>();
      Object.values(folderShards).forEach((videos) => {
        videos.forEach((v) => {
          if (!videoMap.has(v.bvid)) {
            videoMap.set(v.bvid, { ...v });
          } else {
            const existing = videoMap.get(v.bvid);
            // Merge simple fields (for the test only deduplication matters)
            existing.title = v.title;
            existing.cover = v.cover;
            existing.duration = v.duration;
            existing.pubtime = v.pubtime;
            existing.upper = v.upper;
            existing.attr = v.attr;
          }
        });
      });
      storage.setJSON('globalIndex', Array.from(videoMap.values()));
    },
  };

  return { storage };
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
    
    expect(storage.setJSON).toHaveBeenCalledWith('globalIndex', expect.any(Array));
    const savedVideos = (storage.setJSON as jest.Mock).mock.calls[0][1];
    expect(savedVideos.length).toBe(30); // 25 + 5
    
    expect(progressEvents.length).toBeGreaterThan(0);
    const lastEvent = progressEvents[progressEvents.length - 1];
    expect(lastEvent.completedTasks).toBe(lastEvent.totalTasks);
    expect(lastEvent.processedVideos).toBe(30);
    expect(lastEvent.totalVideos).toBe(30);
  });
});
