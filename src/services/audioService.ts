import { biliApi } from './biliApi';
import { cache } from '../core/cache';
import { config } from '../config';
import { normalizeAudio } from './transformers';
import { ResourceUnavailableError } from '../core/errors';
import type { AudioInfo, Quality } from '../types/domain';

const QUALITY_MAP: Record<Quality, number> = {
  low: 30216,    //  64 K
  medium: 30232, // 132 K
  high: 30280,   // 192 K
  dolby: 30250,  // 杜比全景声 Dolby Atmos
  hires: 30251,  // HI-FES 无损
};

/** 音质回退优先级（低索引 → 高优先级，越靠前越优先尝试匹配） */
const QUALITY_ORDER: Quality[] = ['hires', 'dolby', 'high', 'medium', 'low'];

function pickAudio(audios: ReturnType<typeof normalizeAudio>[], quality: Quality) {
  const sorted = [...audios].sort((a, b) => b.bandwidth - a.bandwidth);
  const startIdx = QUALITY_ORDER.indexOf(quality);
  if (startIdx === -1) {
    return sorted[0];
  }
  for (let i = startIdx; i < QUALITY_ORDER.length; i++) {
    const targetId = QUALITY_MAP[QUALITY_ORDER[i]];
    const match = sorted.find((a) => a.id === targetId);
    if (match) return match;
  }
  return sorted[0];
}

/** 从 URL 中提取域名 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * CDN 主机偏好缓存：只保存主机名，不保存带有单曲路径和签名参数的完整播放 URL。
 * key 为原始 baseUrl 主机；命中后仍需从当前资源的候选 URL 中选出对应地址。
 */
const domainSpeedCache = new Map<string, { fastestHostname: string; timestamp: number }>();
const DOMAIN_CACHE_TTL = 30 * 60 * 1000; // 30 分钟

/**
 * 基于主机偏好缓存的 URL 选择。跨请求只能复用主机偏好，不能复用媒体 URL。
 */
async function selectFastestUrl(baseUrl: string, backupUrls: string[]): Promise<string> {
  const sourceHostname = extractDomain(baseUrl);
  const now = Date.now();
  const urls = [baseUrl, ...(backupUrls || [])];

  // 只从当前资源的候选地址中挑选偏好主机，绝不复用另一首歌的完整 URL。
  const domainEntry = sourceHostname ? domainSpeedCache.get(sourceHostname) : undefined;
  if (domainEntry && (now - domainEntry.timestamp) < DOMAIN_CACHE_TTL) {
    const preferredUrl = urls.find(
      url => extractDomain(url) === domainEntry.fastestHostname,
    );
    if (preferredUrl) return preferredUrl;
  }

  const tryUrl = async (url: string): Promise<string> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const commonHeaders = {
      'User-Agent': config.userAgent,
      Referer: config.referer,
    };
    try {
      try {
        const res = await fetch(url, {
          method: 'HEAD',
          headers: commonHeaders,
          signal: controller.signal,
        });
        if (res.ok) return url;
      } catch {}
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { ...commonHeaders, Range: 'bytes=0-0' },
          signal: controller.signal,
        });
        if (res.ok) return url;
      } catch {}
      throw new Error('unreachable');
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    const fastest = await Promise.any(urls.map(tryUrl));
    const fastestHostname = extractDomain(fastest);
    if (sourceHostname && fastestHostname) {
      domainSpeedCache.set(sourceHostname, { fastestHostname, timestamp: now });
    }
    return fastest;
  } catch {
    // 探测失败时仅将本资源的 baseUrl 作为临时回退，不污染跨资源主机偏好。
    return baseUrl;
  }
}

/** 清除指定的域名级测速缓存（用于手动刷新或错误恢复） */
export function invalidateDomainCache(domain?: string) {
  if (domain) {
    domainSpeedCache.delete(domain);
  } else {
    domainSpeedCache.clear();
  }
}

async function getCachedVideoInfo(bvid: string) {
  if (!bvid) throw new Error('bvid 不能为空');
  return cache.getOrSet(
    `videoInfo:${bvid}`,
    config.cacheTTL.videoInfo,
    () => biliApi.getVideoInfo(bvid),
    true,
  );
}

export const audioService = {
  /** 获取视频详情但不请求播放地址，供分P列表按需加载复用。 */
  getVideoInfo: getCachedVideoInfo,

  /**
   * 获取音频元信息
   *
   * 流程：
   * 1. videoInfo 缓存 1 天（标题等基本不变）
   * 2. audioUrl 缓存 1 小时（B 站 URL 约 2 小时失效）
   */
  async getInfo(bvid: string, quality: Quality = 'low', cid?: number): Promise<AudioInfo> {
      if (!QUALITY_MAP[quality]) {
        throw new Error(`无效的音质参数: ${quality}`);
      }
  
      const cacheKey = `audioInfo:${bvid}:${cid ?? 'default'}:${quality}`;
      return cache.getOrSet(
        cacheKey,
        config.cacheTTL.audioUrl,
        async () => {
          const info = await getCachedVideoInfo(bvid);
  
          const targetCid = cid ?? info.cid;
          const playUrl = await biliApi.getPlayUrl(bvid, targetCid);
          
          let audios = (playUrl.dash?.audio || []).map(normalizeAudio);
          
          if (audios.length === 0 && playUrl.durl && playUrl.durl.length > 0) {
            audios = playUrl.durl.map(d => ({
              id: 30216,
              bandwidth: 0,
              mimeType: 'audio/mp4',
              baseUrl: d.url,
              backupUrl: d.backup_url || [],
            }));
          }
  
          if (audios.length === 0) {
            throw new ResourceUnavailableError('该视频无可用音频流');
          }
          const audio = pickAudio(audios, quality);

          const parts = info.pages?.map(p => ({
            cid: p.cid,
            page: p.page,
            title: p.part,
            duration: p.duration,
          })) ?? [];
  
          return {
            bvid,
            cid: targetCid,
            title: info.title,
            cover: info.pic,
            author: info.owner?.name || '',
            duration: info.duration,
            audio: {
              id: audio.id,
              bitrate: Math.round((audio.bandwidth || 0) / 1000),
              mimeType: audio.mimeType,
              baseUrl: await selectFastestUrl(audio.baseUrl, audio.backupUrl),
              backupUrl: audio.backupUrl,
            },
            parts,
          };
        },
        false
      );
    },

  /** 失效指定视频或分P的播放地址缓存，供播放错误后的重新解析使用。 */
  invalidate(bvid: string, cid?: number) {
    const prefix = cid == null
      ? `audioInfo:${bvid}:`
      : `audioInfo:${bvid}:${cid}:`;
    cache.deletePrefix(prefix);
  },
};
