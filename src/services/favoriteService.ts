import { biliApi } from './biliApi';
import { cache } from '../core/cache';
import {storage} from '../core/storage';
import type {RequestPriority} from '../core/adaptiveRateLimit';
import { config } from '../config';
import { trimFolder, trimFavoriteVideo } from './transformers';
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
  syncPlaylistVideosPage,
  markPlaylistSyncSuccess,
  softDeleteMissingVideos,
  getAllValidVideos,
  getRandomVideosBatch,
  clearAllData,
  deletePlaylistAndVideos,
  getPlaylistVideoCount,
  getVideosByPlaylistId,
  softDeleteVideoFromPlaylist,
  movePlaylistVideos,
} from '../db/operations';
import { Mutex } from '../utils/mutex';
import { AuthRequiredError } from '../core/errors';
import LoggerService from './LoggerService';
import type { VideoMeta } from '../db/models/VideoMeta';
import { importedPlaylistService } from './importedPlaylistService';
import { useImportedPlaylistStore } from '../store/importedPlaylistStore';
import {useAuthStore} from '../store/authStore';
import {useSettingsStore} from '../store/settingsStore';
import {usePlayerStore} from '../store/playerStore';
import {forEachInYieldingBatches} from '../utils/yielding';
import {findFirstValidFavoriteCover} from '../utils/favoriteFolderCover';

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
let globalIndexFingerprint = '0:1515:ce07';
let globalIndexMembership: Map<string, string> | null = null;
let globalIndexLoadPromise: Promise<void> | null = null;
let globalIndexLoadGeneration = 0;
const globalIndexRevisionListeners = new Set<(revision: number) => void>();

export interface FavoriteWriteResult {
  queuedFolderIds: number[];
}

interface FavoriteMutationBase {
  id: string;
  uid: string;
  revision: number;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  localApplied: boolean;
  lastError?: string;
}

interface CreateFavoriteFolderMutation extends FavoriteMutationBase {
  kind: 'createFolder';
  tempFolderId: number;
  title: string;
  privacy: 0 | 1;
  baselineKnown: boolean;
  baselineFolderIds: number[];
  uncertainUntil?: number;
  remoteFolder?: FavoriteFolder;
  localMigrationComplete?: boolean;
}

interface SetFavoriteMutation extends FavoriteMutationBase {
  kind: 'favorite';
  folderId: number;
  aid: number;
  video: FavoriteVideo;
  desired: boolean;
}

type FavoriteMutation = CreateFavoriteFolderMutation | SetFavoriteMutation;

const FAVORITE_MUTATION_QUEUE_KEY = 'pendingBiliFavoriteMutations:v1';
const FAVORITE_FOLDER_ALIAS_PREFIX = 'favoriteFolderAliases:';
const favoriteFolderUpdateListeners = new Set<(uid: string) => void>();
const favoriteMutationWorkers = new Map<string, Promise<void>>();
const favoriteMutationRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const favoriteMutationLocalWriteMutex = new Mutex();

class RetryMutationAtError extends Error {
  constructor(public readonly retryAt: number, message: string) {
    super(message);
    this.name = 'RetryMutationAtError';
  }
}

function readFavoriteMutationQueue(): FavoriteMutation[] {
  const queue = storage.getJSON<FavoriteMutation[]>(FAVORITE_MUTATION_QUEUE_KEY);
  return Array.isArray(queue) ? queue : [];
}

function writeFavoriteMutationQueue(queue: FavoriteMutation[]): void {
  storage.setJSON(FAVORITE_MUTATION_QUEUE_KEY, queue);
}

function notifyFavoriteFolderUpdates(uid: string): void {
  for (const listener of favoriteFolderUpdateListeners) listener(uid);
}

export function subscribeFavoriteFolderUpdates(
  listener: (uid: string) => void,
): () => void {
  favoriteFolderUpdateListeners.add(listener);
  return () => favoriteFolderUpdateListeners.delete(listener);
}

function getFavoriteFolderAliases(uid: string): Record<string, number> {
  return storage.getJSON<Record<string, number>>(`${FAVORITE_FOLDER_ALIAS_PREFIX}${uid}`) ?? {};
}

export function resolveFavoriteFolderId(uid: string, folderId: number): number {
  return folderId > 0 ? folderId : getFavoriteFolderAliases(uid)[String(folderId)] ?? folderId;
}

function mergePendingFavoriteFolders(uid: string, folders: FavoriteFolder[]): FavoriteFolder[] {
  const pendingCreates = readFavoriteMutationQueue().filter(
    (mutation): mutation is CreateFavoriteFolderMutation =>
      mutation.uid === uid && mutation.kind === 'createFolder',
  );
  const pendingIds = new Set(
    pendingCreates
      .filter(mutation => !mutation.localMigrationComplete)
      .map(mutation => mutation.tempFolderId),
  );
  const merged = folders.filter(folder => folder.id >= 0 || pendingIds.has(folder.id));
  const byId = new Map(merged.map(folder => [folder.id, folder]));
  for (const mutation of pendingCreates) {
    if (mutation.remoteFolder) {
      if (mutation.localMigrationComplete) {
        byId.set(mutation.remoteFolder.id, mutation.remoteFolder);
      } else {
        byId.delete(mutation.remoteFolder.id);
        byId.set(mutation.tempFolderId, {
          id: mutation.tempFolderId,
          fid: mutation.tempFolderId,
          mid: Number(uid),
          title: mutation.title,
          mediaCount: 0,
          syncState: mutation.lastError ? 'retrying' : 'pending',
        });
      }
      continue;
    }
    byId.set(mutation.tempFolderId, {
      id: mutation.tempFolderId,
      fid: mutation.tempFolderId,
      mid: Number(uid),
      title: mutation.title,
      mediaCount: 0,
      syncState: mutation.lastError ? 'retrying' : 'pending',
    });
  }
  return Array.from(byId.values());
}

function persistFavoriteFolderSnapshot(uid: string, folders: FavoriteFolder[]): void {
  const key = `folders:${uid}`;
  cache.delete(key);
  cache.set(key, mergePendingFavoriteFolders(uid, folders), null, true);
  notifyFavoriteFolderUpdates(uid);
}

