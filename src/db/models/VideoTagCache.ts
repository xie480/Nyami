import {Model} from '@nozbe/watermelondb';
import {field} from '@nozbe/watermelondb/decorators';

/**
 * 保存按 BVID 获取的视频公开 tag 快照与重试时间。
 * 画像在读取时通过当前本地收藏集合计算，不在此表保存用户偏好。
 */
export class VideoTagCache extends Model {
  static table = 'video_tag_cache';

  @field('video_id') videoId!: string;
  @field('tags_json') tagsJson!: string | null;
  @field('fetched_at') fetchedAt!: number | null;
  @field('retry_after') retryAfter!: number | null;
}
