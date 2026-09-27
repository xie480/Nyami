import type {
  BiliFolder,
  BiliFavoriteVideoMedia,
  BiliVideoSearchItem,
  BiliDashAudio,
} from '../types/bili';
import type {
  FavoriteFolder,
  FavoriteVideo,
  OnlineVideoSearchResult,
} from '../types/domain';

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
    favTime: m.fav_time,
    upper: {
      mid: m.upper?.mid ?? 0,
      name: m.upper?.name ?? '未知UP主',
    },
    attr: m.attr,
  };
}

function parseSearchDuration(duration: string): number {
  const parts = duration.split(':').map(value => Number(value));
  if (
    parts.length < 2 ||
    parts.some(value => !Number.isFinite(value) || value < 0)
  ) {
    return 0;
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

export function trimSearchVideo(
  video: BiliVideoSearchItem,
): OnlineVideoSearchResult {
  const cover = video.pic || '';
  return {
    aid: video.aid,
    bvid: video.bvid,
    title: (video.title || '').replace(/<[^>]*>/g, ''),
    cover: cover.startsWith('//') ? `https:${cover}` : cover,
    duration: parseSearchDuration(video.duration || ''),
    pubtime: video.pubdate ?? 0,
    authorId: video.mid ?? 0,
    author: video.author || '未知UP主',
    tags: (video.tag || '')
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean),
  };
}

export function matchesOnlineVideoSearch(
  video: OnlineVideoSearchResult,
  keyword: string,
  field: 'title' | 'tag',
): boolean {
  const normalized = keyword.trim().toLocaleLowerCase();
  if (!normalized) {
    return true;
  }
  if (field === 'title') {
    return video.title.toLocaleLowerCase().includes(normalized);
  }
  return video.tags.some(tag => tag.toLocaleLowerCase().includes(normalized));
}

export function searchVideoToFavoriteVideo(
  video: OnlineVideoSearchResult,
): FavoriteVideo {
  return {
    bvid: video.bvid,
    title: video.title,
    cover: video.cover,
    duration: video.duration,
    page: 1,
    pubtime: video.pubtime,
    favTime: Math.floor(Date.now() / 1000),
    upper: {mid: video.authorId, name: video.author},
    attr: 0,
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
