import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {FavoriteVideo, OnlineSearchQueueContext} from '../types/domain';
import { storage } from '../core/storage';
import { insertNext as tpInsertNext, removeFromQueue as tpRemoveFromQueue, reorderQueue as tpReorderQueue, appendQueue as tpAppendQueue } from '../services/trackPlayer';
import { useProgressStore } from './progressStore';

// MMKV storage adapter compatible with Zustand persist
const mmkvStorage = {
  getItem: (name: string) => Promise.resolve(storage.getString(name) ?? null),
  setItem: (name: string, value: string) => Promise.resolve(storage.setString(name, value)),
  removeItem: (name: string) => Promise.resolve(storage.delete(name)),
};

let playModeSwitchRevision = 0;

function uniqueVideos(videos: FavoriteVideo[]): FavoriteVideo[] {
  return Array.from(
    new Map(videos.filter(video => video.bvid).map(video => [video.bvid, video])).values(),
  );
}

function mergeNewSourceVideos(
  existingVideos: FavoriteVideo[],
  sourceVideos: FavoriteVideo[],
  addedVideos: FavoriteVideo[],
): FavoriteVideo[] {
  const sourceByBvid = new Map(uniqueVideos(sourceVideos).map(video => [video.bvid, video]));
  const sourceOrder = new Map(Array.from(sourceByBvid.keys(), (bvid, index) => [bvid, index]));
  const merged = existingVideos.map(video => sourceByBvid.get(video.bvid) ?? video);
  const seen = new Set(merged.map(video => video.bvid));

  for (const video of uniqueVideos(addedVideos)) {
    if (seen.has(video.bvid)) continue;
    const targetOrder = sourceOrder.get(video.bvid);
    const insertAt = targetOrder === undefined
      ? -1
      : merged.findIndex(existing => {
          const existingOrder = sourceOrder.get(existing.bvid);
          return existingOrder !== undefined && existingOrder > targetOrder;
        });
    if (insertAt < 0) merged.push(video);
    else merged.splice(insertAt, 0, video);
    seen.add(video.bvid);
  }

  return merged;
}

export interface PlayContext {
  folderId?: number;
  sourceKey?: string;
  /** 搜索来源的稳定键，用于刷新结果页与播放队列的同一快照。 */
  refreshKey?: string;
  sortOption?: string;
  searchQuery?: string;
  favoriteSearch?: {uid: string; keyword: string};
  /** 在线搜索结果队列的分页条件和当前页状态。 */
  onlineSearch?: OnlineSearchQueueContext;
  /** 标识个性化队列，以便独立控制自动缓存与按画像续页。 */
  isPersonalized?: boolean;
  /** 当前队列来自搜索/推荐页，播放时可按需读取视频分P详情。 */
  includeVideoParts?: boolean;
  recommendationPage?: number;
  recommendationHasMore?: boolean;
}

