import type {
  DesktopAudioSettings,
  DesktopGraphicPreset,
} from '../../shared/types';

/** 桌面端 Graphic EQ 的标准频段，和 Android 端保持同一组中心频率。 */
export const GRAPHIC_BAND_FREQUENCIES = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;

/**
 * 桌面端首批音色预设。
 * 预设只改变 10 段 Graphic EQ，不覆盖用户的 PEQ 参数。
 */
export const DESKTOP_GRAPHIC_PRESETS: ReadonlyArray<{
  id: DesktopGraphicPreset;
  label: string;
  description: string;
  gains: readonly number[];
}> = [
  {
    id: 'flat',
    label: '原音',
    description: '忠实还原，不染色',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'nyami',
    label: 'Nyami',
    description: '低频扎实，人声明亮',
    gains: [4, 4, 2, -1, -2, 1, 3, 4, 2, 1],
  },
  {
    id: 'cat_bass',
    label: '低频',
    description: '柔弹下潜，不轰头',
    gains: [6, 7, 4, -2, -3, -1, 0, 0, 1, 0],
  },
  {
    id: 'girl_band',
    label: '少女乐队',
    description: '女声前置，吉他明亮',
    gains: [-4, -3, -2, -1, 1, 3, 6, 4, 1, 0],
  },
  {
    id: 'idol_stage',
    label: '偶像现场',
    description: '突出主唱与空气感',
    gains: [-3, -2, -1, -2, -1, 2, 4, 3, 6, 5],
  },
  {
    id: 'midnight_radio',
    label: '深夜电台',
    description: '暖厚收敛，适合熄灯',
    gains: [1, 3, 5, 4, 2, 0, -2, -4, -6, -7],
  },
  {
    id: 'vaporwave',
    label: 'Vaporwave',
    description: '低频绵厚，高频朦胧',
    gains: [5, 6, 3, 1, -2, -3, -4, -3, -5, -8],
  },
];

/** Renderer 在主进程设置加载前使用的安全默认音频参数。 */
export const DEFAULT_DESKTOP_AUDIO_SETTINGS: DesktopAudioSettings = {
  enabled: false,
  mode: 'graphic',
  graphicPreset: 'flat',
  graphicGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  peqBands: [
    {enabled: false, type: 'Peak', frequency: 31, gain: 0, q: 1},
    {enabled: false, type: 'Peak', frequency: 62, gain: 0, q: 1},
    {enabled: false, type: 'Peak', frequency: 125, gain: 0, q: 1},
    {enabled: false, type: 'Peak', frequency: 250, gain: 0, q: 1},
    {enabled: false, type: 'Peak', frequency: 500, gain: 0, q: 1},
    {enabled: false, type: 'Peak', frequency: 1000, gain: 0, q: 1},
    {enabled: false, type: 'Peak', frequency: 2000, gain: 0, q: 1},
    {enabled: false, type: 'Peak', frequency: 4000, gain: 0, q: 1},
  ],
  limiterEnabled: true,
  limiterThreshold: 0.95,
  spectrumEnabled: true,
};

/** 根据预设 ID 返回独立的 Graphic EQ 增益数组。 */
export function getPresetGains(id: DesktopGraphicPreset): number[] {
  const preset = DESKTOP_GRAPHIC_PRESETS.find(item => item.id === id);
  return preset
    ? [...preset.gains]
    : [...DEFAULT_DESKTOP_AUDIO_SETTINGS.graphicGains];
}
