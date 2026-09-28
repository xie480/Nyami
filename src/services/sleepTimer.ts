import {storage} from '../core/storage';
import LoggerService from './LoggerService';

const SLEEP_TIMER_END_KEY = 'player.sleepTimerEndsAt';

type SleepTimerListener = (endsAt: number | null) => void;

const listeners = new Set<SleepTimerListener>();
let expirationTimeout: ReturnType<typeof setTimeout> | null = null;

export function getSleepTimerEndAt(): number | null {
  const value = storage.getNumber(SLEEP_TIMER_END_KEY);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function notifyListeners(): void {
  const endsAt = getSleepTimerEndAt();
  listeners.forEach(listener => listener(endsAt));
}

export function subscribeSleepTimer(listener: SleepTimerListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function clearDeadlineIfMatches(expectedEndAt: number): boolean {
  if (getSleepTimerEndAt() !== expectedEndAt) {
    return false;
  }

  if (expirationTimeout) {
    clearTimeout(expirationTimeout);
    expirationTimeout = null;
  }
  storage.delete(SLEEP_TIMER_END_KEY);
  notifyListeners();
  return true;
}

/**
 * 存储绝对截止时间，使播放服务在后台也能通过进度事件检查期限。
 * onExpire 负责复用播放器已有的暂停流程。
 */
export function scheduleSleepTimer(
  minutes: number,
  onExpire: () => void | Promise<void>,
): number {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('定时分钟数必须大于 0');
  }

  if (expirationTimeout) {
    clearTimeout(expirationTimeout);
    expirationTimeout = null;
  }

  const durationMs = Math.round(minutes * 60 * 1000);
  const endsAt = Date.now() + durationMs;
  storage.setNumber(SLEEP_TIMER_END_KEY, endsAt);
  notifyListeners();

  expirationTimeout = setTimeout(() => {
    if (clearDeadlineIfMatches(endsAt)) {
      Promise.resolve()
        .then(onExpire)
        .catch(error => {
          LoggerService.error(
            'SleepTimer',
            'expire',
            '定时暂停执行失败',
            error,
          );
        });
    }
  }, durationMs);

  return endsAt;
}

export function cancelSleepTimer(): void {
  if (expirationTimeout) {
    clearTimeout(expirationTimeout);
    expirationTimeout = null;
  }
  storage.delete(SLEEP_TIMER_END_KEY);
  notifyListeners();
}

/** Returns true once when a playback event reaches/passes the deadline. */
export function consumeExpiredSleepTimer(now = Date.now()): boolean {
  const endsAt = getSleepTimerEndAt();
  return endsAt !== null && endsAt <= now && clearDeadlineIfMatches(endsAt);
}
