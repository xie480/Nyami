import { biliApi } from './biliApi';
import { cache } from '../core/cache';
import { config } from '../config';
import { trimFolder, trimFavoriteVideo } from './transformers';
import type {
  FavoriteFolder,
  FavoriteVideo,
  PageResult,
} from '../types/domain';

export const favoriteService = {
  async getFolders(uid: string, force = false): Promise<FavoriteFolder[]> {
    const key = `folders:${uid}`;
    if (force) cache.delete(key);
    return cache.getOrSet(
      key,
      config.cacheTTL.folders,
      async () => {
        const data = await biliApi.getFavoriteFolders(uid);
        return (data.list || []).map(trimFolder);
      },
      true
    );
  },

  async getVideos(
    mediaId: number,
    pn = 1,
    ps = 20,
    force = false
  ): Promise<PageResult<FavoriteVideo>> {
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

  invalidateFolder(mediaId: number) {
    cache.deletePrefix(`videos:${mediaId}`);
  },

  invalidateFolderList(uid: string) {
    cache.delete(`folders:${uid}`);
  },
};
