import { biliApi } from './biliApi';
import { cache } from '../core/cache';
import { config } from '../config';
import { trimFolder, trimFavoriteVideo } from './transformers';
import { BiliApiError } from '../core/errors';
import type {
  FavoriteFolder,
  FavoriteVideo,
  ImportedPlaylist,
  OnlineVideoSearchResult,
  PageResult,
} from '../types/domain';
import {
  upsertPlaylistMeta,
  getPlaylistMeta,
  createSyncJob,
  finishSyncJob,
  upsertVideosBatch,
  updatePlaylistSyncProgress,
  markPlaylistSyncSuccess,
  softDeleteMissingVideos,
  getAllValidVideos,
  getRandomVideosBatch,
  clearAllData,
  deletePlaylistAndVideos,
  getPlaylistVideoCount,
  getVideosByPlaylistId,
} from '../db/operations';
import { videoMetaCollection } from '../db/database';
import { Q } from '@nozbe/watermelondb';
import { Mutex } from '../utils/mutex';
import { AuthRequiredError } from '../core/errors';
import LoggerService from './LoggerService';
import type { VideoMeta } from '../db/models/VideoMeta';
import { importedPlaylistService } from './importedPlaylistService';
import { useImportedPlaylistStore } from '../store/importedPlaylistStore';

export interface SyncProgressEvent {
  completedTasks: number;
  totalTasks: number;
  processedVideos: number;
  totalVideos: number;
  skippedTasks: number;
}

// 内存缓存，用于同步读取全局索引（UI 层渲染时需同步获取）
let globalIndexCache: FavoriteVideo[] = [];
let globalIndexRevision = 0;
let globalIndexSignature: string | null = null;
let globalIndexLoadPromise: Promise<void> | null = null;
const globalIndexRevisionListeners = new Set<(revision: number) => void>();

export class FavoriteStateReadbackError extends Error {
  constructor(message: string, public readonly causeValue?: unknown) {
    super(message);
    this.name = 'FavoriteStateReadbackError';
  }
}

export interface FavoriteWriteResult {
  confirmedFolderIds: number[];
  unconfirmedFolderIds: number[];
  writeErrorMessage: string | null;
}

async function assertCurrentAccount(uid: string) {
  await biliApi.assertWriteAccount(uid);
}

function cacheFolderSnapshot(uid: string, folders: Parameters<typeof trimFolder>[0][]) {
  cache.set(
    `folders:${uid}`,
    folders.map(trimFolder),
    config.cacheTTL.folders,
    true,
  );
}
let globalIndexCacheLoaded = false;
let visibleGlobalIndexSource: FavoriteVideo[] | null = null;
let visibleGlobalIndexKey = '';
let visibleGlobalIndexCache: FavoriteVideo[] = [];

function getGlobalIndexSignature(videos: FavoriteVideo[]): string {
  const membership = videos.map(video => [
    video.bvid,
    [...new Set(video.folderIds ?? [])].sort((left, right) => left - right),
    [...new Set(video.sourceKeys ?? [])].sort(),
  ] as const);
  membership.sort((left, right) => left[0].localeCompare(right[0]));
  return JSON.stringify(membership);
}

function replaceGlobalIndexCache(videos: FavoriteVideo[]): void {
  const nextSignature = getGlobalIndexSignature(videos);
  const indexChanged = nextSignature !== globalIndexSignature;
  globalIndexCache = videos;
  visibleGlobalIndexSource = null;
  if (indexChanged) {
    globalIndexRevision += 1;
    globalIndexSignature = nextSignature;
    globalIndexRevisionListeners.forEach(listener => {
      try {
        listener(globalIndexRevision);
      } catch (error) {
        LoggerService.warn(
          'favoriteService',
          'replaceGlobalIndexCache',
          'Global index revision listener failed',
          error,
        );
      }
    });
  }
}

// 互斥锁，防止同步任务并发执行
const syncMutex = new Mutex();

function mapVideoMetaToFavoriteVideo(v: VideoMeta): FavoriteVideo {
  const isOwnedPlaylist = /^\d+$/.test(v.playlistId);
  return {
    bvid: v.videoId,
    title: v.title,
    cover: v.cover || '',
    duration: v.duration || 0,
    page: 1,
    pubtime: v.publishTime || 0,
    favTime: v.favTime || 0,
    upper: { mid: 0, name: v.author || '' },
    attr: 0,
    folderIds: isOwnedPlaylist ? [Number(v.playlistId)] : undefined,
    sourceKeys: isOwnedPlaylist ? undefined : [v.playlistId],
    parts: v.extraJson ? JSON.parse(v.extraJson) : undefined,
  };
}

