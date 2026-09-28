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

export interface PlayContext {
  folderId?: number;
  sourceKey?: string;
  sortOption?: string;
  searchQuery?: string;
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
  /** 在队列中更新特定视频的 parts 信息 */
  updateVideoParts: (bvid: string, parts: any[]) => void;
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
