import {randomUUID} from 'node:crypto';
import type {
  FavoriteVideo,
  VideoPart,
} from '../../../packages/core/src';
import type {
  FavoritePlaylistMeta,
  FavoriteRepository,
  FavoriteSyncPageResult,
} from '../../../packages/core/src/favorites/contracts';
import type {AppLogger} from '../logging/appLogger';
import {SqliteDatabase, type SqliteValue} from './sqliteDatabase';

type PlaylistMetaInput = {
  playlistId: string;
  title: string;
  remoteVideoCount: number;
  playlistSyncStatus?: FavoritePlaylistMeta['playlistSyncStatus'];
  needResync?: boolean;
  kind?: 'owned' | 'collectedFavorite' | 'subscribedSeason';
  ownerMid?: number;
  ownerName?: string;
  cover?: string;
  description?: string;
  remoteRevision?: string | null;
};

type PlaylistRow = {
  uid: string;
  playlist_id: string;
  title: string;
  kind: string;
  remote_video_count: number;
  local_synced_count: number;
  sync_cursor: string | null;
  sync_status: string;
  need_resync: number;
  owner_mid: number;
  owner_name: string;
  cover: string;
  description: string;
  remote_revision: string | null;
  updated_at: number;
};

type VideoRow = {
  uid: string;
  playlist_id: string;
  video_id: string;
  aid: number | null;
  title: string;
  author_id: number;
  author: string;
  cover: string;
  duration: number;
  publish_time: number;
  fav_time: number;
  page: number;
  attr: number;
  folder_ids_json: string;
  source_keys_json: string;
  parts_json: string;
  random_weight: number;
  is_cached: number;
  is_deleted: number;
  synced_at: number;
  updated_at: number;
};

type FavoriteSearchResult = {
  items: FavoriteVideo[];
  total: number;
};

const SYNC_STATUS_VALUES = new Set<FavoritePlaylistMeta['playlistSyncStatus']>([
  'idle',
  'syncing',
  'success',
  'failed',
  'running',
]);

/**
 * 桌面端收藏和全局索引仓储。
 * 该类实现共享核心的 FavoriteRepository，并把账号 UID 作为每张表的隔离边界。
 */
export class DesktopLibraryRepository implements FavoriteRepository {
  private activeUid: string | null = null;

  /**
   * 创建仓储并绑定主进程 SQLite 连接。
   * @param database 已完成迁移的 SQLite 数据库
   * @param logger 脱敏日志器
   */
  constructor(
    private readonly database: SqliteDatabase,
    private readonly logger: AppLogger,
  ) {}

  /** 切换当前账号，并清理数据库中其它账号的业务数据。 */
  switchAccount(uid: string): void {
    const normalizedUid = normalizeUid(uid);
    if (!normalizedUid) {
      throw new Error('同步账号 UID 无效');
    }
    this.database.transaction(() => {
      const existingUids = this.database.all<{uid: string}>(
        'SELECT uid FROM account_state WHERE uid <> ?',
        [normalizedUid],
      );
      for (const row of existingUids) {
        this.deleteAccountRows(row.uid);
      }
      this.database.run(
        `INSERT INTO account_state (uid, updated_at)
         VALUES (?, ?)
         ON CONFLICT(uid) DO UPDATE SET updated_at = excluded.updated_at`,
        [normalizedUid, Date.now()],
      );
    });
    this.activeUid = normalizedUid;
  }

  /** 清理一个账号的收藏索引和同步任务。 */
  clearAccount(uid = this.activeUid): void {
    const normalizedUid = normalizeUid(uid ?? '');
    if (!normalizedUid) {
      return;
    }
    this.database.transaction(() => {
      this.deleteAccountRows(normalizedUid);
    });
    if (this.activeUid === normalizedUid) {
      this.activeUid = null;
    }
  }

  /** 清空桌面端所有账号业务数据，供退出登录和损坏恢复使用。 */
  clearAll(): void {
    this.database.transaction(() => {
      this.database.run('DELETE FROM playlist_meta');
      this.database.run('DELETE FROM video_meta');
      this.database.run('DELETE FROM sync_job');
      this.database.run('DELETE FROM account_state');
    });
    this.activeUid = null;
  }

