import { biliApi } from './biliApi';
import { cache } from '../core/cache';
import { config } from '../config';
import { trimFolder, trimFavoriteVideo } from './transformers';
import type {
  FavoriteFolder,
  FavoriteVideo,
  PageResult,
  FolderSyncMeta,
} from '../types/domain';
import {
  batchUpsertGlobalVideos,
  getGlobalIndex as getGlobalIndexFromDB,
  getAllSyncMetaMap,
  updateSyncMeta,
  clearAllIndexes,
  removeFolderIdFromAllVideos,
} from '../db/operations';
import { Mutex } from '../utils/mutex';
import { AuthRequiredError } from '../core/errors';

export interface SyncProgressEvent {
  completedTasks: number;
  totalTasks: number;
  processedVideos: number;
  totalVideos: number;
}

// 内存缓存，用于同步读取全局索引（UI 层渲染时需同步获取）
let globalIndexCache: FavoriteVideo[] = [];

// 互斥锁，防止同步任务并发执行
const syncMutex = new Mutex();

/**
 * 从 WatermelonDB 加载全局索引到内存缓存。
 * 应在应用启动时（uid useEffect）和同步完成后调用。
 */
export async function loadGlobalIndexCache(): Promise<void> {
  globalIndexCache = await getGlobalIndexFromDB();
}

