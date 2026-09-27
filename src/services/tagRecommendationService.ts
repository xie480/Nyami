import {config} from '../config';
import {
  AuthRequiredError,
  NetworkError,
  RateLimitError,
  ResourceUnavailableError,
} from '../core/errors';
import {getVideoTagCacheEntries, upsertVideoTagCache} from '../db/operations';
import {biliApi} from './biliApi';
import {trimSearchVideo, trimVideoTags} from './transformers';
import {useAuthStore} from '../store/authStore';
import type {
  FavoriteVideo,
  TagProfile,
  TagPreference,
  TagRecommendation,
  VideoTag,
  VideoTagCacheEntry,
} from '../types/domain';

export interface TagBackfillProgress {
  totalVideoCount: number;
  completedVideoCount: number;
  successfulVideoCount: number;
  emptyVideoCount: number;
  failedVideoCount: number;
  paused: boolean;
}

export interface TagRecommendationSearchResult {
  recommendations: TagRecommendation[];
  failedSearchCount: number;
}

function uniqueVideos(videos: FavoriteVideo[]): FavoriteVideo[] {
  const unique = new Map<string, FavoriteVideo>();
  for (const video of videos) {
    if (video.bvid && video.attr === 0 && !unique.has(video.bvid)) {
      unique.set(video.bvid, video);
    }
  }
  return Array.from(unique.values());
}

function normalizedTagKey(tagName: string): string {
  return tagName.trim().toLocaleLowerCase();
}

function decodeTags(entry: VideoTagCacheEntry | undefined): VideoTag[] {
  return entry?.tags ?? [];
}

/**
 * 根据唯一收藏视频和已缓存 tag 生成可解释画像。
 * 每个视频对同名 tag 最多贡献一次，tag_id=0 的特殊标签不参与偏好排序。
 */
export function buildTagProfile(
  videos: FavoriteVideo[],
  cacheEntries: VideoTagCacheEntry[],
): TagProfile {
  const unique = uniqueVideos(videos);
  const cacheByVideoId = new Map(
    cacheEntries.map(entry => [entry.videoId, entry]),
  );
  const counts = new Map<
    string,
    {tagId: number; tagName: string; videoCount: number}
  >();
  let resolvedVideoCount = 0;
  let taggedVideoCount = 0;

  for (const video of unique) {
    const entry = cacheByVideoId.get(video.bvid);
    if (!entry || entry.fetchedAt === null) {
      continue;
    }
    resolvedVideoCount += 1;

    const tagsForVideo = new Set<string>();
    for (const tag of decodeTags(entry)) {
      const key = normalizedTagKey(tag.tagName);
      if (!key || tag.tagId === 0 || tagsForVideo.has(key)) {
        continue;
      }
      tagsForVideo.add(key);
      const current = counts.get(key);
      if (current) {
        current.videoCount += 1;
      } else {
        counts.set(key, {
          tagId: tag.tagId,
          tagName: tag.tagName,
          videoCount: 1,
        });
      }
    }
    if (tagsForVideo.size > 0) {
      taggedVideoCount += 1;
    }
  }

  const preferences: TagPreference[] = Array.from(counts.values())
    .map(tag => ({
      ...tag,
      score: taggedVideoCount > 0 ? tag.videoCount / taggedVideoCount : 0,
    }))
    .sort(
      (left, right) =>
        right.videoCount - left.videoCount ||
        left.tagName.localeCompare(right.tagName, 'zh-CN'),
    );

  return {
    totalVideoCount: unique.length,
    resolvedVideoCount,
    taggedVideoCount,
    pendingVideoCount: Math.max(0, unique.length - resolvedVideoCount),
    preferences,
  };
}

/** 加载当前收藏集合对应的本地画像快照，不触发网络请求。 */
export async function loadTagProfile(
  videos: FavoriteVideo[],
): Promise<{profile: TagProfile; cacheEntries: VideoTagCacheEntry[]}> {
  const unique = uniqueVideos(videos);
  const cacheEntries = await getVideoTagCacheEntries(
    unique.map(video => video.bvid),
  );
  return {
    profile: buildTagProfile(unique, cacheEntries),
    cacheEntries,
  };
}

function retryDelayFor(error: unknown): number {
  return error instanceof ResourceUnavailableError
    ? config.tagRecommendations.unavailableRetryDelayMs
    : config.tagRecommendations.transientRetryDelayMs;
}

function shouldPauseBackfill(error: unknown): boolean {
  return (
    error instanceof AuthRequiredError ||
    error instanceof NetworkError ||
    error instanceof RateLimitError
  );
}

/**
 * 逐个补齐收藏视频的 tag，并立即写入本地缓存。
 * 所有请求复用 biliApi 的全局限速；UID 改变或页面取消时停止后续读取。
 */
