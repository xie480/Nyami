import {describe, it, expect} from '@jest/globals';
import type {FavoriteVideo} from '../../src/types/domain';
import {
  buildFavoriteSearchIndex,
  filterFavoriteSearchIndex,
  filterFavoriteVideos,
} from '../../src/utils/favoriteSearch';
import {getFavoriteSearchRefreshKey} from '../../src/utils/playbackRefreshKey';

const videos = [
  {bvid: 'BVtitle', title: 'Moonlight Piano', upper: {mid: 1, name: 'Alice'}},
  {
    bvid: 'BVauthor',
    title: 'Morning Guitar',
    upper: {mid: 2, name: 'Moonlight Studio'},
  },
  {bvid: 'BVboth', title: 'Moonlight Live', upper: {mid: 3, name: 'MOONLIGHT'}},
  {bvid: 'BVunknown', title: 'Rain', upper: undefined},
] as FavoriteVideo[];

describe('favorite search modes', () => {
  it('searches only titles in keyword mode and only UP names in author mode', () => {
    expect(
      filterFavoriteVideos(videos, 'Moonlight', 'keyword').map(
        video => video.bvid,
      ),
    ).toEqual(['BVtitle', 'BVboth']);
    expect(
      filterFavoriteVideos(videos, 'Moonlight', 'author').map(
        video => video.bvid,
      ),
    ).toEqual(['BVauthor', 'BVboth']);
  });

  it('ignores surrounding whitespace and case in either mode', () => {
    expect(filterFavoriteVideos(videos, '  mOoNlIgHt  ', 'keyword')).toEqual([
      videos[0],
      videos[2],
    ]);
    expect(filterFavoriteVideos(videos, '  mOoNlIgHt  ', 'author')).toEqual([
      videos[1],
      videos[2],
    ]);
  });

  it('returns no results for an empty query or a missing author', () => {
    expect(filterFavoriteVideos(videos, '', 'keyword')).toEqual([]);
    expect(filterFavoriteVideos(videos, '   ', 'author')).toEqual([]);
    expect(filterFavoriteVideos([videos[3]], 'Rain', 'author')).toEqual([]);
  });

  it('keeps indexed screen filtering and refresh filtering consistent', () => {
    const index = buildFavoriteSearchIndex(videos);
    expect(filterFavoriteSearchIndex(index, 'moonlight', 'keyword')).toEqual(
      filterFavoriteVideos(videos, 'moonlight', 'keyword'),
    );
    expect(filterFavoriteSearchIndex(index, 'moonlight', 'author')).toEqual(
      filterFavoriteVideos(videos, 'moonlight', 'author'),
    );
  });

  it('preserves mixed title or author search for legacy contexts without a mode', () => {
    expect(filterFavoriteVideos(videos, 'moonlight')).toEqual(
      videos.slice(0, 3),
    );
  });
});

describe('favorite search refresh keys', () => {
  it('isolates the same keyword across keyword, author and legacy contexts', () => {
    const keys = [
      getFavoriteSearchRefreshKey('uid', 'moonlight', 'keyword'),
      getFavoriteSearchRefreshKey('uid', 'moonlight', 'author'),
      getFavoriteSearchRefreshKey('uid', 'moonlight'),
    ];
    expect(new Set(keys).size).toBe(3);
    expect(keys[2]).toBe('favoriteSearch:uid:moonlight');
  });

  it('normalizes case and whitespace without conflating delimited keywords', () => {
    expect(getFavoriteSearchRefreshKey('uid', '  mOoNlIgHt ', 'keyword')).toBe(
      getFavoriteSearchRefreshKey('uid', 'moonlight', 'keyword'),
    );
    expect(
      getFavoriteSearchRefreshKey('uid', 'author:moonlight', 'keyword'),
    ).not.toBe(getFavoriteSearchRefreshKey('uid', 'moonlight', 'author'));
    expect(getFavoriteSearchRefreshKey('uid', 'moonlight', 'keyword')).not.toBe(
      getFavoriteSearchRefreshKey('another-uid', 'moonlight', 'keyword'),
    );
  });
});