interface PlayerState {
  queue: FavoriteVideo[];
  currentBvid: string | null;
  playbackError: string | null;
  playMode: 'sequential' | 'shuffle';
  originalQueue: FavoriteVideo[];
  playContext: PlayContext | null;
  /** 当前正在播放的分P的 cid，null 表示未解析或单P视频 */
  currentCid: number | null;
  /** 是否正在解析占位符音频资源 */
  isResolving: boolean;
  /** 是否正在后台异步构建播放队列（追加更多分页数据） */
  queueLoading: boolean;
  setQueue: (q: FavoriteVideo[], bvid?: string, context?: PlayContext) => void;
  /** Synchronize the active playback order without replacing the sequential baseline. */
  setCurrentQueue: (q: FavoriteVideo[], bvid?: string) => void;
  setCurrentBvid: (bvid: string | null) => void;
  setPlaybackError: (msg: string | null) => void;
  setPlayMode: (mode: 'sequential' | 'shuffle') => void;
  setPlayContext: (context: PlayContext | null) => void;
  /** 更新当前 cid */
  setCurrentCid: (cid: number | null) => void;
  /** 设置解析状态 */
  setResolving: (resolving: boolean) => void;
  /** 设置后台队列加载状态 */
  setQueueLoading: (loading: boolean) => void;
  togglePlayMode: () => void;
  insertNext: (video: FavoriteVideo) => Promise<void>;
  removeFromQueue: (bvid: string) => Promise<void>;
  reorderQueue: (videos: FavoriteVideo[], startBvid?: string) => Promise<void>;
  appendQueue: (videos: FavoriteVideo[], startBvid?: string) => Promise<void>;
  syncQueueFromSourceRefresh: (
    refreshKey: string,
    sourceVideos: FavoriteVideo[],
    addedVideos: FavoriteVideo[],
  ) => boolean;
  replaceQueueFromSearchRefresh: (refreshKey: string, videos: FavoriteVideo[]) => boolean;
  /** 在队列中更新特定视频的 parts 信息 */
  updateVideoParts: (bvid: string, parts: any[]) => void;
  updateFavoriteFolderMembership: (bvid: string, folderId: number, included: boolean) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      currentBvid: null,
      currentCid: null,
      isResolving: false,
      queueLoading: false,
      playbackError: null,
      playMode: 'sequential',
      originalQueue: [],
      playContext: null,
      setQueue: (queue, bvid, context) => {
        playModeSwitchRevision += 1;
        // 【P0防闪烁优化】setQueue 触发新队列时同步重置播放进度，
        // 避免 PlayerScreen 在新数据就绪前显示上一首歌的 position/duration
        useProgressStore.getState().resetProgress();
        return set(state => ({
          queue,
          currentBvid: bvid ?? queue[0]?.bvid ?? null,
          originalQueue: [...queue],
          currentCid: null,
          playContext: context !== undefined ? context : state.playContext,
        }));
      },
      setCurrentQueue: (queue, bvid) => set(state => ({
        queue,
        currentBvid: bvid ?? (
          state.currentBvid && queue.some(video => video.bvid === state.currentBvid)
            ? state.currentBvid
            : queue[0]?.bvid ?? null
        ),
      })),
      setCurrentBvid: (bvid) => set({ currentBvid: bvid }),
      setCurrentCid: (cid) => set({ currentCid: cid }),
      setResolving: (resolving) => set({ isResolving: resolving }),
      setQueueLoading: (loading) => set({ queueLoading: loading }),
      setPlayContext: (context) => set({ playContext: context }),
      updateVideoParts: (bvid, parts) => set(state => ({
        queue: state.queue.map(v => (v.bvid === bvid ? { ...v, parts } : v)),
        originalQueue: state.originalQueue.map(v => (v.bvid === bvid ? { ...v, parts } : v)),
      })),
      updateFavoriteFolderMembership: (bvid, folderId, included) => {
        const updateMembership = (video: FavoriteVideo): FavoriteVideo => {
          if (video.bvid !== bvid) return video;
          const folderIds = new Set(video.folderIds ?? []);
          if (included) folderIds.add(folderId);
          else folderIds.delete(folderId);
          return {...video, folderIds: Array.from(folderIds)};
        };
        set(state => ({
          queue: state.queue.map(updateMembership),
          originalQueue: state.originalQueue.map(updateMembership),
        }));
      },
      setPlaybackError: (msg) => set({ playbackError: msg }),
      setPlayMode: (mode) => {
        playModeSwitchRevision += 1;
        set({playMode: mode});
      },
      togglePlayMode: () => {
        const targetMode =
          get().playMode === 'sequential' ? 'shuffle' : 'sequential';
        const revision = ++playModeSwitchRevision;
        set({playMode: targetMode});

        setTimeout(() => {
          if (revision !== playModeSwitchRevision) {
            return;
          }

          const currentState = get();
          if (currentState.playMode !== targetMode) {
            return;
          }
          const currentBvid = currentState.currentBvid;
          const baseline = currentState.originalQueue.length > 0
            ? currentState.originalQueue
            : currentState.queue;
          let nextQueue = [...baseline];

          if (targetMode === 'shuffle') {
            const currentTrackIndex = nextQueue.findIndex(
              video => video.bvid === currentBvid,
            );
            if (currentTrackIndex !== -1) {
              const currentTrack = nextQueue.splice(currentTrackIndex, 1)[0];
              for (let i = nextQueue.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [nextQueue[i], nextQueue[j]] = [nextQueue[j], nextQueue[i]];
              }
              nextQueue.unshift(currentTrack);
            } else {
              for (let i = nextQueue.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [nextQueue[i], nextQueue[j]] = [nextQueue[j], nextQueue[i]];
              }
            }
          }

          currentState.setCurrentQueue(nextQueue, currentBvid ?? undefined);
          tpReorderQueue(nextQueue, currentBvid ?? undefined).catch(console.error);
        }, 0);
      },
      // Insert a video to be played next after the current track
      insertNext: async (video) => {
        await tpInsertNext(video);
      },
      // Remove a specific video from the queue by BVID
      removeFromQueue: async (bvid) => {
        await tpRemoveFromQueue(bvid);
      },
      // Reorder entire queue (replace)
      reorderQueue: async (videos, startBvid) => {
        const currentBvid = get().currentBvid;
        set(state => ({
          queue: videos,
          originalQueue: state.playMode === 'sequential' ? videos : state.originalQueue,
        }));
        await tpReorderQueue(videos, currentBvid ?? startBvid ?? undefined);
      },
      // Append a list of videos to the end of the queue
      appendQueue: async (videos, startBvid) => {
        await tpAppendQueue(videos, startBvid);
      },
      syncQueueFromSourceRefresh: (refreshKey, sourceVideos, addedVideos) => {
        const state = get();
        if (
          !refreshKey ||
          (state.playContext?.sourceKey !== refreshKey &&
            state.playContext?.refreshKey !== refreshKey)
        ) {
          return false;
        }

        const sequentialBaseline = state.originalQueue.length > 0
          ? state.originalQueue
          : state.queue;
        const nextOriginalQueue = mergeNewSourceVideos(
          sequentialBaseline,
          sourceVideos,
          addedVideos,
        );
        const existingIds = new Set(state.queue.map(video => video.bvid));
        const nextQueue = state.playMode === 'shuffle'
          ? [
              ...mergeNewSourceVideos(state.queue, sourceVideos, []),
              ...uniqueVideos(addedVideos).filter(video => !existingIds.has(video.bvid)),
            ]
          : mergeNewSourceVideos(state.queue, sourceVideos, addedVideos);
        const membershipChanged = nextQueue.length !== state.queue.length;
        set({queue: nextQueue, originalQueue: nextOriginalQueue});

        if (membershipChanged) {
          void tpReorderQueue(nextQueue, state.currentBvid ?? undefined).catch(console.error);
        }
        return true;
      },
      replaceQueueFromSearchRefresh: (refreshKey, videos) => {
        const state = get();
        if (!refreshKey || state.playContext?.refreshKey !== refreshKey) {
          return false;
        }

        const sourceVideos = uniqueVideos(videos);
        const refreshedByBvid = new Map(sourceVideos.map(video => [video.bvid, video]));
        const currentVideo = state.currentBvid
          ? state.queue.find(video => video.bvid === state.currentBvid)
          : undefined;
        if (currentVideo && !refreshedByBvid.has(currentVideo.bvid)) {
          sourceVideos.unshift(currentVideo);
        }

        let nextQueue = sourceVideos;
        if (state.playMode === 'shuffle') {
          const orderedQueue = state.queue
            .filter(video => refreshedByBvid.has(video.bvid) || video.bvid === state.currentBvid)
            .map(video => refreshedByBvid.get(video.bvid) ?? video);
          const orderedIds = new Set(orderedQueue.map(video => video.bvid));
          nextQueue = [
            ...orderedQueue,
            ...sourceVideos.filter(video => !orderedIds.has(video.bvid)),
          ];
        }

        const membershipChanged =
          nextQueue.length !== state.queue.length ||
          nextQueue.some((video, index) => video.bvid !== state.queue[index]?.bvid);
        set({queue: nextQueue, originalQueue: sourceVideos});
        if (membershipChanged) {
          void tpReorderQueue(nextQueue, state.currentBvid ?? undefined).catch(console.error);
        }
        return true;
      },
    }),
    {
      name: 'playerStore',
      storage: createJSONStorage(() => mmkvStorage),
      onRehydrateStorage: () => state => {
        state?.setQueueLoading(false);
      },
    },
  ),
);
