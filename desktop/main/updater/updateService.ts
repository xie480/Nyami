import {app, net, shell} from 'electron';
import type {DesktopUpdateInfo} from '../../shared/types';
import {AppLogger} from '../logging/appLogger';

const DEFAULT_UPDATE_TIMEOUT_MS = 10000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

type UpdateManifest = {
  version: string;
  releaseDate?: string;
  notes?: string;
  url: string;
  portableUrl?: string;
  sha256: string;
  blockmapUrl?: string | null;
  channel?: string;
};

export type UpdateServiceOptions = {
  source?: string | null;
  currentVersion?: string;
  timeoutMs?: number;
  fetcher?: typeof net.fetch;
};

/**
 * 桌面端手动更新检查服务。
 * 更新源通过 NYAMI_UPDATE_URL 或构造参数配置，Renderer 只接收脱敏清单。
 */
export class UpdateService {
  private readonly source: string | null;

  private readonly currentVersion: string;

  private readonly timeoutMs: number;

  private readonly fetcher: typeof net.fetch;

  private lastResult: DesktopUpdateInfo;

  /**
   * 创建更新检查服务。
   * @param options 更新源、版本和网络请求配置
   */
  constructor(
    private readonly logger: AppLogger,
    options: UpdateServiceOptions = {},
  ) {
    this.source = normalizeSource(
      options.source ?? process.env.NYAMI_UPDATE_URL ?? null,
    );
    this.currentVersion = options.currentVersion ?? app.getVersion();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS;
    this.fetcher = options.fetcher ?? net.fetch.bind(net);
    this.lastResult = createBaseResult(
      this.currentVersion,
      this.source,
      this.source ? 'idle' : 'disabled',
    );
  }

  /**
   * 返回最近一次更新检查结果。
   * @returns Renderer 可见的更新状态快照
   */
  getStatus(): DesktopUpdateInfo {
    return {...this.lastResult};
  }

  /**
   * 从配置的更新源读取 latest.json 并比较版本。
   * @returns 更新检查结果；网络失败会转换成可展示的 error 状态
   */
  async check(): Promise<DesktopUpdateInfo> {
    if (!this.source) {
      this.lastResult = createBaseResult(
        this.currentVersion,
        null,
        'disabled',
      );
      return this.getStatus();
    }

    this.lastResult = {
      ...this.lastResult,
      status: 'checking',
      error: null,
    };
    try {
      const manifestUrl = resolveManifestUrl(this.source);
      const response = await this.fetchManifest(manifestUrl);
      if (!response.ok) {
        throw new Error(`更新源返回 HTTP ${response.status}`);
      }
      const text = await readResponseText(response);
      const manifest = parseManifest(JSON.parse(text));
      const result = createResultFromManifest(
        this.currentVersion,
        manifestUrl,
        manifest,
      );
      this.lastResult = result;
      this.logger.info('updater.check-completed', {
        status: result.status,
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
      });
      return this.getStatus();
    } catch (error) {
      const message = getErrorMessage(error, '更新检查失败');
      this.lastResult = {
        ...createBaseResult(this.currentVersion, this.source, 'error'),
        checkedAt: Date.now(),
        error: message,
      };
      this.logger.warn('updater.check-failed', {error});
      return this.getStatus();
    }
  }

  /**
   * 打开最近一次检查得到的安装包地址，更新仍由用户手动确认。
   * @returns 是否成功交给系统默认浏览器
   */
  async openDownload(): Promise<boolean> {
    if (
      this.lastResult.status !== 'available' ||
      !this.lastResult.downloadUrl
    ) {
      return false;
    }
    await shell.openExternal(this.lastResult.downloadUrl);
    this.logger.info('updater.download-opened', {
      version: this.lastResult.latestVersion,
    });
    return true;
  }

