import { appSchema, tableSchema } from '@nozbe/watermelondb';
import type {TableSchemaSpec} from '@nozbe/watermelondb/Schema';

const recommendationFilterUniqueIndexes = [
  'CREATE UNIQUE INDEX IF NOT EXISTS recommendation_filter_item_uq ON recommendation_filter (uid, item_type, item_id);',
  'CREATE UNIQUE INDEX IF NOT EXISTS recommendation_filter_title_uq ON recommendation_filter (uid, item_type, title_key);',
].join('');

export const recommendationFilterTableSpec: TableSchemaSpec = {
  name: 'recommendation_filter',
  columns: [
    { name: 'uid', type: 'string', isIndexed: true },
    { name: 'item_type', type: 'string', isIndexed: true },
    { name: 'item_id', type: 'string' },
    { name: 'title_key', type: 'string', isOptional: true },
    { name: 'expires_at', type: 'number', isIndexed: true },
  ],
  unsafeSql: sql => `${sql}${recommendationFilterUniqueIndexes}`,
};

const dropRecommendationFilterUniqueIndexes = [
  'DROP INDEX IF EXISTS recommendation_filter_item_uq;',
  'DROP INDEX IF EXISTS recommendation_filter_title_uq;',
].join('');

export const schema = appSchema({
  version: 5,
  unsafeSql: (sql, kind) => {
    if (kind === 'create_indices') return `${sql}${recommendationFilterUniqueIndexes}`;
    if (kind === 'drop_indices') return `${sql}${dropRecommendationFilterUniqueIndexes}`;
    return sql;
  },
  tables: [
    tableSchema({
      name: 'playlist_meta',
      columns: [
        { name: 'playlist_id', type: 'string', isIndexed: true },
        { name: 'title', type: 'string', isOptional: true },
        { name: 'remote_video_count', type: 'number' },
        { name: 'local_synced_count', type: 'number' },
        { name: 'sync_cursor', type: 'string', isOptional: true },
        { name: 'last_synced_video_id', type: 'string', isOptional: true },
        { name: 'remote_revision', type: 'string', isOptional: true },
        { name: 'playlist_sync_status', type: 'string' },
        { name: 'last_synced_at', type: 'number', isOptional: true },
        { name: 'need_resync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'video_meta',
      columns: [
        { name: 'video_id', type: 'string', isIndexed: true },
        { name: 'playlist_id', type: 'string', isIndexed: true },
        { name: 'title', type: 'string' },
        { name: 'author', type: 'string', isOptional: true },
        { name: 'cover', type: 'string', isOptional: true },
        { name: 'duration', type: 'number', isOptional: true },
        { name: 'publish_time', type: 'number', isOptional: true, isIndexed: true },
        { name: 'fav_time', type: 'number', isOptional: true, isIndexed: true },
        { name: 'random_weight', type: 'number', isOptional: true, isIndexed: true },
        { name: 'is_cached', type: 'boolean' },
        { name: 'is_deleted', type: 'boolean', isIndexed: true },
        { name: 'extra_json', type: 'string', isOptional: true },
        { name: 'synced_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'sync_job',
      columns: [
        { name: 'job_id', type: 'string', isIndexed: true },
        { name: 'playlist_id', type: 'string', isIndexed: true },
        { name: 'status', type: 'string' },
        { name: 'cursor_start', type: 'string', isOptional: true },
        { name: 'cursor_end', type: 'string', isOptional: true },
        { name: 'snapshot_revision', type: 'string', isOptional: true },
        { name: 'synced_count', type: 'number' },
        { name: 'failed_reason', type: 'string', isOptional: true },
        { name: 'started_at', type: 'number' },
        { name: 'finished_at', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'video_tag_cache',
      columns: [
        { name: 'video_id', type: 'string', isIndexed: true },
        { name: 'tags_json', type: 'string', isOptional: true },
        { name: 'fetched_at', type: 'number', isOptional: true },
        { name: 'retry_after', type: 'number', isOptional: true },
      ],
    }),
    tableSchema(recommendationFilterTableSpec),
  ],
});
