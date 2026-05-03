import { create } from 'zustand';
import { favoriteService } from '../services/favoriteService';
import type { SyncProgressEvent } from '../services/favoriteService';

// Internal abort controller and timeout for sync operations
let syncAbortController: AbortController | null = null;
let syncTimeoutId: NodeJS.Timeout | null = null;

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
    if (get().syncStatus === 'syncing') return;
    
    // Setup abort controller and global timeout (5 minutes)
    syncAbortController = new AbortController();
    const abortSignal = syncAbortController.signal;
    // 5 minutes timeout
    syncTimeoutId = setTimeout(() => {
      if (get().syncStatus === 'syncing') {
        syncAbortController?.abort();
        set({ syncStatus: 'error', syncError: '同步任务执行超时，已强制重置' });
      }
    }, 5 * 60 * 1000);
    
    set({ syncStatus: 'syncing', progressData: null, syncError: null });
    
    try {
      // 异步执行同步任务，不阻塞 UI，传入 hiddenFolderIds 过滤隐藏的收藏夹
      await favoriteService.syncGlobalIndex(uid, hiddenFolderIds, force, (event) => {
        set({ progressData: event });
      }, abortSignal);
      set({ syncStatus: 'done' });
      // 3秒后恢复 idle 状态
      setTimeout(() => {
        if (get().syncStatus === 'done') {
          set({ syncStatus: 'idle' });
        }
      }, 3000);
    } catch (e: any) {
      set({ syncStatus: 'error', syncError: e.message || '未知错误' });
    } finally {
      // Cleanup abort controller and timeout
      if (syncTimeoutId) {
        clearTimeout(syncTimeoutId);
        syncTimeoutId = null;
      }
      syncAbortController = null;
    }
  },
  abortSync: () => {
    // Abort any ongoing sync operation and reset state
    if (syncAbortController) {
      syncAbortController.abort();
    }
    if (syncTimeoutId) {
      clearTimeout(syncTimeoutId);
      syncTimeoutId = null;
    }
    syncAbortController = null;
    set({ syncStatus: 'idle', progressData: null, syncError: null });
  },
  resetSyncState: () => set({ syncStatus: 'idle', progressData: null, syncError: null }),
}));