async function assertCurrentAccount(uid: string) {
  await biliApi.assertWriteAccount(uid);
}

function assertLocalMutationAccount(uid: string): void {
  if (!uid || useAuthStore.getState().userId !== uid) {
    throw new Error('B 站账号已切换，请刷新后重试');
  }
}

function cacheFolderSnapshot(uid: string, folders: Parameters<typeof trimFolder>[0][]) {
  persistFavoriteFolderSnapshot(uid, folders.map(trimFolder));
}

function createTemporaryFolderId(uid: string): number {
  const key = `favoriteFolderTempSequence:${uid}`;
  const stored = storage.getNumber(key);
  const nextId = Number.isSafeInteger(stored) && (stored ?? 0) < 0
    ? stored ?? -1
    : -1;
  storage.setNumber(key, nextId - 1);
  return nextId;
}

function updateFavoriteMutation(
  task: FavoriteMutation,
  update: (current: FavoriteMutation) => FavoriteMutation,
): FavoriteMutation | null {
  const queue = readFavoriteMutationQueue();
  const index = queue.findIndex(item => item.id === task.id && item.revision === task.revision);
  if (index < 0) return null;
  const updated = update(queue[index]);
  queue[index] = updated;
  writeFavoriteMutationQueue(queue);
  return updated;
}

function removeFavoriteMutation(task: FavoriteMutation): boolean {
  const queue = readFavoriteMutationQueue();
  const next = queue.filter(item => !(item.id === task.id && item.revision === task.revision));
  if (next.length === queue.length) return false;
  writeFavoriteMutationQueue(next);
  return true;
}

function retryDelayForFavoriteMutation(attempts: number): number {
  return Math.min(2_000 * Math.pow(2, Math.max(0, attempts - 1)), 60 * 60 * 1000);
}

function scheduleFavoriteMutationRetry(uid: string, retryAt: number): void {
  const existingTimer = favoriteMutationRetryTimers.get(uid);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    favoriteMutationRetryTimers.delete(uid);
    void resumePendingBiliMutations(uid);
  }, Math.max(500, retryAt - Date.now()));
  favoriteMutationRetryTimers.set(uid, timer);
}

async function queueLocalFavoriteMutation(
  uid: string,
  video: FavoriteVideo,
  folderIds: number[],
  desired: boolean,
): Promise<FavoriteMutation[]> {
  const now = Date.now();
  const queue = readFavoriteMutationQueue();
  const queued: FavoriteMutation[] = [];
  for (const folderId of folderIds) {
    const id = `favorite:${uid}:${folderId}:${video.bvid}`;
    const existing = queue.find(
      mutation => mutation.id === id && mutation.kind === 'favorite',
    ) as SetFavoriteMutation | undefined;
    const task: SetFavoriteMutation = {
      id,
      uid,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      attempts: 0,
      nextAttemptAt: now,
      localApplied: false,
      kind: 'favorite',
      folderId,
      aid: video.aid ?? 0,
      video: {...video, folderIds: [folderId]},
      desired,
    };
    const index = queue.findIndex(mutation => mutation.id === id);
    if (index >= 0) queue[index] = task;
    else queue.push(task);
    queued.push(task);
  }
  writeFavoriteMutationQueue(queue);
  return queued;
}

async function applyLocalFavoriteMutation(
  task: SetFavoriteMutation,
  refreshGlobalIndex = true,
): Promise<void> {
  await favoriteMutationLocalWriteMutex.acquire();
  try {
    if (useAuthStore.getState().userId !== task.uid) {
      throw new RetryMutationAtError(Date.now() + 60_000, '账号已切换，等待原账号重新登录后继续同步。');
    }
    const current = readFavoriteMutationQueue().find(
      mutation => mutation.id === task.id,
    ) as SetFavoriteMutation | undefined;
    if (!current || current.localApplied) return;
    if (current.desired) {
      await upsertVideosBatch(String(current.folderId), [{
        ...current.video,
        folderIds: [current.folderId],
      }]);
    } else {
      await softDeleteVideoFromPlaylist(String(current.folderId), current.video.bvid);
    }
    favoriteService.invalidateFolder(current.folderId);
    usePlayerStore.getState().updateFavoriteFolderMembership(
      current.video.bvid,
      current.folderId,
      current.desired,
    );
    updateFavoriteMutation(current, item => ({...item, localApplied: true}));
    if (refreshGlobalIndex && useAuthStore.getState().userId === task.uid) {
      try {
        await reloadGlobalIndexCacheAfterMutation();
      } catch (error) {
        globalIndexCacheLoaded = false;
        LoggerService.warn(
          'FavoriteMutation',
          'refreshLocalIndex',
          '本地收藏已写入，但全局索引快照刷新失败',
          error,
        );
      }
    }
  } finally {
    favoriteMutationLocalWriteMutex.release();
  }
}

async function applyLocalFavoriteMutationsNow(
  uid: string,
  tasks: FavoriteMutation[],
): Promise<void> {
  try {
    const localTasks = tasks
      .filter((task): task is SetFavoriteMutation => task.kind === 'favorite')
      .map(task => applyLocalFavoriteMutation(task, false));
    const results = await Promise.allSettled(localTasks);
    if (useAuthStore.getState().userId === uid) {
      try {
        await reloadGlobalIndexCacheAfterMutation();
      } catch (error) {
        globalIndexCacheLoaded = false;
        LoggerService.warn(
          'FavoriteMutation',
          'refreshLocalIndex',
          '本地收藏已写入，但全局索引快照刷新失败',
          error,
        );
      }
    }
    const failedWrite = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedWrite) throw failedWrite.reason;
  } catch (error) {
    scheduleFavoriteMutationRetry(uid, Date.now() + 2_000);
    throw error;
  }
}

function cacheOptimisticFavoriteFolder(uid: string, folder: FavoriteFolder): void {
  const folders = cache.get<FavoriteFolder[]>(`folders:${uid}`, true) ?? [];
  persistFavoriteFolderSnapshot(uid, [...folders.filter(item => item.id !== folder.id), folder]);
}