function getVisibleGlobalIndex(
  hiddenFolderIds: number[] = [],
  visibleSourceKeys: string[] = [],
): FavoriteVideo[] {
  const hiddenIds = Array.from(new Set(hiddenFolderIds)).sort((a, b) => a - b);
  const sourceKeys = Array.from(new Set(visibleSourceKeys)).sort();
  const cacheKey = `folders:${hiddenIds.join(',')}|sources:${sourceKeys.join(',')}`;
  if (visibleGlobalIndexSource === globalIndexCache && visibleGlobalIndexKey === cacheKey) {
    return visibleGlobalIndexCache;
  }

  const hiddenIdSet = new Set(hiddenIds);
  const visibleSourceKeySet = new Set(sourceKeys);
  visibleGlobalIndexCache = globalIndexCache.filter(video => {
    const hasOwnedSource = !!video.folderIds?.length;
    const hasImportedSource = !!video.sourceKeys?.length;
    if (!hasOwnedSource && !hasImportedSource) return true;
    return !!video.folderIds?.some(folderId => !hiddenIdSet.has(folderId)) ||
      !!video.sourceKeys?.some(sourceKey => visibleSourceKeySet.has(sourceKey));
  });
  visibleGlobalIndexSource = globalIndexCache;
  visibleGlobalIndexKey = cacheKey;
  return visibleGlobalIndexCache;
}

function sampleWithoutReplacement<T>(items: readonly T[], limit: number): T[] {
  const requestedCount = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const sampleCount = Math.min(items.length, requestedCount);
  if (sampleCount === 0) {
    return [];
  }

  // Floyd 抽样只分配与结果数量相当的索引集合，避免复制或打乱整份曲库。
  const selectedIndices = new Set<number>();
  for (let index = items.length - sampleCount; index < items.length; index += 1) {
    const candidate = Math.floor(Math.random() * (index + 1));
    selectedIndices.add(selectedIndices.has(candidate) ? index : candidate);
  }

  const indices = Array.from(selectedIndices);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }

  return indices.map(index => items[index]);
}

/**
 * 从 WatermelonDB 加载全局索引到内存缓存。
 * 应在应用启动时（uid useEffect）和同步完成后调用。
 */
export function loadGlobalIndexCache(): Promise<void> {
  if (globalIndexLoadPromise) return globalIndexLoadPromise;

  let loadPromise!: Promise<void>;
  loadPromise = (async () => {
    try {
      const validVideos = await getAllValidVideos();
      // 去重，因为同一个视频可能在多个收藏夹中
      const uniqueVideosMap = new Map<string, FavoriteVideo>();
      for (const v of validVideos) {
        if (!uniqueVideosMap.has(v.videoId)) {
          uniqueVideosMap.set(v.videoId, mapVideoMetaToFavoriteVideo(v));
        } else {
          const existing = uniqueVideosMap.get(v.videoId)!;
          const playlistVideo = mapVideoMetaToFavoriteVideo(v);
          existing.folderIds = Array.from(new Set([...(existing.folderIds ?? []), ...(playlistVideo.folderIds ?? [])]));
          existing.sourceKeys = Array.from(new Set([...(existing.sourceKeys ?? []), ...(playlistVideo.sourceKeys ?? [])]));
        }
      }
      replaceGlobalIndexCache(Array.from(uniqueVideosMap.values()));
      globalIndexCacheLoaded = true;
    } finally {
      if (globalIndexLoadPromise === loadPromise) {
        globalIndexLoadPromise = null;
      }
    }
  })();
  globalIndexLoadPromise = loadPromise;
  return loadPromise;
}

export async function ensureGlobalIndexCacheLoaded(): Promise<void> {
  if (globalIndexCacheLoaded) return;
  await loadGlobalIndexCache();
}

export function isGlobalIndexCacheLoaded(): boolean {
  return globalIndexCacheLoaded;
}

export function getGlobalIndexRevision(): number {
  return globalIndexRevision;
}

