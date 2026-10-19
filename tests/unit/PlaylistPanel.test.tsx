import React from 'react';
import {jest, describe, it, beforeEach, afterEach, expect} from '@jest/globals';
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import {GlassView} from '../../src/components/GlassView';
import {PlaylistPanel} from '../../src/components/PlaylistPanel';
import {loadQueue, playQueuedTrack} from '../../src/services/trackPlayer';
import {favoriteService} from '../../src/services/favoriteService';
import {getFavoriteSearchRefreshKey} from '../../src/utils/playbackRefreshKey';
import type {FavoriteVideo} from '../../src/types/domain';

let mockPlayerState: any;
let mockTheme: any;
let mockUserId: string | null;

jest.mock('react-native', () => {
  const ReactMock = require('react');
  const flatten = (style: any): any =>
    Array.isArray(style)
      ? Object.assign({}, ...style.map(flatten))
      : style || {};
  return {
    View: 'View',
    Text: 'Text',
    Modal: 'Modal',
    TouchableOpacity: 'TouchableOpacity',
    ActivityIndicator: 'ActivityIndicator',
    RefreshControl: 'RefreshControl',
    FlatList: ReactMock.forwardRef((props: any, ref: any) => {
      ReactMock.useImperativeHandle(ref, () => ({scrollToIndex: jest.fn()}));
      return ReactMock.createElement(
        'FlatList',
        props,
        props.data.map((item: any, index: number) =>
          ReactMock.createElement(
            ReactMock.Fragment,
            {key: item.bvid},
            props.renderItem({item, index}),
          ),
        ),
      );
    }),
    StyleSheet: {
      create: (styles: any) => styles,
      flatten,
      absoluteFill: {},
      hairlineWidth: 1,
    },
    Platform: {OS: 'android', select: () => undefined},
    Alert: {alert: jest.fn()},
    ToastAndroid: {show: jest.fn(), SHORT: 0},
    useWindowDimensions: () => ({height: 800, width: 400}),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 24, bottom: 34, left: 0, right: 0}),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@react-native-community/blur', () => ({BlurView: 'BlurView'}));
jest.mock('../../src/theme', () => ({useTheme: () => mockTheme}));
jest.mock('../../src/components/IconButton', () => ({
  IconButton: 'IconButton',
}));
jest.mock('../../src/store/playerStore', () => ({
  usePlayerStore: Object.assign(
    (selector: (state: any) => any) => selector(mockPlayerState),
    {getState: () => mockPlayerState},
  ),
}));
jest.mock('../../src/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: any) => any) =>
    selector({glassBlurAmount: 0}),
}));
jest.mock('../../src/store/syncStore', () => ({
  useSyncStore: (selector: (state: any) => any) =>
    selector({syncStatus: 'idle'}),
}));
jest.mock('../../src/store/authStore', () => ({
  useAuthStore: {getState: () => ({userId: mockUserId})},
}));
jest.mock('../../src/store/folderDataStore', () => ({
  useFolderDataStore: {getState: () => ({})},
}));
jest.mock('../../src/core/storage', () => ({
  storage: {getString: () => 'uid'},
}));
jest.mock('../../src/services/trackPlayer', () => ({
  loadQueue: jest.fn(() => Promise.resolve(1)),
  playQueuedTrack: jest.fn(() => Promise.resolve(false)),
  playSpecificPart: jest.fn(),
}));
jest.mock('../../src/services/favoriteService', () => ({
  favoriteService: {getGlobalIndex: jest.fn()},
  loadGlobalIndexCache: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../src/services/importedPlaylistService', () => ({
  importedPlaylistService: {
    getCollectedPlaylists: jest.fn(() =>
      Promise.resolve([{sourceKey: 'season:1'}]),
    ),
  },
}));
jest.mock('../../src/services/onlineVideoSearchService', () => ({
  fetchOnlineVideoSearchPage: jest.fn(),
  getOnlineSearchRefreshKey: jest.fn(),
  publishOnlineSearchRefresh: jest.fn(),
}));
jest.mock('../../src/services/homeRecommendationService', () => ({
  loadMorePersonalizedSongs: jest.fn(),
}));
jest.mock('../../src/services/transformers', () => ({
  searchVideoToFavoriteVideo: jest.fn(),
}));

const mockLoadQueue = jest.mocked(loadQueue);
const mockPlayQueuedTrack = jest.mocked(playQueuedTrack);
const mockGetGlobalIndex = jest.mocked(favoriteService.getGlobalIndex);
const videos: FavoriteVideo[] = Array.from({length: 10}, (_, index) => ({
  bvid: `BV${index + 1}`,
  title: `收藏歌曲 ${index + 1}`,
  upper: {mid: index + 1, name: `作者 ${index + 1}`},
  duration: 60,
  cover: '',
  page: 1,
  pubtime: 0,
  favTime: 0,
  attr: 0,
}));

