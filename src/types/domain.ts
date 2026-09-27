/** 音质选项 */
export type Quality = 'low' | 'medium' | 'high' | 'dolby' | 'hires';

/** 收藏夹（精简后）*/
export interface FavoriteFolder {
  id: number;
  fid: number;
  mid: number;
  title: string;
  mediaCount: number;
}

/** 可从 B 站账号关系自动导入的外部播放列表类型。 */
export type ImportedPlaylistKind = 'collectedFavorite' | 'subscribedSeason';

/** B 站账号已收藏的他人收藏夹或已订阅合集。 */
export interface ImportedPlaylist {
  sourceKey: string;
  kind: ImportedPlaylistKind;
  remoteId: number;
  ownerMid: number;
  ownerName: string;
  title: string;
  cover: string;
  mediaCount: number;
}

/** 视频分段（P）信息 */
export interface VideoPart {
  cid: number;
  page: number;
  title: string;
  duration: number;
}

/** 收藏夹中的视频条目（精简后）*/
export interface FavoriteVideo {
  bvid: string;
  title: string;
  cover: string;
  duration: number;
  page: number;
  pubtime: number;
  favTime: number;
  upper: { mid: number; name: string };
  attr: number;
  folderIds?: number[];
  /** 该视频所属的他人收藏夹或订阅合集稳定来源标识。 */
  sourceKeys?: string[];
  /** 分P 列表，仅在获取到视频详情后填充 */
  parts?: VideoPart[];
}

/** B 站在线搜索结果，保留 AID 与 tag 供收藏和筛选使用。 */
export interface OnlineVideoSearchResult {
  aid: number;
  bvid: string;
  title: string;
  cover: string;
  duration: number;
  pubtime: number;
  authorId: number;
  author: string;
  tags: string[];
}

/** 规范化后的视频 tag。 */
export interface VideoTag {
  tagId: number;
  tagName: string;
}

/** 本地缓存的视频 tag 快照。 */
export interface VideoTagCacheEntry {
  videoId: string;
  tags: VideoTag[];
  fetchedAt: number | null;
  retryAfter: number | null;
}

/** 单个兴趣 tag 的收藏覆盖度。 */
export interface TagPreference {
  tagId: number;
  tagName: string;
  videoCount: number;
  score: number;
}

/** 从当前已同步收藏数据计算出的本地兴趣画像。 */
export interface TagProfile {
  totalVideoCount: number;
  resolvedVideoCount: number;
  taggedVideoCount: number;
  pendingVideoCount: number;
  preferences: TagPreference[];
}

/** 根据兴趣 tag 检索并去重后的推荐视频。 */
export interface TagRecommendation extends OnlineVideoSearchResult {
  matchedTags: string[];
  score: number;
}

/** 音频流信息 */
export interface AudioInfo {
  bvid: string;
  cid: number;
  title: string;
  cover: string;
  author: string;
  duration: number;
  audio: {
    id: number;
    bitrate: number;        // kbps
    mimeType: string;
    baseUrl: string;        // 真实 CDN 地址
    backupUrl: string[];    // 备用 CDN
  };
  /** 视频分段信息，仅在获取到详情后填充 */
  parts?: VideoPart[];
}

/** 分页结果 */
export interface PageResult<T> {
  list: T[];
  hasMore: boolean;
  /** 原始返回的记录数（在过滤失效视频前） */
  rawCount: number;
}
