import { config } from '../config';
import { RateLimitError } from './errors';

/**
 * 令牌桶限流器
 * 客户端层做软限流，避免触发 B 站风控
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const delta = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + delta * this.refillPerSec);
    this.lastRefill = now;
  }

  /** 尝试消耗 1 个令牌；不足时等待 */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // 等待至下一个令牌可用
    const waitMs = ((1 - this.tokens) / this.refillPerSec) * 1000;
    if (waitMs > 5000) {
      throw new RateLimitError('限流：请稍后再试');
    }
    await new Promise((r) => setTimeout(r, waitMs));
    return this.acquire();
  }
}

export const bucket = new TokenBucket(
  config.rateLimit.burstSize,
  config.rateLimit.perSecond
);
