import {biliApi} from './biliApi';
import {trimSearchVideo} from './transformers';
import type {
  OnlineVideoSearchResult,
  OnlineVideoSearchSort,
} from '../types/domain';

export interface OnlineVideoSearchCriteria {
  keyword: string;
  tagFilter: string;
  sort: OnlineVideoSearchSort;
  durationLimitSeconds: number | null;
}

export interface OnlineVideoSearchPage {
  results: OnlineVideoSearchResult[];
  hasMore: boolean;
}

export function sortOnlineVideoSearchResults(
  results: OnlineVideoSearchResult[],
  sort: OnlineVideoSearchSort,
): OnlineVideoSearchResult[] {
  const sorted = [...results];
  if (sort === 'newest') sorted.sort((left, right) => right.pubtime - left.pubtime);
  if (sort === 'durationAsc') sorted.sort((left, right) => left.duration - right.duration);
  if (sort === 'durationDesc') sorted.sort((left, right) => right.duration - left.duration);
  return sorted;
}

/** 复用搜索页的 tag、时长和排序规则，供结果页与播放器队列分页共用。 */
export async function fetchOnlineVideoSearchPage(
  criteria: OnlineVideoSearchCriteria,
  page: number,
  signal?: AbortSignal,
): Promise<OnlineVideoSearchPage> {
  const response = await biliApi.searchVideos(criteria.keyword, page, signal);
  const normalizedTag = criteria.tagFilter.trim().toLocaleLowerCase();
  const results = (response.result ?? [])
    .filter(item => item.aid > 0 && !!item.bvid)
    .map(trimSearchVideo)
    .filter(item =>
      !normalizedTag || item.tags.some(tag => tag.toLocaleLowerCase().includes(normalizedTag)),
    )
    .filter(item =>
      criteria.durationLimitSeconds === null ||
      (item.duration > 0 && item.duration <= criteria.durationLimitSeconds),
    );
  const uniqueResults = Array.from(
    new Map(results.map(video => [video.bvid, video])).values(),
  );

  return {
    results: sortOnlineVideoSearchResults(uniqueResults, criteria.sort),
    hasMore: page < (response.numPages ?? page),
  };
}
