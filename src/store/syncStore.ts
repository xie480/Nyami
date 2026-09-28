import { create } from 'zustand';
import { ensureGlobalIndexCacheLoaded, favoriteService } from '../services/favoriteService';
import type { SyncProgressEvent } from '../services/favoriteService';
import {
  addFavoriteVideosToTagBackfill,
  resumeFavoriteTagsBackfill,
} from '../services/tagRecommendationService';
import {useImportedPlaylistStore} from './importedPlaylistStore';

// Active sync controller; identity checks prevent an older run from clearing a newer run.
let syncAbortController: AbortController | null = null;

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
      return;
    }

    // Setup abort controller (no hard timeout to allow long-running sync)
    const controller = new AbortController();
    syncAbortController = controller;
    const abortSignal = controller.signal;
    set({ syncStatus: 'syncing', progressData: null, syncError: null });
    try {
      await ensureGlobalIndexCacheLoaded();
      if (abortSignal.aborted) return;

      const visibleSourceKeys =
        useImportedPlaylistStore.getState().visibleSourceKeysByUid[uid] ?? [];
      resumeFavoriteTagsBackfill(
        uid,
        favoriteService.getGlobalIndex(hiddenFolderIds, visibleSourceKeys),
      );

      // 异步执行同步任务，不阻塞 UI，传入 hiddenFolderIds 过滤隐藏的收藏夹
      await favoriteService.syncGlobalIndex(uid, hiddenFolderIds, force, (event) => {
        set({ progressData: event });
      }, abortSignal, videos => {
        addFavoriteVideosToTagBackfill(uid, videos);
      });
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
      if (syncAbortController === controller) {
        syncAbortController = null;
      }
    }
  },
  abortSync: () => {
    // Abort any ongoing sync operation and reset state
    if (syncAbortController) {
      syncAbortController.abort();
    }
    syncAbortController = null;
    set({ syncStatus: 'idle', progressData: null, syncError: null });
  },
  resetSyncState: () => set({ syncStatus: 'idle', progressData: null, syncError: null }),
}));
