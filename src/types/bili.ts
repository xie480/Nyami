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

export interface BiliFavoriteVideoMedia {
  bvid: string;
  title: string;
  cover: string;
  duration: number;
  page: number;
  pubtime: number;
  attr: number; // 0 为正常，其他值为失效
  upper: { mid: number; name: string };
}

export interface BiliVideoInfo {
  bvid: string;
  cid: number;
  title: string;
  pic: string;
  duration: number;
  owner: { mid: number; name: string };
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
}

export interface BiliWbiKeys {
  imgKey: string;
  subKey: string;
}
