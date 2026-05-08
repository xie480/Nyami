/**
 * URL 短期内存缓存模块
 *
 * 作用：
 * 缓存 B 站返回的 CDN 音频真实 URL（带过期时间），
 * 避免在物理缓存未完成或短时间重复播放同一歌曲时，
 * 重复发起 API 请求解析 playurl。
 *
 * B 站 CDN URL 有效期通常为 2 小时，
 * 缓存 TTL 设为 1.5 小时留出安全余量。
 */

export interface CachedUrlEntry {
  /** CDN 音频流真实 URL */
  url: string;
  /** 请求头（Referer, User-Agent 等） */
  headers?: Record<string, string>;
  /** 过期时间戳（毫秒） */
  expireAt: number;
}

const URL_CACHE_TTL = 1.5 * 60 * 60 * 1000; // 1.5 小时

/** 内部存储：Map<"bvid-cid", CachedUrlEntry> */
const cache = new Map<string, CachedUrlEntry>();

/** 统计信息 */
let hitCount = 0;
let missCount = 0;
let setCount = 0;

function buildKey(bvid: string, cid?: number): string {
  return cid != null ? `${bvid}-${cid}` : bvid;
}

/**
 * 从缓存中获取已解析的音频 URL
 * @returns 若命中且未过期返回条目，否则返回 undefined
 */
export function getCachedUrl(bvid: string, cid?: number): CachedUrlEntry | undefined {
  const key = buildKey(bvid, cid);
  const entry = cache.get(key);
  if (!entry) {
    missCount++;
    return undefined;
  }
  if (Date.now() >= entry.expireAt) {
    cache.delete(key);
    missCount++;
    return undefined;
  }
  hitCount++;
  return entry;
}

/**
 * 将已解析的音频 URL 存入缓存
 * @param bvid  视频 BVID
 * @param url   CDN 音频流真实 URL
 * @param headers 可选的请求头
 * @param cid   可选的分P cid
 */
export function setCachedUrl(
  bvid: string,
  url: string,
  headers?: Record<string, string>,
  cid?: number,
): void {
  const key = buildKey(bvid, cid);
  cache.set(key, {
    url,
    headers,
    expireAt: Date.now() + URL_CACHE_TTL,
  });
  setCount++;

  // 限制缓存条目数量，防止内存泄漏
  if (cache.size > 500) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

/**
 * 移除指定视频的 URL 缓存
 */
export function invalidateUrl(bvid: string, cid?: number): void {
  const key = buildKey(bvid, cid);
  cache.delete(key);
}

/**
 * 清除所有 URL 缓存
 */
export function clearUrlCache(): void {
  cache.clear();
}

/**
 * 获取缓存的统计信息（用于调试/监控）
 */
export function getUrlCacheStats(): {
  size: number;
  hitCount: number;
  missCount: number;
  setCount: number;
  hitRate: string;
} {
  const total = hitCount + missCount;
  return {
    size: cache.size,
    hitCount,
    missCount,
    setCount,
    hitRate: total > 0 ? `${((hitCount / total) * 100).toFixed(1)}%` : 'N/A',
  };
}
