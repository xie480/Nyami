import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type {AppLogger} from '../logging/appLogger';

/** SQLite 绑定参数的有限集合，所有业务值都通过参数绑定写入数据库。 */
export type SqliteValue = string | number | bigint | Uint8Array | null;

type Migration = {
  version: number;
  sql: string;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS playlist_meta (
        uid TEXT NOT NULL,
        playlist_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'owned',
        remote_video_count INTEGER NOT NULL DEFAULT 0,
        local_synced_count INTEGER NOT NULL DEFAULT 0,
        sync_cursor TEXT,
        sync_status TEXT NOT NULL DEFAULT 'idle',
        need_resync INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (uid, playlist_id)
      );
      CREATE TABLE IF NOT EXISTS video_meta (
        uid TEXT NOT NULL,
        playlist_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        aid INTEGER,
        title TEXT NOT NULL,
        author_id INTEGER NOT NULL DEFAULT 0,
        author TEXT NOT NULL DEFAULT '',
        cover TEXT NOT NULL DEFAULT '',
        duration REAL NOT NULL DEFAULT 0,
        publish_time INTEGER NOT NULL DEFAULT 0,
        fav_time INTEGER NOT NULL DEFAULT 0,
        page INTEGER NOT NULL DEFAULT 1,
        attr INTEGER NOT NULL DEFAULT 0,
        folder_ids_json TEXT NOT NULL DEFAULT '[]',
        source_keys_json TEXT NOT NULL DEFAULT '[]',
        parts_json TEXT NOT NULL DEFAULT '[]',
        random_weight REAL NOT NULL DEFAULT 0,
        is_cached INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        synced_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (uid, playlist_id, video_id)
      );
      CREATE TABLE IF NOT EXISTS sync_job (
        job_id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        playlist_id TEXT NOT NULL,
        status TEXT NOT NULL,
        cursor_start TEXT,
        cursor_end TEXT,
        snapshot_revision TEXT,
        synced_count INTEGER NOT NULL DEFAULT 0,
        failed_reason TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS video_tag_cache (
        uid TEXT NOT NULL,
        video_id TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        fetched_at INTEGER,
        retry_after INTEGER,
        PRIMARY KEY (uid, video_id)
      );
      CREATE TABLE IF NOT EXISTS recommendation_filter (
        uid TEXT NOT NULL,
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        title_key TEXT,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (uid, item_type, item_id)
      );
      CREATE TABLE IF NOT EXISTS account_state (
        uid TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS video_meta_active_idx
        ON video_meta (uid, is_deleted, video_id);
      CREATE INDEX IF NOT EXISTS video_meta_playlist_idx
        ON video_meta (uid, playlist_id, is_deleted);
      CREATE INDEX IF NOT EXISTS sync_job_uid_idx
        ON sync_job (uid, started_at);
      CREATE INDEX IF NOT EXISTS recommendation_filter_expiry_idx
        ON recommendation_filter (uid, expires_at);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE playlist_meta ADD COLUMN owner_mid INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE playlist_meta ADD COLUMN owner_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE playlist_meta ADD COLUMN cover TEXT NOT NULL DEFAULT '';
      ALTER TABLE playlist_meta ADD COLUMN description TEXT NOT NULL DEFAULT '';
      ALTER TABLE playlist_meta ADD COLUMN remote_revision TEXT;
      CREATE INDEX IF NOT EXISTS playlist_meta_kind_idx
        ON playlist_meta (uid, kind, updated_at);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS recommendation_filter_title_idx
        ON recommendation_filter (uid, item_type, title_key)
        WHERE title_key IS NOT NULL AND title_key <> '';
    `,
  },
];

/**
 * 桌面端 SQLite 连接与迁移边界。
 * 主进程独占该对象，所有 DDL 和批量写入都在这里使用事务执行。
 */
export class SqliteDatabase {
  private readonly database: DatabaseSync;

  private closed = false;

  /**
   * 打开数据库并执行尚未应用的前向迁移。
   * @param filePath 数据库绝对路径
   * @param logger 可选日志适配器，用于记录迁移失败
   */
  constructor(
    private readonly filePath: string,
    private readonly logger?: AppLogger,
  ) {
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    this.database = new DatabaseSync(filePath, {
      timeout: 5000,
      enableForeignKeyConstraints: true,
    });
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  /** 执行一条不返回结果集的参数化 SQL。 */
  run(
    sql: string,
    parameters: readonly SqliteValue[] = [],
  ): void {
    this.assertOpen();
    this.database.prepare(sql).run(...parameters);
  }

  /** 读取单行记录，调用方负责把结果收窄为业务类型。 */
  get<T>(
    sql: string,
    parameters: readonly SqliteValue[] = [],
  ): T | undefined {
    this.assertOpen();
    return this.database.prepare(sql).get(...parameters) as T | undefined;
  }

  /** 读取多行记录，调用方负责把结果收窄为业务类型。 */
  all<T>(
    sql: string,
    parameters: readonly SqliteValue[] = [],
  ): T[] {
    this.assertOpen();
    return this.database.prepare(sql).all(...parameters) as T[];
  }

  /** 执行同步事务，异常时回滚并把原始异常继续抛出。 */
  transaction<T>(work: () => T): T {
    this.assertOpen();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const result = work();
      this.database.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK;');
      } catch (rollbackError) {
        this.logger?.error('database.rollback-failed', {
          error: rollbackError,
        });
      }
      throw error;
    }
  }

  /** 关闭数据库连接，避免窗口销毁后仍持有文件锁。 */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.database.close();
  }

  /** 返回当前数据库文件路径，供日志和诊断展示。 */
  getPath(): string {
    return this.filePath;
  }

  /** 逐个应用不可变迁移，只有整条迁移成功才更新 user_version。 */
  private migrate(): void {
    const currentVersion = this.get<{user_version: number}>(
      'PRAGMA user_version',
    )?.user_version ?? 0;
    let version = currentVersion;
    for (const migration of MIGRATIONS) {
      if (migration.version <= version) {
        continue;
      }
      this.database.exec('BEGIN IMMEDIATE;');
      try {
        this.database.exec(migration.sql);
        this.database.exec(`PRAGMA user_version = ${migration.version};`);
        this.database.exec('COMMIT;');
        version = migration.version;
      } catch (error) {
        try {
          this.database.exec('ROLLBACK;');
        } catch (rollbackError) {
          this.logger?.error('database.migration-rollback-failed', {
            version: migration.version,
            error: rollbackError,
          });
        }
        this.logger?.error('database.migration-failed', {
          version: migration.version,
          error,
        });
        throw error;
      }
    }
  }

  /** 防止窗口关闭后继续使用已经释放的连接。 */
  private assertOpen(): void {
    if (this.closed) {
      throw new Error('SQLite 数据库连接已关闭');
    }
  }
}
