import React from 'react';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';
import {
  Alert,
  FlatList,
  Platform,
  StatusBar,
  TextInput,
  ToastAndroid,
} from 'react-native';

jest.mock('react-native/Libraries/Settings/Settings', () => ({
  get: jest.fn(),
  set: jest.fn(),
  watchKeys: jest.fn(),
  clearWatch: jest.fn(),
}));

jest.mock('react-native/Libraries/Settings/NativeSettingsManager', () => ({
  getConstants: () => ({settings: {}}),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-fast-image', () => ({
  __esModule: true,
  default: Object.assign(() => null, {resizeMode: {cover: 'cover'}}),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, right: 0, bottom: 0, left: 0}),
}));
jest.mock('../../src/theme', () => ({
  useTheme: () => ({
    colors: require('../../src/theme/colors').lightColors,
    ...require('../../src/theme/spacing'),
    ...require('../../src/theme/typography'),
    isDark: false,
  }),
}));
jest.mock('../../src/components/Loading', () => ({Loading: () => null}));
jest.mock('../../src/hooks/useNetworkRecoveryRefresh', () => ({
  useNetworkRecoveryRefresh: jest.fn(),
}));
jest.mock('../../src/store/authStore', () => {
  const state = {userId: 'test-user'};
  return {
    useAuthStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      {
        getState: () => state,
      },
    ),
  };
});
jest.mock('../../src/store/settingsStore', () => {
  const state = {hiddenFolderIds: []};
  return {
    useSettingsStore: (selector: (value: typeof state) => unknown) =>
      selector(state),
  };
});
jest.mock('../../src/store/importedPlaylistStore', () => {
  const state = {
    catalogByUid: {'test-user': []},
    visibleSourceKeysByUid: {'test-user': []},
    setCatalog: jest.fn(),
  };
  return {
    useImportedPlaylistStore: (selector: (value: typeof state) => unknown) =>
      selector(state),
  };
});
jest.mock('../../src/store/syncStore', () => ({
  useSyncStore: (selector: (value: {syncStatus: string}) => unknown) =>
    selector({syncStatus: 'idle'}),
}));
jest.mock('../../src/store/playerStore', () => {
  const state = {
    playContext: null as unknown,
    setQueue: jest.fn(),
    setResolving: jest.fn(),
    playbackError: '加载音频失败，请检查网络',
  };
  state.setQueue.mockImplementation((...args) => {
    state.playContext = args[2];
  });
  return {
    usePlayerStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      {
        getState: () => state,
      },
    ),
  };
});
jest.mock('../../src/store/progressStore', () => {
  const state = {resetProgress: jest.fn()};
  return {useProgressStore: {getState: () => state}};
});
jest.mock('../../src/services/favoriteService', () => ({
  favoriteService: {
    getFolders: jest.fn(() => Promise.resolve([])),
    getGlobalIndex: jest.fn(() => []),
  },
  loadGlobalIndexCache: jest.fn(() => Promise.resolve()),
  subscribeFavoriteFolderUpdates: jest.fn(() => () => {}),
}));
jest.mock('../../src/services/importedPlaylistService', () => ({
  importedPlaylistService: {
    getCollectedPlaylists: jest.fn(() => Promise.resolve([])),
  },
}));
jest.mock('../../src/services/dataPrefetcher', () => ({
  prefetchAudioUrl: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../src/services/trackPlayer', () => ({
  loadQueue: jest.fn(() => Promise.resolve(1)),
  playWithIntent: jest.fn(() => Promise.resolve()),
  resolveCurrentTrack: jest.fn(() => Promise.resolve()),
}));

import {FoldersScreen} from '../../src/screens/FoldersScreen';
import {favoriteService} from '../../src/services/favoriteService';
import {
  loadQueue,
  playWithIntent,
  resolveCurrentTrack,
} from '../../src/services/trackPlayer';
import {usePlayerStore} from '../../src/store/playerStore';
import {useAuthStore} from '../../src/store/authStore';
import type {FavoriteVideo} from '../../src/types/domain';
import {getFavoriteSearchRefreshKey} from '../../src/utils/playbackRefreshKey';

