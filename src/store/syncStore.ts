import { create } from 'zustand';
import { favoriteService } from '../services/favoriteService';
import type { SyncProgressEvent } from '../services/favoriteService';
import {
  pauseFavoriteTagsBackfill,
  resumeFavoriteTagsBackfill,
} from '../services/tagRecommendationService';
import {useAuthStore} from './authStore';
import {useImportedPlaylistStore} from './importedPlaylistStore';
import {useSettingsStore} from './settingsStore';

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

    // 让索引请求优先使用 B 站全局限速窗口，标签快照仍会保留在本地缓存。
    pauseFavoriteTagsBackfill();
    // Setup abort controller (no hard timeout to allow long-running sync)
    const controller = new AbortController();
    syncAbortController = controller;
    const abortSignal = controller.signal;
    set({ syncStatus: 'syncing', progressData: null, syncError: null });
    let shouldBackfillTags = false;
    try {
      // 异步执行同步任务，不阻塞 UI，传入 hiddenFolderIds 过滤隐藏的收藏夹
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
      shouldBackfillTags = true;
    } catch (e: any) {
      if (!abortSignal.aborted) {
        set({ syncStatus: 'error', syncError: e.message || '未知错误' });
        shouldBackfillTags = (get().progressData?.completedTasks ?? 0) > 0;
      }
    } finally {
      if (syncAbortController === controller) {
        syncAbortController = null;
      }
      if (
        shouldBackfillTags &&
        !abortSignal.aborted &&
        useAuthStore.getState().userId === uid
      ) {
        const hiddenIds = useSettingsStore.getState().hiddenFolderIds;
        const visibleSourceKeys =
          useImportedPlaylistStore.getState().visibleSourceKeysByUid[uid] ?? [];
        const videos = favoriteService.getGlobalIndex(hiddenIds, visibleSourceKeys);
        resumeFavoriteTagsBackfill(uid, videos);
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
