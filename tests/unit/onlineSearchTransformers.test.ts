import {
  matchesOnlineVideoSearch,
  searchVideoToFavoriteVideo,
  trimSearchVideo,
} from '../../src/services/transformers';

describe('online video search transformers', () => {
  const video = trimSearchVideo({
    aid: 12345,
    bvid: 'BV1xx411c7mD',
    title: '《<em class="keyword">夜曲</em>》钢琴演奏',
    pic: '//i0.hdslb.com/test.jpg',
    duration: '3:02',
    author: '音乐人',
    mid: 88,
    pubdate: 1700000000,
    tag: '钢琴, 夜曲, 音乐',
  });

  it('normalizes search title, cover, duration, author and tags', () => {
    expect(video).toEqual({
      aid: 12345,
      bvid: 'BV1xx411c7mD',
      title: '《夜曲》钢琴演奏',
      cover: 'https://i0.hdslb.com/test.jpg',
      duration: 182,
      pubtime: 1700000000,
      authorId: 88,
      author: '音乐人',
      tags: ['钢琴', '夜曲', '音乐'],
    });
  });

  it('filters online results by title or tag without mixing the fields', () => {
    expect(matchesOnlineVideoSearch(video, '夜曲', 'title')).toBe(true);
    expect(matchesOnlineVideoSearch(video, '古典', 'title')).toBe(false);
    expect(matchesOnlineVideoSearch(video, '钢', 'tag')).toBe(true);
    expect(matchesOnlineVideoSearch(video, '古典', 'tag')).toBe(false);
    expect(matchesOnlineVideoSearch(video, '  ', 'tag')).toBe(true);
  });

  it('adapts a search result to the existing playback queue model', () => {
    const favoriteVideo = searchVideoToFavoriteVideo(video);
    expect(favoriteVideo).toMatchObject({
      bvid: video.bvid,
      title: video.title,
      duration: 182,
      page: 1,
      upper: {mid: 88, name: '音乐人'},
      attr: 0,
    });
    expect(favoriteVideo.favTime).toBeGreaterThan(0);
  });
});