const keywordVideos: FavoriteVideo[] = Array.from(
  {length: 105},
  (_, index) => ({
    bvid: `BVkeyword${index + 1}`,
    title: `Search Needle ${index + 1}`,
    cover: 'https://example.test/cover.jpg',
    duration: 180,
    page: 1,
    pubtime: 0,
    favTime: 0,
    upper: {mid: 1, name: 'Other Author'},
    attr: 0,
  }),
);
const authorVideo: FavoriteVideo = {
  ...keywordVideos[0],
  bvid: 'BVauthorOnly',
  title: 'A Different Title',
  upper: {mid: 2, name: 'Search Needle'},
};

function deferredLoad() {
  let resolve!: (version: number) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<number>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

describe('favorite search screen', () => {
  let screen: ReactTestRenderer;
  const navigation = {navigate: jest.fn()};

  beforeEach(async () => {
    jest.clearAllMocks();
    usePlayerStore.getState().playContext = null;
    useAuthStore.getState().userId = 'test-user';
    jest.spyOn(StatusBar, 'setTranslucent').mockImplementation(() => {});
    jest
      .mocked(favoriteService.getGlobalIndex)
      .mockReturnValue([...keywordVideos, authorVideo]);
    await act(async () => {
      screen = renderer.create(<FoldersScreen navigation={navigation} />);
    });
    act(() => {
      screen.root.findByProps({name: 'magnify', size: 27}).props.onPress();
    });
    act(() => {
      screen.root.findByType(TextInput).props.onChangeText('  SEARCH NEEDLE  ');
    });
  });

  afterEach(() => {
    act(() => screen.unmount());
    jest.restoreAllMocks();
  });

  const switchToAuthor = () => {
    act(() => {
      screen.root
        .findByProps({accessibilityLabel: '按作者搜索收藏视频'})
        .props.onPress();
    });
  };

  it('keeps the query while switching between title and author results', () => {
    expect(screen.root.findByType(FlatList).props.data).toEqual(keywordVideos);
    expect(
      screen.root.findByProps({accessibilityLabel: '按关键词搜索收藏视频'})
        .props.accessibilityState.selected,
    ).toBe(true);

    switchToAuthor();

    expect(screen.root.findByType(TextInput).props.value).toBe(
      '  SEARCH NEEDLE  ',
    );
    expect(screen.root.findByType(FlatList).props.data).toEqual([authorVideo]);
    expect(
      screen.root.findByProps({accessibilityLabel: '按作者搜索收藏视频'}).props
        .accessibilityState.selected,
    ).toBe(true);

    act(() => {
      screen.root
        .findByProps({accessibilityLabel: '按关键词搜索收藏视频'})
        .props.onPress();
    });

    expect(screen.root.findByType(TextInput).props.value).toBe(
      '  SEARCH NEEDLE  ',
    );
    expect(screen.root.findByType(FlatList).props.data).toEqual(keywordVideos);
  });

  it('plays the 105th search result with the complete result queue and search context', async () => {
    const list = screen.root.findByType(FlatList);
    const lastVideo = keywordVideos[104];
    // FlatList virtualizes rows; invoke the real renderItem row for an item beyond its initial window.
    const lastRow = list.props.renderItem({item: lastVideo, index: 104});

    await act(async () => {
      await lastRow.props.onPress();
    });

    expect(usePlayerStore.getState().setQueue).toHaveBeenCalledWith(
      keywordVideos,
      lastVideo.bvid,
      {
        refreshKey: getFavoriteSearchRefreshKey(
          'test-user',
          'SEARCH NEEDLE',
          'keyword',
        ),
        favoriteSearch: {
          uid: 'test-user',
          keyword: 'SEARCH NEEDLE',
          mode: 'keyword',
        },
      },
    );
    expect(loadQueue).toHaveBeenCalledWith(keywordVideos, lastVideo.bvid);
    expect(navigation.navigate).toHaveBeenCalledWith('Player');
    expect(playWithIntent).not.toHaveBeenCalled();
    expect(resolveCurrentTrack).toHaveBeenCalledWith(1);
  });

  it('retains author mode in the playback context', async () => {
    switchToAuthor();
    const list = screen.root.findByType(FlatList);
    const row = list.props.renderItem({item: authorVideo, index: 0});

    await act(async () => {
      await row.props.onPress();
    });

    expect(usePlayerStore.getState().setQueue).toHaveBeenCalledWith(
      [authorVideo],
      authorVideo.bvid,
      {
        refreshKey: getFavoriteSearchRefreshKey(
          'test-user',
          'SEARCH NEEDLE',
          'author',
        ),
        favoriteSearch: {
          uid: 'test-user',
          keyword: 'SEARCH NEEDLE',
          mode: 'author',
        },
      },
    );
    expect(loadQueue).toHaveBeenCalledWith([authorVideo], authorVideo.bvid);
  });

  it('shows the playback error instead of opening the player when audio loading fails', async () => {
    jest.mocked(loadQueue).mockResolvedValueOnce(0);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
    const list = screen.root.findByType(FlatList);
    const row = list.props.renderItem({item: keywordVideos[104], index: 104});

    await act(async () => {
      await row.props.onPress();
    });

    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(resolveCurrentTrack).not.toHaveBeenCalled();
    expect(playWithIntent).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().setResolving).toHaveBeenLastCalledWith(
      false,
    );
    if (Platform.OS === 'android') {
      expect(toast).toHaveBeenCalledWith(
        '加载音频失败，请检查网络',
        ToastAndroid.SHORT,
      );
    } else {
      expect(alert).toHaveBeenCalledWith(
        '播放错误',
        '加载音频失败，请检查网络',
      );
    }
  });

  it('ignores an expired zero result while a newer selection is still loading', async () => {
    const firstLoad = deferredLoad();
    const secondLoad = deferredLoad();
    jest
      .mocked(loadQueue)
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
    const list = screen.root.findByType(FlatList);
    const firstRow = list.props.renderItem({item: keywordVideos[0], index: 0});
    const secondRow = list.props.renderItem({
      item: keywordVideos[104],
      index: 104,
    });
    let firstPress!: Promise<void>;
    let secondPress!: Promise<void>;
    act(() => {
      firstPress = firstRow.props.onPress();
      secondPress = secondRow.props.onPress();
    });
    const firstContext = jest.mocked(usePlayerStore.getState().setQueue).mock
      .calls[0][2];
    const secondContext = jest.mocked(usePlayerStore.getState().setQueue).mock
      .calls[1][2];
    expect(secondContext).not.toBe(firstContext);

    await act(async () => {
      firstLoad.resolve(0);
      await firstPress;
    });

    expect(alert).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(resolveCurrentTrack).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().setResolving).not.toHaveBeenCalledWith(
      false,
    );
    expect(usePlayerStore.getState().playContext).toBe(secondContext);

    await act(async () => {
      secondLoad.resolve(1);
      await secondPress;
    });

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('Player');
    expect(resolveCurrentTrack).toHaveBeenCalledTimes(1);
    expect(resolveCurrentTrack).toHaveBeenCalledWith(1);
  });

  it('ignores an expired rejection after the newer selection has started playback', async () => {
    const firstLoad = deferredLoad();
    const secondLoad = deferredLoad();
    jest
      .mocked(loadQueue)
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
    const list = screen.root.findByType(FlatList);
    const firstRow = list.props.renderItem({item: keywordVideos[0], index: 0});
    const secondRow = list.props.renderItem({
      item: keywordVideos[104],
      index: 104,
    });
    let firstPress!: Promise<void>;
    let secondPress!: Promise<void>;
    act(() => {
      firstPress = firstRow.props.onPress();
      secondPress = secondRow.props.onPress();
    });
    const secondContext = usePlayerStore.getState().playContext;

    await act(async () => {
      secondLoad.resolve(1);
      await secondPress;
    });
    await act(async () => {
      firstLoad.reject(new Error('Expired selection failed'));
      await firstPress;
    });

    expect(alert).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().setResolving).not.toHaveBeenCalledWith(
      false,
    );
    expect(usePlayerStore.getState().playContext).toBe(secondContext);
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(resolveCurrentTrack).toHaveBeenCalledTimes(1);
  });

  it('ignores the pending playback result after the account changes', async () => {
    const pendingLoad = deferredLoad();
    jest.mocked(loadQueue).mockReturnValueOnce(pendingLoad.promise);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
    const list = screen.root.findByType(FlatList);
    const row = list.props.renderItem({item: keywordVideos[104], index: 104});
    let press!: Promise<void>;
    act(() => {
      press = row.props.onPress();
    });
    useAuthStore.getState().userId = 'another-user';

    await act(async () => {
      pendingLoad.resolve(1);
      await press;
    });

    expect(alert).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(resolveCurrentTrack).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().setResolving).not.toHaveBeenCalledWith(
      false,
    );
  });
});
