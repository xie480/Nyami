import type {
  CollectionRecommendation,
  TagRecommendation,
} from '../types/domain';

/** 统一推荐标题比较键，去除大小写和常见空白。 */
export function normalizeRecommendationTitleKey(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/<[^>]*>/g, '')
    .replace(/[\s\u3000]+/g, '')
    .toLocaleLowerCase();
}

/** 统一推荐 tag 比较键。 */
export function normalizeRecommendationTagKey(tag: string): string {
  return tag
    .trim()
    .replace(/[\s\u3000]+/g, '')
    .toLocaleLowerCase();
}

export type RecommendationFilterOptions = {
  excludedVideoIds?: Iterable<string>;
  excludedVideoTitles?: Iterable<string>;
  excludedCollectionIds?: Iterable<string>;
  tagBlacklist?: Iterable<string>;
  durationLimitSeconds?: number | null;
};

/**
 * 纯业务推荐过滤规则。
 * 数据库去重记录和“已展示历史”由平台仓储维护，这里只做可测试的候选筛选。
 */
export function filterRecommendedVideos(
  videos: TagRecommendation[],
  options: RecommendationFilterOptions = {},
): TagRecommendation[] {
  const excludedIds = new Set(options.excludedVideoIds ?? []);
  const excludedTitles = new Set(
    Array.from(
      options.excludedVideoTitles ?? [],
      normalizeRecommendationTitleKey,
    ),
  );
  const blacklist = Array.from(
    options.tagBlacklist ?? [],
    normalizeRecommendationTagKey,
  ).filter(Boolean);
  const durationLimit = options.durationLimitSeconds ?? null;
  const byId = new Map<string, TagRecommendation>();

  for (const video of videos) {
    if (!video.bvid || excludedIds.has(video.bvid)) {
      continue;
    }
    if (excludedTitles.has(normalizeRecommendationTitleKey(video.title))) {
      continue;
    }
    if (
      durationLimit !== null &&
      (video.duration <= 0 || video.duration > durationLimit)
    ) {
      continue;
    }
    if (
      video.tags.some(tag =>
        blacklist.some(keyword =>
          normalizeRecommendationTagKey(tag).includes(keyword),
        ),
      )
    ) {
      continue;
    }

    const existing = byId.get(video.bvid);
    if (!existing || video.score > existing.score) {
      byId.set(video.bvid, video);
    }
  }

  return Array.from(byId.values()).sort(compareRecommendations);
}

/** 对合集候选按来源 ID 去重并排除已展示条目。 */
export function filterRecommendedCollections(
  collections: CollectionRecommendation[],
  options: RecommendationFilterOptions = {},
): CollectionRecommendation[] {
  const excludedIds = new Set(options.excludedCollectionIds ?? []);
  const byId = new Map<string, CollectionRecommendation>();

  for (const collection of collections) {
    if (!collection.sourceKey || excludedIds.has(collection.sourceKey)) {
      continue;
    }
    const existing = byId.get(collection.sourceKey);
    if (!existing || collection.score > existing.score) {
      byId.set(collection.sourceKey, collection);
    }
  }

  return Array.from(byId.values()).sort(
    (left, right) =>
      right.score - left.score ||
      left.title.localeCompare(right.title, 'zh-CN'),
  );
}

/** 统一推荐排序规则，保证相同分数下结果稳定。 */
export function compareRecommendations(
  left: TagRecommendation,
  right: TagRecommendation,
): number {
  return (
    right.score - left.score ||
    right.pubtime - left.pubtime ||
    left.title.localeCompare(right.title, 'zh-CN')
  );
}