export function subscribeGlobalIndexRevision(
  listener: (revision: number) => void,
): () => void {
  globalIndexRevisionListeners.add(listener);
  return () => globalIndexRevisionListeners.delete(listener);
}

/**
 * 单收藏夹增量刷新 —— 仅拉取新增视频数据，不触发全量重新加载。
 *
 * === 数据流向 ===
 * 1. 从本地数据库获取当前收藏夹已有视频的 BVID 集合
 * 2. 从 B 站 API 逐页拉取（order=mtime 收藏时间倒序，最新视频排在最前）
 * 3. 遍历远端数据，遇到首个已存在于本地的 BVID 时停止（后续全部为旧数据）
 * 4. 将纯新增的视频批量写入 WatermelonDB（upsertVideosBatch）
 * 5. 将新增视频直接追加合并到 globalIndexCache（内存缓存），不触发全量 DB 重读
 * 6. 返回新增视频列表供 UI 层直接消费
 *
 * === 增量判断原理 ===
 * B 站收藏夹资源列表接口支持 order=mtime 参数，返回按收藏时间倒序排列的数据。
 * 因此最新收藏的视频必定排在列表最前面。利用这一特性，只需逐页读取直到遇到本地
 * 已存在的视频，即可断定后续再无增量数据，从而以最少 API 调用量完成增量检测。
 *
 * @param mediaId  收藏夹 ID
 * @param signal   可选的 AbortSignal，用于取消进行中的请求
 * @returns        新增视频列表（FavoriteVideo[]），无新增时返回空数组
 */
