import {netStatus} from './netStatus';
import {resumePendingBiliMutations} from './favoriteService';
import {retryInterruptedPlaybackAfterNetworkRecovery} from './trackPlayer';
import {resumePendingIndexSyncRetry} from '../store/syncStore';
import {useAuthStore} from '../store/authStore';

const RECOVERY_DEBOUNCE_MS = 800;
const recoveryListeners = new Set<(revision: number) => void | Promise<unknown>>();

let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryRunning = false;
let recoveryRequestedAgain = false;
let networkRecoveryRevision = 0;

function scheduleRecovery() {
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    void runRecovery();
  }, RECOVERY_DEBOUNCE_MS);
}

async function runRecovery() {
  if (!netStatus.isOnline) return;
  if (recoveryRunning) {
    recoveryRequestedAgain = true;
    return;
  }

  recoveryRunning = true;
  networkRecoveryRevision += 1;
  const currentRecoveryRevision = networkRecoveryRevision;
  const uid = useAuthStore.getState().userId;
  try {
    const pageTasks: Promise<unknown>[] = [];
    recoveryListeners.forEach(listener => {
      try {
        pageTasks.push(Promise.resolve(listener(currentRecoveryRevision)));
      } catch {
        // 单个页面的刷新回调不能阻断播放与持久队列恢复。
      }
    });
    const recoveryTasks: Promise<unknown>[] = [
      retryInterruptedPlaybackAfterNetworkRecovery(),
    ];
    if (uid) {
      recoveryTasks.push(
        resumePendingBiliMutations(uid, {retryNow: true}),
        resumePendingIndexSyncRetry(uid, {retryNow: true}),
      );
    }
    await Promise.allSettled([...recoveryTasks, ...pageTasks]);
  } finally {
    recoveryRunning = false;
    if (recoveryRequestedAgain) {
      recoveryRequestedAgain = false;
      scheduleRecovery();
    }
  }
}

/** 在连通性恢复或 Wi-Fi/蜂窝在线切换稳定后统一唤醒可恢复任务。 */
export function initializeNetworkRecovery() {
  const unsubscribe = netStatus.onStatusChange(change => {
    if (change.isOnline === false) {
      if (recoveryTimer) clearTimeout(recoveryTimer);
      recoveryTimer = null;
      return;
    }

    const connectivityRestored =
      change.previousIsOnline !== true &&
      change.isOnline === true &&
      change.previousType !== 'unknown';
    const transportChangedWhileOnline =
      change.isOnline === true &&
      change.previousIsOnline === true &&
      change.previousType !== 'unknown' &&
      change.previousType !== 'none' &&
      change.type !== change.previousType;
    if (connectivityRestored || transportChangedWhileOnline) {
      scheduleRecovery();
    }
  });
  return () => {
    unsubscribe();
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  };
}

export function getNetworkRecoveryRevision() {
  return networkRecoveryRevision;
}

export function subscribeNetworkRecovered(
  listener: (revision: number) => void | Promise<unknown>,
) {
  recoveryListeners.add(listener);
  return () => {
    recoveryListeners.delete(listener);
  };
}
