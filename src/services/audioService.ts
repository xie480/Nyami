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
};

function pickAudio(audios: ReturnType<typeof normalizeAudio>[], quality: Quality) {
  // 按带宽降序排列，优先匹配目标音质；若不存在则根据 Quality 优先级向下回退
  const sorted = [...audios].sort((a, b) => b.bandwidth - a.bandwidth);
  const qualityOrder: Quality[] = ['high', 'medium', 'low'];
  const startIdx = qualityOrder.indexOf(quality);
  for (let i = startIdx; i < qualityOrder.length; i++) {
    const targetId = QUALITY_MAP[qualityOrder[i]];
    const match = sorted.find((a) => a.id === targetId);
    if (match) return match;
  }
  // 若仍未匹配到任何音质，返回最高可用音质
  return sorted[0];
}

export const audioService = {
  /**
   * 获取音频元信息
   *
   * 流程：
   * 1. videoInfo 缓存 1 天（标题等基本不变）
   * 2. audioUrl 缓存 1 小时（B 站 URL 约 2 小时失效）
   */
  async getInfo(bvid: string, quality: Quality = 'low'): Promise<AudioInfo> {
    if (!QUALITY_MAP[quality]) {
      throw new Error(`无效的音质参数: ${quality}`);
    }

    return cache.getOrSet(
      `audioInfo:${bvid}:${quality}`,
      config.cacheTTL.audioUrl,
      async () => {
        // videoInfo 单独缓存，与 quality 无关
        const info = await cache.getOrSet(
          `videoInfo:${bvid}`,
          config.cacheTTL.videoInfo,
          () => biliApi.getVideoInfo(bvid),
          true
        );

        const playUrl = await biliApi.getPlayUrl(bvid, info.cid);
        const audios = (playUrl.dash?.audio || []).map(normalizeAudio);
        if (audios.length === 0) {
          throw new ResourceUnavailableError('该视频无可用音频流');
        }
        const audio = pickAudio(audios, quality);

        return {
          bvid,
          cid: info.cid,
          title: info.title,
          cover: info.pic,
          author: info.owner?.name || '',
          duration: info.duration,
          audio: {
            id: audio.id,
            bitrate: Math.round((audio.bandwidth || 0) / 1000),
            mimeType: audio.mimeType,
            baseUrl: audio.baseUrl,
            backupUrl: audio.backupUrl,
          },
        };
      },
      false // 仅内存缓存，不持久化（URL 有时效）
    );
  },

  /** 强制刷新某 BV 的所有音质缓存（URL 失效时） */
  invalidate(bvid: string) {
    cache.deletePrefix(`audioInfo:${bvid}`);
  },
};