  /**
   * 使用 AbortController 限制更新清单请求时间。
   * @param manifestUrl 清单地址
   * @returns HTTP 响应
   */
  private async fetchManifest(manifestUrl: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(manifestUrl, {
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 创建不携带发布详情的基础更新状态。
 * @param currentVersion 当前版本
 * @param source 更新源
 * @param status 初始状态
 * @returns 更新状态快照
 */
function createBaseResult(
  currentVersion: string,
  source: string | null,
  status: DesktopUpdateInfo['status'],
): DesktopUpdateInfo {
  return {
    status,
    currentVersion,
    latestVersion: null,
    releaseDate: null,
    notes: null,
    downloadUrl: null,
    portableUrl: null,
    sha256: null,
    blockmapUrl: null,
    source,
    checkedAt: null,
    error: null,
  };
}

/**
 * 将清单转换为 Renderer 可见的更新结果。
 * @param currentVersion 当前版本
 * @param manifestUrl 清单地址
 * @param manifest 已校验清单
 * @returns 更新状态快照
 */
function createResultFromManifest(
  currentVersion: string,
  manifestUrl: string,
  manifest: UpdateManifest,
): DesktopUpdateInfo {
  const latestVersion = manifest.version;
  return {
    status:
      compareVersions(latestVersion, currentVersion) > 0
        ? 'available'
        : 'up-to-date',
    currentVersion,
    latestVersion,
    releaseDate: manifest.releaseDate ?? null,
    notes: manifest.notes ?? null,
    downloadUrl: resolveDownloadUrl(manifest.url, manifestUrl),
    portableUrl: manifest.portableUrl
      ? resolveDownloadUrl(manifest.portableUrl, manifestUrl)
      : null,
    sha256: manifest.sha256.toLowerCase(),
    blockmapUrl: manifest.blockmapUrl
      ? resolveDownloadUrl(manifest.blockmapUrl, manifestUrl)
      : null,
    source: manifestUrl,
    checkedAt: Date.now(),
    error: null,
  };
}

/**
 * 规范化更新源地址，支持直接传入 latest.json 或目录地址。
 * @param value 外部配置值
 * @returns 安全的更新源地址；非法值返回 null
 */
function normalizeSource(value: string | null): string | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (!isAllowedUpdateUrl(url)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 将目录更新源解析为 latest.json。
 * @param source 更新源地址
 * @returns 清单地址
 */
function resolveManifestUrl(source: string): string {
  const url = new URL(source);
  if (!url.pathname.endsWith('.json')) {
    return new URL('latest.json', `${url.toString().replace(/\/$/, '')}/`).toString();
  }
  return url.toString();
}

/**
 * 解析并限制更新下载地址，防止 Renderer 获取任意协议。
 * @param value 清单中的相对或绝对地址
 * @param manifestUrl 清单地址
 * @returns HTTPS 或本机 HTTP 地址
 */
function resolveDownloadUrl(value: string, manifestUrl: string): string {
  const url = new URL(value, manifestUrl);
  if (!isAllowedUpdateUrl(url)) {
    throw new Error('更新下载地址必须使用 HTTPS');
  }
  return url.toString();
}

/**
 * 校验更新源允许的协议，开发环境仅放行本机 HTTP。
 * @param url 待校验 URL
 * @returns 是否允许访问
 */
function isAllowedUpdateUrl(url: URL): boolean {
  if (url.protocol === 'https:') {
    return true;
  }
  return (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  );
}

/**
 * 校验更新清单字段和大小，拒绝不完整或可疑的发布数据。
 * @param value 未知 JSON 值
 * @returns 规范化清单
 */
function parseManifest(value: unknown): UpdateManifest {
  if (!isRecord(value)) {
    throw new Error('更新清单格式无效');
  }
  if (!isVersion(value.version)) {
    throw new Error('更新清单版本无效');
  }
  if (typeof value.url !== 'string' || !value.url.trim()) {
    throw new Error('更新清单缺少安装包地址');
  }
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
    throw new Error('更新清单缺少有效 SHA-256');
  }
  if (value.portableUrl !== undefined && typeof value.portableUrl !== 'string') {
    throw new Error('更新清单便携版地址无效');
  }
  if (value.blockmapUrl !== undefined && value.blockmapUrl !== null && typeof value.blockmapUrl !== 'string') {
    throw new Error('更新清单 blockmap 地址无效');
  }
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 20000)) {
    throw new Error('更新说明过长');
  }
  if (value.releaseDate !== undefined && typeof value.releaseDate !== 'string') {
    throw new Error('更新日期无效');
  }
  return {
    version: value.version,
    releaseDate: value.releaseDate,
    notes: value.notes,
    url: value.url,
    portableUrl: value.portableUrl,
    sha256: value.sha256,
    blockmapUrl: value.blockmapUrl,
    channel: value.channel,
  };
}

/**
 * 判断版本是否符合桌面发布使用的语义化版本格式。
 * @param value 待校验版本
 * @returns 是否为有效版本
 */
function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

/**
 * 限制响应体大小，避免更新源返回异常大内容占用内存。
 * @param response HTTP 响应
 * @returns UTF-8 文本
 */
async function readResponseText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_MANIFEST_BYTES) {
    throw new Error('更新清单超过大小限制');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
    throw new Error('更新清单超过大小限制');
  }
  return text;
}

/**
 * 比较两个语义化版本。
 * @param left 左侧版本
 * @param right 右侧版本
 * @returns 左侧大于、等于或小于右侧时分别返回正数、0、负数
 */
export function compareVersions(left: string, right: string): number {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParsed.core[index] - rightParsed.core[index];
    if (difference !== 0) {
      return difference;
    }
  }
  if (!leftParsed.pre.length && !rightParsed.pre.length) {
    return 0;
  }
  if (!leftParsed.pre.length) {
    return 1;
  }
  if (!rightParsed.pre.length) {
    return -1;
  }
  const length = Math.max(leftParsed.pre.length, rightParsed.pre.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParsed.pre[index];
    const rightPart = rightParsed.pre[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) {
      return leftNumber - rightNumber;
    }
    if (leftNumber !== null) {
      return -1;
    }
    if (rightNumber !== null) {
      return 1;
    }
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

/**
 * 解析版本核心和预发布标识。
 * @param value 语义化版本
 * @returns 可比较的版本结构
 */
function parseVersion(value: string): {core: number[]; pre: string[]} {
  const [coreText, preText] = value.split('-', 2);
  return {
    core: coreText.split('.').map(Number),
    pre: preText ? preText.split('.') : [],
  };
}

/**
 * 判断未知值是否为普通对象。
 * @param value 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 将未知异常转换成不会泄露响应体的短错误信息。
 * @param error 未知异常
 * @param fallback 默认提示
 * @returns 脱敏错误文本
 */
function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 300);
  }
  return fallback;
}
