import type {FavoriteSearchMode} from './favoriteSearch';

export function getFavoriteSearchRefreshKey(
  uid: string,
  keyword: string,
  mode?: FavoriteSearchMode,
): string {
  const normalized = keyword.trim().toLocaleLowerCase();
  // 旧上下文沿用原键，新模式使用独立命名空间，避免关键词包含分隔符时串队列。
  return mode === undefined
    ? `favoriteSearch:${uid}:${normalized}`
    : `favoriteSearchV2:${JSON.stringify([uid, mode, normalized])}`;
}
