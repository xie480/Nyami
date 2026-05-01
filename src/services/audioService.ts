import { biliApi } from './biliApi';
import { cache } from '../core/cache';
import { config } from '../config';
import { normalizeAudio } from './transformers';
import { ResourceUnavailableError } from '../core/errors';
import type { AudioInfo, Quality } from '../types/domain';

const QUALITY_MAP: Record<Quality, number> = {
  low: 30216,
  medium: 30232,
  high: 30280,
};

function pickAudio(audios: ReturnType<typeof normalizeAudio>[], quality: Quality) {
  const targetId = QUALITY_MAP[quality];
  const sorted = [...audios].sort((a, b) => a.bandwidth - b.bandwidth);
  return sorted.find((a) => a.id === targetId) || sorted[0];
}

export const audioService = {
  async getInfo(bvid: string, quality: Quality = 'low'): Promise<AudioInfo> {
    if (!QUALITY_MAP[quality]) {
      throw new Error(`无效的音质参数: ${quality}`);
    }

    return cache.getOrSet(
      `audioInfo:${bvid}:${quality}`,
      config.cacheTTL.audioUrl,
      async () => {
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
      false
    );
  },

  invalidate(bvid: string) {
    cache.deletePrefix(`audioInfo:${bvid}`);
  },
};
