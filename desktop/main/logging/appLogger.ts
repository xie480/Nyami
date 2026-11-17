import {promises as fs} from 'node:fs';
import path from 'node:path';
import {redactUrl} from '../security/urlPolicy';
import type {
  DesktopLogEntry,
  DesktopLogLevel,
} from '../../shared/types';

const LOG_FILE_NAME = 'nyami.log';
const DEFAULT_RECENT_LOG_LIMIT = 100;
const MAX_LOG_TEXT_LENGTH = 2000;

const SENSITIVE_KEY_PATTERN = /(cookie|token|secret|password|authorization|qrcode|refresh)/i;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /((?:SESSDATA|bili_jct|DedeUserID|refresh_token|access_token|qrcode_key|authorization|cookie|token|password)\s*[:=]\s*)([^\s,;}'"]+)/gi;

/**
 * 主进程本地脱敏日志器。
 * 初始化前暂存少量日志，初始化后写入 userData/logs/nyami.log。
 */
export class AppLogger {
  private logFilePath: string | null = null;

  private pendingLines: string[] = [];

  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * 初始化日志目录并刷新初始化前缓存。
   * @param logDirectory 应用日志目录
   * @returns 初始化完成后的 Promise
   */
  async initialize(logDirectory: string): Promise<void> {
    await fs.mkdir(logDirectory, {recursive: true});
    this.logFilePath = path.join(logDirectory, LOG_FILE_NAME);
    const pending = this.pendingLines.splice(0);
    if (pending.length) {
      await fs.appendFile(this.logFilePath, `${pending.join('')}\n`, 'utf8');
    }
  }

  /**
   * 写入调试日志。
   * @param event 稳定的事件名称
   * @param details 可选结构化信息
   */
  debug(event: string, details?: unknown): void {
    this.write('debug', event, details);
  }

  /**
   * 写入普通运行日志。
   * @param event 稳定的事件名称
   * @param details 可选结构化信息
   */
  info(event: string, details?: unknown): void {
    this.write('info', event, details);
  }

  /**
   * 写入警告日志。
   * @param event 稳定的事件名称
   * @param details 可选结构化信息
   */
  warn(event: string, details?: unknown): void {
    this.write('warn', event, details);
  }

  /**
   * 写入错误日志。
   * @param event 稳定的事件名称
   * @param details 可选结构化信息
   */
  error(event: string, details?: unknown): void {
    this.write('error', event, details);
  }

  /**
   * 读取最近的脱敏日志条目。
   * @param limit 返回条数上限
   * @returns 按时间正序排列的日志条目
   */
  async readRecent(limit = DEFAULT_RECENT_LOG_LIMIT): Promise<DesktopLogEntry[]> {
    if (!this.logFilePath) {
      return [];
    }
    await this.writeQueue;
    try {
      const content = await fs.readFile(this.logFilePath, 'utf8');
      return content
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit)
        .map(line => JSON.parse(line) as DesktopLogEntry);
    } catch {
      return [];
    }
  }

  /**
   * 清空本地日志文件。
   * @returns 清空完成后的 Promise
   */
  async clear(): Promise<void> {
    if (!this.logFilePath) {
      this.pendingLines = [];
      return;
    }
    await this.writeQueue;
    await fs.writeFile(this.logFilePath, '', 'utf8');
  }

  /**
   * 将已脱敏的日志文件复制到用户选择的目标路径。
   * @param targetPath 用户在保存对话框中选择的导出路径
   * @returns 导出文件字节数
   */
  async exportTo(targetPath: string): Promise<number> {
    await this.writeQueue;
    if (!this.logFilePath) {
      await fs.writeFile(targetPath, '', 'utf8');
      return 0;
    }
    await fs.copyFile(this.logFilePath, targetPath);
    const stat = await fs.stat(targetPath);
    return stat.size;
  }

  /**
   * 等待当前日志写入队列完成。
   * 异常退出前调用该方法，确保脱敏错误摘要已经落盘。
   * @returns 写入队列完成后的 Promise
   */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  /**
   * 返回当前日志文件路径，仅供主进程内部使用。
   * @returns 日志文件路径；未初始化时返回 null
   */
  getFilePath(): string | null {
    return this.logFilePath;
  }

  /**
   * 将日志排队写入文件，同时在开发环境保留控制台诊断。
   * @param level 日志级别
   * @param event 事件名称
   * @param details 原始结构化信息
   */
  private write(level: DesktopLogLevel, event: string, details?: unknown): void {
    const entry: DesktopLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event: redactText(event),
    };
    const safeDetails = redactValue(details);
    if (isRecord(safeDetails)) {
      entry.details = safeDetails;
    }
    const line = `${JSON.stringify(entry)}\n`;
    if (!this.logFilePath) {
      this.pendingLines.push(line);
      if (this.pendingLines.length > 50) {
        this.pendingLines.shift();
      }
      return;
    }
    const filePath = this.logFilePath;
    this.writeQueue = this.writeQueue
      .then(() => fs.appendFile(filePath, line, 'utf8'))
      .catch(() => undefined);
  }
}

/**
 * 递归清理日志字段中的凭证、URL 查询参数和过长文本。
 * @param value 任意日志值
 * @param key 当前字段名
 * @returns 可安全写入日志的值
 */
export function redactValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (value instanceof Error) {
    return {
      name: redactText(value.name),
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item));
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      result[entryKey] = redactValue(entryValue, entryKey);
    }
    return result;
  }
  return value;
}

/**
 * 清理字符串中的敏感赋值、URL 查询参数和超长内容。
 * @param value 原始文本
 * @returns 脱敏后的文本
 */
export function redactText(value: string): string {
  const withoutSecrets = value.replace(
    SENSITIVE_ASSIGNMENT_PATTERN,
    '$1[redacted]',
  );
  const withoutQuery = withoutSecrets.replace(
    /https?:\/\/[^\s'"<>]+/gi,
    match => redactUrl(match),
  );
  if (withoutQuery.length <= MAX_LOG_TEXT_LENGTH) {
    return withoutQuery;
  }
  return `${withoutQuery.slice(0, MAX_LOG_TEXT_LENGTH)}…`;
}

/**
 * 判断值是否为可写入日志的对象。
 * @param value 待判断值
 * @returns 是否为普通对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