export const favoriteService = {
  /**
   * 获取某 UID 的全部收藏夹
   * 带缓存，10 分钟内不会重复请求
   */
  async getFolders(
    uid: string,
    force = false,
    signal?: AbortSignal,
  ): Promise<FavoriteFolder[]> {
    if (!uid || !uid.trim()) {
      throw new Error('UID 不能为空');
    }
    const key = `folders:${uid}`;
    if (force) cache.delete(key);
    return cache.getOrSet(
      key,
      config.cacheTTL.folders,
      async () => {
        const data = await biliApi.getFavoriteFolders(uid, signal);
        return (data.list || []).map(trimFolder);
      },
      true, // 持久化
    );
  },

  /**
   * 获取收藏夹内视频（分页）
   * 自动过滤已失效条目
   */
  async getVideos(
    mediaId: number,
    pn = 1,
    ps = 20,
    force = false,
    signal?: AbortSignal,
  ): Promise<PageResult<FavoriteVideo>> {
    if (!mediaId) {
      throw new Error('收藏夹 ID 不能为空');
    }
    const key = `videos:${mediaId}:${pn}:${ps}`;
    if (force) cache.delete(key);
    return cache.getOrSet(
      key,
      config.cacheTTL.folderVideos,
      async () => {
        const data = await biliApi.getFavoriteVideos(mediaId, pn, ps, signal);
        return {
          list: (data.medias || [])
            .filter(m => m.attr === 0)
            .map(trimFavoriteVideo),
          hasMore: data.has_more || false,
          // rawCount 为 API 原始返回的记录数（在过滤失效视频前），用于分页判断
          rawCount: (data.medias || []).length,
        };
      },
      true,
    );
  },

  /** 失效某收藏夹的所有缓存（如用户主动刷新） */
  invalidateFolder(mediaId: number) {
    cache.deletePrefix(`videos:${mediaId}`);
  },

  /** 失效某用户的收藏夹列表缓存 */
  invalidateFolderList(uid: string) {
    cache.delete(`folders:${uid}`);
  },

  /**
   * 同步全局索引（增量同步），使用 WatermelonDB 持久化。
   * 通过互斥锁保证同一时间只有一个同步任务在执行。
   *
   * 同步策略：
   * - 新收藏夹 / force 模式 / needsFullSync 标记 → 全量拉取
   * - mediaCount 增加 → 始终执行增量拉取（游标 bvid 之后的新视频）。
   *   注：已移除基于未同步数量阈值自动回退全量同步的机制，以保证增量同步的纯粹性。
   *   如需全量同步（例如本地数据损坏或缺失），请通过 UI 手动触发强制全量同步（force=true）。
   * - mediaCount 减少 → 标记 needsFullSync，本次跳过
   * - mediaCount 不变 → 跳过
   *
   * @param hiddenFolderIds 用户隐藏（不参与索引）的收藏夹 ID 列表
   */
  async syncGlobalIndex(
    uid: string,
    hiddenFolderIds: number[] = [],
    force = false,
    onProgress?: (event: SyncProgressEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!uid) return;

    // 获取互斥锁
    await syncMutex.acquire();
    try {
      let folders = await this.getFolders(uid, force, signal);
      folders = folders.filter(f => !hiddenFolderIds.includes(f.id));

      // 确保内存缓存与数据库一致，避免 storedCount 计算偏差导致误触发全量同步
      await loadGlobalIndexCache();

      // 从 WatermelonDB 加载同步元数据
      const syncMetaMap = await getAllSyncMetaMap();
      const now = Date.now();

      const failedFolders = new Set<number>();
      const syncedFolders = new Set<number>();

      let completedTasks = 0;
      let totalTasks = 0;
      let processedVideos = 0;
      let totalVideos = 0;
      // Compute total expected video count based on all visible folders
      totalVideos = folders.reduce((sum, f) => sum + f.mediaCount, 0);
      // Initialize processed video count with already indexed videos
      processedVideos = globalIndexCache.length;

      const reportProgress = () => {
        if (onProgress) {
          onProgress({
            completedTasks: Math.min(completedTasks, Math.max(totalTasks, 1)),
            totalTasks: Math.max(totalTasks, 1),
            processedVideos: Math.min(processedVideos, Math.max(totalVideos, 1)),
            totalVideos: Math.max(totalVideos, 1),
          });
        }
      };

      // 带有指数退避的执行包装器
      const executeWithBackoff = async <T>(
        task: () => Promise<T>,
        maxRetries = 6,
      ): Promise<T> => {
        for (let i = 0; i <= maxRetries; i++) {
          try {
            return await task();
          } catch (e: any) {
            const isRateLimit =
              e?.name === 'RateLimitError' ||
              e?.message?.includes('412') ||
              e?.message?.includes('429');
            if (isRateLimit && i < maxRetries) {
              const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
              console.log(
                `Rate limited, waiting ${Math.round(delay)}ms before retry ${i + 1}...`,
              );
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            throw e;
          }
        }
        throw new Error('Unreachable');
      };

      // ── 判断每个文件夹的同步模式 ──
      interface FolderSyncPlan {
        folder: FavoriteFolder;
        mode: 'skip' | 'full' | 'incremental';
        cursorBvid: string | null;
      }

      const plans: FolderSyncPlan[] = [];
      let dirtyCount = 0;

      for (const folder of folders) {
        const meta = syncMetaMap[folder.id];
        if (force) {
          plans.push({ folder, mode: 'full', cursorBvid: null });
        } else if (!meta || meta.mediaCount === 0) {
          plans.push({ folder, mode: 'full', cursorBvid: null });
        } else if (meta.needsFullSync) {
          plans.push({ folder, mode: 'full', cursorBvid: null });
        } else if (folder.mediaCount === meta.mediaCount) {
          plans.push({ folder, mode: 'skip', cursorBvid: null });
        } else if (folder.mediaCount > meta.mediaCount) {
          plans.push({
            folder,
            mode: 'incremental',
            cursorBvid: meta.latestBvid || null,
          });
        } else {
          // mediaCount 减少 → 标记需要全量校准，本次跳过
          dirtyCount++;
          syncMetaMap[folder.id] = { ...meta, needsFullSync: true };
          await updateSyncMeta(syncMetaMap[folder.id]);
        }
     }

      // totalVideos already calculated based on all visible folders above; no additional accumulation needed.

      const activePlans = plans.filter(p => p.mode !== 'skip');
      totalTasks = activePlans.length;
      reportProgress();

      // ── 逐个文件夹串行同步 ──
      for (const plan of activePlans) {
        if (signal?.aborted) break;

        const { folder, mode, cursorBvid } = plan;

        try {
          // 全量模式：先清除该文件夹的旧数据
          if (mode === 'full') {
            // 计算即将被删除的旧视频数量，并从已处理计数中扣除
            const removedCount = globalIndexCache.filter(v => v.folderIds?.includes(folder.id)).length;
            processedVideos = Math.max(0, processedVideos - removedCount);
            // 报告进度更新（已处理视频数已调整）
            reportProgress();
            await removeFolderIdFromAllVideos(folder.id);
          }

          let page = 1;
          let hasMore = true;
          let folderDone = false;
          let firstPageFirstBvid: string | null = null;
          const maxPageRetries = 3;
          const retryDelayMs = 30000;

          while (hasMore && !folderDone && !signal?.aborted) {
            let pageRetries = 0;
            try {
              // 2秒抖动，降低限流概率
              await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000)));
              const pageRes = await executeWithBackoff(() =>
                this.getVideos(folder.id, page, 20, force, signal),
              );

              // 记录首页第一条 bvid（用于全量后更新 latestBvid）
              if (page === 1 && pageRes.list.length > 0) {
                firstPageFirstBvid = pageRes.list[0].bvid;
              }

              // 增量模式：检查是否命中游标
              if (mode === 'incremental' && cursorBvid) {
                const cursorIndex = pageRes.list.findIndex(v => v.bvid === cursorBvid);
                if (cursorIndex === 0 && page === 1) {
                  // 游标在首位，无新视频
                  folderDone = true;
                  break;
                }
                if (cursorIndex >= 0) {
                  // 命中游标 → 只取游标前的新视频
                  const newVideos = pageRes.list.slice(0, cursorIndex);
                  await batchUpsertGlobalVideos(newVideos.map(v => ({ ...v, folderIds: [folder.id] })));
                  processedVideos += cursorIndex;
                  reportProgress();
                  folderDone = true;
                  break;
                }
                // 游标未命中，继续翻页
              }

              // 处理本页所有视频
              await batchUpsertGlobalVideos(pageRes.list.map(v => ({ ...v, folderIds: [folder.id] })));
              processedVideos += pageRes.list.length;
              reportProgress();

              // Continue fetching if API indicates more pages, or if we received a full page (fallback for APIs that may omit hasMore when exactly pageSize items returned)
              // 优先使用 API 的 hasMore；若未提供，用原始记录数判断是否可能还有下一页
              hasMore = pageRes.hasMore || pageRes.rawCount === 20;
              page++;
            } catch (err: any) {
              console.warn(`[favoriteService] 文件夹 ${folder.id} 第 ${page} 页拉取失败:`, err.message);
              if (err instanceof AuthRequiredError) {
                console.warn(`[favoriteService] 鉴权错误，终止同步`);
                throw err;
              }
              if (err.name === 'RateLimitError' || err.message?.includes('412') || err.message?.includes('429')) {
                console.warn(`[favoriteService] 触发限流，暂停 5 分钟后重试`);
                await new Promise(r => setTimeout(r, 5 * 60 * 1000));
                continue; // 重试当前页
              }
              pageRetries++;
              if (pageRetries <= maxPageRetries) {
                console.warn(`[favoriteService] 第 ${page} 页请求失败，第 ${pageRetries} 次重试`);
                await new Promise(r => setTimeout(r, retryDelayMs));
                continue;
              }
              failedFolders.add(folder.id);
              break;
            }
          }

          if (!failedFolders.has(folder.id)) {
            // 同步完成后更新同步元数据
            syncMetaMap[folder.id] = {
              folderId: folder.id,
              lastSyncTime: now,
              latestBvid: firstPageFirstBvid || cursorBvid || null,
              mediaCount: folder.mediaCount,
              needsFullSync: false,
              lastSyncedPage: page - 1,
            };
            await updateSyncMeta(syncMetaMap[folder.id]);
            syncedFolders.add(folder.id);
          }
        } catch (e: any) {
          console.warn(`[favoriteService] 文件夹 ${folder.id} 同步异常:`, e.message);
          if (e instanceof AuthRequiredError) {
            throw e;
          }
          failedFolders.add(folder.id);
        }
        completedTasks++;
        reportProgress();
      }
    } finally {
      syncMutex.release();
      // 重建缓存
      await loadGlobalIndexCache();
    }
  },

  /**
   * 获取全局索引（同步返回）
   */
  getGlobalIndex(): FavoriteVideo[] {
    return globalIndexCache;
  },

  /**
   * 清理全局索引
   */
  async clearGlobalIndex() {
    await clearAllIndexes();
    globalIndexCache = [];
  },
};