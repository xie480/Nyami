/** Bilibili 业务错误基类。 */
export class BiliError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BiliError';
  }
}

/** 网络错误，包含超时和连接失败。 */
export class NetworkError extends BiliError {
  constructor(message: string, cause?: unknown) {
    super(-1000, message, cause);
    this.name = 'NetworkError';
  }
}

/** Bilibili 返回的业务码错误。 */
export class BiliApiError extends BiliError {
  constructor(code: number, message: string) {
    super(code, message);
    this.name = 'BiliApiError';
  }
}

/** 当前凭证需要重新登录。 */
export class AuthRequiredError extends BiliError {
  constructor(message = '需要登录或 Cookie 已失效') {
    super(-101, message);
    this.name = 'AuthRequiredError';
  }
}

/** 视频或收藏资源不可用。 */
export class ResourceUnavailableError extends BiliError {
  constructor(message = '该资源已失效') {
    super(-404, message);
    this.name = 'ResourceUnavailableError';
  }
}

/** 请求触发 Bilibili 限流。 */
export class RateLimitError extends BiliError {
  constructor(message = '请求过于频繁') {
    super(-429, message);
    this.name = 'RateLimitError';
  }
}

/** 将未知异常归一化为共享错误类型。 */
export function normalizeError(error: unknown): BiliError {
  if (error instanceof BiliError) {
    return error;
  }

  const candidate = error as {
    code?: string | number;
    response?: {status?: number};
    message?: string;
  } | null;

  if (candidate?.code === 'ECONNABORTED') {
    return new NetworkError('请求超时', error);
  }

  if (candidate?.response?.status === 429 || candidate?.response?.status === 412) {
    return new RateLimitError();
  }

  return new NetworkError(
    candidate?.message || '未知网络错误',
    error,
  );
}
