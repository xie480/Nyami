import {config} from '../config';
import {loadGlobalIndexCache, favoriteService} from './favoriteService';
import {importedPlaylistService} from './importedPlaylistService';
import {
  loadTagProfile,
  normalizeRecommendationTitleKey,
  searchTagRecommendations,
} from './tagRecommendationService';
import {useAuthStore} from '../store/authStore';
import {useImportedPlaylistStore} from '../store/importedPlaylistStore';
import {useSettingsStore} from '../store/settingsStore';
import {storage} from '../core/storage';
import type {
  CollectionRecommendation,
  FavoriteVideo,
  ImportedPlaylist,
  TagProfile,
  TagRecommendation,
} from '../types/domain';
import type {TagRecommendationSearchResult} from './tagRecommendationService';

export interface GeneratedHomeFeed {
  collections: CollectionRecommendation[];
  songs: TagRecommendation[];
  songPage: number;
  songHasMore: boolean;
  failedSearchCount: number;
  updatedAt: number;
  error: null;
}

const ACCOUNT_INDEX_READY_TIMEOUT_MS = 10_000;
const ACCOUNT_INDEX_READY_POLL_MS = 100;

interface PersonalizationContext {
  favorites: FavoriteVideo[];
  favoriteVideoIds: string[];
  favoriteVideoTitles: string[];
  profile: TagProfile;
}

function assertCurrentRecommendationAccount(uid: string) {
  if (!uid || useAuthStore.getState().userId !== uid) {
    throw new Error('B 站账号已变化，请刷新推荐');
  }
  if (storage.getString('lastUid') !== uid) {
    throw new Error('本机收藏索引正在随账号切换，请稍后手动刷新推荐');
  }
}

async function waitForCurrentRecommendationAccount(uid: string, signal: AbortSignal): Promise<void> {
  const startedAt = Date.now();
  while (storage.getString('lastUid') !== uid) {
    if (signal.aborted) throw new Error('推荐刷新已取消');
    if (!uid || useAuthStore.getState().userId !== uid) {
      throw new Error('B 站账号已变化，请刷新推荐');
    }
    if (Date.now() - startedAt >= ACCOUNT_INDEX_READY_TIMEOUT_MS) {
      throw new Error('本机收藏索引尚未完成账号切换，请稍后手动刷新推荐');
    }
    await new Promise<void>(resolve => setTimeout(resolve, ACCOUNT_INDEX_READY_POLL_MS));
  }
  assertCurrentRecommendationAccount(uid);
}

async function loadPersonalizationContext(
  uid: string,
  signal: AbortSignal,
  importedSourcesPromise: Promise<ImportedPlaylist[]>,
): Promise<PersonalizationContext> {
  await waitForCurrentRecommendationAccount(uid, signal);
  const [, importedSources] = await Promise.all([
    loadGlobalIndexCache(),
    importedSourcesPromise,
  ]);
  if (signal.aborted) throw new Error('推荐刷新已取消');
  assertCurrentRecommendationAccount(uid);

  const settings = useSettingsStore.getState();
  const importedStore = useImportedPlaylistStore.getState();
  const visibleSourceKeys = importedStore.visibleSourceKeysByUid[uid] ?? [];
  const favorites = favoriteService.getGlobalIndex(
    settings.hiddenFolderIds,
    visibleSourceKeys,
  );
  const allFavoriteVideos = favoriteService.getGlobalIndex(
    [],
    importedSources.map(source => source.sourceKey),
  );
  const allFavoriteVideoIds = Array.from(new Set(allFavoriteVideos.map(video => video.bvid)));
  const allFavoriteVideoTitles = Array.from(new Set(
    allFavoriteVideos.map(video => normalizeRecommendationTitleKey(video.title)).filter(Boolean),
  ));
  const {profile} = await loadTagProfile(favorites);
  assertCurrentRecommendationAccount(uid);
  return {
    favorites,
    favoriteVideoIds: allFavoriteVideoIds,
    favoriteVideoTitles: allFavoriteVideoTitles,
    profile,
  };
}

function rankCollections(
  sources: ImportedPlaylist[],
  profile: TagProfile,
): CollectionRecommendation[] {
  const preferences = profile.preferences.slice(0, config.tagRecommendations.maxProfileTags);
  return sources
    .map(source => {
      const searchableText = `${source.title} ${source.description ?? ''}`
        .trim()
        .toLocaleLowerCase();
      const matchedTags = preferences
        .filter(preference => searchableText.includes(preference.tagName.trim().toLocaleLowerCase()))
        .map(preference => preference.tagName);
      const score = matchedTags.reduce((sum, tagName) => {
        const preference = preferences.find(item => item.tagName === tagName);
        return sum + (preference?.score ?? 0);
      }, 0);
      return {...source, score, matchedTags};
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.mediaCount - left.mediaCount ||
        left.title.localeCompare(right.title, 'zh-CN'),
    )
    .slice(0, config.recommendations.homePlaylistLimit);
}

/** 生成首页首屏：同步当前账号已有外部来源，按本地收藏画像排序并生成首批歌曲。 */
export async function generateHomeFeed(
  uid: string,
  signal: AbortSignal,
): Promise<GeneratedHomeFeed> {
  if (!uid || useAuthStore.getState().userId !== uid) {
    throw new Error('B 站账号已变化，请刷新推荐');
  }
  const importedSourcesPromise = importedPlaylistService.getCollectedPlaylists(uid, true, signal);
  const [context, sources] = await Promise.all([
    loadPersonalizationContext(uid, signal, importedSourcesPromise),
    importedSourcesPromise,
  ]);
  if (signal.aborted) throw new Error('推荐刷新已取消');
  assertCurrentRecommendationAccount(uid);

  useImportedPlaylistStore.getState().setCatalog(uid, sources);
  const songResult = await searchTagRecommendations(
    context.profile,
    context.favorites,
    signal,
    {
      excludeVideoIds: context.favoriteVideoIds,
      excludeVideoTitles: context.favoriteVideoTitles,
    },
  );
  if (signal.aborted) throw new Error('推荐刷新已取消');
  assertCurrentRecommendationAccount(uid);

  return {
    collections: rankCollections(sources, context.profile),
    songs: songResult.recommendations,
    songPage: 1,
    songHasMore: songResult.hasMore,
    failedSearchCount: songResult.failedSearchCount,
    updatedAt: Date.now(),
    error: null,
  };
}

/** 加载个性化播放队列的下一页；已收藏及队列内的 BVID 会在推荐服务里排除。 */
export async function loadMorePersonalizedSongs(
  uid: string,
  page: number,
  excludeVideoIds: string[],
  signal: AbortSignal,
): Promise<TagRecommendationSearchResult> {
  const importedSourcesPromise = importedPlaylistService.getCollectedPlaylists(uid, false, signal);
  const context = await loadPersonalizationContext(uid, signal, importedSourcesPromise);
  if (signal.aborted) throw new Error('个性化队列补充已取消');
  assertCurrentRecommendationAccount(uid);
  return searchTagRecommendations(
    context.profile,
    context.favorites,
    signal,
    {
      page,
      excludeVideoIds: [...context.favoriteVideoIds, ...excludeVideoIds],
      excludeVideoTitles: context.favoriteVideoTitles,
    },
  );
}
