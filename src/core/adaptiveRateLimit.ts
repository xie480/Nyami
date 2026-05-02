import { RateLimitError } from './errors';

export class AdaptiveRateLimiter {
  private currentRate: number;
  private tokens: number;
  private lastRefill: number;
  
  private readonly minRate = 0.5;
  private readonly maxRate = 10;
  private successCount = 0;
  private readonly successThreshold = 5; // 连续成功5次后提速

  constructor(initialRate = 2) {
    this.currentRate = initialRate;
    this.tokens = initialRate;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = ((1 - this.tokens) / this.currentRate) * 1000;
    if (waitMs > 10000) {
      throw new RateLimitError('限流：请稍后再试');
    }
    await new Promise(r => setTimeout(r, waitMs));
    return this.acquire();
  }

  private refill() {
    const now = Date.now();
    const delta = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.currentRate, this.tokens + delta * this.currentRate);
    this.lastRefill = now;
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
      this.tokens = Math.min(this.tokens, this.currentRate);
      this.successCount = 0;
    }
  }
}

export const adaptiveBucket = new AdaptiveRateLimiter(2);
