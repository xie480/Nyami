import {
  matchesOnlineVideoSearch,
  normalizeDashAudios,
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

  it('收集普通、Dolby 和 Hi-Res 音轨并过滤无地址项', () => {
    const audios = normalizeDashAudios({
      audio: [
        {
          id: 30280,
          baseUrl: 'https://cdn.example/high.m4s',
          bandwidth: 192000,
          mimeType: 'audio/mp4',
        },
      ],
      dolby: {
        audio: [
          {
            id: 30250,
            base_url: 'https://cdn.example/dolby.m4s',
            bandwidth: 640000,
            mime_type: 'audio/mp4',
          },
        ],
      },
      flac: {
        audio: [
          {
            id: 30251,
            baseUrl: 'https://cdn.example/flac.m4s',
            bandwidth: 1200000,
            mimeType: 'audio/flac',
          },
          {
            id: 30251,
            baseUrl: '',
            bandwidth: 1200000,
            mimeType: 'audio/flac',
          },
        ],
      },
    });

    expect(audios.map(audio => audio.id)).toEqual([30280, 30250, 30251]);
    expect(audios[1].mimeType).toBe('audio/mp4');
    expect(audios[2].codecs).toBe('');
  });
});
