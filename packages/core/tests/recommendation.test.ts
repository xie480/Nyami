import {
  filterRecommendedVideos,
  normalizeRecommendationTitleKey,
} from '../src/recommendation/filters';
import type {TagRecommendation} from '../src/types/domain';

const video = (id: string, score: number): TagRecommendation => ({
  aid: 1,
  bvid: id,
  title: id,
  cover: '',
  duration: 120,
  pubtime: 1,
  authorId: 1,
  author: 'author',
  tags: ['音乐'],
  matchedTags: ['音乐'],
  score,
});

describe('共享推荐过滤规则', () => {
  it('按 ID、标题、黑名单和时长过滤并稳定排序', () => {
    const result = filterRecommendedVideos(
      [video('keep', 1), video('keep', 3), video('blocked', 9)],
      {
        excludedVideoIds: ['blocked'],
        excludedVideoTitles: ['  KEEP  '],
      },
    );

    expect(result).toEqual([]);
    expect(normalizeRecommendationTitleKey(' 夜 曲 ')).toBe('夜曲');
  });
});
