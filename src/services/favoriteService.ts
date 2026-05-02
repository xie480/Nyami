import { biliApi } from './biliApi';
import { cache } from '../core/cache';
import { config } from '../config';
import { trimFolder, trimFavoriteVideo } from './transformers';
import type {
  FavoriteFolder,
  FavoriteVideo,
  PageResult,
} from '../types/domain';
import { storage } from '../core/storage';
import { TaskQueue } from '../utils/taskQueue';

export const favoriteService = {
  /**
   * 获取某 UID 的全部收藏夹
   * 带缓存，10 分钟内不会重复请求
   */
  async getFolders(uid: string, force = false): Promise<FavoriteFolder[]> {
      if (!uid || !uid.trim()) {
        throw new Error('UID 不能为空');
      }
      const key = `folders:${uid}`;
      if (force) cache.delete(key);
      return cache.getOrSet(
        key,
        config.cacheTTL.folders,
        async () => {
          const data = await biliApi.getFavoriteFolders(uid);
          return (data.list || []).map(trimFolder);
        },
        true // 持久化
      );
    },

  /**
   * 获取收藏夹内视频（分页）
   * 自动过滤已失效条目
   */
  async getVideos(
    mediaId: number,
    pn = 1,
    ps = 20,
    force = false
  ): Promise<PageResult<FavoriteVideo>> {
    if (!mediaId) {
      throw new Error('收藏夹 ID 不能为空');
    }
    const key = `videos:${mediaId}:${pn}:${ps}`;
    if (force) cache.delete(key);
    return cache.getOrSet(
      key,
      config.cacheTTL.folderVideos,
      async () => {
        const data = await biliApi.getFavoriteVideos(mediaId, pn, ps);
        return {
          list: (data.medias || [])
            .filter((m) => m.attr === 0)
            .map(trimFavoriteVideo),
          hasMore: data.has_more || false,
        };
      },
      true
    );
  },

  /** 失效某收藏夹的所有缓存（如用户主动刷新） */
  invalidateFolder(mediaId: number) {
    cache.deletePrefix(`videos:${mediaId}`);
  },

  /** 失效某用户的收藏夹列表缓存 */
  invalidateFolderList(uid: string) {
    cache.delete(`folders:${uid}`);
  },

  /**
   * 同步全局索引
   */
  async syncGlobalIndex(uid: string, force = false): Promise<void> {
    if (!uid) return;
    try {
      const folders = await this.getFolders(uid, force);
      const allVideos = new Map<string, FavoriteVideo>();
      const queue = new TaskQueue(5); // 最大并发5

      // 带有指数退避的执行包装器
      const executeWithBackoff = async (task: () => Promise<any>, maxRetries = 4) => {
        for (let i = 0; i <= maxRetries; i++) {
          try {
            return await queue.add(task);
          } catch (e: any) {
            const isRateLimit = e?.name === 'RateLimitError' || e?.message?.includes('412') || e?.message?.includes('429');
            if (isRateLimit && i < maxRetries) {
              const delay = Math.pow(2, i) * 1000 + Math.random() * 1000; // 指数退避 + 抖动
              console.log(`Rate limited, waiting ${Math.round(delay)}ms before retry ${i + 1}...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            throw e;
          }
        }
      };

      const processVideos = (folderId: number, list: FavoriteVideo[]) => {
        for (const v of list) {
          if (!allVideos.has(v.bvid)) {
            allVideos.set(v.bvid, { ...v, folderIds: [folderId] });
          } else {
            const existing = allVideos.get(v.bvid)!;
            if (!existing.folderIds) existing.folderIds = [];
            if (!existing.folderIds.includes(folderId)) {
              existing.folderIds.push(folderId);
            }
          }
        }
      };

      // 1. 并发获取所有收藏夹的第一页
      const firstPageTasks = folders.map(folder =>
        executeWithBackoff(() => this.getVideos(folder.id, 1, 20, force))
          .then(res => ({ folder, res }))
          .catch(e => {
            console.warn(`Failed to fetch first page for folder ${folder.id}`, e);
            return null;
          })
      );
      
      const firstPages = await Promise.all(firstPageTasks);
      const subsequentTasks: Array<() => Promise<void>> = [];

      // 2. 收集后续需要拉取的页数
      for (const result of firstPages) {
        if (result) {
          const { folder, res } = result;
          processVideos(folder.id, res.list);
          
          // 如果有更多页，生成后续任务
          if (res.hasMore) {
            // B站收藏夹接口每页20条，可以通过 mediaCount 估算总页数
            const totalPages = Math.ceil(folder.mediaCount / 20);
            for (let page = 2; page <= totalPages; page++) {
              subsequentTasks.push(async () => {
                try {
                  const pageRes = await executeWithBackoff(() => this.getVideos(folder.id, page, 20, force));
                  processVideos(folder.id, pageRes.list);
                } catch (e) {
                  console.warn(`Failed to fetch videos for folder ${folder.id} page ${page}`, e);
                }
              });
            }
          }
        }
      }
      
      // 3. 执行所有后续任务
      await Promise.all(subsequentTasks.map(task => task()));
      
      storage.setJSON('globalIndex', Array.from(allVideos.values()));
    } catch (e) {
      console.warn('Failed to sync global index', e);
    }
  },

  /**
   * 获取全局索引
   */
  getGlobalIndex(): FavoriteVideo[] {
    return storage.getJSON<FavoriteVideo[]>('globalIndex') || [];
  },

  /**
   * 清理全局索引
   */
  clearGlobalIndex() {
    storage.delete('globalIndex');
  },
};
