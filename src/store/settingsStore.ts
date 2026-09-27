import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { storage } from '../core/storage';
import { config } from '../config';
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
  mixWithOthers: boolean;
  noCacheFolderIds: number[];
  recommendationDurationFilterEnabled: boolean;
  recommendationDurationLimitMinutes: number;
  recommendationTagBlacklist: string[];
  cachePersonalizedRecommendations: boolean;
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
  setMixWithOthers: (v: boolean) => void;
  setNoCacheFolderIds: (ids: number[]) => void;
  setRecommendationDurationFilterEnabled: (enabled: boolean) => void;
  setRecommendationDurationLimitMinutes: (minutes: number) => void;
  setRecommendationTagBlacklist: (keywords: string[]) => void;
  setCachePersonalizedRecommendations: (enabled: boolean) => void;
}

function normalizeTagBlacklist(keywords: string[]): string[] {
  const normalized = new Map<string, string>();
  for (const keyword of keywords) {
    const value = keyword.trim().slice(0, config.recommendations.maxBlacklistKeywordLength);
    const key = value.toLocaleLowerCase();
    if (key && !normalized.has(key)) {
      normalized.set(key, value);
    }
    if (normalized.size >= config.recommendations.maxBlacklistKeywords) {
      break;
    }
  }
  return Array.from(normalized.values());
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
      mixWithOthers: false,
      noCacheFolderIds: [],
      recommendationDurationFilterEnabled: true,
      recommendationDurationLimitMinutes: config.recommendations.defaultDurationLimitMinutes,
      recommendationTagBlacklist: [],
      cachePersonalizedRecommendations: false,
      setQuality: (q) => set({ quality: q }),
      setAutoCacheOnWifi: (v) => set({ autoCacheOnWifi: v }),
      setWifiOnly: (v) => set({ wifiOnly: v }),
      setHiddenFolderIds: (ids) => set({ hiddenFolderIds: ids }),
      setExpandMultiPart: (v) => set({ expandMultiPart: v }),
      setThemeMode: (mode) => set({ themeMode: mode }),
      setCustomBackgroundImage: (uri) => set({ customBackgroundImage: uri }),
      setGlassBlurAmount: (v) => set({ glassBlurAmount: v }),
      setMixWithOthers: (v) => set({ mixWithOthers: v }),
      setNoCacheFolderIds: (ids) => set({ noCacheFolderIds: ids }),
      setRecommendationDurationFilterEnabled: (enabled) =>
        set({recommendationDurationFilterEnabled: enabled}),
      setRecommendationDurationLimitMinutes: (minutes) => {
        if (!Number.isFinite(minutes)) return;
        const value = Math.max(
          1,
          Math.min(config.recommendations.maxDurationLimitMinutes, Math.floor(minutes)),
        );
        set({recommendationDurationLimitMinutes: value});
      },
      setRecommendationTagBlacklist: (keywords) =>
        set({recommendationTagBlacklist: normalizeTagBlacklist(keywords)}),
      setCachePersonalizedRecommendations: (enabled) =>
        set({cachePersonalizedRecommendations: enabled}),
    }),
    {
      name: 'settingsStore',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
