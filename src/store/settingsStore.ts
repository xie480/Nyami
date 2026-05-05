import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { storage } from '../core/storage';
import type { Quality } from '../types/domain';

export type ThemeMode = 'system' | 'light' | 'dark' | 'glass-light' | 'glass-dark';

// 将 MMKV 存储适配器改为同步执行，彻底消除首次渲染时的状态闪烁
const mmkvStorage: StateStorage = {
  getItem: (name: string) => storage.getString(name) ?? null,
  setItem: (name: string, value: string) => storage.setString(name, value),
  removeItem: (name: string) => storage.delete(name),
};

interface Settings {
  quality: Quality;
  autoCacheOnWifi: boolean;
  wifiOnly: boolean;
  hiddenFolderIds: number[];
  expandMultiPart: boolean;
  themeMode: ThemeMode;
  customBackgroundImage: string | null;
  glassBlurAmount: number;
}

interface SettingsState extends Settings {
  setQuality: (q: Quality) => void;
  setAutoCacheOnWifi: (v: boolean) => void;
  setWifiOnly: (v: boolean) => void;
  setHiddenFolderIds: (ids: number[]) => void;
  setExpandMultiPart: (v: boolean) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setCustomBackgroundImage: (uri: string | null) => void;
  setGlassBlurAmount: (v: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      quality: 'low',
      autoCacheOnWifi: true,
      wifiOnly: false,
      hiddenFolderIds: [],
      expandMultiPart: true,
      themeMode: 'glass-dark',
      customBackgroundImage: null,
      glassBlurAmount: 28,
      setQuality: (q) => set({ quality: q }),
      setAutoCacheOnWifi: (v) => set({ autoCacheOnWifi: v }),
      setWifiOnly: (v) => set({ wifiOnly: v }),
      setHiddenFolderIds: (ids) => set({ hiddenFolderIds: ids }),
      setExpandMultiPart: (v) => set({ expandMultiPart: v }),
      setThemeMode: (mode) => set({ themeMode: mode }),
      setCustomBackgroundImage: (uri) => set({ customBackgroundImage: uri }),
      setGlassBlurAmount: (v) => set({ glassBlurAmount: v }),
    }),
    {
      name: 'settingsStore',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
