import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../core/storage';

// MMKV storage adapter for Zustand persist
const mmkvStorage = {
  getItem: (name: string) => Promise.resolve(storage.getString(name) ?? null),
  setItem: (name: string, value: string) => Promise.resolve(storage.setString(name, value)),
  removeItem: (name: string) => Promise.resolve(storage.delete(name)),
};

interface UserState {
  uid: string;
  setUid: (uid: string) => void;
}

// Persisted user store using MMKV via zustand persist middleware
export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      uid: '',
      setUid: (uid) => set({ uid }),
    }),
    {
      name: 'userStore',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
