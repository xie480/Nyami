import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { config } from '../config';
import { storage } from './storage';
import { bucket } from './rateLimit';
import {
  AuthRequiredError, BiliApiError, normalizeError,
  ResourceUnavailableError,
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
    await bucket.acquire();
    const cookie = storage.getString('biliCookie');
    if (cookie) cfg.headers.Cookie = cookie;
    return cfg;
  });

  // 响应拦截：归一化错误
  ins.interceptors.response.use(
    (res) => res,
    (err) => Promise.reject(normalizeError(err))
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
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await http.get<BiliResponse<T>>(url, options);
      const { code, data, message } = res.data;
      if (code !== 0) mapBusinessError(code, message);
      return data;
    } catch (err: any) {
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
        await new Promise((r) =>
          setTimeout(r, config.retry.delayMs * (attempt + 1))
        );
      }
    }
  }
  throw lastError;
}
