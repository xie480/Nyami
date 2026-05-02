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
      
      for (const folder of folders) {
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          try {
            const res = await this.getVideos(folder.id, page, 20, force);
            for (const v of res.list) {
              if (!allVideos.has(v.bvid)) {
                allVideos.set(v.bvid, { ...v, folderIds: [folder.id] });
              } else {
                const existing = allVideos.get(v.bvid)!;
                if (!existing.folderIds) existing.folderIds = [];
                if (!existing.folderIds.includes(folder.id)) {
                  existing.folderIds.push(folder.id);
                }
              }
            }
            hasMore = res.hasMore;
            page++;
          } catch (e) {
            console.warn(`Failed to fetch videos for folder ${folder.id} page ${page}`, e);
            break; // Skip to next folder on error
          }
        }
      }
      
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
