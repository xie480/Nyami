import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { storage } from '../core/storage';
import type { Quality } from '../types/domain';

// MMKV storage adapter for zustand persist
const mmkvStorage = {
  getItem: (name: string) => Promise.resolve(storage.getString(name) ?? null),
  setItem: (name: string, value: string) => Promise.resolve(storage.setString(name, value)),
  removeItem: (name: string) => Promise.resolve(storage.delete(name)),
};

interface Settings {
  quality: Quality;
  autoCacheOnWifi: boolean;
  wifiOnly: boolean;
}

interface SettingsState extends Settings {
  setQuality: (q: Quality) => void;
  setAutoCacheOnWifi: (v: boolean) => void;
  setWifiOnly: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      quality: 'low',
      autoCacheOnWifi: true,
      wifiOnly: false,
      setQuality: (q) => set({ quality: q }),
      setAutoCacheOnWifi: (v) => set({ autoCacheOnWifi: v }),
      setWifiOnly: (v) => set({ wifiOnly: v }),
    }),
    {
      name: 'settingsStore',
      getStorage: () => mmkvStorage,
    },
  ),
);
