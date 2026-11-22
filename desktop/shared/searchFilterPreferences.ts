import {
  DEFAULT_SEARCH_TAG_FILTER,
  migrateSearchTagFilter,
  type SearchTagFilterState,
} from './searchTagFilters';

export const SEARCH_FILTER_PREFERENCES_STORAGE_KEY =
  'nyami-search-filter-v2';
export const LEGACY_SEARCH_TAG_FILTER_STORAGE_KEY = 'nyami-search-tag-filter-v1';

export type SearchSortOption =
  | '综合排序'
  | '最多播放'
  | '最新发布'
  | '最多弹幕'
  | '最多收藏';

export type SearchDateFilterOption =
  | '全部日期'
  | '最近一天'
  | '最近一周'
  | '最近半年';

export type SearchFilterPreferences = {
  sort: SearchSortOption;
  dateFilter: SearchDateFilterOption;
  startDate: string;
  endDate: string;
  minDuration: string;
  maxDuration: string;
  tagFilter: SearchTagFilterState;
};

export const DEFAULT_SEARCH_FILTER_PREFERENCES: SearchFilterPreferences = {
  sort: '综合排序',
  dateFilter: '全部日期',
  startDate: '',
  endDate: '',
  minDuration: '',
  maxDuration: '',
  tagFilter: cloneSearchTagFilter(DEFAULT_SEARCH_TAG_FILTER),
};

/** 校验本地存储中的搜索方案，损坏或过期字段回退安全默认值。 */
export function normalizeSearchFilterPreferences(
  value: unknown,
): SearchFilterPreferences {
  const record = isRecord(value) ? value : {};
  const tagFilter = isRecord(record.tagFilter)
    ? migrateSearchTagFilter(record.tagFilter)
    : migrateSearchTagFilter(record);
  return {
    sort: isSearchSortOption(record.sort)
      ? record.sort
      : DEFAULT_SEARCH_FILTER_PREFERENCES.sort,
    dateFilter: isSearchDateFilterOption(record.dateFilter)
      ? record.dateFilter
      : DEFAULT_SEARCH_FILTER_PREFERENCES.dateFilter,
    startDate: normalizeDateInput(record.startDate),
    endDate: normalizeDateInput(record.endDate),
    minDuration: normalizeDurationInput(record.minDuration),
    maxDuration: normalizeDurationInput(record.maxDuration),
    tagFilter,
  };
}

/** 复制标签筛选对象，避免表单状态和默认常量共享数组。 */
export function cloneSearchTagFilter(
  filter: SearchTagFilterState,
): SearchTagFilterState {
  return {
    whitelistTags: [...filter.whitelistTags],
    whitelistMode: filter.whitelistMode,
    blacklistTags: [...filter.blacklistTags],
  };
}

/** 判断值是否属于受支持的排序选项。 */
function isSearchSortOption(value: unknown): value is SearchSortOption {
  return (
    value === '综合排序' ||
    value === '最多播放' ||
    value === '最新发布' ||
    value === '最多弹幕' ||
    value === '最多收藏'
  );
}

/** 判断值是否属于受支持的日期筛选选项。 */
function isSearchDateFilterOption(
  value: unknown,
): value is SearchDateFilterOption {
  return (
    value === '全部日期' ||
    value === '最近一天' ||
    value === '最近一周' ||
    value === '最近半年'
  );
}

/** 只保留浏览器 date 控件接受的日期文本。 */
function normalizeDateInput(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return '';
  }
  return Number.isNaN(Date.parse(`${value}T00:00:00`)) ? '' : value;
}

/** 将时长输入规范化为非负数字文本，空值表示不限。 */
function normalizeDurationInput(value: unknown): string {
  if (value === '' || value === null || value === undefined) {
    return '';
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0
    ? String(normalized)
    : '';
}

/** 判断输入是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
