export function getFavoriteSearchRefreshKey(uid: string, keyword: string): string {
  return `favoriteSearch:${uid}:${keyword.trim().toLocaleLowerCase()}`;
}
