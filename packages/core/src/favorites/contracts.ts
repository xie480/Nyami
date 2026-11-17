import type {BiliApi} from '../api/biliApi';
import type {FavoriteVideo, PageResult} from '../types/domain';
import type {FavoriteSyncTask} from './syncTask';

export type FavoritePlaylistMeta = {
  playlistId: string;
  title: string;
  remoteVideoCount: number;
  localSyncedCount: number;
  syncCursor: string | null;
  playlistSyncStatus: 'idle' | 'syncing' | 'success' | 'failed' | 'running';
  needResync: boolean;
};

export type FavoriteSyncPageResult = {
  existingBvids: Set<string>;
  videosToUpsert: FavoriteVideo[];
  syncedCount: number;
};

/** 收藏索引仓储，移动端和桌面端分别实现。 */
export interface FavoriteRepository {
  getPlaylistMeta(playlistId: string): Promise<FavoritePlaylistMeta | null>;
  upsertPlaylistMeta(data: {
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
  }): Promise<void>;
  createSyncJob(
    playlistId: string,
    snapshotRevision: string | null,
  ): Promise<string>;
  syncPlaylistVideosPage(
    playlistId: string,
    videos: FavoriteVideo[],
    options: {
      force: boolean;
      cursor: string;
      previousSyncedCount: number;
      fullScanCount?: number;
    },
  ): Promise<FavoriteSyncPageResult>;
  finishSyncJob(
    jobId: string,
    status: 'success' | 'failed' | 'cancelled',
    failedReason?: string,
  ): Promise<void>;
  markPlaylistSyncSuccess(playlistId: string): Promise<void>;
  softDeleteMissingVideos(
    playlistId: string,
    remoteVideoIds: string[],
  ): Promise<void>;
}

/** 一个远端收藏夹的同步目标。 */
export type FavoriteSyncTarget = {
  playlistId: string;
  title: string;
  remoteVideoCount: number;
  kind?: 'owned' | 'collectedFavorite' | 'subscribedSeason';
  ownerMid?: number;
  ownerName?: string;
  cover?: string;
  description?: string;
  remoteRevision?: string | null;
  fetchPage: (
    page: number,
    signal?: AbortSignal,
  ) => Promise<PageResult<FavoriteVideo>>;
};

export type FavoriteSyncProgress = {
  completedTasks: number;
  totalTasks: number;
  processedVideos: number;
  totalVideos: number;
  skippedTasks: number;
  failedTasks: number;
};

export type FavoriteSyncTaskOptions = {
  force?: boolean;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: FavoriteSyncProgress) => void;
};

export type FavoriteUseCasesDependencies = {
  api: BiliApi;
  repository: FavoriteRepository;
  syncTask: FavoriteSyncTask;
};
