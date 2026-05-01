import { create } from 'zustand';
import { storage } from '../core/storage';
import type { Quality } from '../types/domain';

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

const KEY = 'settings';
const init: Settings =
  storage.getJSON<Settings>(KEY) || {
    quality: 'low',
    autoCacheOnWifi: true,
    wifiOnly: false,
  };

const persist = (s: Partial<Settings>, prev: Settings) => {
  const next = { ...prev, ...s };
  storage.setJSON(KEY, next);
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...init,
  setQuality: (q) => {
    set({ quality: q });
    persist({ quality: q }, get());
  },
  setAutoCacheOnWifi: (v) => {
    set({ autoCacheOnWifi: v });
    persist({ autoCacheOnWifi: v }, get());
  },
  setWifiOnly: (v) => {
    set({ wifiOnly: v });
    persist({ wifiOnly: v }, get());
  },
}));
