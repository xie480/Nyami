import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import LoggerService from '../services/LoggerService';

import { schema } from './schema';
import migrations from './migrations';
import { PlaylistMeta } from './models/PlaylistMeta';
import { VideoMeta } from './models/VideoMeta';
import { SyncJob } from './models/SyncJob';
import { VideoTagCache } from './models/VideoTagCache';
import {RecommendationFilter} from './models/RecommendationFilter';

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  // jsi: true, // 可选启用 JSI 加速，需安装 react-native-quick-sqlite
  onSetUpError: (error) => {
    LoggerService.error('DB', 'database', 'Setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [PlaylistMeta, VideoMeta, SyncJob, VideoTagCache, RecommendationFilter],
});

export const playlistMetaCollection = database.get<PlaylistMeta>('playlist_meta');
export const videoMetaCollection = database.get<VideoMeta>('video_meta');
export const syncJobCollection = database.get<SyncJob>('sync_job');
export const videoTagCacheCollection = database.get<VideoTagCache>('video_tag_cache');
export const recommendationFilterCollection = database.get<RecommendationFilter>('recommendation_filter');