function getCachedFavoriteFolders(uid: string): FavoriteFolder[] {
  return mergePendingFavoriteFolders(
    uid,
    cache.get<FavoriteFolder[]>(`folders:${uid}`, true) ?? [],
  );
}

async function processCreateFavoriteFolder(task: CreateFavoriteFolderMutation): Promise<void> {
  let remoteFolder = task.remoteFolder;
  let remoteFolders: Parameters<typeof trimFolder>[0][] = [];
  if (!remoteFolder) {
    await assertCurrentAccount(task.uid);
    const response = await biliApi.getFavoriteFolders(task.uid);
    await assertCurrentAccount(task.uid);
    remoteFolders = response.list ?? [];
    const knownIds = new Set(task.baselineFolderIds);
    if (!task.uncertainUntil || !task.baselineKnown) {
      const updatedTask = updateFavoriteMutation(task, current => ({
        ...current,
        baselineKnown: true,
        baselineFolderIds: remoteFolders.map(folder => folder.id),
      }));
      if (updatedTask) task = updatedTask as CreateFavoriteFolderMutation;
    } else {
      const candidates = remoteFolders.filter(folder =>
        !knownIds.has(folder.id) &&
        String(folder.mid) === task.uid &&
        folder.title === task.title,
      );
      if (candidates.length > 1) {
        throw new RetryMutationAtError(
          Date.now() + 5 * 60 * 1000,
          '发现多个同名新收藏夹，等待目录稳定后再确认，避免重复创建。',
        );
      }
      if (candidates.length === 1) remoteFolder = trimFolder(candidates[0]);
    }

    if (!remoteFolder && task.uncertainUntil && task.uncertainUntil > Date.now()) {
      throw new RetryMutationAtError(
        task.uncertainUntil,
        '创建请求结果暂不明确，正在先回读 B 站目录确认。',
      );
    }
    if (!remoteFolder) {
      await assertCurrentAccount(task.uid);
      const uncertainUntil = Date.now() + 60 * 1000;
      const preparedTask = updateFavoriteMutation(task, current => ({
        ...current,
        baselineKnown: true,
        baselineFolderIds: remoteFolders.map(folder => folder.id),
        uncertainUntil,
      }));
      if (preparedTask) task = preparedTask as CreateFavoriteFolderMutation;
      try {
        const created = await biliApi.createFavoriteFolder(
          task.uid,
          task.title,
          task.privacy,
        );
        if (!Number.isSafeInteger(created.id) || created.id <= 0) {
          throw new Error('B 站创建收藏夹响应缺少有效 ID');
        }
        remoteFolder = trimFolder(created);
        const savedTask = updateFavoriteMutation(task, current => ({
          ...current,
          remoteFolder,
          uncertainUntil: undefined,
        }));
        if (savedTask) task = savedTask as CreateFavoriteFolderMutation;
      } catch (error) {
        updateFavoriteMutation(task, current => ({...current, uncertainUntil}));
        throw new RetryMutationAtError(
          uncertainUntil,
          `创建收藏夹请求未得到确认：${error instanceof Error ? error.message : '未知错误'}`,
        );
      }
    }
  }

  if (!remoteFolder) throw new Error('B 站未确认收藏夹 ID，稍后重试');
  if (useAuthStore.getState().userId !== task.uid) {
    throw new RetryMutationAtError(Date.now() + 60_000, '账号已切换，等待原账号重新登录后继续同步。');
  }
  const aliases = getFavoriteFolderAliases(task.uid);
  aliases[String(task.tempFolderId)] = remoteFolder.id;
  storage.setJSON(`${FAVORITE_FOLDER_ALIAS_PREFIX}${task.uid}`, aliases);
  await movePlaylistVideos(String(task.tempFolderId), String(remoteFolder.id));
  usePlayerStore.getState().replaceFavoriteFolderId(task.tempFolderId, remoteFolder.id);
  if (useAuthStore.getState().userId !== task.uid) {
    throw new RetryMutationAtError(Date.now() + 60_000, '账号已切换，等待原账号重新登录后继续同步。');
  }
  await reloadGlobalIndexCacheAfterMutation();
  if (useAuthStore.getState().userId !== task.uid) {
    throw new RetryMutationAtError(Date.now() + 60_000, '账号已切换，等待原账号重新登录后继续同步。');
  }
  const settings = useSettingsStore.getState();
  if (settings.hiddenFolderIds.includes(task.tempFolderId)) {
    settings.setHiddenFolderIds(Array.from(new Set([
      ...settings.hiddenFolderIds.filter(id => id !== task.tempFolderId),
      remoteFolder.id,
    ])));
  }
  if (settings.noCacheFolderIds.includes(task.tempFolderId)) {
    settings.setNoCacheFolderIds(Array.from(new Set([
      ...settings.noCacheFolderIds.filter(id => id !== task.tempFolderId),
      remoteFolder.id,
    ])));
  }

  let latestFolders = remoteFolders;
  if (latestFolders.length === 0) {
    try {
      await assertCurrentAccount(task.uid);
      latestFolders = (await biliApi.getFavoriteFolders(task.uid)).list ?? [];
    } catch {
      // 创建 POST 已返回正式 ID；目录 GET 失败时用本地快照补入响应项。
    }
  }
  const normalized = latestFolders.map(trimFolder).filter(folder => folder.id !== task.tempFolderId);
  if (!normalized.some(folder => folder.id === remoteFolder?.id)) normalized.push(remoteFolder);

  const migratedTask = updateFavoriteMutation(task, current => ({
    ...current,
    localMigrationComplete: true,
  }));
  if (migratedTask) task = migratedTask as CreateFavoriteFolderMutation;
  persistFavoriteFolderSnapshot(task.uid, normalized);
  removeFavoriteMutation(task);
}

