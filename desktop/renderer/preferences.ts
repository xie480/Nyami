/**
 * 桌面端同步 Android 设置页的本地偏好。
 * 这些偏好不改变 Electron 主进程协议，先在 Renderer 持久化，便于和已有桌面设置兼容。
 */

export type DesktopUserPreferences = {
  autoRefreshFavoritesOnLaunch: boolean;
  homeRefreshMode: 'automatic' | 'manual';
  homeRefreshIntervalHours: number;
  recommendationDurationFilterEnabled: boolean;
  recommendationDurationLimitMinutes: number;
  recommendationTagBlacklist: string[];
  cachePersonalizedRecommendations: boolean;
  quality: 'standard' | 'high' | 'best';
  wifiOnly: boolean;
  autoCacheOnWifi: boolean;
  expandMultiPart: boolean;
  mixWithOthers: boolean;
};

const DESKTOP_USER_PREFERENCES_KEY = 'nyami-desktop-user-preferences';

export const DEFAULT_DESKTOP_USER_PREFERENCES: DesktopUserPreferences = {
  autoRefreshFavoritesOnLaunch: false,
  homeRefreshMode: 'manual',
  homeRefreshIntervalHours: 12,
  recommendationDurationFilterEnabled: false,
  recommendationDurationLimitMinutes: 30,
  recommendationTagBlacklist: [],
  cachePersonalizedRecommendations: false,
  quality: 'standard',
  wifiOnly: false,
  autoCacheOnWifi: false,
  expandMultiPart: false,
  mixWithOthers: false,
};

/** 从本地设置读取并校验 Android 端同步到桌面的偏好。 */
export function loadDesktopUserPreferences(): DesktopUserPreferences {
  try {
    const raw = window.localStorage.getItem(DESKTOP_USER_PREFERENCES_KEY);
    if (!raw) {
      return {...DEFAULT_DESKTOP_USER_PREFERENCES};
    }
    const parsed = JSON.parse(raw) as Partial<DesktopUserPreferences>;
    const quality =
      parsed.quality === 'high' || parsed.quality === 'best'
        ? parsed.quality
        : DEFAULT_DESKTOP_USER_PREFERENCES.quality;
    const homeRefreshMode =
      parsed.homeRefreshMode === 'automatic'
        ? parsed.homeRefreshMode
        : DEFAULT_DESKTOP_USER_PREFERENCES.homeRefreshMode;
    const blacklist = Array.isArray(parsed.recommendationTagBlacklist)
      ? parsed.recommendationTagBlacklist.filter(
          item => typeof item === 'string' && item.trim(),
        )
      : DEFAULT_DESKTOP_USER_PREFERENCES.recommendationTagBlacklist;
    return {
      ...DEFAULT_DESKTOP_USER_PREFERENCES,
      ...parsed,
      quality,
      homeRefreshMode,
      recommendationTagBlacklist: blacklist,
      homeRefreshIntervalHours: normalizePositiveNumber(
        parsed.homeRefreshIntervalHours,
        DEFAULT_DESKTOP_USER_PREFERENCES.homeRefreshIntervalHours,
      ),
      recommendationDurationLimitMinutes: normalizePositiveNumber(
        parsed.recommendationDurationLimitMinutes,
        DEFAULT_DESKTOP_USER_PREFERENCES.recommendationDurationLimitMinutes,
      ),
    };
  } catch {
    return {...DEFAULT_DESKTOP_USER_PREFERENCES};
  }
}

/** 保存桌面同步偏好，存储失败时不阻断当前界面操作。 */
export function saveDesktopUserPreferences(
  preferences: DesktopUserPreferences,
): void {
  try {
    window.localStorage.setItem(
      DESKTOP_USER_PREFERENCES_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // 本地存储被禁用时保留内存态，避免设置页失去响应。
  }
}

/** 将输入转换为大于零的整数设置。 */
function normalizePositiveNumber(value: unknown, fallback: number): number {
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) && next > 0 ? Math.floor(next) : fallback;
}
