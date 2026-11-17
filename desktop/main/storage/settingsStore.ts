import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {
  DesktopSettings,
  DesktopSettingsPatch,
  DesktopTheme,
  WindowSettings,
} from '../../shared/types';
import type {AppDirectories} from './appDirectories';

const SETTINGS_FILE_NAME = 'desktop.json';
const SETTINGS_VERSION = 1 as const;
const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 640;
const MAX_WINDOW_WIDTH = 8192;
const MAX_WINDOW_HEIGHT = 8192;

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
  };
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
