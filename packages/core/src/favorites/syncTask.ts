import type {
  FavoriteRepository,
  FavoriteSyncProgress,
  FavoriteSyncTarget,
  FavoriteSyncTaskOptions,
} from './contracts';

/**
 * 收藏夹同步任务。
 * 任务只依赖远端分页函数和仓储接口，因此可以在移动端、Electron 主进程和 Node 测试中复用。
 */
export class FavoriteSyncTask {
  constructor(
    private readonly repository: FavoriteRepository,
    private readonly defaultConcurrency = 3,
  ) {}

  /** 并发同步多个收藏夹，支持取消、断点游标和进度回调。 */
  async run(
    targets: FavoriteSyncTarget[],
    options: FavoriteSyncTaskOptions = {},
  ): Promise<FavoriteSyncProgress> {
    const progress: FavoriteSyncProgress = {
      completedTasks: 0,
      totalTasks: targets.length,
      processedVideos: 0,
      totalVideos: targets.reduce(
        (total, target) => total + Math.max(0, target.remoteVideoCount),
        0,
      ),
      skippedTasks: 0,
      failedTasks: 0,
    };
    const processedByTarget = new Array<number>(targets.length).fill(0);
    const failures: string[] = [];
    let nextTargetIndex = 0;
    const concurrency = Math.max(
      1,
      Math.min(
        options.concurrency ?? this.defaultConcurrency,
        targets.length || 1,
      ),
    );

    const report = (): void => {
      options.onProgress?.({...progress});
    };
    const updateProcessed = (targetIndex: number, value: number): void => {
      processedByTarget[targetIndex] = Math.max(0, value);
      progress.processedVideos = processedByTarget.reduce(
        (total, count) => total + count,
        0,
      );
    };

    report();
    const worker = async (): Promise<void> => {
      while (!options.signal?.aborted) {
        const targetIndex = nextTargetIndex++;
        const target = targets[targetIndex];
        if (!target) {
          return;
        }

        try {
          const result = await this.syncTarget(
            target,
            options,
            targetIndex,
            updateProcessed,
            report,
          );
          if (result.skipped) {
            progress.skippedTasks += 1;
          }
          progress.completedTasks += 1;
          report();
        } catch (error) {
          if (options.signal?.aborted) {
            return;
          }
          progress.failedTasks += 1;
          progress.completedTasks += 1;
          failures.push(
            `${target.title || target.playlistId}：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          report();
        }
      }
    };

    await Promise.all(Array.from({length: concurrency}, () => worker()));

    if (options.signal?.aborted) {
      throw new Error('收藏同步已取消');
    }
    if (failures.length > 0) {
      throw new Error(
        `有 ${failures.length} 个收藏夹同步失败：${failures
          .slice(0, 3)
          .join('；')}`,
      );
    }
    return {...progress};
  }

  private async syncTarget(
    target: FavoriteSyncTarget,
    options: FavoriteSyncTaskOptions,
    targetIndex: number,
    updateProcessed: (targetIndex: number, value: number) => void,
    report: () => void,
  ): Promise<{skipped: boolean}> {
    const force = options.force === true;
    const initialMeta = await this.repository.getPlaylistMeta(target.playlistId);
    let meta = initialMeta;
    const remoteCountDecreased =
      initialMeta !== null && target.remoteVideoCount < initialMeta.remoteVideoCount;
    const needsSync =
      force ||
      !meta ||
      meta.remoteVideoCount !== target.remoteVideoCount ||
      meta.syncCursor !== null ||
      meta.needResync ||
      meta.playlistSyncStatus === 'failed' ||
      meta.playlistSyncStatus === 'syncing' ||
      meta.playlistSyncStatus === 'running';

    if (!needsSync) {
      updateProcessed(targetIndex, target.remoteVideoCount);
      report();
      return {skipped: true};
    }

    await this.repository.upsertPlaylistMeta({
      playlistId: target.playlistId,
      title: target.title,
      remoteVideoCount: target.remoteVideoCount,
      playlistSyncStatus: 'syncing',
      needResync: force || meta?.needResync || false,
      kind: target.kind,
      ownerMid: target.ownerMid,
      ownerName: target.ownerName,
      cover: target.cover,
      description: target.description,
      remoteRevision: target.remoteRevision,
    });
    meta = await this.repository.getPlaylistMeta(target.playlistId);
    const jobId = await this.repository.createSyncJob(target.playlistId, null);
    const remoteVideoIds = new Set<string>();
    let page = 1;
    let syncedCount = meta?.localSyncedCount ?? 0;
    let hasMore = true;

    if (!force && !remoteCountDecreased && meta?.syncCursor?.startsWith('page_')) {
      const cursorPage = Number.parseInt(meta.syncCursor.slice(5), 10);
      if (Number.isSafeInteger(cursorPage) && cursorPage > 0) {
        page = cursorPage + 1;
      }
    }
    const incrementalMode =
      !force &&
      !remoteCountDecreased &&
      initialMeta?.syncCursor === null &&
      initialMeta.playlistSyncStatus === 'success';
    const fullScan = !incrementalMode;
    let incrementalDone = false;

    try {
      while (hasMore && !options.signal?.aborted) {
        const pageResult = await target.fetchPage(page, options.signal);
        pageResult.list.forEach(video => remoteVideoIds.add(video.bvid));
        const writeResult = await this.repository.syncPlaylistVideosPage(
          target.playlistId,
          pageResult.list,
          {
            force,
            cursor: `page_${page}`,
            previousSyncedCount: syncedCount,
            fullScanCount: fullScan ? remoteVideoIds.size : undefined,
          },
        );
        syncedCount = writeResult.syncedCount;
        updateProcessed(targetIndex, syncedCount);
        report();
        if (incrementalMode && pageResult.list.length > 0) {
          const pageBvids = new Set(pageResult.list.map(video => video.bvid));
          const existingOnPage = Array.from(pageBvids).filter(bvid =>
            writeResult.existingBvids.has(bvid),
          );
          incrementalDone = page === 1
            ? existingOnPage.length === pageBvids.size
            : existingOnPage.length > 0;
        }
        hasMore = !incrementalDone && (
          pageResult.hasMore || pageResult.rawCount === 20
        );
        page += 1;
        if (pageResult.list.length === 0 && !pageResult.hasMore) {
          hasMore = false;
        }
      }

      if (options.signal?.aborted) {
        await this.repository.finishSyncJob(jobId, 'cancelled');
        await this.repository.upsertPlaylistMeta({
          playlistId: target.playlistId,
          title: target.title,
          remoteVideoCount: target.remoteVideoCount,
          playlistSyncStatus: 'idle',
        });
        return {skipped: false};
      }

      if (fullScan) {
        await this.repository.softDeleteMissingVideos(
          target.playlistId,
          Array.from(remoteVideoIds),
        );
      }
      await this.repository.finishSyncJob(jobId, 'success');
      await this.repository.markPlaylistSyncSuccess(target.playlistId);
      return {skipped: false};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.signal?.aborted) {
        await this.repository.finishSyncJob(jobId, 'cancelled', message);
        await this.repository.upsertPlaylistMeta({
          playlistId: target.playlistId,
          title: target.title,
          remoteVideoCount: target.remoteVideoCount,
          playlistSyncStatus: 'idle',
          kind: target.kind,
          ownerMid: target.ownerMid,
          ownerName: target.ownerName,
          cover: target.cover,
          description: target.description,
          remoteRevision: target.remoteRevision,
        });
        return {skipped: false};
      }
      await this.repository.finishSyncJob(jobId, 'failed', message);
      await this.repository.upsertPlaylistMeta({
        playlistId: target.playlistId,
        title: target.title,
        remoteVideoCount: target.remoteVideoCount,
        playlistSyncStatus: 'failed',
        kind: target.kind,
        ownerMid: target.ownerMid,
        ownerName: target.ownerName,
        cover: target.cover,
        description: target.description,
        remoteRevision: target.remoteRevision,
      });
      throw error;
    }
  }
}
