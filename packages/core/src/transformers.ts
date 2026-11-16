import type {
  BiliDashAudio,
  BiliFavoriteVideoMedia,
  BiliFolder,
  BiliVideoSearchItem,
  BiliVideoTag,
} from './types/bili';
import type {
  FavoriteFolder,
  FavoriteVideo,
  OnlineVideoSearchResult,
  VideoTag,
} from './types/domain';

/** 将 Bilibili 收藏夹响应转换为共享领域模型。 */
export function trimFolder(folder: BiliFolder): FavoriteFolder {
  return {
    id: folder.id,
    fid: folder.fid,
    mid: folder.mid,
    title: folder.title,
    mediaCount: folder.media_count,
  };
}

/** 将 Bilibili 收藏视频响应转换为共享领域模型。 */
export function trimFavoriteVideo(
  media: BiliFavoriteVideoMedia,
): FavoriteVideo {
  return {
    bvid: media.bvid,
    aid: media.aid,
    title: media.title,
    cover: media.cover,
    duration: media.duration,
    page: media.page,
    pubtime: media.pubtime,
    favTime: media.fav_time,
    upper: {
      mid: media.upper?.mid ?? 0,
      name: media.upper?.name ?? '未知UP主',
    },
    attr: media.attr,
  };
}

/** 解析 Bilibili 搜索返回的时长文本。 */
export function parseSearchDuration(duration: string): number {
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

/** 将搜索结果规范化为共享在线视频模型。 */
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

/** 去重并规范化视频 tag。 */
export function trimVideoTags(tags: BiliVideoTag[]): VideoTag[] {
  const normalizedTags = new Map<string, VideoTag>();
  for (const tag of tags) {
    const tagName = typeof tag.tag_name === 'string' ? tag.tag_name.trim() : '';
    const tagId = Number(tag.tag_id);
    if (!tagName || !Number.isSafeInteger(tagId) || tagId < 0) {
      continue;
    }
    const key = `${tagId}:${tagName.toLocaleLowerCase()}`;
    if (!normalizedTags.has(key)) {
      normalizedTags.set(key, {tagId, tagName});
    }
  }
  return Array.from(normalizedTags.values());
}

/** 按标题或 tag 搜索在线视频。 */
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

/** 将在线搜索结果转换为播放器和收藏写入共用的视频模型。 */
export function searchVideoToFavoriteVideo(
  video: OnlineVideoSearchResult,
): FavoriteVideo {
  return {
    bvid: video.bvid,
    aid: video.aid,
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

/** 兼容 Bilibili DASH 音频字段的 camelCase 和 snake_case。 */
export function normalizeAudio(audio: BiliDashAudio) {
  return {
    id: audio.id,
    bandwidth: audio.bandwidth,
    mimeType: audio.mimeType || audio.mime_type || 'audio/mp4',
    baseUrl: audio.baseUrl || audio.base_url || '',
    backupUrl: audio.backupUrl || audio.backup_url || [],
  };
}