describe('PlaylistPanel search result playback', () => {
  let view: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 'uid';
    mockTheme = {
      colors: {primary: '#fb7299', background: '#fff', divider: '#ddd'},
      radius: {md: 12},
    };
    mockPlayerState = {
      queue: videos,
      currentBvid: videos[0].bvid,
      playContext: {
        favoriteSearch: {uid: 'uid', keyword: '收藏', mode: 'keyword'},
      },
      playMode: 'sequential',
      queueLoading: false,
      appendQueue: jest.fn(),
      removeFromQueue: jest.fn(),
      togglePlayMode: jest.fn(),
      setCurrentBvid: jest.fn(),
      replaceQueueFromSearchRefresh: jest.fn(),
    };
    mockLoadQueue.mockResolvedValue(1);
    mockPlayQueuedTrack.mockResolvedValue(false);
  });

  afterEach(() => {
    act(() => view?.unmount());
  });

  function openPanel() {
    const onClose = jest.fn();
    act(() => {
      view = renderer.create(<PlaylistPanel visible onClose={onClose} />);
    });
    return {list: findHostNodes('FlatList')[0], onClose};
  }

  function findHostNodes(type: string) {
    return view!.root.findAll(node => (node.type as unknown) === type);
  }

  it('keeps all ten results and loads the last selected video when it is outside the native buffer', async () => {
    const {list, onClose} = openPanel();
    expect(list.props.data).toEqual(videos);
    const playButtons = findHostNodes('TouchableOpacity');

    await act(async () => {
      await playButtons[9].props.onPress();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(playQueuedTrack).toHaveBeenCalledWith(videos[9].bvid);
    expect(loadQueue).toHaveBeenCalledWith(videos, videos[9].bvid);
    expect(mockPlayerState.setCurrentBvid).toHaveBeenCalledWith(videos[9].bvid);
  });

  it('reuses the native track when the selected video is already buffered', async () => {
    mockPlayQueuedTrack.mockResolvedValue(true);
    openPanel();

    await act(async () => {
      await findHostNodes('TouchableOpacity')[9].props.onPress();
    });

    expect(loadQueue).not.toHaveBeenCalled();
    expect(mockPlayerState.setCurrentBvid).toHaveBeenCalledWith(videos[9].bvid);
  });

  it('does not let an earlier failed selection replace a later selection', async () => {
    let finishFirstSelection!: (played: boolean) => void;
    mockPlayQueuedTrack
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishFirstSelection = resolve;
          }),
      )
      .mockResolvedValueOnce(true);
    openPanel();
    const playButtons = findHostNodes('TouchableOpacity');

    await act(async () => {
      playButtons[4].props.onPress();
      playButtons[9].props.onPress();
      await Promise.resolve();
      finishFirstSelection(false);
      await Promise.resolve();
    });

    expect(loadQueue).not.toHaveBeenCalled();
    expect(mockPlayerState.setCurrentBvid).toHaveBeenCalledTimes(1);
    expect(mockPlayerState.setCurrentBvid).toHaveBeenCalledWith(videos[9].bvid);
  });

  it('does not reload a selection after another playback source has replaced its context', async () => {
    let finishSelection!: (played: boolean) => void;
    mockPlayQueuedTrack.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishSelection = resolve;
        }),
    );
    mockPlayerState.playContext = {sourceKey: 'first-source'};
    openPanel();

    await act(async () => {
      findHostNodes('TouchableOpacity')[9].props.onPress();
      mockPlayerState.playContext = {sourceKey: 'other-source'};
      finishSelection(false);
      await Promise.resolve();
    });

    expect(loadQueue).not.toHaveBeenCalled();
    expect(mockPlayerState.setCurrentBvid).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'refresh key',
      context: {refreshKey: 'online-search:query', onlineSearch: {page: 1}},
    },
    {label: 'source key', context: {sourceKey: 'season:1'}},
    {label: 'folder id', context: {folderId: 123}},
    {
      label: 'personalized source',
      context: {isPersonalized: true, recommendationPage: 1},
    },
  ])(
    'allows $label metadata updates while loading an unbuffered selection',
    async ({context}) => {
      let finishSelection!: (played: boolean) => void;
      mockPlayQueuedTrack.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishSelection = resolve;
          }),
      );
      mockPlayerState.playContext = context;
      openPanel();

      await act(async () => {
        findHostNodes('TouchableOpacity')[9].props.onPress();
        mockPlayerState.playContext = {
          ...context,
          onlineSearch: {page: 2},
          recommendationPage: 2,
        };
        finishSelection(false);
        await Promise.resolve();
      });

      expect(loadQueue).toHaveBeenCalledWith(videos, videos[9].bvid);
      expect(mockPlayerState.setCurrentBvid).toHaveBeenCalledWith(
        videos[9].bvid,
      );
    },
  );

  it('does not reload an old selection after the signed-in account changes', async () => {
    let finishSelection!: (played: boolean) => void;
    mockPlayQueuedTrack.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishSelection = resolve;
        }),
    );
    mockPlayerState.playContext = {refreshKey: 'online-search:query'};
    openPanel();

    await act(async () => {
      findHostNodes('TouchableOpacity')[9].props.onPress();
      mockUserId = 'other-uid';
      finishSelection(false);
      await Promise.resolve();
    });

    expect(loadQueue).not.toHaveBeenCalled();
    expect(mockPlayerState.setCurrentBvid).not.toHaveBeenCalled();
  });

  it('requires the original context reference for a queue with no stable source identity', async () => {
    let finishSelection!: (played: boolean) => void;
    mockPlayQueuedTrack.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishSelection = resolve;
        }),
    );
    openPanel();

    await act(async () => {
      findHostNodes('TouchableOpacity')[9].props.onPress();
      mockPlayerState.playContext = {...mockPlayerState.playContext};
      finishSelection(false);
      await Promise.resolve();
    });

    expect(loadQueue).not.toHaveBeenCalled();
    expect(mockPlayerState.setCurrentBvid).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'constrains every list ancestor in the glass=%s branch without forcing a full-height sheet',
    glass => {
      if (glass) {
        mockTheme.glass = {colors: {glass: {}}, material: {}};
      }
      const {list} = openPanel();

      expect(StyleSheet.flatten(list.props.style)).toMatchObject({
        flexGrow: 0,
        flexShrink: 1,
        minHeight: 0,
      });
      const ancestors = [];
      let ancestor = list.parent;
      while (ancestor && (ancestor.type as unknown) !== 'Modal') {
        if ((ancestor.type as unknown) === 'View') {
          ancestors.push(StyleSheet.flatten(ancestor.props.style));
        }
        ancestor = ancestor.parent;
      }
      // These are rendered layout contracts; Jest does not run native Yoga layout.
      const bounds = ancestors.find(style => style.maxHeight !== undefined);
      expect(bounds).toMatchObject({
        maxHeight: (800 - 24) * 0.8,
        paddingBottom: 34,
      });
      const boundedAncestors = ancestors.slice(
        0,
        ancestors.indexOf(bounds) + 1,
      );
      expect(boundedAncestors).toHaveLength(glass ? 4 : 1);
      boundedAncestors.forEach(style => {
        expect(style).toMatchObject({flexShrink: 1, minHeight: 0});
        expect(style.height).toBeUndefined();
        expect(style.flex).toBeUndefined();
      });
    },
  );

  it('preserves natural GlassView wrapper sizing unless content constraints are requested', () => {
    act(() => {
      view = renderer.create(
        <GlassView minimal>
          <>{'short content'}</>
        </GlassView>,
      );
    });
    const wrappers = findHostNodes('View');
    expect(wrappers).toHaveLength(4);
    wrappers.forEach(wrapper => {
      expect(
        StyleSheet.flatten(wrapper.props.style).flexShrink,
      ).toBeUndefined();
    });
  });

  it.each(['keyword', 'author'] as const)(
    'refreshes favorites using the original %s criteria and identity key',
    async mode => {
      const refreshedVideos = [
        {...videos[0], title: '目标歌曲', upper: {mid: 1, name: '其他作者'}},
        {...videos[1], title: '其他歌曲', upper: {mid: 2, name: '目标作者'}},
      ];
      mockGetGlobalIndex.mockReturnValue(refreshedVideos);
      mockPlayerState.playContext = {
        favoriteSearch: {uid: 'uid', keyword: '目标', mode},
        refreshKey: getFavoriteSearchRefreshKey('uid', '目标', mode),
      };
      const {list} = openPanel();

      await act(async () => {
        list.props.refreshControl.props.onRefresh();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        mockPlayerState.replaceQueueFromSearchRefresh,
      ).toHaveBeenCalledWith(getFavoriteSearchRefreshKey('uid', '目标', mode), [
        refreshedVideos[mode === 'keyword' ? 0 : 1],
      ]);
    },
  );
});
