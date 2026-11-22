import type {DesktopVideo} from './types';

export type SearchTagMode = 'and' | 'or';

export type SearchTagFilterState = {
  whitelistTags: string[];
  whitelistMode: SearchTagMode;
  blacklistTags: string[];
};

export const DEFAULT_SEARCH_TAG_FILTER: SearchTagFilterState = {
  whitelistTags: [],
  whitelistMode: 'and',
  blacklistTags: [],
};

/** 规范化标签数组，去除空白并保持用户输入顺序。 */
export function normalizeSearchTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean),
    ),
  );
}

/** 将旧版单列表标签筛选迁移到白名单和黑名单双列表结构。 */
export function migrateSearchTagFilter(value: unknown): SearchTagFilterState {
  if (!value || typeof value !== 'object') {
    return DEFAULT_SEARCH_TAG_FILTER;
  }
  const record = value as Record<string, unknown>;
  if ('whitelistTags' in record || 'blacklistTags' in record) {
    return {
      whitelistTags: normalizeSearchTags(record.whitelistTags),
      whitelistMode: record.whitelistMode === 'or' ? 'or' : 'and',
      blacklistTags: normalizeSearchTags(record.blacklistTags),
    };
  }
  const tags = normalizeSearchTags(record.tags);
  return {
    whitelistTags: record.listMode === 'blacklist' ? [] : tags,
    whitelistMode:
      record.listMode === 'blacklist'
        ? 'and'
        : record.mode === 'or'
        ? 'or'
        : 'and',
    blacklistTags: record.listMode === 'blacklist' ? tags : [],
  };
}

/** 按白名单模式和固定 AND 黑名单过滤搜索结果。 */
export function filterSearchVideosByTags(
  videos: DesktopVideo[],
  filter: SearchTagFilterState,
): DesktopVideo[] {
  const whitelistTags = filter.whitelistTags.map(tag =>
    tag.toLocaleLowerCase(),
  );
  const blacklistTags = filter.blacklistTags.map(tag =>
    tag.toLocaleLowerCase(),
  );
  if (!whitelistTags.length && !blacklistTags.length) {
    return videos;
  }
  return videos.filter(video => {
    const videoTags = video.tags.map(tag => tag.trim().toLocaleLowerCase());
    const whitelistMatched =
      !whitelistTags.length ||
      (filter.whitelistMode === 'and'
        ? whitelistTags.every(tag => videoTags.includes(tag))
        : whitelistTags.some(tag => videoTags.includes(tag)));
    const blacklisted =
      blacklistTags.length > 0 &&
      blacklistTags.every(tag => videoTags.includes(tag));
    return whitelistMatched && !blacklisted;
  });
}