async function processSetFavorite(task: SetFavoriteMutation): Promise<void> {
  let aid = task.aid;
  if (!Number.isSafeInteger(aid) || aid <= 0) {
    await assertCurrentAccount(task.uid);
    const info = await biliApi.getVideoInfo(task.video.bvid);
    await assertCurrentAccount(task.uid);
    aid = info.aid ?? 0;
    if (!Number.isSafeInteger(aid) || aid <= 0) throw new Error('无法解析视频 AID，稍后重试');
    updateFavoriteMutation(task, current => ({...current, aid}));
    task = {...task, aid};
  }
  const folderId = resolveFavoriteFolderId(task.uid, task.folderId);
  if (!Number.isSafeInteger(folderId) || folderId <= 0) {
    throw new RetryMutationAtError(Date.now() + 5_000, '等待新收藏夹获得 B 站正式 ID。');
  }

  await assertCurrentAccount(task.uid);
  let response = await biliApi.getFavoriteFolders(task.uid, undefined, aid);
  await assertCurrentAccount(task.uid);
  let targetFolder = (response.list ?? []).find(
    folder => folder.id === folderId && String(folder.mid) === task.uid,
  );
  if (!targetFolder) throw new Error('B 站未找到目标收藏夹，稍后重试');
  if (targetFolder.fav_state !== (task.desired ? 1 : 0)) {
    await assertCurrentAccount(task.uid);
    if (task.desired) {
      await biliApi.addVideoToFavoriteFolders(task.uid, aid, [folderId]);
    } else {
      await biliApi.removeVideoFromFavoriteFolder(task.uid, aid, folderId);
    }
    await assertCurrentAccount(task.uid);
    response = await biliApi.getFavoriteFolders(task.uid, undefined, aid);
    await assertCurrentAccount(task.uid);
    targetFolder = (response.list ?? []).find(
      folder => folder.id === folderId && String(folder.mid) === task.uid,
    );
  }
  if (targetFolder?.fav_state !== (task.desired ? 1 : 0)) {
    throw new Error('B 站尚未确认目标收藏状态，稍后重试');
  }
  cacheFolderSnapshot(task.uid, response.list ?? []);
}

export async function resumePendingBiliMutations(uid: string): Promise<void> {
  if (!uid || useAuthStore.getState().userId !== uid) return;
  const active = favoriteMutationWorkers.get(uid);
  if (active) return active;
  const pendingTimer = favoriteMutationRetryTimers.get(uid);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    favoriteMutationRetryTimers.delete(uid);
  }

  let worker: Promise<void>;
  worker = (async () => {
    while (useAuthStore.getState().userId === uid) {
      const pending = readFavoriteMutationQueue()
        .filter(mutation => mutation.uid === uid)
        .sort((left, right) => left.createdAt - right.createdAt);
      if (pending.length === 0) return;
      const unresolvedTemporaryFolderIds = new Set(
        pending
          .filter((mutation): mutation is CreateFavoriteFolderMutation =>
            mutation.kind === 'createFolder' &&
            resolveFavoriteFolderId(uid, mutation.tempFolderId) <= 0,
          )
          .map(mutation => mutation.tempFolderId),
      );
      const now = Date.now();
      const task = pending.find(mutation =>
        mutation.nextAttemptAt <= now &&
        !(mutation.kind === 'favorite' &&
          mutation.folderId < 0 &&
          unresolvedTemporaryFolderIds.has(mutation.folderId)),
      );
      if (!task) {
        const retryAt = Math.min(...pending
          .filter(mutation => mutation.kind === 'createFolder' || mutation.folderId > 0)
          .map(mutation => mutation.nextAttemptAt));
        scheduleFavoriteMutationRetry(uid, Number.isFinite(retryAt) ? retryAt : now + 5_000);
        return;
      }
      try {
        if (task.kind === 'favorite' && !task.localApplied) {
          await applyLocalFavoriteMutation(task);
        }
        const current = readFavoriteMutationQueue().find(
          mutation => mutation.id === task.id,
        );
        if (!current) continue;
        if (current.kind === 'createFolder') {
          await processCreateFavoriteFolder(current);
        } else {
          await processSetFavorite(current);
        }
        removeFavoriteMutation(current);
      } catch (error) {
        const current = readFavoriteMutationQueue().find(
          mutation => mutation.id === task.id,
        );
        if (!current || current.revision !== task.revision) continue;
        const attempts = current.attempts + 1;
        const retryAt = error instanceof RetryMutationAtError
          ? error.retryAt
          : Date.now() + retryDelayForFavoriteMutation(attempts);
        updateFavoriteMutation(current, mutation => ({
          ...mutation,
          attempts,
          nextAttemptAt: retryAt,
          lastError: error instanceof Error ? error.message : '未知错误',
        }));
        if (current.kind === 'createFolder') notifyFavoriteFolderUpdates(uid);
        LoggerService.warn('FavoriteMutation', 'retry', 'B 站收藏变更暂未完成，将在后台重试');
        scheduleFavoriteMutationRetry(uid, retryAt);
        continue;
      }
    }
  })().finally(() => {
    if (favoriteMutationWorkers.get(uid) === worker) favoriteMutationWorkers.delete(uid);
  });
  favoriteMutationWorkers.set(uid, worker);
  return worker;
}

function queueCreateFavoriteFolder(
  uid: string,
  title: string,
  privacy: 0 | 1,
): FavoriteFolder {
  const now = Date.now();
  const folders = cache.get<FavoriteFolder[]>(`folders:${uid}`, true);
  const tempFolderId = createTemporaryFolderId(uid);
  const task: CreateFavoriteFolderMutation = {
    id: `createFolder:${uid}:${tempFolderId}`,
    uid,
    revision: 1,
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
    localApplied: true,
    kind: 'createFolder',
    tempFolderId,
    title,
    privacy,
    baselineKnown: folders !== undefined,
    baselineFolderIds: (folders ?? []).filter(folder => folder.id > 0).map(folder => folder.id),
  };
  writeFavoriteMutationQueue([...readFavoriteMutationQueue(), task]);
  const placeholder: FavoriteFolder = {
    id: tempFolderId,
    fid: tempFolderId,
    mid: Number(uid),
    title,
    mediaCount: 0,
    syncState: 'pending',
  };
  cacheOptimisticFavoriteFolder(uid, placeholder);
  scheduleFavoriteMutationRetry(uid, now);
  return placeholder;
}
let globalIndexCacheLoaded = false;
let visibleGlobalIndexSource: FavoriteVideo[] | null = null;
let visibleGlobalIndexKey = '';
let visibleGlobalIndexCache: FavoriteVideo[] = [];