async function syncSingleFolder(
  mediaId: number,
  signal?: AbortSignal,
): Promise<FavoriteVideo[]> {
  const playlistId = mediaId.toString();

  // Step 1: 读取本地已有视频的 BVID 集合（仅限该收藏夹，含未删除记录）
  const existingLocalRecords = await getVideosByPlaylistId(playlistId);
  const existingBvids = new Set(
    existingLocalRecords.map((v: VideoMeta) => v.videoId),
  );

  const newVideos: FavoriteVideo[] = [];
  let page = 1;
  let hasMore = true;
  let reachedExisting = false;

  // Step 2: 逐页拉取远端数据，force=true 绕过内存缓存确保获取最新内容
  while (hasMore && !reachedExisting && !signal?.aborted) {
    const pageRes = await favoriteService.getVideos(mediaId, page, 20, true, signal);
    if (pageRes.list.length === 0) break;

    for (const video of pageRes.list) {
      if (existingBvids.has(video.bvid)) {
        // 由 mtime 倒序可知：一旦遇到已存在的视频，后续全为旧数据，终止拉取
        reachedExisting = true;
        break;
      }
      // 确保 folderIds 携带当前收藏夹 ID（trimFavoriteVideo 不填充此字段）
      video.folderIds = video.folderIds
        ? [...new Set([...video.folderIds, mediaId])]
        : [mediaId];
      newVideos.push(video);
      existingBvids.add(video.bvid); // 同批次内去重
    }

    hasMore = pageRes.hasMore;
    page++;

    // 请求间隔抖动，防止触发 B 站接口限流
    if (hasMore && !reachedExisting) {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
    }
  }

  // 无新增数据，提前返回空数组
  if (newVideos.length === 0) return [];

  // Step 3: 批量写入 WatermelonDB（upsertVideosBatch 内部区分 create / update）
  await upsertVideosBatch(playlistId, newVideos);

  // 首次加载尚未完成时从数据库重建，避免缓存只包含本次增量。
  if (!globalIndexCacheLoaded) {
    await loadGlobalIndexCache();
    return newVideos;
  }

  // 用 Map 合并同一 BVID 的收藏夹关系，并替换数组引用以便订阅方识别快照变化。
  const updatedIndex = [...globalIndexCache];
  const cachedVideoIndexes = new Map<string, number>();
  updatedIndex.forEach((video, index) => cachedVideoIndexes.set(video.bvid, index));
  for (const video of newVideos) {
    const cachedIndex = cachedVideoIndexes.get(video.bvid);
    if (cachedIndex === undefined) {
      cachedVideoIndexes.set(video.bvid, updatedIndex.length);
      updatedIndex.push(video);
      continue;
    }

    const cached = updatedIndex[cachedIndex];
    const folderIds = [...new Set([...(cached.folderIds || []), ...(video.folderIds || [])])];
    const sourceKeys = [...new Set([...(cached.sourceKeys || []), ...(video.sourceKeys || [])])];
    if (
      folderIds.length !== cached.folderIds?.length ||
      sourceKeys.length !== cached.sourceKeys?.length
    ) {
      updatedIndex[cachedIndex] = { ...cached, folderIds, sourceKeys };
    }
  }
  replaceGlobalIndexCache(updatedIndex);

  return newVideos;
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

  /** 新建收藏夹后从 B 站目录回读，以远端目录为准更新本地缓存。 */
  async createFavoriteFolder(
    uid: string,
    title: string,
    privacy: 0 | 1,
  ): Promise<FavoriteFolder> {
    await assertCurrentAccount(uid);
    const created = await biliApi.createFavoriteFolder(uid, title, privacy);
    this.invalidateFolderList(uid);

    let folderList;
    try {
      await assertCurrentAccount(uid);
      folderList = await biliApi.getFavoriteFolders(uid);
      await assertCurrentAccount(uid);
    } catch (error) {
      throw new FavoriteStateReadbackError(
        '收藏夹创建请求已发送，但回读失败；请刷新 B 站收藏夹确认，避免重复创建。',
        error,
      );
    }
    const remoteFolders = folderList.list || [];
    cacheFolderSnapshot(uid, remoteFolders);
    const confirmedFolder = remoteFolders.find(
      folder => folder.id === created.id && String(folder.mid) === uid,
    );
    if (!confirmedFolder) {
      throw new FavoriteStateReadbackError(
        '收藏夹创建请求已发送，但 B 站目录尚未确认；请刷新后再试。',
      );
    }
    return trimFolder(confirmedFolder);
  },

  /** 写入 B 站收藏后按 AID 回读实际状态，并仅索引远端确认的目标目录。 */
  async addSearchResultToFolders(
    uid: string,
    video: OnlineVideoSearchResult,
    folderIds: number[],
  ): Promise<FavoriteWriteResult> {
    await assertCurrentAccount(uid);
    const aid = Number.isSafeInteger(video.aid) && video.aid > 0
      ? video.aid
      : (await biliApi.getVideoInfo(video.bvid)).aid ?? 0;
    if (!Number.isSafeInteger(aid) || aid <= 0) {
      throw new Error('无法确认视频 AID，未发送收藏请求');
    }
    const writableVideo = {...video, aid};
    const uniqueFolderIds = [...new Set(folderIds)];
    if (uniqueFolderIds.length === 0) {
      throw new Error('请至少选择一个收藏夹');
    }

    const knownFolders = await this.getFolders(uid);
    const ownedFolderIds = new Set(
      knownFolders
        .filter(folder => String(folder.mid) === uid)
        .map(folder => folder.id),
    );
    if (uniqueFolderIds.some(folderId => !ownedFolderIds.has(folderId))) {
      throw new Error('收藏目标已失效或不属于当前账号，请重新选择');
    }

    let writeError: unknown = null;
    try {
      await biliApi.addVideoToFavoriteFolders(uid, aid, uniqueFolderIds);
    } catch (error) {
      // 11201 表示至少有一个目标已收藏；仍以状态回读判断每个目标。
      writeError = error;
    }

    let folderList;
    try {
      await assertCurrentAccount(uid);
      folderList = await biliApi.getFavoriteFolders(uid, undefined, aid);
      await assertCurrentAccount(uid);
    } catch (error) {
      this.invalidateFolderList(uid);
      throw new FavoriteStateReadbackError(
        '收藏请求已发送，但 B 站状态回读失败；未自动重发，请刷新收藏夹确认。',
        error,
      );
    }

    const remoteFolders = folderList.list || [];
    cacheFolderSnapshot(uid, remoteFolders);
    const confirmedFolderIds = uniqueFolderIds.filter(folderId =>
      remoteFolders.some(
        folder =>
          folder.id === folderId &&
          String(folder.mid) === uid &&
          folder.fav_state === 1,
      ),
    );
    const unconfirmedFolderIds = uniqueFolderIds.filter(
      folderId => !confirmedFolderIds.includes(folderId),
    );

    if (confirmedFolderIds.length > 0) {
      const indexedVideo: FavoriteVideo = {
        ...writableVideo,
        page: 1,
        favTime: Math.floor(Date.now() / 1000),
        upper: {mid: video.authorId, name: video.author},
        attr: 0,
      };
      try {
        for (const folderId of confirmedFolderIds) {
          this.invalidateFolder(folderId);
          await upsertVideosBatch(folderId.toString(), [indexedVideo]);
        }
        await loadGlobalIndexCache();
      } catch (error) {
        throw new Error(
          `B 站已确认收藏，但本地索引更新失败：${error instanceof Error ? error.message : '未知错误'}`,
        );
      }
    }

    return {
      confirmedFolderIds,
      unconfirmedFolderIds,
      writeErrorMessage:
        writeError instanceof BiliApiError
          ? writeError.message
          : writeError instanceof Error
            ? writeError.message
            : writeError
              ? '收藏写入未返回成功'
              : null,
    };
  },

  /**
   * 同步全局索引（增量同步），使用 WatermelonDB 持久化。
   * 基于全新的 DB 架构，支持断点续传和增量同步。
   */
  async syncGlobalIndex(
    uid: string,
    hiddenFolderIds: number[] = [],
    force = false,
    onProgress?: (event: SyncProgressEvent) => void,
    signal?: AbortSignal,
    onVideosSynced?: (videos: FavoriteVideo[]) => void,
  ): Promise<void> {
    if (!uid) return;

    await syncMutex.acquire();
    let indexMayHaveChanged = false;
    try {
      const allFolders = await this.getFolders(uid, true, signal);
      const folders = allFolders.filter(f => !hiddenFolderIds.includes(f.id));
      const importedStore = useImportedPlaylistStore.getState();
      const selectedSourceKeys = importedStore.visibleSourceKeysByUid[uid] ?? [];
      let selectedImportedSources: ImportedPlaylist[] = [];
      const failedPlaylists: string[] = [];
      if (selectedSourceKeys.length > 0) {
        const latestCatalog = await importedPlaylistService.getCollectedPlaylists(uid, true, signal);
        if (!signal?.aborted) {
          importedStore.setCatalog(uid, latestCatalog);
        }
        const selectedSourceKeySet = new Set(selectedSourceKeys);
        selectedImportedSources = latestCatalog.filter(source => selectedSourceKeySet.has(source.sourceKey));
        const resolvedSourceKeys = new Set(selectedImportedSources.map(source => source.sourceKey));
        const unresolvedCount = selectedSourceKeys.filter(sourceKey => !resolvedSourceKeys.has(sourceKey)).length;
        if (unresolvedCount > 0) {
          failedPlaylists.push(
            `有 ${unresolvedCount} 个已选外部来源已不在当前账号的目录中，请刷新主页播放列表偏好`,
          );
        }
      }

      type SyncTarget =
        | { kind: 'owned'; playlistId: string; title: string; mediaCount: number; folder: FavoriteFolder }
        | { kind: 'imported'; playlistId: string; title: string; mediaCount: number; source: ImportedPlaylist };
      const syncTargets: SyncTarget[] = [
        ...folders.map(folder => ({
          kind: 'owned' as const,
          playlistId: folder.id.toString(),
          title: folder.title,
          mediaCount: folder.mediaCount,
          folder,
        })),
        ...selectedImportedSources.map(source => ({
          kind: 'imported' as const,
          playlistId: source.sourceKey,
          title: source.title,
          mediaCount: source.mediaCount,
          source,
        })),
      ];
      if (syncTargets.length === 0) {
        throw new Error(
          selectedSourceKeys.length > 0
            ? '所选外部收藏夹或合集已不在当前账号的来源目录中，请刷新主页播放列表偏好后再同步。'
            : allFolders.length === 0
              ? '当前账号没有可同步的自有收藏夹或已选外部收藏夹/合集。'
              : '当前没有已选且可见的播放列表，请在主页播放列表偏好中显示至少一个自有收藏夹或选择外部收藏夹/合集后再同步。',
        );
      }

      let completedTasks = 0;
      const totalTasks = syncTargets.length;
      let processedVideos = 0;
      let baseProcessedVideos = 0;
      const totalVideos = syncTargets.reduce((sum, target) => sum + target.mediaCount, 0);
      let skippedTasks = 0;

      const reportProgress = () => {
        if (onProgress) {
          onProgress({
            completedTasks,
            totalTasks,
            processedVideos,
            totalVideos,
            skippedTasks,
          });
        }
      };

      reportProgress();

      for (const target of syncTargets) {
        if (signal?.aborted) break;

        const playlistId = target.playlistId;
        let localMeta = await getPlaylistMeta(playlistId);
        const remoteCountDecreased =
          localMeta !== null && target.mediaCount < localMeta.remoteVideoCount;

        // 1. 判断是否需要同步
        let needSync = false;
        if (force || !localMeta) {
          needSync = true;
        } else if (
          localMeta.remoteVideoCount !== target.mediaCount ||
          localMeta.syncCursor !== null ||
          localMeta.needResync ||
          localMeta.playlistSyncStatus === 'failed' ||
          localMeta.playlistSyncStatus === 'running' // 上次崩溃
        ) {
          needSync = true;
        }

        if (!needSync) {
          completedTasks++;
          skippedTasks++;
          baseProcessedVideos += target.mediaCount;
          processedVideos = baseProcessedVideos;
          reportProgress();
          continue;
        }

        // 2. 初始化或更新 Meta
        await upsertPlaylistMeta({
          playlistId,
          title: target.title,
          remoteVideoCount: target.mediaCount,
          playlistSyncStatus: 'syncing',
          needResync: force ? true : (localMeta?.needResync || false),
        });

        localMeta = await getPlaylistMeta(playlistId);
        if (!localMeta) continue;

        // 3. 创建同步任务
        const jobId = await createSyncJob(playlistId, null);

        let page = 1;
        // 断点续传：如果不是强制全量，且有游标，则从游标处继续
        if (!force && !remoteCountDecreased && localMeta.syncCursor && localMeta.syncCursor.startsWith('page_')) {
          const cursorPage = parseInt(localMeta.syncCursor.replace('page_', ''), 10);
          if (!isNaN(cursorPage) && cursorPage > 0) {
            page = cursorPage + 1; // 从下一页开始
          }
        }

        let hasMore = true;
        let isIncrementalDone = false;
        const remoteVideoIds: string[] = [];

        try {
          while (hasMore && !isIncrementalDone && !signal?.aborted) {
            const pageRes = target.kind === 'owned'
              ? await this.getVideos(target.folder.id, page, 20, force, signal)
              : await importedPlaylistService.getVideos(target.source, page, force, signal);
            
            if (pageRes.list.length === 0) {
              hasMore = pageRes.hasMore || pageRes.rawCount === 20;
              if (!hasMore) break;
            }

            const currentBvids = Array.from(new Set(pageRes.list.map(video => video.bvid)));
            const existingBvids = new Set<string>();
            if (!force && currentBvids.length > 0) {
              const existingVideos = await videoMetaCollection.query(
                Q.where('playlist_id', playlistId),
                Q.where('video_id', Q.oneOf(currentBvids)),
                Q.where('is_deleted', false),
              ).fetch();
              existingVideos.forEach(video => existingBvids.add(video.videoId));
            }

            const uniquePageBvids = new Set(currentBvids);
            if (!force && !remoteCountDecreased && localMeta.localSyncedCount > 0 && page === 1) {
              isIncrementalDone = existingBvids.size === uniquePageBvids.size && uniquePageBvids.size > 0;
            } else if (!force && !remoteCountDecreased && localMeta.localSyncedCount > 0 && page > 1) {
              isIncrementalDone = existingBvids.size > 0;
            }

            const videosToUpsert: FavoriteVideo[] = [];
            const seenPageIds = new Set<string>();
            for (const video of pageRes.list) {
              remoteVideoIds.push(video.bvid);
              if (seenPageIds.has(video.bvid)) continue;
              seenPageIds.add(video.bvid);
              if (force || !existingBvids.has(video.bvid)) {
                videosToUpsert.push(video);
              }
            }

            // 增量扫描只写本地未存在的视频；已删除记录不在 existingBvids 中，会被重新激活。
            if (videosToUpsert.length > 0) {
              await upsertVideosBatch(playlistId, videosToUpsert);
              indexMayHaveChanged = true;
              onVideosSynced?.(videosToUpsert);
            }
            
            // 获取当前收藏夹的绝对有效视频数量
            const absoluteSyncedCount = await getPlaylistVideoCount(playlistId);
            
            // 更新游标和进度（使用绝对数量）
            await updatePlaylistSyncProgress(playlistId, `page_${page}`, absoluteSyncedCount);
            
            // 更新总进度
            processedVideos = baseProcessedVideos + absoluteSyncedCount;
            reportProgress();

            hasMore = pageRes.hasMore || pageRes.rawCount === 20;
            page++;
          }

          if (!signal?.aborted) {
            // 4. 软删除（仅在全量拉取时执行）
            if (force || (!isIncrementalDone && !hasMore)) {
               await softDeleteMissingVideos(playlistId, remoteVideoIds);
               indexMayHaveChanged = true;
            }

            await finishSyncJob(jobId, 'success');
            await markPlaylistSyncSuccess(playlistId);
          } else {
            await finishSyncJob(jobId, 'cancelled');
            await upsertPlaylistMeta({ playlistId, remoteVideoCount: target.mediaCount, playlistSyncStatus: 'idle' });
          }

        } catch (err: any) {
          if (signal?.aborted) {
            await finishSyncJob(jobId, 'cancelled');
            await upsertPlaylistMeta({ playlistId, remoteVideoCount: target.mediaCount, playlistSyncStatus: 'idle' });
          } else {
            const errorMessage = err instanceof Error ? err.message : String(err);
            LoggerService.warn('favoriteService', 'syncPlaylist', `播放列表 ${target.title} 同步异常:`, errorMessage);
            await finishSyncJob(jobId, 'failed', errorMessage);
            await upsertPlaylistMeta({ playlistId, remoteVideoCount: target.mediaCount, playlistSyncStatus: 'failed' });
            failedPlaylists.push(`${target.title || target.playlistId}：${errorMessage}`);
            if (err instanceof AuthRequiredError) {
              throw err;
            }
          }
        }

        if (signal?.aborted) break;
        completedTasks++;
        baseProcessedVideos += target.mediaCount;
        processedVideos = baseProcessedVideos;
        reportProgress();
      }

      if (failedPlaylists.length > 0) {
        const visibleFailures = failedPlaylists.slice(0, 3).join('；');
        const remainingFailures = failedPlaylists.length - 3;
        throw new Error(
          `有 ${failedPlaylists.length} 个播放列表同步失败：${visibleFailures}` +
          (remainingFailures > 0 ? `；另有 ${remainingFailures} 个失败` : ''),
        );
      }

    } finally {
      try {
        if (indexMayHaveChanged) {
          await loadGlobalIndexCache();
        }
      } finally {
        syncMutex.release();
      }
    }
  },

  /**
   * 获取全局索引（同步返回）；隐藏的收藏夹不会贡献全局候选视频。
   */
  getGlobalIndex(
    hiddenFolderIds: number[] = [],
    visibleSourceKeys: string[] = [],
  ): FavoriteVideo[] {
    return getVisibleGlobalIndex(hiddenFolderIds, visibleSourceKeys);
  },

  /**
   * 清理全局索引
   */
  async clearGlobalIndex() {
    await clearAllData();
    replaceGlobalIndexCache([]);
    globalIndexCacheLoaded = true;
  },

  /**
   * 删除指定收藏夹的索引数据
   */
  async deleteFolderIndex(folderId: number) {
    const playlistId = folderId.toString();
    await deletePlaylistAndVideos(playlistId);
    await loadGlobalIndexCache();
  },

  /**
   * 按唯一 BVID 获取随机候选；全局播放从内存快照无放回抽样，单收藏夹沿用数据库查询。
   */
  async getRandomVideos(
    playlistId?: string,
    limit: number = 50,
    hiddenFolderIds: number[] = [],
    visibleSourceKeys: string[] = [],
  ): Promise<FavoriteVideo[]> {
    if (!playlistId) {
      if (!globalIndexCacheLoaded) {
        await loadGlobalIndexCache();
      }
      return sampleWithoutReplacement(getVisibleGlobalIndex(hiddenFolderIds, visibleSourceKeys), limit);
    }

    const records = await getRandomVideosBatch(playlistId, limit);
    return records.map(mapVideoMetaToFavoriteVideo);
  },

  /**
   * 单收藏夹增量刷新：检测收藏夹内新增视频并合并到全局索引。
   * 详情见上方 syncSingleFolder 函数定义及注释。
   */
  syncSingleFolder,
};
