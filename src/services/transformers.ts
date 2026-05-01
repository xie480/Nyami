import type {
  BiliFolder,
  BiliFavoriteVideoMedia,
  BiliDashAudio,
} from '../types/bili';
import type { FavoriteFolder, FavoriteVideo } from '../types/domain';

export function trimFolder(f: BiliFolder): FavoriteFolder {
  return {
    id: f.id,
    fid: f.fid,
    mid: f.mid,
    title: f.title,
    mediaCount: f.media_count,
  };
}

export function trimFavoriteVideo(m: BiliFavoriteVideoMedia): FavoriteVideo {
  return {
    bvid: m.bvid,
    title: m.title,
    cover: m.cover,
    duration: m.duration,
    page: m.page,
    pubtime: m.pubtime,
    upper: {
      mid: m.upper?.mid ?? 0,
      name: m.upper?.name ?? '未知UP主',
    },
    attr: m.attr,
  };
}

/** B 站 dash 字段在某些 case 下是 snake_case，做下兼容 */
export function normalizeAudio(a: BiliDashAudio) {
  return {
    id: a.id,
    bandwidth: a.bandwidth,
    mimeType: a.mimeType || a.mime_type || 'audio/mp4',
    baseUrl: a.baseUrl || a.base_url || '',
    backupUrl: a.backupUrl || a.backup_url || [],
  };
}
