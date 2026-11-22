import {FetchBiliHttpClient} from '../src/api/http';
import {RateLimitError} from '../src/api/errors';

describe('FetchBiliHttpClient 限流重试', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('按 Android 端策略对限流请求使用指数退避', async () => {
    jest.useFakeTimers();
    const response = {
      status: 429,
      ok: false,
      json: jest.fn(),
    } as unknown as Response;
    const fetchImpl = jest.fn().mockResolvedValue(response);
    const rateLimiter = {
      acquire: jest.fn().mockResolvedValue(undefined),
      reportSuccess: jest.fn(),
      reportError: jest.fn(),
    };
    const client = new FetchBiliHttpClient({
      baseUrl: 'https://api.bilibili.com',
      userAgent: 'test',
      referer: 'https://www.bilibili.com/',
      fetchImpl,
      rateLimiter: rateLimiter as never,
      retryDelayMs: 2_000,
      totalTimeoutMs: 60_000,
    });

    const request = client.get('/test', {}, 3);
    const rejection = expect(request).rejects.toBeInstanceOf(RateLimitError);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(3_999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await jest.advanceTimersByTimeAsync(7_999);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    await rejection;
    expect(rateLimiter.reportError).toHaveBeenCalledTimes(4);
  });
});
