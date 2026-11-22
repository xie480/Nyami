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
});
