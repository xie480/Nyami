import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { config } from '../config';
import { storage } from './storage';
import { adaptiveBucket } from './adaptiveRateLimit';
import {
  AuthRequiredError, BiliApiError, normalizeError,
  ResourceUnavailableError, RateLimitError,
} from './errors';
import type { BiliResponse } from '../types/bili';

/** 创建带默认头的 axios 实例 */
function createInstance(): AxiosInstance {
  const ins = axios.create({
    baseURL: config.biliBaseURL,
    timeout: config.httpTimeout,
    headers: {
      'User-Agent': config.userAgent,
      Referer: config.referer,
    },
  });

  // 请求拦截：限流 + 自动注入 Cookie
  ins.interceptors.request.use(async (cfg) => {
    await adaptiveBucket.acquire();
    const cookie = storage.getString('biliCookie');
    if (cookie) cfg.headers.Cookie = cookie;
    return cfg;
  });

  // 响应拦截：归一化错误 + 状态上报
  ins.interceptors.response.use(
    (res) => {
      adaptiveBucket.reportSuccess();
      return res;
    },
    (err) => {
      const isRateLimit = err?.response?.status === 412 || err?.response?.status === 429;
      adaptiveBucket.reportError(isRateLimit);
      return Promise.reject(normalizeError(err));
    }
  );
  return ins;
}

export const http = createInstance();

/** 业务码错误映射 */
function mapBusinessError(code: number, message: string): never {
  if (code === -101 || code === -400) throw new AuthRequiredError(message);
  if (code === 62002 || code === 62004) throw new ResourceUnavailableError(message);
  throw new BiliApiError(code, message);
}

/**
 * 请求 B 站 API 并自动校验 code，附带重试
 */
export async function biliGet<T>(
  url: string,
  options: AxiosRequestConfig = {},
  retries = config.retry.maxAttempts
): Promise<T> {
  let lastError: any;
  const absoluteTimeout = 30000; // 30 秒的绝对超时
  for (let attempt = 0; attempt <= retries; attempt++) {
    // 为每次尝试创建独立的 AbortController，以实现绝对超时
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), absoluteTimeout);
    // 合并用户传入的 signal（若有）和内部的 abortController.signal
    const combinedSignal = options.signal ?? abortController.signal;
    // 若用户提供了 signal，我们在其 abort 时同步 abort 内部的 controller
    if (options.signal) {
      options.signal.addEventListener('abort', () => abortController.abort());
    }
    const requestOptions: AxiosRequestConfig = { ...options, signal: combinedSignal };
    try {
      const res = await http.get<BiliResponse<T>>(url, requestOptions);
      clearTimeout(timeoutId);
      const { code, data, message } = res.data;
      if (code !== 0) mapBusinessError(code, message);
      return data;
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err;
      // 仅对网络错误重试，业务错误立即抛出
      if (
        err instanceof BiliApiError ||
        err instanceof AuthRequiredError ||
        err instanceof ResourceUnavailableError
      ) {
        throw err;
      }
      if (attempt < retries) {
        let delay = config.retry.delayMs * (attempt + 1);
        if (err instanceof RateLimitError) {
          delay = 3000; // 触发风控时等待更长时间
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
