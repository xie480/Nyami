import {config} from '../config';
import {
  AuthRequiredError,
  NetworkError,
  RateLimitError,
  ResourceUnavailableError,
} from '../core/errors';
import {getVideoTagCacheEntries, upsertVideoTagCacheBatch} from '../db/operations';
import {biliApi} from './biliApi';
import {trimSearchVideo, trimVideoTags} from './transformers';
import {useAuthStore} from '../store/authStore';
import {useSettingsStore} from '../store/settingsStore';
import {useTagBackfillStore} from '../store/tagBackfillStore';
import {forEachInYieldingBatches} from '../utils/yielding';
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

async function uniqueVideosYielding(
  videos: FavoriteVideo[],
  signal?: AbortSignal,
): Promise<FavoriteVideo[]> {
  const seen = new Set<string>();
  const unique: FavoriteVideo[] = [];
  await forEachInYieldingBatches(videos, video => {
    if (video.bvid && video.attr === 0 && !seen.has(video.bvid)) {
      seen.add(video.bvid);
      unique.push(video);
    }
  }, signal);
  return unique;
}

function* favoriteVideoIds(
  videos: FavoriteVideo[],
): IterableIterator<string> {
  for (const video of videos) yield video.bvid;
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

interface TagProfileAccumulator {
  cacheByVideoId: Map<string, VideoTagCacheEntry>;
  counts: Map<string, {tagId: number; tagName: string; videoCount: number}>;
  resolvedVideoCount: number;
  taggedVideoCount: number;
}

function createTagProfileAccumulator(
  cacheByVideoId: Map<string, VideoTagCacheEntry>,
): TagProfileAccumulator {
  return {
    cacheByVideoId,
    counts: new Map(),
    resolvedVideoCount: 0,
    taggedVideoCount: 0,
  };
}

function addVideoToTagProfile(
  video: FavoriteVideo,
  accumulator: TagProfileAccumulator,
): void {
  const entry = accumulator.cacheByVideoId.get(video.bvid);
  if (!entry || entry.fetchedAt === null) return;
  accumulator.resolvedVideoCount += 1;

  const tagsForVideo = new Set<string>();
  for (const tag of decodeTags(entry)) {
    const key = normalizedTagKey(tag.tagName);
    if (!key || tag.tagId === 0 || tagsForVideo.has(key)) continue;
    tagsForVideo.add(key);
    const current = accumulator.counts.get(key);
    if (current) {
      current.videoCount += 1;
    } else {
      accumulator.counts.set(key, {
        tagId: tag.tagId,
        tagName: tag.tagName,
        videoCount: 1,
      });
    }
  }
  if (tagsForVideo.size > 0) accumulator.taggedVideoCount += 1;
}

function finishTagProfile(
  totalVideoCount: number,
  accumulator: TagProfileAccumulator,
): TagProfile {
  const preferences: TagPreference[] = Array.from(accumulator.counts.values())
    .map(tag => ({
      ...tag,
      score:
        accumulator.taggedVideoCount > 0
          ? tag.videoCount / accumulator.taggedVideoCount
          : 0,
    }))
    .sort(
      (left, right) =>
        right.videoCount - left.videoCount ||
        left.tagName.localeCompare(right.tagName, 'zh-CN'),
    );

  return {
    totalVideoCount,
    resolvedVideoCount: accumulator.resolvedVideoCount,
    taggedVideoCount: accumulator.taggedVideoCount,
    pendingVideoCount: Math.max(
      0,
      totalVideoCount - accumulator.resolvedVideoCount,
    ),
    preferences,
  };
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
  const accumulator = createTagProfileAccumulator(cacheByVideoId);
  for (const video of unique) {
    addVideoToTagProfile(video, accumulator);
  }
  return finishTagProfile(unique.length, accumulator);
}

async function buildTagProfileYielding(
  videos: FavoriteVideo[],
  cacheEntries: Iterable<VideoTagCacheEntry>,
  signal?: AbortSignal,
): Promise<TagProfile> {
  const cacheByVideoId = new Map<string, VideoTagCacheEntry>();
  await forEachInYieldingBatches(cacheEntries, entry => {
    cacheByVideoId.set(entry.videoId, entry);
  }, signal);

  const accumulator = createTagProfileAccumulator(cacheByVideoId);
  await forEachInYieldingBatches(
    videos,
    video => addVideoToTagProfile(video, accumulator),
    signal,
  );
  return finishTagProfile(videos.length, accumulator);
}

/** 加载当前收藏集合对应的本地画像快照，不触发网络请求。 */
export async function loadTagProfile(
  videos: FavoriteVideo[],
  signal?: AbortSignal,
): Promise<{profile: TagProfile; cacheEntries: VideoTagCacheEntry[]}> {
  const unique = await uniqueVideosYielding(videos, signal);
  const cacheEntries = await getVideoTagCacheEntries(
    favoriteVideoIds(unique),
    signal,
  );
  return {
    profile: await buildTagProfileYielding(unique, cacheEntries, signal),
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
 * 有界并行补齐收藏视频 tag，并按小批次写入本地缓存。
 * 所有请求复用 biliApi 的全局限速；UID 改变或页面取消时停止后续读取。
 */
export async function backfillFavoriteTags(
  expectedUid: string,
  videos: FavoriteVideo[],
  signal: AbortSignal,
  onProgress: (progress: TagBackfillProgress) => void,
): Promise<{profile: TagProfile; progress: TagBackfillProgress}> {
  const unique = await uniqueVideosYielding(videos, signal);
  const initialEntries = await getVideoTagCacheEntries(
    favoriteVideoIds(unique),
    signal,
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

  const uncachedVideos: FavoriteVideo[] = [];
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
      continue;
    }
    uncachedVideos.push(video);
  }
  onProgress({...progress});

  type BackfillOutcome =
    | {kind: 'success'; videoId: string; tags: VideoTag[]; fetchedAt: number}
    | {kind: 'empty'; videoId: string; tags: VideoTag[]; fetchedAt: number}
    | {kind: 'failure'; videoId: string; cached?: VideoTagCacheEntry; retryAfter: number; pause: boolean}
    | {kind: 'accountChanged'}
    | null;

  const batchSize = config.tagRecommendations.backfillBatchSize;
  const concurrency = config.tagRecommendations.backfillConcurrency;
  for (let offset = 0; offset < uncachedVideos.length && !progress.paused; offset += batchSize) {
    const batchGroup = uncachedVideos.slice(offset, offset + batchSize);
    for (
      let batchOffset = 0;
      batchOffset < batchGroup.length && !progress.paused;
      batchOffset += concurrency
    ) {
      if (signal.aborted) break;
      if (useAuthStore.getState().userId !== expectedUid) {
        progress.paused = true;
        break;
      }

      const batch = batchGroup.slice(batchOffset, batchOffset + concurrency);
      const outcomes = await Promise.all(batch.map(async (video): Promise<BackfillOutcome> => {
        const cached = cacheByVideoId.get(video.bvid);
        try {
          const response = await biliApi.getVideoTags(video.bvid, signal);
          if (signal.aborted) return null;
          if (useAuthStore.getState().userId !== expectedUid) {
            return {kind: 'accountChanged'};
          }
          const tags = trimVideoTags(response);
          const fetchedAt = Date.now();
          return tags.length > 0
            ? {kind: 'success' as const, videoId: video.bvid, tags, fetchedAt}
            : {kind: 'empty' as const, videoId: video.bvid, tags, fetchedAt};
        } catch (error) {
          if (signal.aborted) return null;
          if (useAuthStore.getState().userId !== expectedUid) {
            return {kind: 'accountChanged'};
          }
          return {
            kind: 'failure',
            videoId: video.bvid,
            cached,
            retryAfter: Date.now() + retryDelayFor(error),
            pause: shouldPauseBackfill(error),
          };
        }
      }));

      if (useAuthStore.getState().userId !== expectedUid) {
        progress.paused = true;
        onProgress({...progress});
        break;
      }

      const cacheWrites: Array<{
        videoId: string;
        tags?: VideoTag[];
        fetchedAt?: number | null;
        retryAfter?: number | null;
      }> = [];
      let pauseAfterBatch = false;
      for (const outcome of outcomes) {
        if (!outcome) continue;
        if (outcome.kind === 'accountChanged') {
          progress.paused = true;
          pauseAfterBatch = true;
          continue;
        }
        if (outcome.kind === 'success' || outcome.kind === 'empty') {
          const cachedEntry = {
            videoId: outcome.videoId,
            tags: outcome.tags,
            fetchedAt: outcome.fetchedAt,
            retryAfter: null,
          };
          cacheWrites.push(cachedEntry);
          cacheByVideoId.set(outcome.videoId, cachedEntry);
          progress.completedVideoCount += 1;
          if (outcome.kind === 'success') {
            progress.successfulVideoCount += 1;
          } else {
            progress.emptyVideoCount += 1;
          }
          continue;
        }

        const cachedEntry = {
          videoId: outcome.videoId,
          tags: outcome.cached?.tags ?? [],
          fetchedAt: outcome.cached?.fetchedAt ?? null,
          retryAfter: outcome.retryAfter,
        };
        cacheWrites.push({
          videoId: cachedEntry.videoId,
          fetchedAt: cachedEntry.fetchedAt,
          retryAfter: cachedEntry.retryAfter,
        });
        cacheByVideoId.set(outcome.videoId, cachedEntry);
        progress.completedVideoCount += 1;
        progress.failedVideoCount += 1;
        if (outcome.pause) {
          progress.paused = true;
          pauseAfterBatch = true;
        }
      }

      await upsertVideoTagCacheBatch(cacheWrites);
      onProgress({...progress});
      if (pauseAfterBatch || signal.aborted) break;
    }
  }

  return {
    profile: await buildTagProfileYielding(
      unique,
      cacheByVideoId.values(),
      signal,
    ),
    progress: {...progress},
  };
}

/**
 * 后台标签队列可在索引同步期间接收新入库视频；所有 B 站请求仍共用全局限速器。
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
          backgroundBackfillPaused = true;
          backgroundBackfillEpoch += 1;
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

/** 解除暂停闸门并安排当前索引已有视频的标签回填。 */
export function resumeFavoriteTagsBackfill(
  expectedUid: string,
  videos: FavoriteVideo[],
): void {
  backgroundBackfillPaused = false;
  backgroundBackfillEpoch += 1;
  enqueueFavoriteTagsBackfill(expectedUid, videos, backgroundBackfillEpoch);
}

/** 将新同步入库的视频追加到正在运行的标签回填队列。 */
export function addFavoriteVideosToTagBackfill(
  expectedUid: string,
  videos: FavoriteVideo[],
): void {
  if (backgroundBackfillPaused) return;
  enqueueFavoriteTagsBackfill(expectedUid, videos, backgroundBackfillEpoch);
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
