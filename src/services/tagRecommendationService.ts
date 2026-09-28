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
import {useSettingsStore} from '../store/settingsStore';
import {useTagBackfillStore} from '../store/tagBackfillStore';
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
  hasMore: boolean;
}

export interface TagRecommendationSearchOptions {
  page?: number;
  excludeVideoIds?: string[];
  excludeVideoTitles?: string[];
  /** Null disables the duration ceiling; omitted values use the persisted app preference. */
  durationLimitSeconds?: number | null;
  tagBlacklist?: string[];
  maxRecommendations?: number;
}

interface BackgroundBackfillTask {
  uid: string;
  controller: AbortController;
  scheduledVideoIds: Set<string>;
  pendingVideos: Map<string, FavoriteVideo>;
  promise: Promise<void>;
  accepting: boolean;
  completedVideoCount: number;
  successfulVideoCount: number;
  emptyVideoCount: number;
  failedVideoCount: number;
}

let backgroundBackfillTask: BackgroundBackfillTask | null = null;
let backgroundBackfillPaused = false;
let backgroundBackfillEpoch = 0;

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

export function normalizeRecommendationTitleKey(title: string): string {
  return title.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
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
 * 在全局索引完成后异步补齐标签。B 站请求沿用全局限速，因此不阻塞主同步，
 * 且 syncStore 会在下次索引同步开始前中断本任务，避免与索引请求争用限速窗口。
 */
function enqueueFavoriteTagsBackfill(
  expectedUid: string,
  videos: FavoriteVideo[],
  taskEpoch: number,
): void {
  if (backgroundBackfillPaused || taskEpoch !== backgroundBackfillEpoch) {
    return;
  }
  const candidates = uniqueVideos(videos);
  if (
    !expectedUid ||
    candidates.length === 0 ||
    useAuthStore.getState().userId !== expectedUid
  ) {
    return;
  }

  const currentTask = backgroundBackfillTask;
  if (currentTask) {
    if (
      currentTask.uid === expectedUid &&
      currentTask.accepting &&
      !currentTask.controller.signal.aborted
    ) {
      for (const video of candidates) {
        if (!currentTask.scheduledVideoIds.has(video.bvid)) {
          currentTask.scheduledVideoIds.add(video.bvid);
          currentTask.pendingVideos.set(video.bvid, video);
        }
      }
      useTagBackfillStore.getState().setTotalVideoCount(
        expectedUid,
        currentTask.scheduledVideoIds.size,
      );
      return;
    }

    if (currentTask.uid !== expectedUid) {
      currentTask.controller.abort();
    }
    currentTask.promise.then(() =>
      enqueueFavoriteTagsBackfill(expectedUid, candidates, taskEpoch),
    );
    return;
  }

  const controller = new AbortController();
  const task: BackgroundBackfillTask = {
    uid: expectedUid,
    controller,
    scheduledVideoIds: new Set(candidates.map(video => video.bvid)),
    pendingVideos: new Map(candidates.map(video => [video.bvid, video])),
    promise: Promise.resolve(),
    accepting: true,
    completedVideoCount: 0,
    successfulVideoCount: 0,
    emptyVideoCount: 0,
    failedVideoCount: 0,
  };
  backgroundBackfillTask = task;
  useTagBackfillStore.getState().begin(expectedUid, task.scheduledVideoIds.size);

  task.promise = (async () => {
    try {
      while (!controller.signal.aborted && task.pendingVideos.size > 0) {
        const batch = Array.from(task.pendingVideos.values());
        task.pendingVideos.clear();
        const result = await backfillFavoriteTags(
          expectedUid,
          batch,
          controller.signal,
          progress => {
            useTagBackfillStore.getState().updateProgress(expectedUid, {
              totalVideoCount: task.scheduledVideoIds.size,
              completedVideoCount:
                task.completedVideoCount + progress.completedVideoCount,
              successfulVideoCount:
                task.successfulVideoCount + progress.successfulVideoCount,
              emptyVideoCount:
                task.emptyVideoCount + progress.emptyVideoCount,
              failedVideoCount:
                task.failedVideoCount + progress.failedVideoCount,
              paused: progress.paused,
            });
          },
        );

        task.completedVideoCount += result.progress.completedVideoCount;
        task.successfulVideoCount += result.progress.successfulVideoCount;
        task.emptyVideoCount += result.progress.emptyVideoCount;
        task.failedVideoCount += result.progress.failedVideoCount;
        const interrupted = controller.signal.aborted || result.progress.paused;
        useTagBackfillStore.getState().updateProgress(expectedUid, {
          totalVideoCount: task.scheduledVideoIds.size,
          completedVideoCount: task.completedVideoCount,
          successfulVideoCount: task.successfulVideoCount,
          emptyVideoCount: task.emptyVideoCount,
          failedVideoCount: task.failedVideoCount,
          paused: interrupted,
        });

        if (interrupted) {
          useTagBackfillStore.getState().finish(expectedUid, 'paused');
          return;
        }
      }

      const interrupted =
        controller.signal.aborted || useAuthStore.getState().userId !== expectedUid;
      useTagBackfillStore.getState().updateProgress(expectedUid, {
        totalVideoCount: task.scheduledVideoIds.size,
        completedVideoCount: task.completedVideoCount,
        successfulVideoCount: task.successfulVideoCount,
        emptyVideoCount: task.emptyVideoCount,
        failedVideoCount: task.failedVideoCount,
        paused: interrupted,
      });
      useTagBackfillStore.getState().finish(expectedUid, interrupted ? 'paused' : 'done');
    } catch (error) {
      useTagBackfillStore.getState().finish(
        expectedUid,
        'error',
        error instanceof Error ? error.message : '后台读取兴趣标签失败',
      );
    } finally {
      task.accepting = false;
      if (backgroundBackfillTask === task) {
        backgroundBackfillTask = null;
      }
    }
  })();
}

/** 在索引同步完成后解除暂停闸门并安排当前索引的标签回填。 */
export function resumeFavoriteTagsBackfill(
  expectedUid: string,
  videos: FavoriteVideo[],
): void {
  backgroundBackfillPaused = false;
  backgroundBackfillEpoch += 1;
  enqueueFavoriteTagsBackfill(expectedUid, videos, backgroundBackfillEpoch);
}

/** 索引同步开始时暂停后台标签请求，已写入 WatermelonDB 的缓存会保留。 */
export function pauseFavoriteTagsBackfill(): void {
  backgroundBackfillPaused = true;
  backgroundBackfillEpoch += 1;
  backgroundBackfillTask?.controller.abort();
}

/**
 * 用画像 Top tag 查询 B 站音乐分区，合并相同 BVID 并排除本地已收藏视频。
 */
export async function searchTagRecommendations(
  profile: TagProfile,
  favoriteVideos: FavoriteVideo[],
  signal: AbortSignal,
  options: TagRecommendationSearchOptions = {},
): Promise<TagRecommendationSearchResult> {
  const page = options.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error('推荐页码无效');
  }
  const favorites = uniqueVideos(favoriteVideos);
  const favoriteIds = new Set(favorites.map(video => video.bvid));
  const favoriteTitles = new Set(
    [...favorites.map(video => video.title), ...(options.excludeVideoTitles ?? [])]
      .map(normalizeRecommendationTitleKey)
      .filter(Boolean),
  );
  for (const videoId of options.excludeVideoIds ?? []) {
    if (videoId) favoriteIds.add(videoId);
  }
  const settings = useSettingsStore.getState();
  const durationLimitSeconds = options.durationLimitSeconds === undefined
    ? settings.recommendationDurationFilterEnabled
      ? settings.recommendationDurationLimitMinutes * 60
      : null
    : options.durationLimitSeconds;
  const normalizedBlacklist = (options.tagBlacklist ?? settings.recommendationTagBlacklist)
    .map(normalizedTagKey)
    .filter(Boolean);
  const maxRecommendations = options.maxRecommendations ?? config.tagRecommendations.maxRecommendations;
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
  let hasMore = false;

  type SearchPage = Awaited<ReturnType<typeof biliApi.searchVideos>>;
  const searchResponses: (SearchPage | null)[] = Array(preferences.length).fill(null);
  let nextPreferenceIndex = 0;
  let stopSchedulingSearches = false;
  const searchWorker = async () => {
    while (!signal.aborted && !stopSchedulingSearches) {
      const preferenceIndex = nextPreferenceIndex++;
      const preference = preferences[preferenceIndex];
      if (!preference) return;
      try {
        searchResponses[preferenceIndex] = await biliApi.searchVideos(
          preference.tagName,
          page,
          signal,
          config.tagRecommendations.musicTid,
        );
      } catch (error) {
        if (signal.aborted) return;
        failedSearchCount += 1;
        if (shouldPauseBackfill(error)) {
          stopSchedulingSearches = true;
        }
      }
    }
  };
  const workerCount = Math.min(
    preferences.length,
    config.tagRecommendations.searchConcurrency,
  );
  await Promise.all(Array.from({length: workerCount}, () => searchWorker()));

  // 请求并行执行，结果按画像标签原顺序合并，确保同分推荐仍然稳定。
  for (let preferenceIndex = 0; preferenceIndex < preferences.length; preferenceIndex += 1) {
    const response = searchResponses[preferenceIndex];
    if (!response) continue;
    hasMore ||= (response.numPages ?? page) > page;
    for (const searchItem of response.result ?? []) {
        if (
          !searchItem.aid ||
          !searchItem.bvid ||
          favoriteIds.has(searchItem.bvid)
        ) {
          continue;
        }
        const video = trimSearchVideo(searchItem);
        if (favoriteTitles.has(normalizeRecommendationTitleKey(video.title))) {
          continue;
        }
        if (
          durationLimitSeconds !== null &&
          (video.duration <= 0 || video.duration > durationLimitSeconds)
        ) {
          continue;
        }
        if (
          video.tags.some(tag => {
            const normalizedTag = normalizedTagKey(tag);
            return normalizedBlacklist.some(keyword => normalizedTag.includes(keyword));
          })
        ) {
          continue;
        }
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
  }

  const recommendations = Array.from(recommendationById.values())
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.pubtime - left.pubtime ||
        left.title.localeCompare(right.title, 'zh-CN'),
    )
    .slice(0, Math.max(0, maxRecommendations));

  return {recommendations, failedSearchCount, hasMore};
}
