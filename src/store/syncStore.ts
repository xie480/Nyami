import { create } from 'zustand';
import { favoriteService } from '../services/favoriteService';
import type { SyncProgressEvent } from '../services/favoriteService';

interface SyncState {
  syncStatus: 'idle' | 'syncing' | 'error' | 'done';
  progressData: SyncProgressEvent | null;
  syncError: string | null;
  startSync: (uid: string, hiddenFolderIds?: number[], force?: boolean) => Promise<void>;
  resetSyncState: () => void;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  syncStatus: 'idle',
  progressData: null,
  syncError: null,
  startSync: async (uid: string, hiddenFolderIds: number[] = [], force = false) => {
    if (get().syncStatus === 'syncing') return;
    
    set({ syncStatus: 'syncing', progressData: null, syncError: null });
    
    try {
      // 异步执行同步任务，不阻塞 UI，传入 hiddenFolderIds 过滤隐藏的收藏夹
      await favoriteService.syncGlobalIndex(uid, hiddenFolderIds, force, (event) => {
        set({ progressData: event });
      });
      set({ syncStatus: 'done' });
      // 3秒后恢复 idle 状态
      setTimeout(() => {
        if (get().syncStatus === 'done') {
          set({ syncStatus: 'idle' });
        }
      }, 3000);
    } catch (e: any) {
      set({ syncStatus: 'error', syncError: e.message || '未知错误' });
    }
  },
  resetSyncState: () => set({ syncStatus: 'idle', progressData: null, syncError: null }),
}));
