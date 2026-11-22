import type {
  BiliHttpPort,
  BiliHttpRequestOptions,
  CredentialStore,
  HttpHeaders,
  HttpParams,
  RequestPriority,
} from '../../../platform-contracts/src';
import {AdaptiveRateLimiter} from './rateLimiter';
import {
  AuthRequiredError,
  BiliApiError,
  RateLimitError,
  ResourceUnavailableError,
  normalizeError,
} from './errors';
import type {BiliResponse} from '../types/bili';

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type BiliHttpClientOptions = {
  baseUrl: string;
  userAgent: string;
  referer: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  totalTimeoutMs?: number;
  credentials?: CredentialStore;
  fetchImpl?: FetchLike;
  rateLimiter?: AdaptiveRateLimiter;
  onAuthRequired?: () => void;
};

/**
 * 基于 Fetch 的 Bilibili HTTP 适配器。
 * 共享核心只关心请求契约，Cookie、限流和重试行为通过依赖注入提供。
 */
export class FetchBiliHttpClient implements BiliHttpPort {
  private readonly fetchImpl: FetchLike;

  private readonly timeoutMs: number;

  private readonly retries: number;

  private readonly retryDelayMs: number;

  private readonly totalTimeoutMs: number;

  private readonly rateLimiter: AdaptiveRateLimiter;

  constructor(private readonly options: BiliHttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.retries = options.retries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.totalTimeoutMs = options.totalTimeoutMs ?? 180_000;
    this.rateLimiter = options.rateLimiter ?? new AdaptiveRateLimiter();
  }

  /** 发起带业务码校验和重试的 GET 请求。 */
  async get<T>(
    url: string,
    requestOptions: BiliHttpRequestOptions = {},
    retries = this.retries,
  ): Promise<T> {
    return this.request<T>('GET', url, undefined, requestOptions, retries);
  }

  /** 发起一次不自动重放的表单 POST 请求。 */
  async post<T>(
    url: string,
    body: string,
    requestOptions: BiliHttpRequestOptions = {},
  ): Promise<T> {
    return this.request<T>('POST', url, body, requestOptions, 0);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    url: string,
    body: string | undefined,
    requestOptions: BiliHttpRequestOptions,
    retries: number,
  ): Promise<T> {
    const deadline = Date.now() + this.totalTimeoutMs;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (requestOptions.signal?.aborted) {
        throw this.createAbortError();
      }

      try {
        const priority: RequestPriority =
          requestOptions.rateLimitPriority ?? 'normal';
        await this.rateLimiter.acquire(priority, requestOptions.signal);
        const response = await this.fetchOnce(
          method,
          url,
          body,
          requestOptions,
          Math.max(1, Math.min(this.timeoutMs, deadline - Date.now())),
        );
        const payload = await this.readResponse(response);
        const data = payload as BiliResponse<T>;
        if (data.code !== 0) {
          this.throwBusinessError(data.code, data.message);
        }
        this.rateLimiter.reportSuccess();
        return data.data;
      } catch (error) {
        lastError = error;
        const normalized = normalizeError(error);
        const shouldRetry = this.shouldRetry(normalized, attempt, retries, deadline);
        const isRateLimit = normalized instanceof RateLimitError;
        if (isRateLimit) {
          this.rateLimiter.reportError(true);
        }
        if (!shouldRetry) {
          if (normalized instanceof AuthRequiredError) {
            this.options.onAuthRequired?.();
          }
          throw normalized;
        }

        await this.waitBeforeRetry(
          attempt,
          deadline,
          requestOptions.signal,
          isRateLimit,
        );
      }
    }

    throw normalizeError(lastError);
  }

  private async fetchOnce(
    method: 'GET' | 'POST',
    path: string,
    body: string | undefined,
    requestOptions: BiliHttpRequestOptions,
    timeoutMs: number,
  ): Promise<Response> {
    const target = this.buildUrl(path, requestOptions.params);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    requestOptions.signal?.addEventListener('abort', onAbort, {once: true});

    try {
      const headers: HttpHeaders = {
        'User-Agent': this.options.userAgent,
        Referer: this.options.referer,
        ...(requestOptions.headers ?? {}),
      };
      const credentials = await this.options.credentials?.getCredentials();
      if (credentials?.cookie && !this.hasHeader(headers, 'Cookie')) {
        headers.Cookie = credentials.cookie;
      }
      if (method === 'POST' && !this.hasHeader(headers, 'Content-Type')) {
        headers['Content-Type'] =
          'application/x-www-form-urlencoded;charset=UTF-8';
      }

      const response = await this.fetchImpl(target, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      if (response.status === 412 || response.status === 429) {
        throw new RateLimitError();
      }
      if (response.status === 401 || response.status === 403) {
        throw new AuthRequiredError('Bilibili 请求未通过鉴权');
      }
      return response;
    } catch (error) {
      if (controller.signal.aborted && !requestOptions.signal?.aborted) {
        throw new Error('请求超时');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      requestOptions.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async readResponse(response: Response): Promise<unknown> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`Bilibili 响应不是有效 JSON（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      throw new Error(`Bilibili HTTP ${response.status}`);
    }
    if (!payload || typeof payload !== 'object' || !('code' in payload)) {
      throw new Error('Bilibili 响应缺少业务码');
    }
    return payload;
  }

  private buildUrl(path: string, params?: HttpParams): string {
    const target = /^https?:\/\//.test(path)
      ? new URL(path)
      : new URL(path, this.options.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          target.searchParams.set(key, String(value));
        }
      });
    }
    return target.toString();
  }

  private hasHeader(headers: HttpHeaders, name: string): boolean {
    return Object.keys(headers).some(
      key => key.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
  }

  private throwBusinessError(code: number, message: string): never {
    if (code === -101 || code === -400) {
      throw new AuthRequiredError(message);
    }
    if (code === 62002 || code === 62004) {
      throw new ResourceUnavailableError(message);
    }
    throw new BiliApiError(code, message);
  }

  private shouldRetry(
    error: Error,
    attempt: number,
    retries: number,
    deadline: number,
  ): boolean {
    if (error instanceof AuthRequiredError || error instanceof BiliApiError) {
      return false;
    }
    if (error instanceof ResourceUnavailableError) {
      return false;
    }
    return attempt < retries && Date.now() < deadline;
  }

  private async waitBeforeRetry(
    attempt: number,
    deadline: number,
    signal?: AbortSignal,
    isRateLimit = false,
  ): Promise<void> {
    const retryMultiplier = isRateLimit ? 2 ** attempt : attempt + 1;
    const delay = Math.min(
      isRateLimit
        ? Math.min(this.retryDelayMs * retryMultiplier, 30_000)
        : this.retryDelayMs * retryMultiplier,
      Math.max(0, deadline - Date.now()),
    );
    if (delay <= 0) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      const onAbort = () => {
        clearTimeout(timer);
        reject(this.createAbortError());
      };
      signal?.addEventListener('abort', onAbort, {once: true});
    });
  }

  private createAbortError(): Error {
    const error = new Error('请求已取消');
    error.name = 'AbortError';
    return error;
  }
}

/** 创建共享 HTTP 客户端，便于桌面端和测试注入 Fetch 实现。 */
export function createBiliHttpClient(
  options: BiliHttpClientOptions,
): BiliHttpPort {
  return new FetchBiliHttpClient(options);
}
