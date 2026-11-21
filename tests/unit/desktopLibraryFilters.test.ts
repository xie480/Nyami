import type {
  DesktopVideo,
  FavoriteSourceSummary,
} from '../../desktop/shared/types';
import {
  filterVisibleFavoriteIndex,
  filterVisibleFavoriteSources,
  getFavoriteSourceKey,
  getSyncStatusLabel,
} from '../../desktop/shared/libraryFilters';

const createSource = (
  sourceKey: string,
  syncStatus: FavoriteSourceSummary['syncStatus'] = 'success',
): FavoriteSourceSummary => ({
  sourceKey,
  kind: 'collectedFavorite',
  remoteId: 1,
  ownerMid: 2,
  ownerName: 'owner',
  title: sourceKey,
  cover: '',
  mediaCount: 1,
  description: '',
  syncStatus,
  lastSyncedAt: null,
});

const createVideo = (
  bvid: string,
  sourceKeys: string[],
): DesktopVideo => ({
  bvid,
  title: bvid,
  cover: '',
  duration: 1,
  pubtime: 0,
  authorId: 1,
  author: 'author',
  tags: [],
  source: 'favorite',
  sourceKeys,
});

describe('desktop favorite source filters', () => {
  it('creates stable keys for collected favorites and seasons', () => {
    expect(getFavoriteSourceKey('collectedFavorite', 42, 7)).toBe(
      'collectedFavorite:42:7',
    );
    expect(getFavoriteSourceKey('subscribedSeason', 42, 7)).toBe(
      'subscribedSeason:42:7',
    );
  });

  it('filters sources and videos by the imported source keys', () => {
    const sources = [createSource('collectedFavorite:2:1'), createSource('collectedFavorite:2:2')];
    const videos = [
      createVideo('BV1', ['collectedFavorite:2:1']),
      createVideo('BV2', ['collectedFavorite:2:2']),
      createVideo('BV3', ['collectedFavorite:2:1', 'collectedFavorite:2:2']),
    ];

    expect(filterVisibleFavoriteSources(sources, ['collectedFavorite:2:2']).map(item => item.sourceKey)).toEqual([
      'collectedFavorite:2:2',
    ]);
    expect(filterVisibleFavoriteIndex(videos, ['collectedFavorite:2:2']).map(item => item.bvid)).toEqual([
      'BV2',
      'BV3',
    ]);
  });

  it('does not call an unsynced source synced', () => {
    expect(getSyncStatusLabel('running')).toBe('同步中');
    expect(getSyncStatusLabel('failed')).toBe('同步失败');
    expect(getSyncStatusLabel('success')).toBe('已同步');
  });
});
