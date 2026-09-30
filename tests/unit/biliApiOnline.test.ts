import {biliApi} from '../../src/services/biliApi';
import {biliGet, biliPost} from '../../src/core/http';
import {encWbi, getWbiKeys} from '../../src/core/wbi';
import {cookieService} from '../../src/services/cookieService';

jest.mock('../../src/core/http', () => ({
  biliGet: jest.fn(),
  biliPost: jest.fn(),
}));

jest.mock('../../src/core/wbi', () => ({
  encWbi: jest.fn(),
  getWbiKeys: jest.fn(),
}));

jest.mock('../../src/services/cookieService', () => ({
  cookieService: {
    get: jest.fn(),
    extractUid: jest.fn(),
    extractSessdata: jest.fn(),
    extractCsrf: jest.fn(),
  },
}));

const getMock = biliGet as jest.Mock;
const postMock = biliPost as jest.Mock;
const getKeysMock = getWbiKeys as jest.Mock;
const encWbiMock = encWbi as jest.Mock;
const cookieGetMock = cookieService.get as jest.Mock;
const extractUidMock = cookieService.extractUid as jest.Mock;
const extractSessdataMock = cookieService.extractSessdata as jest.Mock;
const extractCsrfMock = cookieService.extractCsrf as jest.Mock;

describe('biliApi online search and favorite writes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getKeysMock.mockResolvedValue({imgKey: 'img', subKey: 'sub'});
    encWbiMock.mockReturnValue('keyword=signed');
    cookieGetMock.mockResolvedValue(
      'SESSDATA=session; DedeUserID=42; bili_jct=token',
    );
    extractUidMock.mockReturnValue('42');
    extractSessdataMock.mockReturnValue('session');
    extractCsrfMock.mockReturnValue('token');
    postMock.mockResolvedValue({});
  });

  it('uses WBI video search and passes the abort signal through', async () => {
    const controller = new AbortController();
    await biliApi.searchVideos(' 夜曲 ', 2, controller.signal);

    expect(encWbiMock).toHaveBeenCalledWith(
      expect.objectContaining({search_type: 'video', keyword: '夜曲', page: 2}),
      'img',
      'sub',
    );
    expect(getMock).toHaveBeenCalledWith(
      '/x/web-interface/wbi/search/type?keyword=signed',
      {signal: controller.signal, silent: true},
      1,
    );
  });

  it('rejects empty search keywords and invalid pages before networking', async () => {
    await expect(biliApi.searchVideos('   ')).rejects.toThrow(
      '搜索关键词不能为空',
    );
    await expect(biliApi.searchVideos('夜曲', 0)).rejects.toThrow(
      '搜索页码无效',
    );
    expect(getKeysMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('creates a private folder with the matching account cookie and CSRF', async () => {
    await biliApi.createFavoriteFolder('42', 'My Playlist', 1);

    expect(postMock).toHaveBeenCalledWith(
      '/x/v3/fav/folder/add',
      'title=My+Playlist&intro=&privacy=1&csrf=token',
      {headers: {Cookie: 'SESSDATA=session; DedeUserID=42; bili_jct=token'}},
    );
  });

  it('adds a video to deduplicated selected folders using aid and csrf', async () => {
    await biliApi.addVideoToFavoriteFolders('42', 9876, [10, 10, 20]);

    expect(postMock).toHaveBeenCalledWith(
      '/x/v3/fav/resource/deal',
      'rid=9876&type=2&add_media_ids=10%2C20&del_media_ids=&csrf=token',
      {headers: {Cookie: 'SESSDATA=session; DedeUserID=42; bili_jct=token'}},
    );
  });

  it('blocks writes when the stored cookie belongs to another account or lacks CSRF', async () => {
    extractUidMock.mockReturnValueOnce('99');
    await expect(
      biliApi.createFavoriteFolder('42', 'Private', 1),
    ).rejects.toThrow('账号已变化');

    extractUidMock.mockReturnValue('42');
    extractCsrfMock.mockReturnValueOnce(null);
    await expect(
      biliApi.addVideoToFavoriteFolders('42', 9, [10]),
    ).rejects.toThrow('缺少 bili_jct');
    expect(postMock).not.toHaveBeenCalled();
  });
});
