import type {RequestPriority} from '../../../platform-contracts/src';

type Waiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  priority: RequestPriority;
  signal?: AbortSignal;
  abortListener?: () => void;
};

const PRIORITY_ORDER: Record<RequestPriority, number> = {
  // 用户当前页面的请求必须先于后台收藏索引拿到令牌，避免索引任务拖住搜索和播放。
  normal: 0,
  index: 1,
  background: 2,
};

/** 共享 API 的轻量自适应令牌桶。 */
export class AdaptiveRateLimiter {
  private readonly minRate = 0.1;

  private readonly maxRate: number;

  private readonly maxTokens: number;

  private currentRate: number;

  private tokens: number;

  private lastRefill = Date.now();

  private successCount = 0;

  private readonly successThreshold = 10;

  private waitQueue: Waiter[] = [];

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    maxRate = 3,
    burstSize = 2,
  ) {
    this.maxRate = Math.max(this.minRate, maxRate);
    this.maxTokens = Math.max(1, burstSize);
    this.currentRate = this.maxRate;
    this.tokens = this.maxTokens;
  }

  /** 获取一个请求令牌，支持按优先级排队和取消。 */
  async acquire(
    priority: RequestPriority = 'normal',
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw this.createAbortError();
    }

    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        priority,
        signal,
        resolve: () => {
          this.cleanupWaiter(waiter);
          resolve();
        },
        reject: error => {
          this.cleanupWaiter(waiter);
          reject(error);
        },
      };

      if (signal) {
        waiter.abortListener = () => {
          const index = this.waitQueue.indexOf(waiter);
          if (index < 0) {
            return;
          }

          this.waitQueue.splice(index, 1);
          waiter.reject(this.createAbortError());
          this.scheduleWake();
        };
        signal.addEventListener('abort', waiter.abortListener, {once: true});
      }

      const insertAt = this.waitQueue.findIndex(
        queued => PRIORITY_ORDER[queued.priority] > PRIORITY_ORDER[priority],
      );
      if (insertAt < 0) {
        this.waitQueue.push(waiter);
      } else {
        this.waitQueue.splice(insertAt, 0, waiter);
      }

      if (signal?.aborted) {
        waiter.abortListener?.();
        return;
      }

      this.scheduleWake();
    });
  }

  /** 上报一次成功请求，逐步恢复到最大速率。 */
  reportSuccess(): void {
    this.successCount += 1;
    if (this.successCount < this.successThreshold) {
      return;
    }
    this.currentRate = Math.min(this.maxRate, this.currentRate + 0.5);
    this.successCount = 0;
  }

  /** 上报限流错误，降低当前速率。 */
  reportError(isRateLimit: boolean): void {
    if (isRateLimit) {
      this.currentRate = Math.max(this.minRate, this.currentRate * 0.5);
      this.tokens = 0;
      this.successCount = 0;
    }
  }

  private createAbortError(): Error {
    const error = new Error('请求已取消');
    error.name = 'AbortError';
    return error;
  }

  private cleanupWaiter(waiter: Waiter): void {
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener);
    }
  }

  private scheduleWake(): void {
    if (this.timer || this.waitQueue.length === 0) {
      return;
    }

    const waitMs = Math.max(
      0,
      ((1 - this.tokens) / this.currentRate) * 1000,
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refill();
      if (this.waitQueue.length > 0) {
        this.scheduleWake();
      }
    }, waitMs);
  }

  private refill(): void {
    const now = Date.now();
    const delta = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + delta * this.currentRate,
    );
    this.lastRefill = now;

    while (this.waitQueue.length > 0 && this.tokens >= 1) {
      const waiter = this.waitQueue.shift();
      if (!waiter) {
        break;
      }
      if (waiter.signal?.aborted) {
        waiter.reject(this.createAbortError());
        continue;
      }
      this.tokens -= 1;
      waiter.resolve();
    }
  }
}
