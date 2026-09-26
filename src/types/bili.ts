/** B 站统一响应包装 */
export interface BiliResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface BiliFolder {
  id: number;
  fid: number;
  mid: number;
  title: string;
  media_count: number;
}

/** 收藏关系目录接口中的条目；fid 为 0 的条目表示视频合集。 */
export interface BiliCollectedPlaylist {
  id: number;
  season_id?: number;
  fid?: number;
  mid?: number;
  title?: string;
  name?: string;
  cover?: string;
  media_count?: number;
  total?: number;
  type_name?: string;
  upper?: { mid?: number; name?: string; face?: string };
}

export interface BiliCollectedPlaylistList {
  count?: number;
  list?: BiliCollectedPlaylist[] | null;
}

export interface BiliSeasonArchive {
  aid?: number;
  bvid?: string;
  title: string;
  pic?: string;
  cover?: string;
  duration?: number;
  pubdate?: number;
  ctime?: number;
  owner?: { mid?: number; name?: string };
  upper?: { mid?: number; name?: string };
}

export interface BiliSeasonArchivesPage {
  archives?: BiliSeasonArchive[];
  page?: { page_num?: number; page_size?: number; total?: number };
}

export interface BiliFavoriteVideoMedia {
  bvid: string;
  title: string;
  cover: string;
  duration: number;
  page: number;
  pubtime: number;
  fav_time: number;
  attr: number; // 0 为正常，其他值为失效
  upper: { mid: number; name: string };
}

/** 视频分段（P）信息，匹配 B 站 API 中的 pages 条目 */
export interface BiliVideoPage {
  cid: number;
  page: number;
  part: string; // 分段标题
  duration: number;
  vid?: string;
  weblink?: string;
  dimension?: { width: number; height: number; rotate: number };
}

export interface BiliVideoInfo {
  bvid: string;
  cid: number;
  title: string;
  pic: string;
  duration: number;
  owner: { mid: number; name: string };
  /** 视频分段（P）列表，可能为空 */
  pages?: BiliVideoPage[];
}

export interface BiliDashAudio {
  id: number;            // 音质 ID（30216/30232/30280 等）
  baseUrl: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth: number;
  mimeType: string;
  mime_type?: string;
}

export interface BiliPlayUrlData {
  dash?: {
    audio?: BiliDashAudio[];
    video?: any[];
  };
  durl?: {
    url: string;
    backup_url?: string[];
  }[];
}

export interface BiliWbiKeys {
  imgKey: string;
  subKey: string;
}