  /** 读取一个收藏来源的断点元数据。 */
  async getPlaylistMeta(
    playlistId: string,
  ): Promise<FavoritePlaylistMeta | null> {
    const row = this.database.get<PlaylistRow>(
      `SELECT * FROM playlist_meta WHERE uid = ? AND playlist_id = ?`,
      [this.requireUid(), playlistId],
    );
    if (!row) {
      return null;
    }
    return {
      playlistId: row.playlist_id,
      title: row.title,
      remoteVideoCount: row.remote_video_count,
      localSyncedCount: row.local_synced_count,
      syncCursor: row.sync_cursor,
      playlistSyncStatus: normalizeSyncStatus(row.sync_status),
      needResync: row.need_resync === 1,
    };
  }

  /** 写入收藏来源描述和同步状态，同时保留已有断点与本地计数。 */
  async upsertPlaylistMeta(data: PlaylistMetaInput): Promise<void> {
    const uid = this.requireUid();
    const now = Date.now();
    this.database.run(
      `INSERT INTO playlist_meta (
        uid, playlist_id, title, kind, remote_video_count,
        local_synced_count, sync_cursor, sync_status, need_resync,
        owner_mid, owner_name, cover, description, remote_revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid, playlist_id) DO UPDATE SET
        title = excluded.title,
        kind = excluded.kind,
        remote_video_count = excluded.remote_video_count,
        sync_status = excluded.sync_status,
        need_resync = excluded.need_resync,
        owner_mid = excluded.owner_mid,
        owner_name = excluded.owner_name,
        cover = excluded.cover,
        description = excluded.description,
        remote_revision = excluded.remote_revision,
        updated_at = excluded.updated_at`,
      [
        uid,
        data.playlistId,
        data.title.trim(),
        data.kind ?? inferPlaylistKind(data.playlistId),
        Math.max(0, Math.floor(data.remoteVideoCount)),
        normalizeSyncStatus(data.playlistSyncStatus ?? 'idle'),
        data.needResync === true ? 1 : 0,
        data.ownerMid ?? 0,
        data.ownerName ?? '',
        data.cover ?? '',
        data.description ?? '',
        data.remoteRevision ?? null,
        now,
      ],
    );
  }

  /** 创建一个可追踪的同步任务记录。 */
  async createSyncJob(
    playlistId: string,
    snapshotRevision: string | null,
  ): Promise<string> {
    const jobId = `sync-job-${randomUUID()}`;
    const now = Date.now();
    this.database.run(
      `INSERT INTO sync_job (
        job_id, uid, playlist_id, status, cursor_start,
        cursor_end, snapshot_revision, synced_count, started_at
      ) VALUES (?, ?, ?, 'running', NULL, NULL, ?, 0, ?)`,
      [jobId, this.requireUid(), playlistId, snapshotRevision, now],
    );
    return jobId;
  }

  /** 在一个事务内写入一页视频、更新游标和本地计数。 */
  async syncPlaylistVideosPage(
    playlistId: string,
    videos: FavoriteVideo[],
    options: {
      force: boolean;
      cursor: string;
      previousSyncedCount: number;
      fullScanCount?: number;
    },
  ): Promise<FavoriteSyncPageResult> {
    const uid = this.requireUid();
    const uniqueVideos = Array.from(
      new Map(
        videos
          .filter(video => Boolean(video.bvid.trim()))
          .map(video => [video.bvid.trim(), video]),
      ).values(),
    );
    const existingRows = this.findVideoRows(uid, playlistId, uniqueVideos.map(video => video.bvid));
    const existingBvids = new Set(
      existingRows
        .filter(row => row.is_deleted === 0)
        .map(row => row.video_id),
    );
    const videosToUpsert = options.force
      ? uniqueVideos
      : uniqueVideos.filter(video => !existingBvids.has(video.bvid));
    const syncedCount =
      options.fullScanCount ??
      options.previousSyncedCount + videosToUpsert.length;
    const now = Date.now();

    this.database.transaction(() => {
      for (const video of videosToUpsert) {
        this.upsertVideo(uid, playlistId, video, now);
      }
      this.database.run(
        `UPDATE playlist_meta
         SET sync_cursor = ?, local_synced_count = ?, updated_at = ?
         WHERE uid = ? AND playlist_id = ?`,
        [options.cursor, syncedCount, now, uid, playlistId],
      );
      this.database.run(
        `UPDATE sync_job
         SET cursor_end = ?, synced_count = ?
         WHERE uid = ? AND playlist_id = ? AND status = 'running'`,
        [options.cursor, syncedCount, uid, playlistId],
      );
    });

    return {
      existingBvids,
      videosToUpsert,
      syncedCount,
    };
  }

