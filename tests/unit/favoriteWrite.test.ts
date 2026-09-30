import {BiliApiError} from '../../src/core/errors';
import {
  favoriteService,
  FavoriteStateReadbackError,
} from '../../src/services/favoriteService';
import {biliApi} from '../../src/services/biliApi';
import {cookieService} from '../../src/services/cookieService';
import * as dbOperations from '../../src/db/operations';

jest.mock('../../src/services/biliApi', () => ({
  biliApi: {
    getFavoriteFolders: jest.fn(),
    assertWriteAccount: jest.fn(),
    getFavoriteVideos: jest.fn(),
    addVideoToFavoriteFolders: jest.fn(),
    createFavoriteFolder: jest.fn(),
  },
}));

jest.mock('../../src/services/cookieService', () => ({
  cookieService: {
    get: jest.fn(),
    extractUid: jest.fn(),
  },
}));

jest.mock('../../src/core/cache', () => ({
  cache: {
    getOrSet: jest.fn((_key, _ttl, fetcher) => fetcher()),
    set: jest.fn(),
    delete: jest.fn(),
    deletePrefix: jest.fn(),
  },
}));

jest.mock('../../src/db/operations', () => ({
  upsertPlaylistMeta: jest.fn(),
  getPlaylistMeta: jest.fn(),
  createSyncJob: jest.fn(),
  finishSyncJob: jest.fn(),
  upsertVideosBatch: jest.fn(),
  updatePlaylistSyncProgress: jest.fn(),
  markPlaylistSyncSuccess: jest.fn(),
  softDeleteMissingVideos: jest.fn(),
  getAllValidVideos: jest.fn(),
  getRandomVideosBatch: jest.fn(),
  clearAllData: jest.fn(),
  deletePlaylistAndVideos: jest.fn(),
  getPlaylistVideoCount: jest.fn(),
  getVideosByPlaylistId: jest.fn(),
}));

jest.mock('../../src/db/database', () => ({
  database: {write: jest.fn()},
  videoMetaCollection: {query: jest.fn()},
}));

jest.mock('../../src/services/LoggerService', () => ({
  __esModule: true,
  default: {warn: jest.fn(), error: jest.fn(), info: jest.fn()},
}));

jest.mock('@nozbe/watermelondb', () => ({
  Q: {where: jest.fn(), oneOf: jest.fn()},
}));

const folderRows = [
  {id: 10, fid: 1, mid: 42, title: 'Playlist A', media_count: 1},
  {id: 20, fid: 2, mid: 42, title: 'Playlist B', media_count: 1},
];
const video = {
  aid: 9876,
  bvid: 'BV1xx411c7mD',
  title: '夜曲',
  cover: 'https://i0.hdslb.com/test.jpg',
  duration: 180,
  pubtime: 1700000000,
  authorId: 88,
  author: '音乐人',
  tags: ['钢琴', '夜曲'],
};

const getFoldersMock = biliApi.getFavoriteFolders as jest.Mock;
const addMock = biliApi.addVideoToFavoriteFolders as jest.Mock;
const createMock = biliApi.createFavoriteFolder as jest.Mock;
const cookieGetMock = cookieService.get as jest.Mock;
const cookieUidMock = cookieService.extractUid as jest.Mock;
const upsertVideosMock = dbOperations.upsertVideosBatch as jest.Mock;
const getAllValidVideosMock = dbOperations.getAllValidVideos as jest.Mock;

describe('favorite write reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (biliApi.assertWriteAccount as jest.Mock).mockResolvedValue(undefined);
    cookieGetMock.mockResolvedValue(
      'SESSDATA=session; DedeUserID=42; bili_jct=token',
    );
    cookieUidMock.mockReturnValue('42');
    getAllValidVideosMock.mockResolvedValue([]);
    upsertVideosMock.mockResolvedValue(undefined);
  });

  it('reads back all selected folders before writing their video into the local index', async () => {
    getFoldersMock
      .mockResolvedValueOnce({list: folderRows})
      .mockResolvedValueOnce({
        list: folderRows.map(folder => ({...folder, fav_state: 1})),
      });
    addMock.mockResolvedValue({});

    const result = await favoriteService.addSearchResultToFolders(
      '42',
      video,
      [10, 20],
    );

    expect(addMock).toHaveBeenCalledWith('42', video.aid, [10, 20]);
    expect(getFoldersMock).toHaveBeenNthCalledWith(
      2,
      '42',
      undefined,
      video.aid,
    );
    expect(result).toEqual({
      confirmedFolderIds: [10, 20],
      unconfirmedFolderIds: [],
      writeErrorMessage: null,
    });
    expect(upsertVideosMock).toHaveBeenCalledTimes(2);
    expect(upsertVideosMock).toHaveBeenCalledWith('10', [
      expect.objectContaining({bvid: video.bvid}),
    ]);
    expect(upsertVideosMock).toHaveBeenCalledWith('20', [
      expect.objectContaining({bvid: video.bvid}),
    ]);
    expect(getAllValidVideosMock).toHaveBeenCalledTimes(1);
  });

  it('indexes only remotely confirmed folders when Bilibili reports an already-saved item', async () => {
    getFoldersMock
      .mockResolvedValueOnce({list: folderRows})
      .mockResolvedValueOnce({
        list: [
          {...folderRows[0], fav_state: 1},
          {...folderRows[1], fav_state: 0},
        ],
      });
    addMock.mockRejectedValue(new BiliApiError(11201, '已经收藏过了'));

    const result = await favoriteService.addSearchResultToFolders(
      '42',
      video,
      [10, 20],
    );

    expect(result.confirmedFolderIds).toEqual([10]);
    expect(result.unconfirmedFolderIds).toEqual([20]);
    expect(result.writeErrorMessage).toBe('已经收藏过了');
    expect(upsertVideosMock).toHaveBeenCalledTimes(1);
    expect(upsertVideosMock).toHaveBeenCalledWith('10', [
      expect.objectContaining({bvid: video.bvid}),
    ]);
  });

  it('does not index when Bilibili status cannot be read back', async () => {
    getFoldersMock
      .mockResolvedValueOnce({list: folderRows})
      .mockRejectedValueOnce(new Error('network unavailable'));
    addMock.mockResolvedValue({});

    await expect(
      favoriteService.addSearchResultToFolders('42', video, [10]),
    ).rejects.toBeInstanceOf(FavoriteStateReadbackError);
    expect(upsertVideosMock).not.toHaveBeenCalled();
  });

  it('verifies a newly created folder in Bilibili before returning it to the picker', async () => {
    const created = {id: 30, fid: 3, mid: 42, title: 'New', media_count: 0};
    createMock.mockResolvedValue(created);
    getFoldersMock.mockResolvedValueOnce({list: [created]});

    const result = await favoriteService.createFavoriteFolder('42', ' New ', 1);

    expect(createMock).toHaveBeenCalledWith('42', ' New ', 1);
    expect(result).toEqual({
      id: 30,
      fid: 3,
      mid: 42,
      title: 'New',
      mediaCount: 0,
    });
  });
});
