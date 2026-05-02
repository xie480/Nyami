# B站音乐播放器 - 索引同步机制优化方案

## 一、 瓶颈分析

当前系统在执行 `syncGlobalIndex` 时存在以下瓶颈：
1. **串行执行效率低下**：当前逻辑是按收藏夹顺序，逐页串行请求视频列表。对于拥有大量收藏夹和视频的用户，网络 I/O 阻塞时间极长。
2. **静态限流策略僵化**：`core/rateLimit.ts` 采用固定速率的令牌桶（如 2次/秒）。如果 B 站当前风控较松，固定速率会浪费带宽；如果风控收紧，固定速率又容易触发 412/429 错误。
3. **粗暴的重试机制**：遇到限流错误时，直接 `sleep(10s)` 然后重试。这种固定等待时间在并发场景下会导致“惊群效应”（多个请求同时醒来再次触发限流），且无法动态适应服务端的恢复节奏。

## 二、 核心优化思路

为了在**绝对不触发上游服务限流策略的安全阈值前提下，将同步速度最大化**，我们需要引入以下机制：

### 1. 自适应速率限制 (Adaptive Rate Limiting)
借鉴 TCP 拥塞控制的 **AIMD（和增乘减）算法**：
- **探测期 (Additive Increase)**：连续 N 次请求成功后，缓慢增加每秒允许的请求数（如 +0.5 req/s），试探 B 站的当前限流水位。
- **退避期 (Multiplicative Decrease)**：一旦收到 412/429 错误，立即将当前允许的请求速率减半（如 * 0.5），并清空当前令牌，快速降低上游压力。

### 2. 异步任务队列与并发调度 (Task Queue)
- 引入 `TaskQueue` 控制最大并发连接数（如最大 5-10 个并发）。
- 将每个“获取某收藏夹某页”的操作封装为一个 Task 放入队列。
- 队列的实际出队执行速率受 `AdaptiveRateLimiter` 严格控制。

### 3. 指数退避重试与抖动 (Exponential Backoff with Jitter)
- 针对单个失败的 Task，采用指数退避（如 1s, 2s, 4s, 8s）进行重试。
- 引入随机抖动（Jitter），避免多个失败任务在同一时刻重试导致再次拥塞。

### 4. 动态分批处理 (Dynamic Batching)
- 优先获取所有收藏夹的首页，从而得知每个收藏夹的总页数。
- 将后续所有需要拉取的页数打散，全部推入 `TaskQueue` 进行无序并发拉取，最大化利用网络吞吐。

## 三、 核心代码实现方案

### 1. 自适应限流器 (`src/core/adaptiveRateLimit.ts`)
```typescript
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
```

### 2. 任务队列 (`src/utils/taskQueue.ts`)
```typescript
export class TaskQueue {
  private running = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(private concurrency: number) {}

  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await task());
        } catch (e) {
          reject(e);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;
    this.running++;
    const task = this.queue.shift();
    if (task) await task();
    this.running--;
    this.process();
  }
}
```

### 3. HTTP 拦截器改造 (`src/core/http.ts`)
在 axios 拦截器中接入 `adaptiveBucket` 的状态上报：
```typescript
ins.interceptors.response.use(
  (res) => {
    adaptiveBucket.reportSuccess();
    return res;
  },
  (err) => {
    const isRateLimit = err?.response?.status === 412 || err?.response?.status === 429;
    adaptiveBucket.reportError(isRateLimit);
    return Promise.reject(normalizeError(err));
  }
);
```

### 4. 业务层重构 (`src/services/favoriteService.ts`)
```typescript
async syncGlobalIndex(uid: string, force = false): Promise<void> {
  if (!uid) return;
  const folders = await this.getFolders(uid, force);
  const allVideos = new Map<string, FavoriteVideo>();
  const queue = new TaskQueue(5); // 最大并发5

  // 带有指数退避的执行包装器
  const executeWithBackoff = async (task: () => Promise<any>, maxRetries = 4) => {
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await queue.add(task);
      } catch (e: any) {
        const isRateLimit = e?.name === 'RateLimitError' || e?.message?.includes('412') || e?.message?.includes('429');
        if (isRateLimit && i < maxRetries) {
          const delay = Math.pow(2, i) * 1000 + Math.random() * 1000; // 指数退避 + 抖动
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
  };

  // 1. 并发获取所有收藏夹的第一页（同时获取总页数）
  const firstPageTasks = folders.map(folder => 
    executeWithBackoff(() => this.getVideos(folder.id, 1, 20, force))
      .then(res => ({ folder, res }))
  );
  
  const firstPages = await Promise.allSettled(firstPageTasks);
  const subsequentTasks: Array<() => Promise<void>> = [];

  // 2. 收集后续需要拉取的页数
  for (const result of firstPages) {
    if (result.status === 'fulfilled') {
      const { folder, res } = result.value;
      // 处理第一页数据
      res.list.forEach(v => /* 存入 allVideos */);
      
      // 如果有更多页，计算总页数并生成任务
      if (res.hasMore) {
        // 假设 B 站接口能推算出总页数，或者我们不断生成下一页任务直到 hasMore 为 false
        // 这里为了最大化并发，可以采用动态生成任务的方式
      }
    }
  }
  
  // 3. 执行所有后续任务...
  // 4. 保存到 storage
}
```

## 四、 预期效果
1. **速度提升**：在网络和风控允许的情况下，并发请求能将同步时间从几分钟缩短到十几秒。
2. **稳定性增强**：遇到风控时，系统会自动降速并平滑重试，不会因为大量 412 错误导致同步彻底失败或 IP 被封。
3. **资源利用率高**：AIMD 算法能始终让请求速率保持在 B 站当前允许的最高水位线附近。