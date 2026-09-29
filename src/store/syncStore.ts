import { create } from 'zustand';
import { ensureGlobalIndexCacheLoaded, favoriteService } from '../services/favoriteService';
import type { SyncProgressEvent } from '../services/favoriteService';
import {
  pauseFavoriteTagsBackfill,
  resumeFavoriteTagsBackfill,
} from '../services/tagRecommendationService';
import {useAuthStore} from './authStore';
import {useImportedPlaylistStore} from './importedPlaylistStore';
import {storage} from '../core/storage';

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

interface PendingIndexSyncRetry {
  uid: string;
  revision: number;
  hiddenFolderIds: number[];
  attempts: number;
  nextAttemptAt: number;
}

const INDEX_SYNC_RETRY_PREFIX = 'pendingGlobalIndexSyncRetry:';
const indexSyncRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const indexSyncRetryWorkers = new Map<string, Promise<void>>();

function waitForActiveIndexSync(): Promise<void> {
  if (useSyncStore.getState().syncStatus !== 'syncing') return Promise.resolve();
  return new Promise(resolve => {
    let unsubscribe = () => {};
    const check = () => {
      if (useSyncStore.getState().syncStatus !== 'syncing') {
        unsubscribe();
        resolve();
      }
    };
    unsubscribe = useSyncStore.subscribe(check);
    check();
  });
}

async function waitForIndexSyncQueueToSettle(uid: string): Promise<boolean> {
  while (useSyncStore.getState().syncStatus === 'syncing') {
    await waitForActiveIndexSync();
    if (useAuthStore.getState().userId !== uid) return false;
  }
  return useAuthStore.getState().userId === uid;
}

function readPendingIndexSyncRetry(uid: string): PendingIndexSyncRetry | null {
  return storage.getJSON<PendingIndexSyncRetry>(`${INDEX_SYNC_RETRY_PREFIX}${uid}`);
}

function scheduleIndexSyncRetry(uid: string, retryAt: number): void {
  const oldTimer = indexSyncRetryTimers.get(uid);
  if (oldTimer) clearTimeout(oldTimer);
  const timer = setTimeout(() => {
    indexSyncRetryTimers.delete(uid);
    void resumePendingIndexSyncRetry(uid);
  }, Math.max(500, retryAt - Date.now()));
  indexSyncRetryTimers.set(uid, timer);
}

/** 立即启动本地优先的索引同步；错误会以账号隔离状态持久化并退避重试。 */
export function queueIndexSyncWithRetry(uid: string, hiddenFolderIds: number[]): void {
  if (!uid) return;
  const key = `${INDEX_SYNC_RETRY_PREFIX}${uid}`;
  const previous = readPendingIndexSyncRetry(uid);
  storage.setJSON(key, {
    uid,
    revision: (previous?.revision ?? 0) + 1,
    hiddenFolderIds: [...hiddenFolderIds],
    attempts: previous?.attempts ?? 0,
    nextAttemptAt: Date.now(),
  } satisfies PendingIndexSyncRetry);
  void resumePendingIndexSyncRetry(uid);
}

/** 登录恢复时继续处理上次中断或失败的本地索引同步意图。 */
export function resumePendingIndexSyncRetry(uid: string): Promise<void> {
  if (!uid || useAuthStore.getState().userId !== uid) return Promise.resolve();
  const active = indexSyncRetryWorkers.get(uid);
  if (active) return active;
  const timer = indexSyncRetryTimers.get(uid);
  if (timer) {
    clearTimeout(timer);
    indexSyncRetryTimers.delete(uid);
  }

  let worker: Promise<void>;
  worker = (async () => {
    const pending = readPendingIndexSyncRetry(uid);
    if (!pending) return;
    if (pending.nextAttemptAt > Date.now()) {
      scheduleIndexSyncRetry(uid, pending.nextAttemptAt);
      return;
    }
    if (useAuthStore.getState().userId !== uid) return;
    if (!await waitForIndexSyncQueueToSettle(uid)) return;
    await useSyncStore.getState().startSync(uid, pending.hiddenFolderIds, false);
    if (useSyncStore.getState().syncStatus === 'syncing') {
      if (!await waitForIndexSyncQueueToSettle(uid)) return;
    }
    const status = useSyncStore.getState().syncStatus;
    if (status === 'done') {
      const latest = readPendingIndexSyncRetry(uid);
      if (latest?.revision === pending.revision) {
        storage.delete(`${INDEX_SYNC_RETRY_PREFIX}${uid}`);
      } else {
        scheduleIndexSyncRetry(uid, Date.now());
      }
      return;
    }

    const latest = readPendingIndexSyncRetry(uid);
    if (!latest) return;
    if (latest.revision !== pending.revision) {
      scheduleIndexSyncRetry(uid, Date.now());
      return;
    }
    const attempts = latest.attempts + 1;
    const retryAt = Date.now() + Math.min(5_000 * Math.pow(2, attempts - 1), 60 * 60 * 1000);
    storage.setJSON(`${INDEX_SYNC_RETRY_PREFIX}${uid}`, {
      ...latest,
      attempts,
      nextAttemptAt: retryAt,
    } satisfies PendingIndexSyncRetry);
    scheduleIndexSyncRetry(uid, retryAt);
  })().finally(() => {
    if (indexSyncRetryWorkers.get(uid) === worker) indexSyncRetryWorkers.delete(uid);
  });
  indexSyncRetryWorkers.set(uid, worker);
  return worker;
}
