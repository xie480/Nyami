import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { FavoriteVideo } from '../types/domain';
import { storage } from '../core/storage';
import TrackPlayer from 'react-native-track-player';
import { loadQueue, insertNext as tpInsertNext, removeFromQueue as tpRemoveFromQueue, reorderQueue as tpReorderQueue, appendQueue as tpAppendQueue } from '../services/trackPlayer';

// MMKV storage adapter compatible with Zustand persist
const mmkvStorage = {
  getItem: (name: string) => Promise.resolve(storage.getString(name) ?? null),
  setItem: (name: string, value: string) => Promise.resolve(storage.setString(name, value)),
  removeItem: (name: string) => Promise.resolve(storage.delete(name)),
};

interface PlayerState {
  queue: FavoriteVideo[];
  currentBvid: string | null;
  playbackError: string | null;
  setQueue: (q: FavoriteVideo[], bvid?: string) => void;
  setCurrentBvid: (bvid: string | null) => void;
  setPlaybackError: (msg: string | null) => void;
  insertNext: (video: FavoriteVideo) => Promise<void>;
  removeFromQueue: (bvid: string) => Promise<void>;
  reorderQueue: (videos: FavoriteVideo[], startBvid?: string) => Promise<void>;
  appendQueue: (videos: FavoriteVideo[], startBvid?: string) => Promise<void>;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      queue: [],
      currentBvid: null,
      playbackError: null,
      setQueue: (queue, bvid) =>
        set({ queue, currentBvid: bvid ?? queue[0]?.bvid ?? null }),
      setCurrentBvid: (bvid) => set({ currentBvid: bvid }),
      setPlaybackError: (msg) => set({ playbackError: msg }),
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
        await tpReorderQueue(videos, startBvid);
      },
      // Append a list of videos to the end of the queue
      appendQueue: async (videos, startBvid) => {
        await tpAppendQueue(videos, startBvid);
      },
    }),
    {
      name: 'playerStore',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
