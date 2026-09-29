import { cache } from '../core/cache';
import { config } from '../config';
import type {RequestPriority} from '../core/adaptiveRateLimit';
import type {
  BiliCollectedPlaylist,
  BiliSeasonArchive,
} from '../types/bili';
import type { FavoriteVideo, ImportedPlaylist, PageResult } from '../types/domain';
import { trimFavoriteVideo } from './transformers';
import { biliApi } from './biliApi';

const COLLECTED_PLAYLIST_PAGE_SIZE = 50;
const IMPORTED_VIDEO_PAGE_SIZE = 20;

function normalizeImportedPlaylist(
  item: BiliCollectedPlaylist,
): ImportedPlaylist | null {
  const ownerMid = Number(item.upper?.mid ?? item.mid ?? 0);
  const isSeason = (item.fid != null && Number(item.fid) === 0) || item.season_id != null || item.type_name === '合集';
  const remoteId = Number(isSeason ? item.season_id ?? item.id : item.id);
  if (!ownerMid || !remoteId) return null;

  const kind = isSeason ? 'subscribedSeason' : 'collectedFavorite';
  const description = typeof item.intro === 'string'
    ? item.intro
    : typeof item.description === 'string'
      ? item.description
      : '';
  return {
    sourceKey: `${kind}:${ownerMid}:${remoteId}`,
    kind,
    remoteId,
    ownerMid,
    ownerName: item.upper?.name ?? '',
    title: item.title ?? item.name ?? '未命名列表',
    cover: item.cover ?? '',
    mediaCount: Number(item.media_count ?? item.total ?? 0),
    description: description.trim(),
  };
}

function normalizeSeasonArchive(
  archive: BiliSeasonArchive,
  source: ImportedPlaylist,
): FavoriteVideo | null {
  if (!archive.bvid) return null;
  return {
    bvid: archive.bvid,
    aid: archive.aid,
    title: archive.title,
    cover: archive.pic ?? archive.cover ?? '',
    duration: archive.duration ?? 0,
    page: 1,
    pubtime: archive.pubdate ?? archive.ctime ?? 0,
    favTime: 0,
    upper: {
      mid: archive.owner?.mid ?? archive.upper?.mid ?? source.ownerMid,
      name: archive.owner?.name ?? archive.upper?.name ?? source.ownerName,
    },
    attr: 0,
  };
}

/** 自动同步当前账号的外部收藏来源，并在线分页读取来源视频。 */
export const importedPlaylistService = {
  async getCollectedPlaylists(
    uid: string,
    force = false,
    signal?: AbortSignal,
    rateLimitPriority: RequestPriority = 'normal',
  ): Promise<ImportedPlaylist[]> {
    if (!uid.trim()) throw new Error('UID 不能为空');
    const cacheKey = `collectedPlaylists:${uid}`;
    if (force) cache.delete(cacheKey);

    return cache.getOrSet(
      cacheKey,
      config.cacheTTL.folders,
      async () => {
        const allItems: BiliCollectedPlaylist[] = [];
        let page = 1;
        let expectedCount = 0;

        while (!signal?.aborted) {
          const response = await biliApi.getCollectedPlaylists(
            uid,
            page,
            COLLECTED_PLAYLIST_PAGE_SIZE,
            signal,
            rateLimitPriority,
          );
          const items = response.list ?? [];
          expectedCount = response.count ?? expectedCount;
          allItems.push(...items);

          if (
            items.length === 0 ||
            (expectedCount > 0 && allItems.length >= expectedCount) ||
            items.length < COLLECTED_PLAYLIST_PAGE_SIZE
          ) {
            break;
          }
          page += 1;
        }

        const deduplicated = new Map<string, ImportedPlaylist>();
        for (const item of allItems) {
          const source = normalizeImportedPlaylist(item);
          if (!source) continue;
          if (source.kind === 'collectedFavorite' && source.ownerMid === Number(uid)) continue;
          deduplicated.set(source.sourceKey, source);
        }
        return Array.from(deduplicated.values());
      },
      true,
    );
  },

  async getVideos(
    source: ImportedPlaylist,
    page: number,
    force = false,
    signal?: AbortSignal,
    rateLimitPriority: RequestPriority = 'normal',
  ): Promise<PageResult<FavoriteVideo>> {
    if (!source?.sourceKey || page < 1) throw new Error('播放列表来源无效');
    const cacheKey = `importedVideos:${source.sourceKey}:${page}`;
    if (force) cache.delete(cacheKey);

    return cache.getOrSet(
      cacheKey,
      config.cacheTTL.folderVideos,
      async () => {
        if (source.kind === 'collectedFavorite') {
          const response = await biliApi.getFavoriteVideos(
            source.remoteId,
            page,
            IMPORTED_VIDEO_PAGE_SIZE,
            signal,
            rateLimitPriority,
          );
          const medias = response.medias ?? [];
          return {
            list: medias.filter(media => media.attr === 0).map(trimFavoriteVideo),
            hasMore: response.has_more ?? medias.length === IMPORTED_VIDEO_PAGE_SIZE,
            rawCount: medias.length,
            description: response.info?.intro?.trim() ?? '',
          };
        }

        const response = await biliApi.getSeasonArchives(
          source.ownerMid,
          source.remoteId,
          page,
          IMPORTED_VIDEO_PAGE_SIZE,
          signal,
          rateLimitPriority,
        );
        if (!Array.isArray(response.archives)) {
          throw new Error('B 站合集接口返回格式异常');
        }
        const archives = response.archives;
        const pageInfo = response.page;
        const hasMore = pageInfo?.total != null
          ? page * (pageInfo.page_size ?? IMPORTED_VIDEO_PAGE_SIZE) < pageInfo.total
          : archives.length === IMPORTED_VIDEO_PAGE_SIZE;
        return {
          list: archives
            .map(archive => normalizeSeasonArchive(archive, source))
            .filter((video): video is FavoriteVideo => video !== null),
          hasMore,
          rawCount: archives.length,
          description: response.meta?.description?.trim() ?? response.meta?.intro?.trim() ?? '',
        };
      },
      true,
    );
  },

  invalidatePlaylists(uid: string) {
    cache.delete(`collectedPlaylists:${uid}`);
  },

  invalidateVideos(sourceKey: string) {
    cache.deletePrefix(`importedVideos:${sourceKey}:`);
  },
};
