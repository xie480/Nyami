import type {
  DesktopAudioSettings,
  DesktopSettings,
  DesktopSettingsPatch,
} from '../shared/types';

/** 将设置补丁应用到 Renderer 快照，支持音频控件的乐观更新。 */
export function applyDesktopSettingsPatch(
  settings: DesktopSettings,
  patch: DesktopSettingsPatch,
): DesktopSettings {
  return {
    ...settings,
    ...patch,
    window: {
      ...settings.window,
      ...(patch.window ?? {}),
    },
    audio: cloneAudioSettings({
      ...settings.audio,
      ...(patch.audio ?? {}),
    }),
  };
}

/** 合并待持久化设置补丁，避免滑动条拖动时每次都触发一次磁盘写入。 */
export function mergeDesktopSettingsPatches(
  current: DesktopSettingsPatch,
  next: DesktopSettingsPatch,
): DesktopSettingsPatch {
  const merged: DesktopSettingsPatch = {
    ...current,
    ...next,
  };
  if (current.window || next.window) {
    merged.window = {
      ...(current.window ?? {}),
      ...(next.window ?? {}),
    };
  }
  if (current.audio || next.audio) {
    const audio = {
      ...(current.audio ?? {}),
      ...(next.audio ?? {}),
    };
    if (next.audio?.graphicGains !== undefined) {
      audio.graphicGains = [...next.audio.graphicGains];
    } else if (current.audio?.graphicGains !== undefined) {
      audio.graphicGains = [...current.audio.graphicGains];
    }
    if (next.audio?.peqBands !== undefined) {
      audio.peqBands = next.audio.peqBands.map(band => ({...band}));
    } else if (current.audio?.peqBands !== undefined) {
      audio.peqBands = current.audio.peqBands.map(band => ({...band}));
    }
    merged.audio = audio;
  }
  return merged;
}

/** 深拷贝音频设置数组，避免 UI 状态与异步音频线程共享可变引用。 */
function cloneAudioSettings(
  settings: DesktopAudioSettings,
): DesktopAudioSettings {
  return {
    ...settings,
    graphicGains: [...settings.graphicGains],
    peqBands: settings.peqBands.map(band => ({...band})),
  };
}
