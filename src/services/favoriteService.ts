import { biliApi } from './biliApi';
import { cache } from '../core/cache';
import { config } from '../config';
import { trimFolder, trimFavoriteVideo } from './transformers';
import type {
  FavoriteFolder,
  FavoriteVideo,
  PageResult,
} from '../types/domain';
import { storage } from '../core/storage';
import { TaskQueue } from '../utils/taskQueue';

export interface SyncProgressEvent {
  completedTasks: number;
  totalTasks: number;
  processedVideos: number;
  totalVideos: number;
}

export const favoriteService = {
  /**
   * 获取某 UID 的全部收藏夹
   * 带缓存，10 分钟内不会重复请求
   */
  async getFolders(uid: string, force = false, signal?: AbortSignal): Promise<FavoriteFolder[]> {
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
      true // 持久化
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
    signal?: AbortSignal
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
            .filter((m) => m.attr === 0)
            .map(trimFavoriteVideo),
          hasMore: data.has_more || false,
        };
      },
      true
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
   * 同步全局索引
   * @param hiddenFolderIds 用户隐藏（不参与索引）的收藏夹 ID 列表
   */
  async syncGlobalIndex(uid: string, hiddenFolderIds: number[] = [], force = false, onProgress?: (event: SyncProgressEvent) => void, signal?: AbortSignal): Promise<void> {
    if (!uid) return;
    
    let folders = await this.getFolders(uid, force, signal);
    // 过滤掉用户隐藏的收藏夹，仅对可见收藏夹构建索引
    folders = folders.filter(f => !hiddenFolderIds.includes(f.id));
    const allVideos = new Map<string, FavoriteVideo>();
    const queue = new TaskQueue(5); // 最大并发5
  
    let completedTasks = 0;
    // 总任务数先设为 0，后续根据实际任务计算
    let totalTasks = 0;
    let processedVideos = 0;
    let totalVideos = folders.reduce((sum, f) => sum + f.mediaCount, 0);
  
    const reportProgress = () => {
      if (onProgress) {
        onProgress({
          completedTasks: Math.min(completedTasks, totalTasks),
          totalTasks,
          processedVideos: Math.min(processedVideos, totalVideos),
          totalVideos,
        });
      }
    };
  
    // 初始报告一次进度，让 UI 尽早显示 0% 进度条
    reportProgress();
  
    // 带有指数退避的执行包装器
    const executeWithBackoff = async (task: () => Promise<any>, maxRetries = 4) => {
      for (let i = 0; i <= maxRetries; i++) {
        try {
          return await queue.add(task);
        } catch (e: any) {
          const isRateLimit = e?.name === 'RateLimitError' || e?.message?.includes('412') || e?.message?.includes('429');
          if (isRateLimit && i < maxRetries) {
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000; // 指数退避 + 抖动
            console.log(`Rate limited, waiting ${Math.round(delay)}ms before retry ${i + 1}...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw e;
        }
      }
    };
  
    const processVideos = (folderId: number, list: FavoriteVideo[]) => {
      for (const v of list) {
        if (!allVideos.has(v.bvid)) {
          allVideos.set(v.bvid, { ...v, folderIds: [folderId] });
        } else {
          const existing = allVideos.get(v.bvid)!;
          if (!existing.folderIds) existing.folderIds = [];
          if (!existing.folderIds.includes(folderId)) {
            existing.folderIds.push(folderId);
          }
        }
      }
    };
  
    // 1. 并发获取所有可见收藏夹的第一页（部分失败不中断整体流程）
    const firstPageTasks = folders.map(folder =>
      executeWithBackoff(() => this.getVideos(folder.id, 1, 20, force, signal))
        .then(res => {
          completedTasks++;
          processedVideos += res.list.length;
          reportProgress();
          return { folder, res };
        })
        .catch(err => {
          completedTasks++; // 即使失败也算完成一个任务，避免进度卡住
          reportProgress();
          throw err;
        })
    );
    
    const firstPageResults = await Promise.allSettled(firstPageTasks);
    const firstPages: Array<{ folder: FavoriteFolder; res: PageResult<FavoriteVideo> }> = [];
    const firstPageErrors: string[] = [];
    for (const result of firstPageResults) {
      if (result.status === 'fulfilled') {
        firstPages.push(result.value);
      } else {
        firstPageErrors.push(result.reason?.message || '未知错误');
      }
    }
    // 如果所有收藏夹第一页都失败了，则抛出异常让 UI 层感知
    if (firstPages.length === 0 && firstPageErrors.length > 0) {
      throw new Error(`所有收藏夹第一页请求均失败: ${firstPageErrors.join('; ')}`);
    }
    const subsequentTasks: Array<() => Promise<void>> = [];
  
    // 2. 收集后续需要拉取的页数
    for (const result of firstPages) {
      const { folder, res } = result;
      processVideos(folder.id, res.list);
      
      // 如果有更多页，生成后续任务
      if (res.hasMore) {
        // B站收藏夹接口每页20条，可以通过 mediaCount 估算总页数
        const totalPages = Math.ceil(folder.mediaCount / 20);
        // 计算总任务数：已完成的任务 + 将要生成的后续任务数
        // 因为 firstPageTasks 已经计入 completedTasks（成功或失败），这里仅加后续任务数量
        
        for (let page = 2; page <= totalPages; page++) {
          subsequentTasks.push(async () => {
            try {
              const pageRes = await executeWithBackoff(() => this.getVideos(folder.id, page, 20, force, signal));
              processVideos(folder.id, pageRes.list);
              processedVideos += pageRes.list.length;
            } finally {
              completedTasks++;
              reportProgress();
            }
          });
        }
      }
    }
    
    // 计算总任务数（包括已经完成的任务和剩余的后续任务）
    totalTasks = completedTasks + subsequentTasks.length;
    reportProgress();
  
    // 3. 执行所有后续任务（部分失败不中断整体流程）
    const subsequentResults = await Promise.allSettled(subsequentTasks.map(task => task()));
    const subsequentErrors: string[] = [];
    for (const result of subsequentResults) {
      if (result.status === 'rejected') {
        subsequentErrors.push(result.reason?.message || '未知错误');
      }
    }
    if (subsequentErrors.length > 0) {
      console.warn(`[favoriteService] 后续页面任务部分失败: ${subsequentErrors.join('; ')}`);
    }
    
    storage.setJSON('globalIndex', Array.from(allVideos.values()));
  },

  /**
   * 获取全局索引
   */
  getGlobalIndex(): FavoriteVideo[] {
    return storage.getJSON<FavoriteVideo[]>('globalIndex') || [];
  },

  /**
   * 清理全局索引
   */
  clearGlobalIndex() {
    storage.delete('globalIndex');
  },
};
