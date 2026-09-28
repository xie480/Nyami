import {createBilibiliVideoUrl} from '../src/utils/bilibiliVideoUrl';

describe('createBilibiliVideoUrl', () => {
  it('creates a fixed HTTPS video URL for a valid BVID', () => {
    expect(createBilibiliVideoUrl('BV1xx411c7mD')).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    );
  });

  it('trims surrounding whitespace and rejects malformed identifiers', () => {
    expect(createBilibiliVideoUrl(' BV1xx411c7mD ')).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    );
    expect(createBilibiliVideoUrl('not-a-bvid')).toBeNull();
    expect(createBilibiliVideoUrl('BV123')).toBeNull();
    expect(createBilibiliVideoUrl(undefined)).toBeNull();
  });
});