export async function backfillFavoriteTags(
  expectedUid: string,
  videos: FavoriteVideo[],
  signal: AbortSignal,
  onProgress: (progress: TagBackfillProgress) => void,
): Promise<{profile: TagProfile; progress: TagBackfillProgress}> {
  const unique = uniqueVideos(videos);
  const initialEntries = await getVideoTagCacheEntries(
    unique.map(video => video.bvid),
  );
  const cacheByVideoId = new Map(
    initialEntries.map(entry => [entry.videoId, entry]),
  );
  const progress: TagBackfillProgress = {
    totalVideoCount: unique.length,
    completedVideoCount: 0,
    successfulVideoCount: 0,
    emptyVideoCount: 0,
    failedVideoCount: 0,
    paused: false,
  };
  onProgress({...progress});

  for (const video of unique) {
    if (signal.aborted) {
      break;
    }
    if (useAuthStore.getState().userId !== expectedUid) {
      progress.paused = true;
      break;
    }

    const cached = cacheByVideoId.get(video.bvid);
    const now = Date.now();
    const cacheIsFresh =
      cached?.fetchedAt !== null &&
      cached?.fetchedAt !== undefined &&
      now - cached.fetchedAt < config.cacheTTL.videoTags;
    const isInCooldown =
      cached?.retryAfter !== null &&
      cached?.retryAfter !== undefined &&
      cached.retryAfter > now;

    if (cacheIsFresh || isInCooldown) {
      progress.completedVideoCount += 1;
      if (cacheIsFresh) {
        if ((cached?.tags.length ?? 0) > 0) {
          progress.successfulVideoCount += 1;
        } else {
          progress.emptyVideoCount += 1;
        }
      } else {
        progress.failedVideoCount += 1;
      }
      onProgress({...progress});
      continue;
    }

    try {
      const response = await biliApi.getVideoTags(video.bvid, signal);
      if (signal.aborted) {
        break;
      }
      if (useAuthStore.getState().userId !== expectedUid) {
        progress.paused = true;
        break;
      }
      const tags = trimVideoTags(response);
      const fetchedAt = Date.now();
      await upsertVideoTagCache({
        videoId: video.bvid,
        tags,
        fetchedAt,
        retryAfter: null,
      });
      cacheByVideoId.set(video.bvid, {
        videoId: video.bvid,
        tags,
        fetchedAt,
        retryAfter: null,
      });
      if (tags.length > 0) {
        progress.successfulVideoCount += 1;
      } else {
        progress.emptyVideoCount += 1;
      }
    } catch (error) {
      if (signal.aborted) {
        break;
      }
      if (useAuthStore.getState().userId !== expectedUid) {
        progress.paused = true;
        break;
      }

      const retryAfter = Date.now() + retryDelayFor(error);
      await upsertVideoTagCache({videoId: video.bvid, retryAfter});
      cacheByVideoId.set(video.bvid, {
        videoId: video.bvid,
        tags: cached?.tags ?? [],
        fetchedAt: cached?.fetchedAt ?? null,
        retryAfter,
      });
      progress.failedVideoCount += 1;
      if (shouldPauseBackfill(error)) {
        progress.paused = true;
        progress.completedVideoCount += 1;
        onProgress({...progress});
        break;
      }
    }

    progress.completedVideoCount += 1;
    onProgress({...progress});
  }

  const cacheEntries = Array.from(cacheByVideoId.values());
  return {
    profile: buildTagProfile(unique, cacheEntries),
    progress: {...progress},
  };
}

/**
 * 用画像 Top tag 查询 B 站音乐分区，合并相同 BVID 并排除本地已收藏视频。
 */
export async function searchTagRecommendations(
  profile: TagProfile,
  favoriteVideos: FavoriteVideo[],
  signal: AbortSignal,
): Promise<TagRecommendationSearchResult> {
  const favorites = uniqueVideos(favoriteVideos);
  const favoriteIds = new Set(favorites.map(video => video.bvid));
  const preferences = profile.preferences.slice(
    0,
    config.tagRecommendations.maxProfileTags,
  );
  const preferencesByName = new Map(
    profile.preferences.map(preference => [
      normalizedTagKey(preference.tagName),
      preference,
    ]),
  );
  const recommendationById = new Map<string, TagRecommendation>();
  let failedSearchCount = 0;

  for (const preference of preferences) {
    if (signal.aborted) {
      break;
    }
    try {
      const response = await biliApi.searchVideos(
        preference.tagName,
        1,
        signal,
        config.tagRecommendations.musicTid,
      );
      for (const searchItem of response.result ?? []) {
        if (
          !searchItem.aid ||
          !searchItem.bvid ||
          favoriteIds.has(searchItem.bvid)
        ) {
          continue;
        }
        const video = trimSearchVideo(searchItem);
        const matchedTags = Array.from(
          new Set(
            video.tags
              .map(tag => preferencesByName.get(normalizedTagKey(tag))?.tagName)
              .filter((tagName): tagName is string => Boolean(tagName)),
          ),
        );
        if (matchedTags.length === 0) {
          continue;
        }
        const score = matchedTags.reduce(
          (total, tagName) =>
            total +
            (preferencesByName.get(normalizedTagKey(tagName))?.score ?? 0),
          0,
        );
        const existing = recommendationById.get(video.bvid);
        if (existing) {
          const mergedTags = Array.from(
            new Set([...existing.matchedTags, ...matchedTags]),
          );
          const mergedScore = mergedTags.reduce(
            (total, tagName) =>
              total +
              (preferencesByName.get(normalizedTagKey(tagName))?.score ?? 0),
            0,
          );
          recommendationById.set(video.bvid, {
            ...existing,
            matchedTags: mergedTags,
            score: mergedScore,
          });
        } else {
          recommendationById.set(video.bvid, {...video, matchedTags, score});
        }
      }
    } catch (error) {
      if (signal.aborted) {
        break;
      }
      failedSearchCount += 1;
      if (shouldPauseBackfill(error)) {
        break;
      }
    }
  }

  const recommendations = Array.from(recommendationById.values())
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.pubtime - left.pubtime ||
        left.title.localeCompare(right.title, 'zh-CN'),
    )
    .slice(0, config.tagRecommendations.maxRecommendations);

  return {recommendations, failedSearchCount};
}
