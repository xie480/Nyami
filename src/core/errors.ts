/** 业务错误统一基类 */
export class BiliError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'BiliError';
  }
}

/** 网络错误（含超时）*/
export class NetworkError extends BiliError {
  constructor(message: string, cause?: unknown) {
    super(-1000, message, cause);
    this.name = 'NetworkError';
  }
}

/** B 站业务错误（B 站返回 code 非 0）*/
export class BiliApiError extends BiliError {
  constructor(code: number, message: string) {
    super(code, message);
    this.name = 'BiliApiError';
  }
}

/** 鉴权失败（需要登录）*/
export class AuthRequiredError extends BiliError {
  constructor(message = '需要登录或 Cookie 已失效') {
    super(-101, message);
    this.name = 'AuthRequiredError';
  }
}

/** 资源不可用（视频被删/私有）*/
export class ResourceUnavailableError extends BiliError {
  constructor(message = '该资源已失效') {
    super(-404, message);
    this.name = 'ResourceUnavailableError';
  }
}

/** 限流错误 */
export class RateLimitError extends BiliError {
  constructor(message = '请求过于频繁') {
    super(-429, message);
    this.name = 'RateLimitError';
  }
}

/** 把 axios 错误归一化为 BiliError */
export function normalizeError(err: any): BiliError {
  if (err instanceof BiliError) return err;
  if (err?.code === 'ECONNABORTED') return new NetworkError('请求超时');
  if (err?.response?.status === 429 || err?.response?.status === 412) return new RateLimitError();
  if (err?.message) return new NetworkError(err.message, err);
  return new NetworkError('未知错误', err);
}