function getVideoSourceMembership(video: FavoriteVideo): string {
  return JSON.stringify([
    [...new Set(video.folderIds ?? [])].sort((left, right) => left - right),
    [...new Set(video.sourceKeys ?? [])].sort(),
  ]);
}

function getGlobalIndexMembership(
  videos: FavoriteVideo[],
): Map<string, string> {
  const membership = new Map<string, string>();
  for (const video of videos) {
    membership.set(video.bvid, getVideoSourceMembership(video));
  }
  return membership;
}

async function getGlobalIndexMembershipYielding(
  videos: FavoriteVideo[],
): Promise<Map<string, string>> {
  const membership = new Map<string, string>();
  await forEachInYieldingBatches(videos, video => {
    membership.set(video.bvid, getVideoSourceMembership(video));
  });
  return membership;
}

function hasGlobalIndexMembershipChanged(
  nextMembership: Map<string, string>,
): boolean {
  if (!globalIndexMembership || globalIndexMembership.size !== nextMembership.size) {
    return true;
  }
  for (const [bvid, membership] of nextMembership) {
    if (globalIndexMembership.get(bvid) !== membership) return true;
  }
  return false;
}

function fingerprintGlobalIndexMembership(membership: Map<string, string>): string {
  const entries = Array.from(membership.entries()).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  let firstHash = 5381;
  let secondHash = 52711;
  for (const [videoId, sources] of entries) {
    const value = `${videoId}:${sources};`;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      firstHash = (firstHash * 31 + code) % 4_294_967_291;
      secondHash = (secondHash * 37 + code) % 4_294_967_279;
    }
  }
  return `${entries.length}:${firstHash.toString(16)}:${secondHash.toString(16)}`;
}

