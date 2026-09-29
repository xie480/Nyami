import { create } from 'zustand';
import { ensureGlobalIndexCacheLoaded, favoriteService } from '../services/favoriteService';
import type { SyncProgressEvent } from '../services/favoriteService';
import {
  pauseFavoriteTagsBackfill,
  resumeFavoriteTagsBackfill,
} from '../services/tagRecommendationService';
import {useAuthStore} from './authStore';
import {useImportedPlaylistStore} from './importedPlaylistStore';

// Active sync controller; identity checks prevent an older run from clearing a newer run.
let syncAbortController: AbortController | null = null;

interface QueuedSyncRequest {
  uid: string;
  hiddenFolderIds: number[];
  force: boolean;
}

let pendingSyncRequest: QueuedSyncRequest | null = null;

interface SyncState {
  syncStatus: 'idle' | 'syncing' | 'error' | 'done';
  progressData: SyncProgressEvent | null;
  syncError: string | null;
  startSync: (uid: string, hiddenFolderIds?: number[], force?: boolean) => Promise<void>;
  abortSync: () => void;
  resetSyncState: () => void;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  syncStatus: 'idle',
  progressData: null,
  syncError: null,
  startSync: async (uid: string, hiddenFolderIds: number[] = [], force = false) => {
    if (get().syncStatus === 'syncing') {
      const nextRequest = {uid, hiddenFolderIds: [...hiddenFolderIds], force};
      if (pendingSyncRequest?.uid === uid) {
        pendingSyncRequest = {
          ...nextRequest,
          force: pendingSyncRequest.force || force,
        };
      } else {
        pendingSyncRequest = nextRequest;
      }
      return;
    }

    // Setup abort controller (no hard timeout to allow long-running sync)
    const controller = new AbortController();
    syncAbortController = controller;
    const abortSignal = controller.signal;
    set({ syncStatus: 'syncing', progressData: null, syncError: null });
    try {
      await pauseFavoriteTagsBackfill();
      if (abortSignal.aborted) {
        return;
      }
      await ensureGlobalIndexCacheLoaded();
      if (abortSignal.aborted) {
        return;
      }

      // 先完成索引同步，避免后台标签回填与索引请求和数据库写入争用。
      await favoriteService.syncGlobalIndex(uid, hiddenFolderIds, force, (event) => {
        set({ progressData: event });
      }, abortSignal);
      if (abortSignal.aborted) {
        if (syncAbortController === controller && get().syncStatus === 'syncing') {
          set({ syncStatus: 'idle', progressData: null, syncError: null });
        }
        return;
      }
      set({ syncStatus: 'done' });
    } catch (e: any) {
      if (!abortSignal.aborted) {
        set({ syncStatus: 'error', syncError: e.message || '未知错误' });
      }
    } finally {
      let queuedRequest: QueuedSyncRequest | null = null;
      if (syncAbortController === controller) {
        syncAbortController = null;
        queuedRequest = pendingSyncRequest;
        pendingSyncRequest = null;
      }
      if (queuedRequest && !abortSignal.aborted) {
        await get().startSync(
          queuedRequest.uid,
          queuedRequest.hiddenFolderIds,
          queuedRequest.force,
        );
        return;
      }
      if (
        syncAbortController === null &&
        get().syncStatus !== 'syncing' &&
        useAuthStore.getState().userId === uid
      ) {
        const visibleSourceKeys =
          useImportedPlaylistStore.getState().visibleSourceKeysByUid[uid] ?? [];
        resumeFavoriteTagsBackfill(
          uid,
          favoriteService.getGlobalIndexYielding(hiddenFolderIds, visibleSourceKeys),
        );
      }
    }
  },
  abortSync: () => {
    // Abort any ongoing sync operation and reset state
    pendingSyncRequest = null;
    if (syncAbortController) {
      syncAbortController.abort();
    }
    syncAbortController = null;
    set({ syncStatus: 'idle', progressData: null, syncError: null });
  },
  resetSyncState: () => set({ syncStatus: 'idle', progressData: null, syncError: null }),
}));
