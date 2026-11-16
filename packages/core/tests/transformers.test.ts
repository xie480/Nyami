import {
  matchesOnlineVideoSearch,
  searchVideoToFavoriteVideo,
  trimSearchVideo,
} from '../src/transformers';

describe('共享核心数据转换', () => {
  it('规范化搜索结果并保持移动端字段语义', () => {
    const video = trimSearchVideo({
      aid: 123,
      bvid: 'BV1core001',
      title: '<em>夜曲</em>',
      pic: '//i0.hdslb.com/cover.jpg',
      duration: '3:02',
      author: '音乐人',
      mid: 88,
      pubdate: 1700000000,
      tag: '钢琴, 夜曲',
    });

    expect(video).toMatchObject({
      aid: 123,
      bvid: 'BV1core001',
      title: '夜曲',
      cover: 'https://i0.hdslb.com/cover.jpg',
      duration: 182,
      tags: ['钢琴', '夜曲'],
    });
    expect(matchesOnlineVideoSearch(video, '夜曲', 'title')).toBe(true);
    expect(matchesOnlineVideoSearch(video, '古典', 'tag')).toBe(false);
    expect(searchVideoToFavoriteVideo(video).upper.mid).toBe(88);
  });
});
