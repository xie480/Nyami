import type {
  FavoritePlaylistMeta,
  FavoriteRepository,
} from '../../../packages/core/src/favorites/contracts';
import type {FavoriteVideo} from '../../../packages/core/src/types/domain';
import * as databaseOperations from '../../db/operations';

/**
 * WatermelonDB 收藏索引适配器。
 * 共享同步任务只依赖 FavoriteRepository，不直接导入 WatermelonDB 模型。
 */
export const mobileFavoriteRepository: FavoriteRepository = {
  /** 读取并转换本地收藏夹同步元数据。 */
  async getPlaylistMeta(playlistId: string) {
    const record = await databaseOperations.getPlaylistMeta(playlistId);
    if (!record) {
      return null;
    }
    return {
      playlistId: record.playlistId,
      title: record.title,
      remoteVideoCount: record.remoteVideoCount,
      localSyncedCount: record.localSyncedCount,
      syncCursor: record.syncCursor,
      playlistSyncStatus: normalizeSyncStatus(record.playlistSyncStatus),
      needResync: record.needResync,
    };
  },

  /** 写入收藏夹同步元数据。 */
  async upsertPlaylistMeta(data) {
    await databaseOperations.upsertPlaylistMeta(data);
  },

  /** 创建一个 WatermelonDB 同步任务记录。 */
  async createSyncJob(playlistId: string, snapshotRevision: string | null) {
    return databaseOperations.createSyncJob(playlistId, snapshotRevision);
  },

  /** 原子写入一页视频和游标。 */
  async syncPlaylistVideosPage(
    playlistId: string,
    videos: FavoriteVideo[],
    options,
  ) {
    return databaseOperations.syncPlaylistVideosPage(
      playlistId,
      videos,
      options,
    );
  },

  /** 更新同步任务结束状态。 */
  async finishSyncJob(jobId, status, failedReason) {
    await databaseOperations.finishSyncJob(jobId, status, failedReason);
  },

  /** 标记收藏夹同步成功。 */
  async markPlaylistSyncSuccess(playlistId: string) {
    await databaseOperations.markPlaylistSyncSuccess(playlistId);
  },

  /** 将远端不存在的视频软删除。 */
  async softDeleteMissingVideos(playlistId: string, remoteVideoIds: string[]) {
    await databaseOperations.softDeleteMissingVideos(
      playlistId,
      remoteVideoIds,
    );
  },
};

/** 将历史字符串状态收敛到共享契约允许的枚举。 */
function normalizeSyncStatus(
  value: string,
): FavoritePlaylistMeta['playlistSyncStatus'] {
  if (
    value === 'syncing' ||
    value === 'success' ||
    value === 'failed' ||
    value === 'running'
  ) {
    return value;
  }
  return 'idle';
}
