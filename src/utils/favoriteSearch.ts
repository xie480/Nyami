import type {FavoriteVideo} from '../types/domain';

export type FavoriteSearchMode = 'keyword' | 'author';

export interface FavoriteSearchIndexEntry {
  video: FavoriteVideo;
  normalizedTitle: string;
  normalizedAuthor: string;
}

/** 标题和作者只在收藏数据改变时规范化，避免每次输入都重新处理整个索引。 */
export function buildFavoriteSearchIndex(
  videos: readonly FavoriteVideo[],
): FavoriteSearchIndexEntry[] {
  return videos.map(video => ({
    video,
    normalizedTitle: video.title.toLocaleLowerCase(),
    normalizedAuthor: (video.upper?.name ?? '').toLocaleLowerCase(),
  }));
}

export function filterFavoriteSearchIndex(
  index: readonly FavoriteSearchIndexEntry[],
  query: string,
  mode?: FavoriteSearchMode,
): FavoriteVideo[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return [];
  }

  return index
    .filter(item => {
      if (mode === 'keyword') {
        return item.normalizedTitle.includes(normalized);
      }
      if (mode === 'author') {
        return item.normalizedAuthor.includes(normalized);
      }
      // 已持久化的旧搜索上下文没有 mode，维持原有标题或作者匹配语义。
      return (
        item.normalizedTitle.includes(normalized) ||
        item.normalizedAuthor.includes(normalized)
      );
    })
    .map(item => item.video);
}

export function filterFavoriteVideos(
  videos: readonly FavoriteVideo[],
  query: string,
  mode?: FavoriteSearchMode,
): FavoriteVideo[] {
  return filterFavoriteSearchIndex(
    buildFavoriteSearchIndex(videos),
    query,
    mode,
  );
}
