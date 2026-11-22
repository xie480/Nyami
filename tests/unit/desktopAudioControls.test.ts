import {getRangeProgressPercent} from '../../desktop/renderer/audio/rangeProgress';
import {
  applyDesktopSettingsPatch,
  mergeDesktopSettingsPatches,
} from '../../desktop/renderer/settingsState';
import type {DesktopSettings} from '../../desktop/shared/types';

const SETTINGS_FIXTURE: DesktopSettings = {
  version: 4,
  theme: 'system',
  quality: 'high',
  closeToTray: false,
  autoSyncIndex: false,
  window: {
    width: 1280,
    height: 820,
    x: null,
    y: null,
  },
  audio: {
    enabled: true,
    mode: 'graphic',
    graphicPreset: 'flat',
    graphicGains: [0, 0],
    peqBands: [],
    limiterEnabled: true,
    limiterThreshold: 0.95,
    loudnessEnabled: false,
    loudnessTargetDb: -18,
    spectrumEnabled: true,
  },
};

describe('桌面音频滑动条进度', () => {
  it('按最小值和最大值计算轨道填充比例并限制边界', () => {
    expect(getRangeProgressPercent(-12, -12, 12)).toBe(0);
    expect(getRangeProgressPercent(0, -12, 12)).toBe(50);
    expect(getRangeProgressPercent(12, -12, 12)).toBe(100);
    expect(getRangeProgressPercent(18, -12, 12)).toBe(100);
    expect(getRangeProgressPercent(-18, -12, 12)).toBe(0);
  });

  it('合并音频补丁时保留未修改的设置并复制数组', () => {
    const next = applyDesktopSettingsPatch(SETTINGS_FIXTURE, {
      audio: {
        limiterThreshold: 0.8,
        graphicGains: [3, -2],
      },
    });

    expect(next.audio).toMatchObject({
      enabled: true,
      limiterThreshold: 0.8,
      loudnessTargetDb: -18,
    });
    expect(next.audio.graphicGains).toEqual([3, -2]);
    expect(next.audio.graphicGains).not.toBe(SETTINGS_FIXTURE.audio.graphicGains);
  });

  it('合并连续补丁时使用最后一次字段值', () => {
    expect(
      mergeDesktopSettingsPatches(
        {audio: {limiterThreshold: 0.8, graphicGains: [1, 2]}},
        {audio: {limiterThreshold: 0.7}},
      ),
    ).toEqual({
      audio: {
        limiterThreshold: 0.7,
        graphicGains: [1, 2],
      },
    });
  });
});