function replaceGlobalIndexCache(
  videos: FavoriteVideo[],
  nextMembership = getGlobalIndexMembership(videos),
): void {
  globalIndexLoadGeneration += 1;
  const indexChanged = hasGlobalIndexMembershipChanged(nextMembership);
  globalIndexCache = videos;
  globalIndexMembership = nextMembership;
  globalIndexFingerprint = fingerprintGlobalIndexMembership(nextMembership);
  visibleGlobalIndexSource = null;
  if (indexChanged) {
    globalIndexRevision += 1;
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

async function getVisibleGlobalIndexYielding(
  hiddenFolderIds: number[] = [],
  visibleSourceKeys: string[] = [],
  signal?: AbortSignal,
): Promise<FavoriteVideo[]> {
  const hiddenIds = Array.from(new Set(hiddenFolderIds)).sort((a, b) => a - b);
  const sourceKeys = Array.from(new Set(visibleSourceKeys)).sort();
  const cacheKey = `folders:${hiddenIds.join(',')}|sources:${sourceKeys.join(',')}`;
  const hiddenIdSet = new Set(hiddenIds);
  const visibleSourceKeySet = new Set(sourceKeys);

  while (true) {
    const source = globalIndexCache;
    if (visibleGlobalIndexSource === source && visibleGlobalIndexKey === cacheKey) {
      return visibleGlobalIndexCache;
    }

    const visibleVideos: FavoriteVideo[] = [];
    await forEachInYieldingBatches(
      source,
      video => {
        const hasOwnedSource = !!video.folderIds?.length;
        const hasImportedSource = !!video.sourceKeys?.length;
        if (
          !hasOwnedSource &&
          !hasImportedSource
        ) {
          visibleVideos.push(video);
          return;
        }
        if (
          video.folderIds?.some(folderId => !hiddenIdSet.has(folderId)) ||
          video.sourceKeys?.some(sourceKey => visibleSourceKeySet.has(sourceKey))
        ) {
          visibleVideos.push(video);
        }
      },
      signal,
    );

    if (source !== globalIndexCache) continue;
    visibleGlobalIndexCache = visibleVideos;
    visibleGlobalIndexSource = source;
    visibleGlobalIndexKey = cacheKey;
    return visibleGlobalIndexCache;
  }
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
    const loadGeneration = globalIndexLoadGeneration;
    try {
      const validVideos = await getAllValidVideos();
      if (loadGeneration !== globalIndexLoadGeneration) return;
      // 去重，因为同一个视频可能在多个收藏夹中
      const uniqueVideosMap = new Map<string, FavoriteVideo>();
      const uniqueVideos: FavoriteVideo[] = [];
      await forEachInYieldingBatches(validVideos, v => {
        if (!uniqueVideosMap.has(v.videoId)) {
          const favoriteVideo = mapVideoMetaToFavoriteVideo(v);
          uniqueVideosMap.set(v.videoId, favoriteVideo);
          uniqueVideos.push(favoriteVideo);
        } else {
          const existing = uniqueVideosMap.get(v.videoId)!;
          const playlistVideo = mapVideoMetaToFavoriteVideo(v);
          existing.folderIds = Array.from(new Set([...(existing.folderIds ?? []), ...(playlistVideo.folderIds ?? [])]));
          existing.sourceKeys = Array.from(new Set([...(existing.sourceKeys ?? []), ...(playlistVideo.sourceKeys ?? [])]));
        }
      });
      if (loadGeneration !== globalIndexLoadGeneration) return;
      const membership = await getGlobalIndexMembershipYielding(uniqueVideos);
      if (loadGeneration !== globalIndexLoadGeneration) return;
      replaceGlobalIndexCache(uniqueVideos, membership);
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

/** 本地写入后强制丢弃可能早于写入启动的索引读取，再从数据库重建快照。 */
async function reloadGlobalIndexCacheAfterMutation(): Promise<void> {
  const inFlightLoad = globalIndexLoadPromise;
  if (inFlightLoad) {
    globalIndexLoadGeneration += 1;
    try {
      await inFlightLoad;
    } catch (error) {
      LoggerService.warn(
        'favoriteService',
        'reloadGlobalIndexCacheAfterMutation',
        '旧全局索引读取失败，继续重建本地变更后的索引',
        error,
      );
    }
  }
  globalIndexCacheLoaded = false;
  await loadGlobalIndexCache();
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

/** 跨应用重启稳定的收藏索引内容指纹，用于校验持久化画像快照。 */
export function getGlobalIndexFingerprint(): string {
  return globalIndexFingerprint;
}

export function subscribeGlobalIndexRevision(
  listener: (revision: number) => void,
): () => void {
  globalIndexRevisionListeners.add(listener);
  return () => globalIndexRevisionListeners.delete(listener);
}

/**
 * 单收藏夹增量刷新 —— 拉取新增视频，并刷新首个重叠页面的元数据，不触发全量重新加载。
 *
 * === 数据流向 ===
 * 1. 从本地数据库获取当前收藏夹已有视频的 BVID 集合
 * 2. 从 B 站 API 逐页拉取（order=mtime 收藏时间倒序，最新视频排在最前）
 * 3. 读取到首个已存在条目后停止后续分页，但消费完该页
 * 4. 将新增视频和该重叠页的远端条目批量写入 WatermelonDB（upsertVideosBatch）
 * 5. 合并远端元数据与收藏夹关系到 globalIndexCache，不触发全量 DB 重读
 * 6. 返回新增视频与本次刷新的远端视频供列表和播放队列同步
 *
 * === 增量判断原理 ===
 * B 站收藏夹资源列表接口支持 order=mtime 参数，返回按收藏时间倒序排列的数据。
 * 因此最新收藏的视频必定排在列表最前面。利用这一特性，只需逐页读取直到遇到本地
 * 已存在的视频，即可断定后续再无增量数据，从而以最少 API 调用量完成增量检测。
 *
 * @param mediaId  收藏夹 ID
 * @param signal   可选的 AbortSignal，用于取消进行中的请求
 * @returns        本次新增视频和本次拉取的最新远端视频
 */
async function syncSingleFolder(
  mediaId: number,
  signal?: AbortSignal,
): Promise<{newVideos: FavoriteVideo[]; refreshedVideos: FavoriteVideo[]}> {
  const playlistId = mediaId.toString();

  // Step 1: 读取本地已有视频的 BVID 集合（仅限该收藏夹，含未删除记录）
  const existingLocalRecords = await getVideosByPlaylistId(playlistId);
  const existingBvids = new Set(
    existingLocalRecords.map((v: VideoMeta) => v.videoId),
  );

  const newVideos: FavoriteVideo[] = [];
  const refreshedVideos: FavoriteVideo[] = [];
  const refreshedBvids = new Set<string>();
  let page = 1;
  let hasMore = true;
  let reachedExisting = false;

  // Step 2: 逐页拉取远端数据，force=true 绕过内存缓存确保获取最新内容
  while (hasMore && !reachedExisting && !signal?.aborted) {
    const pageRes = await favoriteService.getVideos(mediaId, page, 20, true, signal);
    if (pageRes.list.length === 0) break;

    for (const video of pageRes.list) {
      if (!video.bvid || refreshedBvids.has(video.bvid)) continue;
      refreshedBvids.add(video.bvid);
      // 确保 folderIds 携带当前收藏夹 ID（trimFavoriteVideo 不填充此字段）
      video.folderIds = video.folderIds
        ? [...new Set([...video.folderIds, mediaId])]
        : [mediaId];
      refreshedVideos.push(video);

      if (existingBvids.has(video.bvid)) {
        // 由 mtime 倒序停止后续分页，但仍刷新本页已取得的其他条目。
        reachedExisting = true;
        continue;
      }
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

  if (signal?.aborted || refreshedVideos.length === 0) {
    return {newVideos, refreshedVideos};
  }

  // Step 3: 更新首段远端元数据并写入新增记录。
  await upsertVideosBatch(playlistId, refreshedVideos);

  // 首次加载尚未完成时从数据库重建，避免缓存只包含本次增量。
  if (!globalIndexCacheLoaded) {
    await loadGlobalIndexCache();
    return {newVideos, refreshedVideos};
  }

  // 用 Map 合并同一 BVID 的收藏夹关系，并替换数组引用以便订阅方识别快照变化。
  const updatedIndex = [...globalIndexCache];
  const cachedVideoIndexes = new Map<string, number>();
  updatedIndex.forEach((video, index) => cachedVideoIndexes.set(video.bvid, index));
  for (const video of refreshedVideos) {
    const cachedIndex = cachedVideoIndexes.get(video.bvid);
    if (cachedIndex === undefined) {
      cachedVideoIndexes.set(video.bvid, updatedIndex.length);
      updatedIndex.push(video);
      continue;
    }

    const cached = updatedIndex[cachedIndex];
    const folderIds = [...new Set([...(cached.folderIds || []), ...(video.folderIds || [])])];
    const sourceKeys = [...new Set([...(cached.sourceKeys || []), ...(video.sourceKeys || [])])];
    updatedIndex[cachedIndex] = {...video, folderIds, sourceKeys};
  }
  replaceGlobalIndexCache(updatedIndex);

  return {newVideos, refreshedVideos};
}

export const favoriteService = {
  /**
   * 获取某 UID 的全部收藏夹
   * 持久化缓存；仅在数据变更或用户强制刷新时重新请求
   */
  async getFolders(
    uid: string,
    force = false,
    signal?: AbortSignal,
    rateLimitPriority: RequestPriority = 'normal',
  ): Promise<FavoriteFolder[]> {
    if (!uid || !uid.trim()) {
      throw new Error('UID 不能为空');
    }
    const key = `folders:${uid}`;
    if (force) cache.delete(key);
    const folders = await cache.getOrSet(
      key,
      null,
      async () => {
        const data = await biliApi.getFavoriteFolders(uid, signal, undefined, rateLimitPriority);
        return (data.list || []).map(trimFolder);
      },
      true, // 持久化
    );
    const merged = mergePendingFavoriteFolders(uid, folders);
    if (merged.length !== folders.length || merged.some(folder => folder.syncState)) {
      cache.set(key, merged, null, true);
    }
    return merged;
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
    rateLimitPriority: RequestPriority = 'normal',
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
        const data = await biliApi.getFavoriteVideos(mediaId, pn, ps, signal, rateLimitPriority);
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

  /** 仅读取收藏夹预览封面，不写入按 mediaId 缓存，避免跨账号复用预览数据。 */
  async getFolderCoverPreview(
    mediaId: number,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (!mediaId) {
      return null;
    }
    const data = await biliApi.getFavoriteVideos(mediaId, 1, 20, signal);
    if (signal?.aborted) {
      return null;
    }
    return findFirstValidFavoriteCover(data.medias ?? []);
  },

  /** 失效某收藏夹的所有缓存（如用户主动刷新） */
  invalidateFolder(mediaId: number) {
    cache.deletePrefix(`videos:${mediaId}`);
  },

  /** 失效某用户的收藏夹列表缓存 */
  invalidateFolderList(uid: string) {
    cache.delete(`folders:${uid}`);
  },

  /** 先显示本地临时目录，再由持久队列异步创建 B 站收藏夹。 */
  async createFavoriteFolder(
    uid: string,
    title: string,
    privacy: 0 | 1,
  ): Promise<FavoriteFolder> {
    assertLocalMutationAccount(uid);
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error('收藏夹名称不能为空');
    return queueCreateFavoriteFolder(uid, normalizedTitle, privacy);
  },

  /** 先更新本地索引，再将目标状态排队同步到 B 站。 */
  async removeVideoFromFavoriteFolder(
    uid: string,
    bvid: string,
    aid: number,
    folderId: number,
  ): Promise<void> {
    assertLocalMutationAccount(uid);
    if (!bvid.trim()) throw new Error('视频 BVID 无效，无法取消收藏');
    const folders = getCachedFavoriteFolders(uid);
    const localFolderId = resolveFavoriteFolderId(uid, folderId);
    const targetFolder = folders.find(folder => folder.id === folderId || folder.id === localFolderId);
    if (!targetFolder || String(targetFolder.mid) !== uid) {
      throw new Error('目标收藏夹已失效或不属于当前账号');
    }
    const cachedVideo = globalIndexCache.find(video => video.bvid === bvid);
    const video: FavoriteVideo = {
      bvid,
      aid: Number.isSafeInteger(aid) && aid > 0 ? aid : cachedVideo?.aid,
      title: cachedVideo?.title ?? '',
      cover: cachedVideo?.cover ?? '',
      duration: cachedVideo?.duration ?? 0,
      page: cachedVideo?.page ?? 1,
      pubtime: cachedVideo?.pubtime ?? 0,
      favTime: cachedVideo?.favTime ?? Math.floor(Date.now() / 1000),
      upper: cachedVideo?.upper ?? {mid: 0, name: ''},
      attr: 0,
      folderIds: [localFolderId],
    };
    const [task] = await queueLocalFavoriteMutation(uid, video, [localFolderId], false);
    await applyLocalFavoriteMutationsNow(uid, [task]);
    scheduleFavoriteMutationRetry(uid, Date.now());
  },

  /** 先本地收藏，再将 B 站目标状态排队同步并在失败后重试。 */
  async addSearchResultToFolders(
    uid: string,
    video: OnlineVideoSearchResult,
    folderIds: number[],
  ): Promise<FavoriteWriteResult> {
    assertLocalMutationAccount(uid);
    if (!video.bvid.trim()) throw new Error('视频 BVID 无效，无法收藏');
    const uniqueFolderIds = [...new Set(folderIds.map(folderId => resolveFavoriteFolderId(uid, folderId)))];
    if (uniqueFolderIds.length === 0) {
      throw new Error('请至少选择一个收藏夹');
    }

    const knownFolders = getCachedFavoriteFolders(uid);
    const ownedFolderIds = new Set(
      knownFolders
        .filter(folder => String(folder.mid) === uid)
        .map(folder => folder.id),
    );
    if (uniqueFolderIds.some(folderId => !ownedFolderIds.has(folderId))) {
      throw new Error('收藏目标已失效或不属于当前账号，请重新选择');
    }
    const indexedVideo: FavoriteVideo = {
      aid: Number.isSafeInteger(video.aid) && video.aid > 0 ? video.aid : undefined,
      bvid: video.bvid,
      title: video.title,
      cover: video.cover,
      duration: video.duration,
      page: 1,
      pubtime: video.pubtime,
      favTime: Math.floor(Date.now() / 1000),
      upper: {mid: video.authorId, name: video.author},
      attr: 0,
    };
    const queued = await queueLocalFavoriteMutation(uid, indexedVideo, uniqueFolderIds, true);
    await applyLocalFavoriteMutationsNow(uid, queued);
    scheduleFavoriteMutationRetry(uid, Date.now());
    return {queuedFolderIds: uniqueFolderIds};
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
  ): Promise<void> {
    if (!uid) return;

    await syncMutex.acquire();
    let indexMayHaveChanged = false;
    try {
      const allFolders = await this.getFolders(uid, true, signal, 'index');
      const folders = allFolders.filter(
        folder => !folder.syncState && !hiddenFolderIds.includes(folder.id),
      );
      const importedStore = useImportedPlaylistStore.getState();
      const selectedSourceKeys = importedStore.visibleSourceKeysByUid[uid] ?? [];
      let selectedImportedSources: ImportedPlaylist[] = [];
      const failedPlaylists: string[] = [];
      if (selectedSourceKeys.length > 0) {
        const latestCatalog = await importedPlaylistService.getCollectedPlaylists(
          uid,
          true,
          signal,
          'index',
        );
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
      const processedByTarget = new Array<number>(syncTargets.length).fill(0);
      const totalVideos = syncTargets.reduce((sum, target) => sum + target.mediaCount, 0);
      let skippedTasks = 0;

      const updateTargetProgress = (targetIndex: number, value: number) => {
        processedByTarget[targetIndex] = value;
        processedVideos = processedByTarget.reduce((sum, count) => sum + count, 0);
      };

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

      let nextTargetIndex = 0;
      let fatalAuthError: AuthRequiredError | null = null;
      const syncNextTarget = async () => {
        while (!signal?.aborted && !fatalAuthError) {
          const targetIndex = nextTargetIndex++;
          if (targetIndex >= syncTargets.length) {
            return;
          }
          const target = syncTargets[targetIndex];
          const playlistId = target.playlistId;
          let localMeta = await getPlaylistMeta(playlistId);
          const remoteCountDecreased =
            localMeta !== null && target.mediaCount < localMeta.remoteVideoCount;

          // 1. 判断是否需要同步
          const needSync = force || !localMeta ||
            localMeta.remoteVideoCount !== target.mediaCount ||
            localMeta.syncCursor !== null ||
            localMeta.needResync ||
            localMeta.playlistSyncStatus === 'failed' ||
            localMeta.playlistSyncStatus === 'running';

          if (!needSync) {
            completedTasks++;
            skippedTasks++;
            updateTargetProgress(targetIndex, target.mediaCount);
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
          if (!force && !remoteCountDecreased && localMeta.syncCursor?.startsWith('page_')) {
            const cursorPage = parseInt(localMeta.syncCursor.replace('page_', ''), 10);
            if (!isNaN(cursorPage) && cursorPage > 0) {
              page = cursorPage + 1;
            }
          }

          let hasMore = true;
          let isIncrementalDone = false;
          const remoteVideoIds = new Set<string>();
          let syncedVideoCount = 0;

          try {
            if (!force && !remoteCountDecreased) {
              syncedVideoCount = await getPlaylistVideoCount(playlistId);
            }
            while (
              hasMore &&
              !isIncrementalDone &&
              !signal?.aborted &&
              !fatalAuthError
            ) {
              const pageRes = target.kind === 'owned'
                ? await this.getVideos(target.folder.id, page, 20, force, signal, 'index')
                : await importedPlaylistService.getVideos(
                    target.source,
                    page,
                    force,
                    signal,
                    'index',
                  );
              if (fatalAuthError) {
                break;
              }

              if (pageRes.list.length === 0) {
                hasMore = pageRes.hasMore || pageRes.rawCount === 20;
                if (!hasMore) break;
              }

              pageRes.list.forEach(video => remoteVideoIds.add(video.bvid));
              const pageWrite = await syncPlaylistVideosPage(
                playlistId,
                pageRes.list,
                {
                  force,
                  cursor: `page_${page}`,
                  previousSyncedCount: syncedVideoCount,
                  fullScanCount: force || remoteCountDecreased
                    ? remoteVideoIds.size
                    : undefined,
                },
              );
              const uniquePageBvids = new Set(
                pageRes.list.map(video => video.bvid),
              );
              if (!force && !remoteCountDecreased && localMeta.localSyncedCount > 0 && page === 1) {
                isIncrementalDone =
                  pageWrite.existingBvids.size === uniquePageBvids.size &&
                  uniquePageBvids.size > 0;
              } else if (!force && !remoteCountDecreased && localMeta.localSyncedCount > 0 && page > 1) {
                isIncrementalDone = pageWrite.existingBvids.size > 0;
              }

              syncedVideoCount = pageWrite.syncedCount;
              if (pageWrite.videosToUpsert.length > 0) {
                indexMayHaveChanged = true;
              }

              updateTargetProgress(targetIndex, syncedVideoCount);
              reportProgress();

              hasMore = pageRes.hasMore || pageRes.rawCount === 20;
              page++;
            }

            if (signal?.aborted || fatalAuthError) {
              await finishSyncJob(jobId, 'cancelled');
              await upsertPlaylistMeta({
                playlistId,
                remoteVideoCount: target.mediaCount,
                playlistSyncStatus: 'idle',
              });
              return;
            }

            if (force || (!isIncrementalDone && !hasMore)) {
              await softDeleteMissingVideos(
                playlistId,
                Array.from(remoteVideoIds),
              );
              indexMayHaveChanged = true;
            }
            await finishSyncJob(jobId, 'success');
            await markPlaylistSyncSuccess(playlistId);
          } catch (err: any) {
            if (signal?.aborted || fatalAuthError) {
              await finishSyncJob(jobId, 'cancelled');
              await upsertPlaylistMeta({
                playlistId,
                remoteVideoCount: target.mediaCount,
                playlistSyncStatus: 'idle',
              });
              return;
            }

            const errorMessage = err instanceof Error ? err.message : String(err);
            LoggerService.warn(
              'favoriteService',
              'syncPlaylist',
              `播放列表 ${target.title} 同步异常:`,
              errorMessage,
            );
            await finishSyncJob(jobId, 'failed', errorMessage);
            await upsertPlaylistMeta({
              playlistId,
              remoteVideoCount: target.mediaCount,
              playlistSyncStatus: 'failed',
            });
            failedPlaylists.push(`${target.title || target.playlistId}：${errorMessage}`);
            if (err instanceof AuthRequiredError) {
              fatalAuthError = err;
              return;
            }
          }

          if (signal?.aborted || fatalAuthError) return;
          completedTasks++;
          updateTargetProgress(targetIndex, target.mediaCount);
          reportProgress();
        }
      };

      const workerCount = Math.min(
        config.favoriteSync.playlistConcurrency,
        syncTargets.length,
      );
      const workerResults = await Promise.allSettled(
        Array.from({length: workerCount}, () => syncNextTarget()),
      );
      if (fatalAuthError) throw fatalAuthError;
      const unexpectedFailure = workerResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (unexpectedFailure) throw unexpectedFailure.reason;

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

  /** 分批生成画像页使用的可见索引，允许导航和触摸事件在批次间运行。 */
  getGlobalIndexYielding(
    hiddenFolderIds: number[] = [],
    visibleSourceKeys: string[] = [],
    signal?: AbortSignal,
  ): Promise<FavoriteVideo[]> {
    return getVisibleGlobalIndexYielding(
      hiddenFolderIds,
      visibleSourceKeys,
      signal,
    );
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