  /** 更新同步任务状态，并保留有限长度的错误摘要。 */
  async finishSyncJob(
    jobId: string,
    status: 'success' | 'failed' | 'cancelled',
    failedReason?: string,
  ): Promise<void> {
    this.database.run(
      `UPDATE sync_job
       SET status = ?, failed_reason = ?, finished_at = ?
       WHERE job_id = ? AND uid = ?`,
      [
        status,
        failedReason ? failedReason.slice(0, 500) : null,
        Date.now(),
        jobId,
        this.requireUid(),
      ],
    );
  }

  /** 标记来源完成，清除断点使下次相同远端计数可以跳过。 */
  async markPlaylistSyncSuccess(playlistId: string): Promise<void> {
    const uid = this.requireUid();
    this.database.run(
      `UPDATE playlist_meta
       SET sync_status = 'success', sync_cursor = NULL,
           need_resync = 0, updated_at = ?
       WHERE uid = ? AND playlist_id = ?`,
      [Date.now(), uid, playlistId],
    );
    this.database.run(
      `UPDATE sync_job
       SET synced_count = COALESCE(
         (SELECT local_synced_count FROM playlist_meta
          WHERE uid = ? AND playlist_id = ?),
         synced_count
       )
       WHERE uid = ? AND playlist_id = ? AND status = 'running'`,
      [uid, playlistId, uid, playlistId],
    );
  }

  /** 全量扫描完成后软删除远端已经不存在的视频关系。 */
  async softDeleteMissingVideos(
    playlistId: string,
    remoteVideoIds: string[],
  ): Promise<void> {
    const uid = this.requireUid();
    const ids = Array.from(new Set(remoteVideoIds.filter(Boolean)));
    if (ids.length === 0) {
      this.database.run(
        `UPDATE video_meta SET is_deleted = 1, updated_at = ?
         WHERE uid = ? AND playlist_id = ?`,
        [Date.now(), uid, playlistId],
      );
      return;
    }
    const placeholders = ids.map(() => '?').join(', ');
    this.database.run(
      `UPDATE video_meta SET is_deleted = 1, updated_at = ?
       WHERE uid = ? AND playlist_id = ? AND video_id NOT IN (${placeholders})`,
      [Date.now(), uid, playlistId, ...ids],
    );
  }

  /** 读取当前账号所有有效收藏关系并合并为去重全局索引。 */
  async getGlobalIndex(uid = this.requireUid()): Promise<FavoriteVideo[]> {
    const normalizedUid = normalizeUid(uid);
    if (!normalizedUid) {
      return [];
    }
    const rows = this.database.all<VideoRow & {kind: string}>(
      `SELECT video_meta.*, playlist_meta.kind
       FROM video_meta
       INNER JOIN playlist_meta
         ON playlist_meta.uid = video_meta.uid
        AND playlist_meta.playlist_id = video_meta.playlist_id
       WHERE video_meta.uid = ?
         AND video_meta.is_deleted = 0
         AND playlist_meta.kind = 'owned'
       ORDER BY video_meta.fav_time DESC, video_meta.updated_at DESC`,
      [normalizedUid],
    );
    const merged = new Map<string, FavoriteVideo>();
    for (const row of rows) {
      const current = rowToFavoriteVideo(row);
      const previous = merged.get(current.bvid);
      if (!previous) {
        merged.set(current.bvid, current);
        continue;
      }
      previous.folderIds = Array.from(
        new Set([...(previous.folderIds ?? []), ...(current.folderIds ?? [])]),
      );
      previous.sourceKeys = Array.from(
        new Set([...(previous.sourceKeys ?? []), ...(current.sourceKeys ?? [])]),
      );
      previous.favTime = Math.max(previous.favTime, current.favTime);
      if (!previous.parts?.length && current.parts?.length) {
        previous.parts = current.parts;
      }
    }
    return Array.from(merged.values());
  }

