import type {DesktopVideo} from '../../desktop/shared/types';
import {
  filterSearchVideosByTags,
  migrateSearchTagFilter,
} from '../../desktop/shared/searchTagFilters';

const createVideo = (bvid: string, tags: string[]): DesktopVideo => ({
  bvid,
  title: bvid,
  cover: '',
  duration: 1,
  pubtime: 0,
  authorId: 1,
  author: 'author',
  tags,
  source: 'search',
  sourceKeys: [],
});

describe('desktop search tag filters', () => {
  it('migrates a legacy blacklist with a neutral whitelist mode', () => {
    expect(
      migrateSearchTagFilter({
        tags: ['ambient', 'live'],
        mode: 'or',
        listMode: 'blacklist',
      }),
    ).toEqual({
      whitelistTags: [],
      whitelistMode: 'and',
      blacklistTags: ['ambient', 'live'],
    });
  });

  it('requires every blacklist tag before excluding a result', () => {
    const videos = [
      createVideo('one', ['ambient', 'live']),
      createVideo('two', ['ambient']),
      createVideo('three', ['live']),
    ];
    expect(
      filterSearchVideosByTags(videos, {
        whitelistTags: [],
        whitelistMode: 'and',
        blacklistTags: ['ambient', 'live'],
      }).map(video => video.bvid),
    ).toEqual(['two', 'three']);
  });

  it('combines whitelist matching with blacklist exclusion', () => {
    const videos = [
      createVideo('one', ['ambient', 'live']),
      createVideo('two', ['ambient', 'studio']),
      createVideo('three', ['live', 'studio']),
    ];
    expect(
      filterSearchVideosByTags(videos, {
        whitelistTags: ['ambient'],
        whitelistMode: 'and',
        blacklistTags: ['live'],
      }).map(video => video.bvid),
    ).toEqual(['two']);
  });
});
