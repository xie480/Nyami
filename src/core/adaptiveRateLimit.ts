import { RateLimitError } from './errors';
import { config } from '../config';

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  priority: RequestPriority;
  signal?: AbortSignal;
  abortListener?: () => void;
}

export type RequestPriority = 'index' | 'normal' | 'background';

const PRIORITY_ORDER: Record<RequestPriority, number> = {
  index: 0,
  normal: 1,
  background: 2,
};

function createAbortError(): Error {
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
}

export class AdaptiveRateLimiter {
  private currentRate: number;
  private tokens: number;
  private lastRefill: number;
  private waitQueue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly minRate = 0.1;
  private readonly maxRate = config.rateLimit.perSecond;
  private readonly maxTokens = config.rateLimit.burstSize;
  private successCount = 0;
  private readonly successThreshold = 10; // 连续成功10次后提速

  constructor(initialRate = config.rateLimit.perSecond) {
    this.currentRate = Math.max(
      this.minRate,
      Math.min(initialRate, this.maxRate),
    );
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(
    priority: RequestPriority = 'normal',
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw createAbortError();
    }
    this.refill();
    if (signal?.aborted) {
      throw createAbortError();
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = ((1 - this.tokens) / this.currentRate) * 1000;
    if (waitMs > 10000) {
      throw new RateLimitError('限流：请稍后再试');
    }
    // 优先级内保持 FIFO；索引请求可越过尚未发出的标签回填请求。
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        if (signal && waiter.abortListener) {
          signal.removeEventListener('abort', waiter.abortListener);
        }
      };
      const waiter: Waiter = {
        priority,
        signal,
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: error => {
          cleanup();
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
          waiter.reject(createAbortError());
          if (this.waitQueue.length === 0 && this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
          } else {
            this.scheduleWake();
          }
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

  private scheduleWake() {
    if (this.timer) {
      return;
    }
    if (this.waitQueue.length === 0) {
      return;
    }
    const waitMs = Math.max(0, ((1 - this.tokens) / this.currentRate) * 1000);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refill();
      if (this.waitQueue.length > 0) {
        this.scheduleWake();
      }
    }, waitMs);
  }

  private get capacity() {
    return this.maxTokens;
  }

  private refill() {
    const now = Date.now();
    const delta = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + delta * this.currentRate);
    this.lastRefill = now;
    // 尝试唤醒等待队列中的请求
    this.tryWake();
  }

  private tryWake() {
    while (this.waitQueue.length > 0 && this.tokens >= 1) {
      const waiter = this.waitQueue.shift()!;
      if (waiter.signal?.aborted) {
        waiter.reject(createAbortError());
        continue;
      }
      this.tokens -= 1; // 确保被唤醒的请求消耗令牌，维持并发上限
      waiter.resolve();
    }
  }

  reportSuccess() {
    this.successCount++;
    if (this.successCount >= this.successThreshold) {
      this.currentRate = Math.min(this.maxRate, this.currentRate + 0.5); // 和增
      this.successCount = 0;
    }
  }

  reportError(isRateLimit: boolean) {
    if (isRateLimit) {
      this.currentRate = Math.max(this.minRate, this.currentRate * 0.5); // 乘减
      this.tokens = 0;
      this.successCount = 0;
    }
  }
}

export const adaptiveBucket = new AdaptiveRateLimiter();