  /** 在本地收藏关系中搜索标题、UP 主或收藏夹名称。 */
  searchFavorites(
    uid: string,
    keyword: string,
    page = 1,
    pageSize = 20,
  ): FavoriteSearchResult {
    const normalizedUid = normalizeUid(uid);
    const normalizedKeyword = keyword.trim();
    const normalizedPage = Math.max(1, Math.floor(page));
    const normalizedPageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
    if (!normalizedUid || !normalizedKeyword) {
      return {items: [], total: 0};
    }
    const pattern = `%${escapeLikePattern(normalizedKeyword)}%`;
    const params = [normalizedUid, pattern, pattern, pattern];
    const rows = this.database.all<VideoRow & {kind: string}>(
      `SELECT video_meta.*, playlist_meta.kind
       FROM video_meta
       INNER JOIN playlist_meta
         ON playlist_meta.uid = video_meta.uid
        AND playlist_meta.playlist_id = video_meta.playlist_id
       WHERE video_meta.uid = ?
         AND video_meta.is_deleted = 0
         AND playlist_meta.kind = 'owned'
         AND (
           video_meta.title LIKE ? ESCAPE '\\'
           OR video_meta.author LIKE ? ESCAPE '\\'
           OR playlist_meta.title LIKE ? ESCAPE '\\'
         )
       ORDER BY video_meta.fav_time DESC, video_meta.updated_at DESC`,
      params,
    );
    const merged = mergeFavoriteRows(rows);
    const offset = (normalizedPage - 1) * normalizedPageSize;
    return {
      items: merged.slice(offset, offset + normalizedPageSize),
      total: merged.length,
    };
  }

  /** 检查当前 UID 是否已经成功建立本地索引，用于自动同步门槛。 */
  hasAccountData(uid: string): boolean {
    const row = this.database.get<{count: number}>(
      `SELECT COUNT(*) AS count
       FROM playlist_meta
       WHERE uid = ? AND kind = 'owned' AND sync_status = 'success'`,
      [normalizeUid(uid)],
    );
    return (row?.count ?? 0) > 0;
  }

  /** 关闭仓储使用的数据库连接。 */
  close(): void {
    this.database.close();
  }

  /** 在数据库事务内删除账号所有业务表数据。 */
  private deleteAccountRows(uid: string): void {
    const tables = [
      'playlist_meta',
      'video_meta',
      'sync_job',
      'account_state',
    ];
    for (const table of tables) {
      this.database.run(`DELETE FROM ${table} WHERE uid = ?`, [uid]);
    }
  }

  /** 写入单个视频关系，保留下载缓存标志和稳定随机权重。 */
  private upsertVideo(
    uid: string,
    playlistId: string,
    video: FavoriteVideo,
    now: number,
  ): void {
    const kind = inferPlaylistKind(playlistId);
    const folderIds = video.folderIds ?? ownedFolderIds(playlistId);
    const sourceKeys =
      video.sourceKeys ?? (kind === 'owned' ? [] : [playlistId]);
    const parts = video.parts ?? [];
    this.database.run(
      `INSERT INTO video_meta (
        uid, playlist_id, video_id, aid, title, author_id, author, cover,
        duration, publish_time, fav_time, page, attr, folder_ids_json,
        source_keys_json, parts_json, random_weight, is_cached, is_deleted,
        synced_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
      ON CONFLICT(uid, playlist_id, video_id) DO UPDATE SET
        aid = excluded.aid,
        title = excluded.title,
        author_id = excluded.author_id,
        author = excluded.author,
        cover = excluded.cover,
        duration = excluded.duration,
        publish_time = excluded.publish_time,
        fav_time = excluded.fav_time,
        page = excluded.page,
        attr = excluded.attr,
        folder_ids_json = excluded.folder_ids_json,
        source_keys_json = excluded.source_keys_json,
        parts_json = excluded.parts_json,
        is_deleted = 0,
        synced_at = excluded.synced_at,
        updated_at = excluded.updated_at`,
      [
        uid,
        playlistId,
        video.bvid,
        video.aid ?? null,
        video.title,
        video.upper.mid,
        video.upper.name,
        video.cover,
        video.duration,
        video.pubtime,
        video.favTime,
        video.page,
        video.attr,
        JSON.stringify(folderIds),
        JSON.stringify(sourceKeys),
        JSON.stringify(parts),
        Math.random(),
        now,
        now,
      ],
    );
  }

