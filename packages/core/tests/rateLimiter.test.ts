import {AdaptiveRateLimiter} from '../src/api/rateLimiter';

describe('AdaptiveRateLimiter', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('交互请求优先于收藏索引队列', async () => {
    jest.useFakeTimers();
    const limiter = new AdaptiveRateLimiter(1, 1);
    const order: string[] = [];

    await limiter.acquire('index');
    const indexFirst = limiter
      .acquire('index')
      .then(() => order.push('index-first'));
    const indexSecond = limiter
      .acquire('index')
      .then(() => order.push('index-second'));
    const normal = limiter
      .acquire('normal')
      .then(() => order.push('normal'));

    await jest.advanceTimersByTimeAsync(1000);
    expect(order).toEqual(['normal']);

    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.all([indexFirst, indexSecond, normal]);
    expect(order).toEqual(['normal', 'index-first', 'index-second']);
  });

  it('低速时继续排队等待，不因等待超过十秒提前抛出限流错误', async () => {
    jest.useFakeTimers();
    const limiter = new AdaptiveRateLimiter(0.1, 1);

    await limiter.acquire('index');
    const pending = limiter.acquire('index');

    await jest.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeUndefined();
  });
});
