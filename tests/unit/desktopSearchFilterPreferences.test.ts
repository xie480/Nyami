import {
  DEFAULT_SEARCH_FILTER_PREFERENCES,
  normalizeSearchFilterPreferences,
} from '../../desktop/shared/searchFilterPreferences';

describe('桌面搜索筛选偏好', () => {
  it('保留合法的时长、日期、排序和标签条件', () => {
    expect(
      normalizeSearchFilterPreferences({
        sort: '最多播放',
        dateFilter: '最近一周',
        startDate: '2026-11-01',
        endDate: '2026-11-22',
        minDuration: '12',
        maxDuration: '45',
        tagFilter: {
          whitelistTags: ['ambient'],
          whitelistMode: 'or',
          blacklistTags: ['live'],
        },
      }),
    ).toEqual({
      sort: '最多播放',
      dateFilter: '最近一周',
      startDate: '2026-11-01',
      endDate: '2026-11-22',
      minDuration: '12',
      maxDuration: '45',
      tagFilter: {
        whitelistTags: ['ambient'],
        whitelistMode: 'or',
        blacklistTags: ['live'],
      },
    });
  });

  it('非法值回退默认条件并限制时长输入', () => {
    expect(
      normalizeSearchFilterPreferences({
        sort: 'unknown',
        dateFilter: 'unknown',
        startDate: 'not-a-date',
        minDuration: '-3',
        maxDuration: 'not-a-number',
      }),
    ).toEqual(DEFAULT_SEARCH_FILTER_PREFERENCES);
  });
});
