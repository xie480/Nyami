# 同步任务异常修复方案

## 问题背景
在应用了任务队列重构、并发数调整以及 HTTP 限流重试机制修改后，同步索引操作出现异常：系统只会显示并执行一个任务，界面进度显示为 1/1，该单个任务完成后同步流程便直接终止，导致大量尚未同步的视频被遗漏。

## 根本原因分析

### 1. `AdaptiveRateLimiter` 缺少定时唤醒导致的死锁
在 `src/core/adaptiveRateLimit.ts` 中，优化后的排队机制存在缺陷：
```typescript
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // ...
    return new Promise((resolve, reject) => {
      this.waitQueue.push({ resolve, reject });
    });
  }
```
当 `tokens < 1` 时，请求被推入 `waitQueue`。但是，如果没有后续的请求调用 `acquire`（从而触发 `refill` 和 `tryWake`），队列中的请求将永远等待下去。这导致了当并发数降为 2 时，如果两个请求都耗尽了令牌并进入等待队列，整个系统就会死锁，表现为任务队列卡住，只执行了极少量的任务。

### 2. `syncMetaMap` 游标污染导致的增量同步截断
在 `src/services/favoriteService.ts` 中，增量同步的游标更新逻辑存在问题：
```typescript
      // 更新游标为第一页第一个视频（最新）
      if (res.list.length > 0) {
        syncMetaMap[folder.id] = {
          // ...
          latestBvid: res.list[0].bvid,
        };
      }
```
在处理第一页数据时，系统直接更新了 `syncMetaMap` 中的 `latestBvid`。如果后续页面的拉取任务（`subsequentTasks`）因为网络或限流原因失败，这个已经更新的游标会被持久化保存。
当下一次同步触发时，系统会读取这个被污染的游标，认为该收藏夹已经同步到了最新状态，从而跳过之前失败的页面，导致大量视频被永久遗漏。

## 修复方案

### 方案一：修复 `AdaptiveRateLimiter` 死锁
在 `AdaptiveRateLimiter` 中引入定时器，确保当有请求在等待队列中时，系统会在预期的等待时间后自动唤醒并处理队列。
- 增加 `private timer: ReturnType<typeof setTimeout> | null = null;`
- 增加 `scheduleWake()` 方法，计算等待时间并设置 `setTimeout` 触发 `refill()`。
- 在 `acquire` 方法将请求推入队列后，调用 `scheduleWake()`。

### 方案二：修复 `syncMetaMap` 游标污染
在 `favoriteService.ts` 中，引入事务性更新机制，确保只有在整个收藏夹的所有页面都成功同步后，才更新其游标。
- 引入 `failedFolders = new Set<number>()` 记录发生错误的文件夹。
- 引入 `pendingMetaUpdates = new Map<number, FolderSyncMeta>()` 暂存待更新的元数据。
- 在第一页和后续页面的 `catch` 块中，将出错的 `folder.id` 加入 `failedFolders`。
- 在最后保存阶段，遍历 `pendingMetaUpdates`，仅当 `folderId` 不在 `failedFolders` 中时，才将其更新到 `syncMetaMap` 中。

## 下一步行动
切换到 **Code 模式**，按照上述方案修改 `src/core/adaptiveRateLimit.ts` 和 `src/services/favoriteService.ts`。