import {AppState, NativeModules, Platform} from 'react-native';
import LoggerService from './LoggerService';

interface BackgroundSyncNativeModule {
  start(
    title: string,
    detail: string,
    completed: number,
    total: number,
  ): Promise<void>;
  update(title: string, detail: string, completed: number, total: number): void;
  stop(): void;
}

interface SyncNotificationTask {
  title: string;
  detail: string;
  completed: number;
  total: number;
  references: number;
}

const STOP_GRACE_PERIOD_MS = 1_500;
const START_RETRY_COOLDOWN_MS = 5_000;
const nativeModule = NativeModules.BackgroundSyncModule as
  | BackgroundSyncNativeModule
  | undefined;
const activeTasks = new Map<string, SyncNotificationTask>();

let nativeServiceStarted = false;
let nativeServiceStarting: Promise<void> | null = null;
let lastStartFailureAt = 0;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

function buildNotificationSnapshot() {
  const tasks = Array.from(activeTasks.values());
  const total = tasks.reduce((sum, task) => sum + task.total, 0);
  const completed = tasks.reduce(
    (sum, task) => sum + Math.min(task.completed, task.total),
    0,
  );
  const title =
    tasks.length === 1 ? tasks[0].title : `正在后台同步 ${tasks.length} 项任务`;
  const detail =
    tasks.length === 1
      ? tasks[0].detail
      : tasks
          .map(
            task =>
              `${task.title.replace(/^正在同步/, '')} ${task.completed}/${
                task.total
              }`,
          )
          .join(' · ');

  return {title, detail, completed, total};
}

function stopNativeServiceAfterGracePeriod(): void {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    stopTimer = null;
    if (activeTasks.size > 0) return;

    if (nativeServiceStarted) {
      try {
        nativeModule?.stop();
      } catch (error) {
        LoggerService.warn(
          'BackgroundSyncNotification',
          'stop',
          '停止后台同步通知失败',
          error,
        );
      }
    }
    nativeServiceStarted = false;
  }, STOP_GRACE_PERIOD_MS);
}

async function ensureNativeServiceStarted(): Promise<void> {
  if (
    Platform.OS !== 'android' ||
    !nativeModule ||
    activeTasks.size === 0 ||
    nativeServiceStarted
  ) {
    return;
  }
  if (nativeServiceStarting) return nativeServiceStarting;
  if (Date.now() - lastStartFailureAt < START_RETRY_COOLDOWN_MS) return;
  if (AppState.currentState !== 'active') {
    return;
  }

  const {title, detail, completed, total} = buildNotificationSnapshot();
  let startPromise!: Promise<void>;
  startPromise = nativeModule
    .start(title, detail, completed, total)
    .then(() => {
      nativeServiceStarted = true;
      if (activeTasks.size > 0) {
        const snapshot = buildNotificationSnapshot();
        nativeModule.update(
          snapshot.title,
          snapshot.detail,
          snapshot.completed,
          snapshot.total,
        );
      } else {
        stopNativeServiceAfterGracePeriod();
      }
    })
    .catch(error => {
      lastStartFailureAt = Date.now();
      LoggerService.warn(
        'BackgroundSyncNotification',
        'start',
        '无法启动 Android 后台同步通知服务',
        error,
      );
    })
    .finally(() => {
      if (nativeServiceStarting === startPromise) {
        nativeServiceStarting = null;
      }
    });
  nativeServiceStarting = startPromise;
  return startPromise;
}

function publishProgress(): void {
  if (Platform.OS !== 'android' || !nativeModule || activeTasks.size === 0) {
    return;
  }
  if (!nativeServiceStarted) {
    void ensureNativeServiceStarted();
    return;
  }

  const {title, detail, completed, total} = buildNotificationSnapshot();
  try {
    nativeModule.update(title, detail, completed, total);
  } catch (error) {
    LoggerService.warn(
      'BackgroundSyncNotification',
      'update',
      '更新后台同步通知失败',
      error,
    );
  }
}

/** 同一类任务可跨连续批次复用；引用计数避免短暂批次间隙移除通知。 */
export function beginBackgroundSyncNotification(
  taskId: string,
  title: string,
  total: number,
): void {
  if (Platform.OS !== 'android' || !nativeModule) return;
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }

  const previous = activeTasks.get(taskId);
  activeTasks.set(taskId, {
    title,
    detail: '准备同步',
    completed: 0,
    total: Math.max(0, Math.floor(total)),
    references: (previous?.references ?? 0) + 1,
  });
  publishProgress();
}

export function updateBackgroundSyncNotification(
  taskId: string,
  completed: number,
  total: number,
  detail: string,
): void {
  const task = activeTasks.get(taskId);
  if (!task) return;
  task.total = Math.max(0, Math.floor(total));
  task.completed = Math.max(0, Math.floor(completed));
  task.detail = detail;
  publishProgress();
}

export function finishBackgroundSyncNotification(taskId: string): void {
  const task = activeTasks.get(taskId);
  if (!task) return;
  if (task.references > 1) {
    task.references -= 1;
  } else {
    activeTasks.delete(taskId);
  }

  if (activeTasks.size > 0) {
    publishProgress();
    return;
  }
  stopNativeServiceAfterGracePeriod();
}

AppState.addEventListener('change', state => {
  if (state === 'active' && activeTasks.size > 0) {
    void ensureNativeServiceStarted();
  }
});
