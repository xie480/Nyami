import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {
  DesktopAudioSettings,
  DesktopEqMode,
  DesktopGraphicPreset,
  DesktopPeqBand,
  DesktopSettings,
  DesktopSettingsPatch,
  DesktopTheme,
  WindowSettings,
} from '../../shared/types';
import type {AppDirectories} from './appDirectories';

const SETTINGS_FILE_NAME = 'desktop.json';
const SETTINGS_VERSION = 2 as const;
const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 640;
const MAX_WINDOW_WIDTH = 8192;
const MAX_WINDOW_HEIGHT = 8192;
const GRAPHIC_BAND_COUNT = 10;
const PEQ_BAND_COUNT = 8;
const MIN_GRAPHIC_GAIN = -12;
const MAX_GRAPHIC_GAIN = 12;
const MIN_PEQ_FREQUENCY = 20;
const MAX_PEQ_FREQUENCY = 20000;
const MIN_PEQ_GAIN = -18;
const MAX_PEQ_GAIN = 18;
const MIN_PEQ_Q = 0.1;
const MAX_PEQ_Q = 20;
const MIN_LIMITER_THRESHOLD = 0.5;
const MAX_LIMITER_THRESHOLD = 1;

const GRAPHIC_PRESETS: readonly DesktopGraphicPreset[] = [
  'flat',
  'nyami',
  'cat_bass',
  'girl_band',
  'idol_stage',
  'midnight_radio',
  'vaporwave',
  'custom',
];

const EQ_MODES: readonly DesktopEqMode[] = ['graphic', 'parametric'];

const DEFAULT_GRAPHIC_GAINS = [
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
];

const DEFAULT_PEQ_BANDS: DesktopPeqBand[] = [
  {enabled: false, frequency: 31, gain: 0, q: 1},
  {enabled: false, frequency: 62, gain: 0, q: 1},
  {enabled: false, frequency: 125, gain: 0, q: 1},
  {enabled: false, frequency: 250, gain: 0, q: 1},
  {enabled: false, frequency: 500, gain: 0, q: 1},
  {enabled: false, frequency: 1000, gain: 0, q: 1},
  {enabled: false, frequency: 2000, gain: 0, q: 1},
  {enabled: false, frequency: 4000, gain: 0, q: 1},
];

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  version: SETTINGS_VERSION,
  theme: 'system',
  closeToTray: false,
  window: {
    width: 1280,
    height: 820,
    x: null,
    y: null,
  },
  audio: {
    enabled: false,
    mode: 'graphic',
    graphicPreset: 'flat',
    graphicGains: [...DEFAULT_GRAPHIC_GAINS],
    peqBands: clonePeqBands(DEFAULT_PEQ_BANDS),
    limiterEnabled: true,
    limiterThreshold: 0.95,
    spectrumEnabled: true,
  },
};

const THEMES: readonly DesktopTheme[] = [
  'system',
  'light',
  'dark',
  'glass',
];

/**
 * 桌面设置文件存储。
 * 只保存可公开给 Renderer 的偏好，不保存 Cookie、token 或其他凭证。
 */
export class SettingsStore {
  private settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;

  private loaded = false;

  /**
   * 创建设置存储并绑定 settings 目录。
   * @param directories 应用数据目录
   */
  constructor(private readonly directories: AppDirectories) {}

  /**
   * 加载并校验设置文件，文件损坏时回退默认值。
   * @returns 规范化后的桌面设置
   */
  async load(): Promise<DesktopSettings> {
    try {
      const content = await fs.readFile(this.getFilePath(), 'utf8');
      this.settings = normalizeSettings(JSON.parse(content));
    } catch {
      this.settings = DEFAULT_DESKTOP_SETTINGS;
    }
    this.loaded = true;
    return this.get();
  }

  /**
   * 获取当前设置快照。
   * @returns 不含敏感信息的设置对象
   */
  get(): DesktopSettings {
    return cloneSettings(this.settings);
  }