  /** 查询指定关系中的已存在记录，避免为每页视频逐条查询数据库。 */
  private findVideoRows(
    uid: string,
    playlistId: string,
    videoIds: readonly string[],
  ): VideoRow[] {
    if (videoIds.length === 0) {
      return [];
    }
    const placeholders = videoIds.map(() => '?').join(', ');
    return this.database.all<VideoRow>(
      `SELECT * FROM video_meta
       WHERE uid = ? AND playlist_id = ? AND video_id IN (${placeholders})`,
      [uid, playlistId, ...videoIds],
    );
  }

  /** 获取已绑定账号，防止调用方把未绑定请求写入数据库。 */
  private requireUid(): string {
    if (!this.activeUid) {
      throw new Error('本地数据库尚未绑定 B 站账号');
    }
    return this.activeUid;
  }
}

/** 规范化账号 UID，拒绝超长或包含控制字符的值。 */
function normalizeUid(value: string): string {
  const normalized = value.trim();
  return /^[0-9]{1,32}$/.test(normalized) ? normalized : '';
}

/** 将未知同步状态收敛到共享核心允许的状态集合。 */
function normalizeSyncStatus(
  value: string,
): FavoritePlaylistMeta['playlistSyncStatus'] {
  return SYNC_STATUS_VALUES.has(value as FavoritePlaylistMeta['playlistSyncStatus'])
    ? (value as FavoritePlaylistMeta['playlistSyncStatus'])
    : 'idle';
}

/** 根据来源键推断同步对象类型。 */
function inferPlaylistKind(
  playlistId: string,
): 'owned' | 'collectedFavorite' | 'subscribedSeason' {
  if (playlistId.startsWith('subscribedSeason:')) {
    return 'subscribedSeason';
  }
  if (playlistId.startsWith('collectedFavorite:')) {
    return 'collectedFavorite';
  }
  return 'owned';
}

/** 从自有收藏夹来源键恢复数字 folderId。 */
function ownedFolderIds(playlistId: string): number[] {
  const match = playlistId.match(/^ownedFavorite:(\d+)$/);
  return match ? [Number(match[1])] : [];
}

/** 安全解析数组字段，损坏时返回空数组并记录到调用方日志之外。 */
function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

/** 转义 SQLite LIKE 通配符，避免本地搜索把用户输入当成模式。 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

/** 将同一 BVID 在多个收藏夹中的关系合并为一条本地搜索结果。 */
function mergeFavoriteRows(
  rows: Array<VideoRow & {kind: string}>,
): FavoriteVideo[] {
  const merged = new Map<string, FavoriteVideo>();
  for (const row of rows) {
    const current = rowToFavoriteVideo(row);
    const previous = merged.get(current.bvid);
    if (!previous) {
      merged.set(current.bvid, current);
      continue;
    }
    previous.folderIds = Array.from(
      new Set([...(previous.folderIds ?? []), ...(current.folderIds ?? [])]),
    );
    previous.sourceKeys = Array.from(
      new Set([...(previous.sourceKeys ?? []), ...(current.sourceKeys ?? [])]),
    );
    previous.favTime = Math.max(previous.favTime, current.favTime);
    if (!previous.parts?.length && current.parts?.length) {
      previous.parts = current.parts;
    }
  }
  return Array.from(merged.values());
}

/** 将数据库视频关系还原为共享 FavoriteVideo，并保留来源去重信息。 */
function rowToFavoriteVideo(
  row: VideoRow & {kind: string},
): FavoriteVideo {
  const sourceKeys = parseJsonArray<string>(row.source_keys_json);
  const folderIds = parseJsonArray<number>(row.folder_ids_json);
  if (row.kind !== 'owned' && !sourceKeys.includes(row.playlist_id)) {
    sourceKeys.push(row.playlist_id);
  }
  if (row.kind === 'owned' && folderIds.length === 0) {
    folderIds.push(...ownedFolderIds(row.playlist_id));
  }
  return {
    bvid: row.video_id,
    aid: row.aid ?? undefined,
    title: row.title,
    cover: row.cover,
    duration: row.duration,
    page: row.page,
    pubtime: row.publish_time,
    favTime: row.fav_time,
    upper: {
      mid: row.author_id,
      name: row.author,
    },
    attr: row.attr,
    folderIds,
    sourceKeys,
    parts: parseJsonArray<VideoPart>(row.parts_json),
  };
}

export type {
  FavoriteSearchResult,
};
