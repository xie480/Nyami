import type {
  DesktopVideo,
  FavoriteSourceKind,
  FavoriteSourceSummary,
  FavoriteSourceSyncStatus,
} from './types';

const IMPORTED_SOURCE_STORAGE_PREFIX = 'nyami-imported-sources-';

/** 返回音乐库导入来源选择的本地存储键。 */
export function getImportedSourcesStorageKey(uid: string): string {
  return `${IMPORTED_SOURCE_STORAGE_PREFIX}${uid}`;
}

/** 生成跨进程稳定的收藏来源标识。 */
export function getFavoriteSourceKey(
  kind: FavoriteSourceKind,
  ownerMid: number,
  remoteId: number,
): string {
  return `${kind}:${ownerMid}:${remoteId}`;
}

/** 只保留当前账号选择导入的收藏来源。 */
export function filterVisibleFavoriteSources(
  sources: readonly FavoriteSourceSummary[],
  visibleSourceKeys: readonly string[],
): FavoriteSourceSummary[] {
  const visible = new Set(visibleSourceKeys.filter(Boolean));
  return sources.filter(source => visible.has(source.sourceKey));
}

/** 只保留属于当前导入来源的视频，并按原索引顺序去重。 */
export function filterVisibleFavoriteIndex(
  videos: readonly DesktopVideo[],
  visibleSourceKeys: readonly string[],
): DesktopVideo[] {
  const visible = new Set(visibleSourceKeys.filter(Boolean));
  const seen = new Set<string>();
  return videos.filter(video => {
    if (seen.has(video.bvid)) {
      return false;
    }
    const sourceKeys = video.sourceKeys ?? [];
    if (!sourceKeys.some(sourceKey => visible.has(sourceKey))) {
      return false;
    }
    seen.add(video.bvid);
    return true;
  });
}

/** 将同步状态转换为不带句号的桌面界面文案。 */
export function getSyncStatusLabel(status: FavoriteSourceSyncStatus): string {
  switch (status) {
    case 'success':
      return '已同步';
    case 'syncing':
    case 'running':
      return '同步中';
    case 'failed':
      return '同步失败';
    case 'idle':
    default:
      return '未同步';
  }
}