  /**
   * 合并并持久化 Renderer 提交的设置补丁。
   * @param patch 经过 IPC 类型校验的设置补丁
   * @returns 保存后的设置快照
   */
  async update(patch: DesktopSettingsPatch): Promise<DesktopSettings> {
    if (!this.loaded) {
      await this.load();
    }
    this.settings = normalizeSettings({
      ...this.settings,
      ...patch,
      window: {
        ...this.settings.window,
        ...(patch.window ?? {}),
      },
      audio: {
        ...this.settings.audio,
        ...(patch.audio ?? {}),
      },
    });
    await this.persist();
    return this.get();
  }

  /**
   * 保存窗口边界，供下次启动恢复上一次布局。
   * @param bounds Electron 窗口边界
   * @returns 持久化任务
   */
  async updateWindowBounds(bounds: WindowSettings): Promise<void> {
    await this.update({window: bounds});
  }

  /**
   * 返回设置文件路径，仅供主进程内部使用。
   * @returns 设置文件绝对路径
   */
  getFilePath(): string {
    return path.join(this.directories.settings, SETTINGS_FILE_NAME);
  }

  /**
   * 以临时文件加替换的方式保存设置，降低进程中断导致的损坏概率。
   * @returns 保存完成后的 Promise
   */
  private async persist(): Promise<void> {
    await fs.mkdir(this.directories.settings, {recursive: true});
    const temporaryPath = `${this.getFilePath()}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(this.settings, null, 2), {
      encoding: 'utf8',
    });
    try {
      await fs.rename(temporaryPath, this.getFilePath());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') {
        throw error;
      }
      await fs.rm(this.getFilePath(), {force: true});
      await fs.rename(temporaryPath, this.getFilePath());
    }
  }
}

/**
 * 校验并规范化任意 JSON 设置。
 * @param value 解析后的未知对象
 * @returns 安全可用的设置快照
 */
export function normalizeSettings(value: unknown): DesktopSettings {
  const record = isRecord(value) ? value : {};
  const windowValue = isRecord(record.window) ? record.window : {};
  const defaultWindow = DEFAULT_DESKTOP_SETTINGS.window;
  return {
    version: SETTINGS_VERSION,
    theme: isTheme(record.theme) ? record.theme : DEFAULT_DESKTOP_SETTINGS.theme,
    closeToTray:
      typeof record.closeToTray === 'boolean'
        ? record.closeToTray
        : DEFAULT_DESKTOP_SETTINGS.closeToTray,
    window: {
      width: normalizeDimension(
        windowValue.width,
        defaultWindow.width,
        MIN_WINDOW_WIDTH,
        MAX_WINDOW_WIDTH,
      ),
      height: normalizeDimension(
        windowValue.height,
        defaultWindow.height,
        MIN_WINDOW_HEIGHT,
        MAX_WINDOW_HEIGHT,
      ),
      x: normalizeCoordinate(windowValue.x),
      y: normalizeCoordinate(windowValue.y),
    },
    audio: normalizeAudioSettings(record.audio),
  };
}

/**
 * 深拷贝设置，避免调用方修改内存中的主进程状态。
 * @param settings 原始设置
 * @returns 独立的设置对象
 */
function cloneSettings(settings: DesktopSettings): DesktopSettings {
  return {
    ...settings,
    window: {
      ...settings.window,
    },
    audio: {
      ...settings.audio,
      graphicGains: [...settings.audio.graphicGains],
      peqBands: clonePeqBands(settings.audio.peqBands),
    },
  };
}

/**
 * 校验并规范化桌面音频处理参数。
 * @param value 外部 JSON 或 Renderer 设置补丁中的音频参数
 * @returns 可安全发送到 AudioWorklet 的音频设置
 */
export function normalizeAudioSettings(value: unknown): DesktopAudioSettings {
  const record = isRecord(value) ? value : {};
  const graphicGains = normalizeGraphicGains(record.graphicGains);
  const peqBands = normalizePeqBands(record.peqBands);
  return {
    enabled:
      typeof record.enabled === 'boolean'
        ? record.enabled
        : DEFAULT_DESKTOP_SETTINGS.audio.enabled,
    mode: isEqMode(record.mode)
      ? record.mode
      : DEFAULT_DESKTOP_SETTINGS.audio.mode,
    graphicPreset: isGraphicPreset(record.graphicPreset)
      ? record.graphicPreset
      : DEFAULT_DESKTOP_SETTINGS.audio.graphicPreset,
    graphicGains,
    peqBands,
    limiterEnabled:
      typeof record.limiterEnabled === 'boolean'
        ? record.limiterEnabled
        : DEFAULT_DESKTOP_SETTINGS.audio.limiterEnabled,
    limiterThreshold: normalizeNumber(
      record.limiterThreshold,
      DEFAULT_DESKTOP_SETTINGS.audio.limiterThreshold,
      MIN_LIMITER_THRESHOLD,
      MAX_LIMITER_THRESHOLD,
    ),
    spectrumEnabled:
      typeof record.spectrumEnabled === 'boolean'
        ? record.spectrumEnabled
        : DEFAULT_DESKTOP_SETTINGS.audio.spectrumEnabled,
  };
}

/** 规范化 10 段 Graphic EQ 增益，缺失项使用平直曲线。 */
function normalizeGraphicGains(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [];
  return Array.from({length: GRAPHIC_BAND_COUNT}, (_item, index) =>
    normalizeNumber(
      values[index],
      DEFAULT_GRAPHIC_GAINS[index] ?? 0,
      MIN_GRAPHIC_GAIN,
      MAX_GRAPHIC_GAIN,
    ),
  );
}

/** 规范化 8 段 PEQ 参数，避免非法参数进入音频处理线程。 */
function normalizePeqBands(value: unknown): DesktopPeqBand[] {
  const values = Array.isArray(value) ? value : [];
  return Array.from({length: PEQ_BAND_COUNT}, (_item, index) => {
    const source = isRecord(values[index]) ? values[index] : {};
    const fallback = DEFAULT_PEQ_BANDS[index] ?? DEFAULT_PEQ_BANDS[0];
    return {
      enabled:
        typeof source.enabled === 'boolean'
          ? source.enabled
          : fallback.enabled,
      frequency: normalizeNumber(
        source.frequency,
        fallback.frequency,
        MIN_PEQ_FREQUENCY,
        MAX_PEQ_FREQUENCY,
      ),
      gain: normalizeNumber(
        source.gain,
        fallback.gain,
        MIN_PEQ_GAIN,
        MAX_PEQ_GAIN,
      ),
      q: normalizeNumber(source.q, fallback.q, MIN_PEQ_Q, MAX_PEQ_Q),
    };
  });
}

/** 复制 PEQ 数组，避免设置快照被 Renderer 修改。 */
function clonePeqBands(bands: readonly DesktopPeqBand[]): DesktopPeqBand[] {
  return bands.map(band => ({...band}));
}

/** 判断值是否为合法 EQ 模式。 */
function isEqMode(value: unknown): value is DesktopEqMode {
  return typeof value === 'string' && EQ_MODES.includes(value as DesktopEqMode);
}

/** 判断值是否为允许的 Graphic EQ 预设。 */
function isGraphicPreset(value: unknown): value is DesktopGraphicPreset {
  return (
    typeof value === 'string' &&
    GRAPHIC_PRESETS.includes(value as DesktopGraphicPreset)
  );
}

/** 将外部数值限制在音频参数允许的范围内。 */
function normalizeNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * 判断值是否为普通对象。
 * @param value 待判断值
 * @returns 是否为非 null 对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 判断主题值是否属于固定枚举。
 * @param value 待判断值
 * @returns 是否为合法主题
 */
function isTheme(value: unknown): value is DesktopTheme {
  return typeof value === 'string' && THEMES.includes(value as DesktopTheme);
}

/**
 * 将窗口宽高限制在安全范围内。
 * @param value 外部输入值
 * @param fallback 非法时的默认值
 * @param minimum 最小值
 * @param maximum 最大值
 * @returns 规范化后的整数
 */
function normalizeDimension(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

/**
 * 将窗口坐标限制为有限整数或 null。
 * @param value 外部输入值
 * @returns 规范化后的坐标
 */
function normalizeCoordinate(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}
