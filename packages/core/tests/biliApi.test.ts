import {createBiliApi} from '../src/api/biliApi';

describe('共享 Bilibili API 用例', () => {
  it('在不依赖平台实现的情况下完成搜索和收藏写入参数构造', async () => {
    const get = jest.fn(async () => ({result: [], numPages: 1}));
    const post = jest.fn(async () => ({id: 42}));
    const api = createBiliApi({
      http: {get, post},
      wbi: {
        getKeys: async () => ({imgKey: 'img', subKey: 'sub'}),
        sign: params => `keyword=${String(params.keyword ?? '')}`,
      },
      credentials: {
        getCredentials: async () => ({
          cookie: 'SESSDATA=session; DedeUserID=7; bili_jct=csrf',
          refreshToken: null,
        }),
        saveCredentials: async () => undefined,
        clearCredentials: async () => undefined,
      },
    });

    await api.searchVideos(' 夜曲 ', 2);
    await api.createFavoriteFolder('7', '我的收藏', 0);

    expect(get).toHaveBeenCalledWith(
      '/x/web-interface/wbi/search/type?keyword=夜曲',
      {signal: undefined, silent: true},
      1,
    );
    expect(post).toHaveBeenCalledWith(
      '/x/v3/fav/folder/add',
      'title=%E6%88%91%E7%9A%84%E6%94%B6%E8%97%8F&intro=&privacy=0&csrf=csrf',
      {headers: {Cookie: 'SESSDATA=session; DedeUserID=7; bili_jct=csrf'}},
    );
  });

  it('请求完整 DASH 能力以便返回专用音轨', async () => {
    const get = jest.fn(async () => ({dash: {audio: []}}));
    const sign = jest.fn(() => 'signed-play-url');
    const api = createBiliApi({
      http: {get},
      wbi: {
        getKeys: async () => ({imgKey: 'img', subKey: 'sub'}),
        sign,
      },
      credentials: {
        getCredentials: async () => ({cookie: '', refreshToken: null}),
        saveCredentials: async () => undefined,
        clearCredentials: async () => undefined,
      },
    });

    await api.getPlayUrl('BV1quality001', 123);

    expect(sign).toHaveBeenCalledWith({
      bvid: 'BV1quality001',
      cid: 123,
      fnval: 4048,
      fnver: 0,
      fourk: 1,
    });
    expect(get).toHaveBeenCalledWith(
      '/x/player/wbi/playurl?signed-play-url',
      {signal: undefined},
      undefined,
    );
  });
});
