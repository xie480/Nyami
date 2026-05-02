import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FavoriteVideo } from '../types/domain';
import { storage } from '../core/storage';

// MMKV storage adapter compatible with Zustand persist
const mmkvStorage = {
  getItem: (name: string) => Promise.resolve(storage.getString(name) ?? null),
  setItem: (name: string, value: string) => Promise.resolve(storage.setString(name, value)),
  removeItem: (name: string) => Promise.resolve(storage.delete(name)),
};

interface PlayerState {
  queue: FavoriteVideo[];
  currentBvid: string | null;
  setQueue: (q: FavoriteVideo[], bvid?: string) => void;
  setCurrentBvid: (bvid: string | null) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      queue: [],
      currentBvid: null,
      setQueue: (queue, bvid) =>
        set({ queue, currentBvid: bvid ?? queue[0]?.bvid ?? null }),
      setCurrentBvid: (bvid) => set({ currentBvid: bvid }),
    }),
    {
      name: 'playerStore',
      getStorage: () => mmkvStorage,
    },
  ),
);
