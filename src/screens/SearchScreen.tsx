import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
import {useNetworkRecoveryRefresh} from '../hooks/useNetworkRecoveryRefresh';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {FavoriteFolderPickerSheet} from '../components/FavoriteFolderPickerSheet';
import {GlassView} from '../components/GlassView';
import {Header} from '../components/Header';
import {IconButton} from '../components/IconButton';
import {
  favoriteService,
  loadGlobalIndexCache,
  subscribeGlobalIndexRevision,
} from '../services/favoriteService';
import {importedPlaylistService} from '../services/importedPlaylistService';
import {
  fetchOnlineVideoSearchPage,
  getOnlineSearchRefreshKey,
  sortOnlineVideoSearchResults,
  subscribeOnlineSearchRefresh,
} from '../services/onlineVideoSearchService';
import {loadQueue, resolveCurrentTrack} from '../services/trackPlayer';
import {prefetchAudioUrl} from '../services/dataPrefetcher';
import {searchVideoToFavoriteVideo} from '../services/transformers';
import {useAuthStore} from '../store/authStore';
import {useImportedPlaylistStore} from '../store/importedPlaylistStore';
import {useFolderDataStore} from '../store/folderDataStore';
import {usePlayerStore} from '../store/playerStore';
import {useProgressStore} from '../store/progressStore';
import {useSettingsStore} from '../store/settingsStore';
import {useTheme} from '../theme';
import {storage} from '../core/storage';
import {formatDuration} from '../utils/format';
import {getFavoriteSearchRefreshKey} from '../utils/playbackRefreshKey';
import {
  buildFavoriteSearchIndex,
  filterFavoriteSearchIndex,
  filterFavoriteVideos,
} from '../utils/favoriteSearch';
import type {FavoriteSearchMode} from '../utils/favoriteSearch';
import type {
  FavoriteVideo,
  OnlineVideoSearchResult,
  OnlineVideoSearchSort,
} from '../types/domain';

type SearchMode = 'bilibili' | 'favorites';
type SearchSort = OnlineVideoSearchSort;

const SORT_OPTIONS: Array<{key: SearchSort; title: string}> = [
  {key: 'relevance', title: '综合推荐'},
  {key: 'newest', title: '最新发布'},
  {key: 'durationDesc', title: '时长从长到短'},
  {key: 'durationAsc', title: '时长从短到长'},
];

/** 独立承接 B 站全站搜索与本地全收藏搜索，在线结果仍复用平台收藏写入服务。 */
export const SearchScreen = ({navigation}: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const {width, fontScale} = useWindowDimensions();
  const uid = useAuthStore(state => state.userId);
  const setQueue = usePlayerStore(state => state.setQueue);
  const [mode, setMode] = useState<SearchMode>('bilibili');
  const [favoriteSearchMode, setFavoriteSearchMode] =
    useState<FavoriteSearchMode>('keyword');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [tagFilter, setTagFilter] = useState('');
  const [onlineResults, setOnlineResults] = useState<OnlineVideoSearchResult[]>(
    [],
  );
  const [favoriteIndex, setFavoriteIndex] = useState<FavoriteVideo[]>([]);
  const [localFavoriteState, setLocalFavoriteState] = useState<{
    uid: string | null;
    bvids: Set<string>;
  }>({uid: null, bvids: new Set()});
  const [favoriteSourceKeys, setFavoriteSourceKeys] = useState<string[]>([]);
  const [onlinePage, setOnlinePage] = useState(0);
  const [onlineHasMore, setOnlineHasMore] = useState(false);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [didSearch, setDidSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [sortVisible, setSortVisible] = useState(false);
  const [favoritePickerVisible, setFavoritePickerVisible] = useState(false);
  const [selectedVideo, setSelectedVideo] =
    useState<OnlineVideoSearchResult | null>(null);
  const requestId = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const onlineLoadingRef = useRef(false);
  const onlineEndReachedArmedRef = useRef(false);
  const favoriteRequestId = useRef(0);
  const favoriteRequestController = useRef<AbortController | null>(null);
  const recommendationDurationFilterEnabled = useSettingsStore(
    state => state.recommendationDurationFilterEnabled,
  );
  const recommendationDurationLimitMinutes = useSettingsStore(
    state => state.recommendationDurationLimitMinutes,
  );
  const setRecommendationDurationFilterEnabled = useSettingsStore(
    state => state.setRecommendationDurationFilterEnabled,
  );
  const previousDurationFilter = useRef({
    enabled: recommendationDurationFilterEnabled,
    minutes: recommendationDurationLimitMinutes,
  });

  const loadFavorites = useCallback(
    async (forceCatalog = false) => {
      if (!uid) {
        setFavoriteIndex([]);
        setFavoriteSourceKeys([]);
        setFavoriteLoading(false);
        return;
      }
      favoriteRequestController.current?.abort();
      const controller = new AbortController();
      favoriteRequestController.current = controller;
      const currentRequestId = ++favoriteRequestId.current;
      setFavoriteLoading(true);
      setError(null);
      try {
        const sources = await importedPlaylistService.getCollectedPlaylists(
          uid,
          forceCatalog,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          currentRequestId !== favoriteRequestId.current ||
          useAuthStore.getState().userId !== uid
        ) {
          return;
        }
        useImportedPlaylistStore.getState().setCatalog(uid, sources);
        await loadGlobalIndexCache();
        if (
          controller.signal.aborted ||
          currentRequestId !== favoriteRequestId.current ||
          useAuthStore.getState().userId !== uid
        ) {
          return;
        }
        if (storage.getString('lastUid') !== uid) {
          setFavoriteIndex([]);
          setError('收藏索引正在随账号切换，请稍后重试');
          return;
        }
        const allSourceKeys = sources.map(source => source.sourceKey);
        setFavoriteSourceKeys(allSourceKeys);
        const refreshedIndex = favoriteService.getGlobalIndex(
          [],
          allSourceKeys,
        );
        setFavoriteIndex(refreshedIndex);

        const keyword = deferredQuery.trim();
        const refreshKey = getFavoriteSearchRefreshKey(
          uid,
          keyword,
          favoriteSearchMode,
        );
        const matchingVideos = filterFavoriteVideos(
          refreshedIndex,
          keyword,
          favoriteSearchMode,
        );
        usePlayerStore
          .getState()
          .replaceQueueFromSearchRefresh(refreshKey, matchingVideos);
      } catch (loadError) {
        if (
          !controller.signal.aborted &&
          currentRequestId === favoriteRequestId.current
        ) {
          setError(
            loadError instanceof Error ? loadError.message : '读取本地收藏失败',
          );
        }
      } finally {
        if (currentRequestId === favoriteRequestId.current) {
          favoriteRequestController.current = null;
          setFavoriteLoading(false);
        }
      }
    },
    [deferredQuery, favoriteSearchMode, uid],
  );

  useFocusEffect(
    useCallback(() => {
      if (mode === 'favorites') {
        void loadFavorites();
      }
      return () => {
        if (mode === 'favorites') {
          favoriteRequestId.current += 1;
          favoriteRequestController.current?.abort();
          favoriteRequestController.current = null;
        }
      };
    }, [loadFavorites, mode]),
  );

  useEffect(
    () => () => {
      requestId.current += 1;
      requestController.current?.abort();
      favoriteRequestId.current += 1;
      favoriteRequestController.current?.abort();
    },
    [],
  );

  const runOnlineSearch = useCallback(
    async (page = 1) => {
      const keyword = query.trim() || tagFilter.trim();
      if (!keyword) {
        setError('请输入视频关键词，或填写 tag 条件后搜索');
        setOnlineResults([]);
        setDidSearch(false);
        return;
      }
      if (!uid) {
        setError('请先登录 B 站账号后再搜索');
        return;
      }
      if (page > 1 && onlineLoadingRef.current) {
        return;
      }
      if (page === 1) {
        requestController.current?.abort();
        onlineEndReachedArmedRef.current = false;
      }

      const controller = new AbortController();
      requestController.current = controller;
      const currentRequestId = ++requestId.current;
      onlineLoadingRef.current = true;
      setOnlineLoading(true);
      setError(null);
      if (page === 1) {
        setOnlineResults([]);
        setDidSearch(false);
      }

      try {
        const response = await fetchOnlineVideoSearchPage(
          {
            keyword,
            tagFilter: tagFilter.trim(),
            sort,
            durationLimitSeconds: recommendationDurationFilterEnabled
              ? recommendationDurationLimitMinutes * 60
              : null,
          },
          page,
          controller.signal,
        );
        if (
          currentRequestId !== requestId.current ||
          controller.signal.aborted
        ) {
          return;
        }
        const criteria = {
          keyword,
          tagFilter: tagFilter.trim(),
          sort,
          durationLimitSeconds: recommendationDurationFilterEnabled
            ? recommendationDurationLimitMinutes * 60
            : null,
        };
        const refreshKey = getOnlineSearchRefreshKey(criteria);
        const playerState = usePlayerStore.getState();
        if (page === 1 && playerState.playContext?.refreshKey === refreshKey) {
          playerState.replaceQueueFromSearchRefresh(
            refreshKey,
            response.results.map(searchVideoToFavoriteVideo),
          );
          playerState.setPlayContext({
            ...playerState.playContext,
            onlineSearch: {
              keyword,
              tagFilter: criteria.tagFilter,
              sort,
              page: 1,
              hasMore: response.hasMore,
              durationLimitSeconds: criteria.durationLimitSeconds,
            },
          });
        }
        setOnlineResults(current => {
          const combined =
            page === 1 ? response.results : [...current, ...response.results];
          return Array.from(
            new Map(combined.map(item => [item.bvid, item])).values(),
          );
        });
        setOnlinePage(page);
        setOnlineHasMore(response.hasMore);
        setDidSearch(true);
      } catch (searchError) {
        if (
          currentRequestId === requestId.current &&
          !controller.signal.aborted
        ) {
          setError(
            searchError instanceof Error ? searchError.message : 'B 站搜索失败',
          );
        }
      } finally {
        if (currentRequestId === requestId.current) {
          onlineLoadingRef.current = false;
          setOnlineLoading(false);
        }
      }
    },
    [
      query,
      recommendationDurationFilterEnabled,
      recommendationDurationLimitMinutes,
      sort,
      tagFilter,
      uid,
    ],
  );

  const refreshOnlineResults = useCallback(async () => {
    const keyword = query.trim() || tagFilter.trim();
    if (!keyword || !uid || onlineLoadingRef.current) {
      return;
    }

    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const currentRequestId = ++requestId.current;
    onlineLoadingRef.current = true;
    setOnlineLoading(true);
    setError(null);
    onlineEndReachedArmedRef.current = false;

    const criteria = {
      keyword,
      tagFilter: tagFilter.trim(),
      sort,
      durationLimitSeconds: recommendationDurationFilterEnabled
        ? recommendationDurationLimitMinutes * 60
        : null,
    };
    const refreshKey = getOnlineSearchRefreshKey(criteria);
    const targetPage = Math.max(1, onlinePage);

    try {
      const refreshedResults = new Map<string, OnlineVideoSearchResult>();
      let page = 1;
      let hasMore = true;
      while (page <= targetPage && hasMore && !controller.signal.aborted) {
        const response = await fetchOnlineVideoSearchPage(
          criteria,
          page,
          controller.signal,
        );
        response.results.forEach(video =>
          refreshedResults.set(video.bvid, video),
        );
        hasMore = response.hasMore;
        if (!hasMore) {
          break;
        }
        page += 1;
      }
      if (controller.signal.aborted || currentRequestId !== requestId.current) {
        return;
      }

      const results = Array.from(refreshedResults.values());
      const fetchedPage = Math.min(targetPage, page);
      setOnlineResults(results);
      setOnlinePage(fetchedPage);
      setOnlineHasMore(hasMore);
      setDidSearch(true);

      const playerState = usePlayerStore.getState();
      if (playerState.playContext?.refreshKey === refreshKey) {
        playerState.replaceQueueFromSearchRefresh(
          refreshKey,
          results.map(searchVideoToFavoriteVideo),
        );
        playerState.setPlayContext({
          ...playerState.playContext,
          onlineSearch: {
            ...playerState.playContext.onlineSearch!,
            page: fetchedPage,
            hasMore,
          },
        });
      }
    } catch (refreshError) {
      if (
        currentRequestId === requestId.current &&
        !controller.signal.aborted
      ) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : '刷新 B 站搜索结果失败',
        );
      }
    } finally {
      if (currentRequestId === requestId.current) {
        onlineLoadingRef.current = false;
        setOnlineLoading(false);
      }
    }
  }, [
    onlinePage,
    query,
    recommendationDurationFilterEnabled,
    recommendationDurationLimitMinutes,
    sort,
    tagFilter,
    uid,
  ]);

  useNetworkRecoveryRefresh(() => {
    if (mode === 'bilibili') {
      return refreshOnlineResults();
    }
    return loadFavorites(true);
  }, Boolean(error && (mode === 'favorites' ? uid : query.trim() || tagFilter.trim())));

  useEffect(
    () =>
      subscribeOnlineSearchRefresh(snapshot => {
        if (mode !== 'bilibili') {
          return;
        }
        const keyword = query.trim() || tagFilter.trim();
        const refreshKey = getOnlineSearchRefreshKey({
          keyword,
          tagFilter: tagFilter.trim(),
          sort,
          durationLimitSeconds: recommendationDurationFilterEnabled
            ? recommendationDurationLimitMinutes * 60
            : null,
        });
        if (snapshot.refreshKey !== refreshKey) {
          return;
        }
        if (usePlayerStore.getState().playContext?.refreshKey !== refreshKey) {
          return;
        }

        setOnlineResults(snapshot.results);
        setOnlinePage(snapshot.page);
        setOnlineHasMore(snapshot.hasMore);
        setDidSearch(true);
        setError(null);
      }),
    [
      mode,
      query,
      recommendationDurationFilterEnabled,
      recommendationDurationLimitMinutes,
      sort,
      tagFilter,
    ],
  );

  useEffect(() => {
    if (mode !== 'favorites' || !uid) {
      return;
    }
    return subscribeGlobalIndexRevision(() => {
      setFavoriteIndex(favoriteService.getGlobalIndex([], favoriteSourceKeys));
    });
  }, [favoriteSourceKeys, mode, uid]);

  useEffect(() => {
    const changed =
      previousDurationFilter.current.enabled !==
        recommendationDurationFilterEnabled ||
      previousDurationFilter.current.minutes !==
        recommendationDurationLimitMinutes;
    previousDurationFilter.current = {
      enabled: recommendationDurationFilterEnabled,
      minutes: recommendationDurationLimitMinutes,
    };
    if (!changed) {
      return;
    }
    if (
      mode === 'bilibili' &&
      (didSearch || onlineLoading) &&
      (query.trim() || tagFilter.trim())
    ) {
      void runOnlineSearch(1);
    }
  }, [
    didSearch,
    mode,
    onlineLoading,
    query,
    recommendationDurationFilterEnabled,
    recommendationDurationLimitMinutes,
    runOnlineSearch,
    tagFilter,
  ]);

  const sortedOnlineResults = useMemo(
    () => sortOnlineVideoSearchResults(onlineResults, sort),
    [onlineResults, sort],
  );
  const favoriteBvids = useMemo(
    () =>
      new Set(
        favoriteIndex
          .filter(video => video.folderIds?.length)
          .map(video => video.bvid),
      ),
    [favoriteIndex],
  );

  const favoriteSearchIndex = useMemo(
    () => buildFavoriteSearchIndex(favoriteIndex),
    [favoriteIndex],
  );

  const filteredFavorites = useMemo(
    () =>
      filterFavoriteSearchIndex(
        favoriteSearchIndex,
        deferredQuery,
        favoriteSearchMode,
      ),
    [deferredQuery, favoriteSearchIndex, favoriteSearchMode],
  );

  const playVideo = useCallback(
    (video: FavoriteVideo) => {
      try {
        const queue =
          mode === 'bilibili'
            ? sortedOnlineResults.map(searchVideoToFavoriteVideo)
            : filteredFavorites;
        const onlineCriteria = {
          keyword: query.trim() || tagFilter.trim(),
          tagFilter: tagFilter.trim(),
          sort,
          durationLimitSeconds: recommendationDurationFilterEnabled
            ? recommendationDurationLimitMinutes * 60
            : null,
        };
        const playContext =
          mode === 'bilibili'
            ? {
                refreshKey: getOnlineSearchRefreshKey(onlineCriteria),
                includeVideoParts: true,
                onlineSearch: {
                  keyword: onlineCriteria.keyword,
                  tagFilter: onlineCriteria.tagFilter,
                  sort,
                  page: onlinePage,
                  hasMore: onlineHasMore,
                  durationLimitSeconds: onlineCriteria.durationLimitSeconds,
                },
              }
            : {
                refreshKey: uid
                  ? getFavoriteSearchRefreshKey(
                      uid,
                      deferredQuery,
                      favoriteSearchMode,
                    )
                  : undefined,
                favoriteSearch: uid
                  ? {
                      uid,
                      keyword: deferredQuery.trim(),
                      mode: favoriteSearchMode,
                    }
                  : undefined,
              };
        if (mode === 'bilibili') {
          usePlayerStore.getState().setPlayMode('sequential');
        }
        setQueue(queue, video.bvid, playContext);
        usePlayerStore.getState().setResolving(true);
        useProgressStore.getState().resetProgress();
        const selectedIndex = queue.findIndex(item => item.bvid === video.bvid);
        prefetchAudioUrl(video.bvid, video.parts?.[0]?.cid).catch(() => {});
        const previousVideo =
          selectedIndex > 0 ? queue[selectedIndex - 1] : undefined;
        if (previousVideo) {
          prefetchAudioUrl(
            previousVideo.bvid,
            previousVideo.parts?.[0]?.cid,
          ).catch(() => {});
        }
        navigation.navigate('Player');
        void (async () => {
          try {
            const revision = await loadQueue(queue, video.bvid);
            if (!revision) {
              throw new Error(
                usePlayerStore.getState().playbackError || '视频暂时无法播放',
              );
            }
            resolveCurrentTrack(revision).catch(() => {});
          } catch (playError) {
            usePlayerStore.getState().setResolving(false);
            Alert.alert(
              '播放失败',
              playError instanceof Error
                ? playError.message
                : '视频暂时无法播放',
            );
          }
        })();
      } catch (playError) {
        usePlayerStore.getState().setResolving(false);
        Alert.alert(
          '播放失败',
          playError instanceof Error ? playError.message : '视频暂时无法播放',
        );
      }
    },
    [
      deferredQuery,
      favoriteSearchMode,
      filteredFavorites,
      mode,
      navigation,
      onlineHasMore,
      onlinePage,
      query,
      recommendationDurationFilterEnabled,
      recommendationDurationLimitMinutes,
      setQueue,
      sort,
      sortedOnlineResults,
      tagFilter,
      uid,
    ],
  );

  const glassBackground = t.glass?.colors.glass.bg ?? t.colors.surface;
  const glassBorder = t.glass?.colors.glass.border ?? t.colors.divider;
  const results: Array<OnlineVideoSearchResult | FavoriteVideo> =
    mode === 'bilibili' ? sortedOnlineResults : filteredFavorites;
  const isLoadingResults =
    onlineLoading ||
    (mode === 'favorites' && (favoriteLoading || query !== deferredQuery));

  const compact = width < 380 || fontScale > 1.2;
  const switchSearchMode = (nextMode: SearchMode) => {
    if (nextMode === mode) {
      return;
    }
    requestController.current?.abort();
    requestId.current += 1;
    onlineLoadingRef.current = false;
    onlineEndReachedArmedRef.current = false;
    setOnlineLoading(false);
    setMode(nextMode);
    setError(null);
  };

  const resultItem = (item: OnlineVideoSearchResult | FavoriteVideo) => {
    const isOnline = mode === 'bilibili';
    const isFavorite =
      (localFavoriteState.uid === uid &&
        localFavoriteState.bvids.has(item.bvid)) ||
      favoriteBvids.has(item.bvid);
    const author = isOnline
      ? (item as OnlineVideoSearchResult).author
      : (item as FavoriteVideo).upper?.name || '未知 UP 主';
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: t.spacing.md,
          padding: t.spacing.md,
          borderRadius: 18,
          backgroundColor: glassBackground,
          borderWidth: 1,
          borderColor: glassBorder,
        }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`播放 ${item.title}，${author}，${formatDuration(
            item.duration,
          )}`}
          activeOpacity={0.75}
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
          }}
          onPress={() =>
            playVideo(
              isOnline
                ? searchVideoToFavoriteVideo(item as OnlineVideoSearchResult)
                : (item as FavoriteVideo),
            )
          }>
          <View
            style={{
              width: compact ? 80 : 104,
              height: compact ? 76 : 80,
              borderRadius: 12,
              overflow: 'hidden',
              backgroundColor: t.colors.surfaceHigh,
            }}>
            <FastImage
              source={{uri: item.cover}}
              style={{width: '100%', height: '100%'}}
              resizeMode={FastImage.resizeMode.cover}
            />
            <View
              style={{
                position: 'absolute',
                bottom: 4,
                right: 4,
                paddingHorizontal: 5,
                paddingVertical: 3,
                borderRadius: 5,
                backgroundColor: 'rgba(15,15,20,0.8)',
              }}>
              <Text style={{fontSize: t.fontSize.xs, color: '#fff'}}>
                {formatDuration(item.duration)}
              </Text>
            </View>
          </View>
          <View style={{flex: 1, minWidth: 0, marginLeft: t.spacing.md}}>
            <Text
              style={{
                fontSize: t.fontSize.base,
                fontWeight: '600',
                color: t.colors.text,
                lineHeight: 23,
              }}
              numberOfLines={2}>
              {item.title}
            </Text>
            <Text
              style={{
                fontSize: t.fontSize.sm,
                color: t.colors.textSub,
                marginTop: t.spacing.xs,
              }}
              numberOfLines={1}>
              {author}
            </Text>
            {isOnline && (item as OnlineVideoSearchResult).tags.length > 0 && (
              <Text
                style={{
                  fontSize: t.fontSize.xs,
                  color: t.colors.textSub,
                  marginTop: t.spacing.xs,
                }}
                numberOfLines={1}>
                {(item as OnlineVideoSearchResult).tags.slice(0, 2).join(' · ')}
              </Text>
            )}
          </View>
        </TouchableOpacity>
        {isOnline && (
          <IconButton
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={23}
            color={isFavorite ? t.colors.primary : t.colors.textSub}
            accessibilityLabel={`${isFavorite ? '已收藏，管理' : '收藏'} ${
              item.title
            }`}
            style={{marginLeft: t.spacing.xs}}
            onPress={() => {
              setSelectedVideo(item as OnlineVideoSearchResult);
              setFavoritePickerVisible(true);
            }}
          />
        )}
      </View>
    );
  };

  const listHeader = (
    <View>
      {mode === 'bilibili' ? (
        <View style={{marginTop: t.spacing.lg, marginBottom: t.spacing.lg}}>
          <Text
            style={{
              fontSize: t.fontSize.sm,
              color: t.colors.text,
              fontWeight: '600',
              marginBottom: t.spacing.sm,
            }}>
            筛选条件
          </Text>
          <View
            style={{
              minHeight: 52,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: t.spacing.md,
              borderWidth: 1,
              borderColor: glassBorder,
              borderRadius: 14,
              backgroundColor: glassBackground,
            }}>
            <Icon
              accessible={false}
              name="tag-outline"
              size={20}
              color={t.colors.textSub}
            />
            <TextInput
              value={tagFilter}
              onChangeText={setTagFilter}
              accessibilityLabel="按兴趣标签筛选"
              placeholder="兴趣标签，例如：日语、治愈"
              placeholderTextColor={t.colors.textHint}
              onSubmitEditing={() => runOnlineSearch(1)}
              returnKeyType="search"
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 48,
                marginLeft: t.spacing.sm,
                color: t.colors.text,
                fontSize: t.fontSize.sm,
                paddingVertical: t.spacing.md,
              }}
            />
          </View>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: t.spacing.sm,
              marginTop: t.spacing.sm,
            }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`时长筛选，${
                recommendationDurationFilterEnabled
                  ? `不超过 ${recommendationDurationLimitMinutes} 分钟`
                  : '不限时长'
              }`}
              accessibilityState={{
                selected: recommendationDurationFilterEnabled,
              }}
              activeOpacity={0.7}
              onPress={() =>
                setRecommendationDurationFilterEnabled(
                  !recommendationDurationFilterEnabled,
                )
              }
              style={{
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.xs,
                paddingHorizontal: t.spacing.md,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: recommendationDurationFilterEnabled
                  ? t.colors.primary
                  : glassBorder,
                backgroundColor: recommendationDurationFilterEnabled
                  ? t.colors.primaryLight
                  : glassBackground,
              }}>
              <Icon
                accessible={false}
                name="clock-outline"
                size={18}
                color={
                  recommendationDurationFilterEnabled
                    ? t.colors.primary
                    : t.colors.textSub
                }
              />
              <Text
                style={{
                  fontSize: t.fontSize.sm,
                  color: recommendationDurationFilterEnabled
                    ? t.colors.primary
                    : t.colors.textSub,
                }}>
                {recommendationDurationFilterEnabled
                  ? `≤ ${recommendationDurationLimitMinutes} 分钟`
                  : '不限时长'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="选择搜索结果排序"
              activeOpacity={0.7}
              onPress={() => setSortVisible(true)}
              style={{
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.xs,
                paddingHorizontal: t.spacing.md,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: glassBorder,
                backgroundColor: glassBackground,
              }}>
              <Icon
                accessible={false}
                name="sort"
                size={18}
                color={t.colors.textSub}
              />
              <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
                {SORT_OPTIONS.find(option => option.key === sort)?.title}
              </Text>
              <Icon
                accessible={false}
                name="chevron-down"
                size={18}
                color={t.colors.textSub}
              />
            </TouchableOpacity>
          </View>
          <Text
            style={{
              fontSize: t.fontSize.xs,
              lineHeight: 20,
              color: t.colors.textSub,
              marginTop: t.spacing.sm,
            }}>
            标签与时长会进一步筛选 B 站返回的结果
          </Text>
        </View>
      ) : (
        <View style={{marginTop: t.spacing.lg, marginBottom: t.spacing.lg}}>
          <Text
            style={{
              fontSize: t.fontSize.sm,
              color: t.colors.text,
              fontWeight: '600',
              marginBottom: t.spacing.sm,
            }}>
            搜索方式
          </Text>
          <View style={{flexDirection: 'row', gap: t.spacing.sm}}>
            {(
              [
                {key: 'keyword', title: '按标题'},
                {key: 'author', title: '按作者'},
              ] as const
            ).map(option => {
              const selected = favoriteSearchMode === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${option.title}搜索收藏视频`}
                  accessibilityState={{selected}}
                  activeOpacity={0.7}
                  onPress={() => setFavoriteSearchMode(option.key)}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    padding: t.spacing.sm,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: selected ? t.colors.primary : glassBorder,
                    backgroundColor: selected
                      ? t.colors.primaryLight
                      : glassBackground,
                  }}>
                  <Text
                    style={{
                      fontSize: t.fontSize.sm,
                      color: selected ? t.colors.primary : t.colors.textSub,
                      fontWeight: selected ? '600' : '400',
                    }}>
                    {option.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text
            style={{
              fontSize: t.fontSize.xs,
              lineHeight: 20,
              color: t.colors.textSub,
              marginTop: t.spacing.sm,
            }}>
            搜索本机已同步的全部自有收藏夹及外部来源
          </Text>
        </View>
      )}
      {error && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            padding: t.spacing.md,
            marginBottom: t.spacing.md,
            gap: t.spacing.sm,
            borderWidth: 1,
            borderColor: glassBorder,
            borderRadius: 14,
            backgroundColor: t.colors.surface,
          }}>
          <Icon
            accessible={false}
            name="alert-circle-outline"
            size={20}
            color={t.colors.error}
          />
          <Text
            style={{
              flex: 1,
              fontSize: t.fontSize.sm,
              lineHeight: 22,
              color: t.colors.text,
            }}>
            {error}
          </Text>
        </View>
      )}
      {(results.length > 0 || didSearch) && (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            fontSize: t.fontSize.sm,
            color: t.colors.textSub,
            marginBottom: t.spacing.md,
          }}>
          搜索结果 · {results.length} 个视频
        </Text>
      )}
    </View>
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.glass ? 'transparent' : t.colors.background,
      }}>
      <StatusBar
        barStyle={t.isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <Header title="搜索" showBack noBorder />
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 880,
          alignSelf: 'center',
          paddingHorizontal: t.spacing.xl,
          paddingTop: t.spacing.sm,
        }}>
        <View
          style={{
            flexDirection: 'row',
            gap: t.spacing.xs,
            padding: t.spacing.xs,
            borderRadius: 18,
            backgroundColor: t.colors.surfaceHigh,
            marginBottom: t.spacing.lg,
          }}>
          {(
            [
              {key: 'bilibili', title: 'B 站全站', icon: 'web'},
              {key: 'favorites', title: '我的收藏', icon: 'heart-outline'},
            ] as const
          ).map(option => {
            const selected = mode === option.key;
            return (
              <TouchableOpacity
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{selected}}
                activeOpacity={0.7}
                onPress={() => switchSearchMode(option.key)}
                style={{
                  flex: 1,
                  minHeight: 48,
                  padding: t.spacing.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: t.spacing.sm,
                  borderRadius: 14,
                  backgroundColor: selected ? t.colors.surface : 'transparent',
                  borderWidth: 1,
                  borderColor: selected ? glassBorder : 'transparent',
                }}>
                <Icon
                  accessible={false}
                  name={option.icon}
                  size={20}
                  color={selected ? t.colors.primary : t.colors.textSub}
                />
                <Text
                  style={{
                    fontSize: t.fontSize.base,
                    fontWeight: selected ? '700' : '500',
                    color: selected ? t.colors.text : t.colors.textSub,
                    flexShrink: 1,
                    textAlign: 'center',
                  }}>
                  {option.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={{
            fontSize: t.fontSize.sm,
            color: t.colors.text,
            fontWeight: '600',
            marginBottom: t.spacing.sm,
          }}>
          {mode === 'bilibili'
            ? '搜索关键词'
            : favoriteSearchMode === 'keyword'
            ? '收藏视频标题'
            : '收藏视频作者'}
        </Text>
        <GlassView
          borderRadius={18}
          backgroundColor={glassBackground}
          borderColor={glassBorder}
          noShadow
          noBlur
          minimal>
          <View
            style={{
              minHeight: 56,
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: t.spacing.md,
              paddingRight: t.spacing.xs,
            }}>
            <Icon
              accessible={false}
              name="magnify"
              size={22}
              color={t.colors.textSub}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => mode === 'bilibili' && runOnlineSearch(1)}
              returnKeyType="search"
              accessibilityLabel={
                mode === 'bilibili'
                  ? 'B 站搜索关键词'
                  : favoriteSearchMode === 'keyword'
                  ? '收藏视频标题关键词'
                  : '收藏视频作者'
              }
              placeholder={
                mode === 'bilibili'
                  ? '搜索视频、音乐、UP 主'
                  : favoriteSearchMode === 'keyword'
                  ? '输入视频标题'
                  : '输入 UP 主名称'
              }
              placeholderTextColor={t.colors.textHint}
              style={{
                flex: 1,
                minWidth: 0,
                marginHorizontal: t.spacing.sm,
                paddingVertical: t.spacing.md,
                color: t.colors.text,
                fontSize: t.fontSize.base,
              }}
            />
            {query.length > 0 && (
              <IconButton
                name="close-circle"
                size={20}
                color={t.colors.textSub}
                accessibilityLabel="清空搜索关键词"
                onPress={() => setQuery('')}
              />
            )}
            {mode === 'bilibili' && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="开始搜索"
                accessibilityState={{
                  disabled: onlineLoading,
                  busy: onlineLoading,
                }}
                activeOpacity={0.7}
                onPress={() => runOnlineSearch(1)}
                disabled={onlineLoading}
                style={{
                  minHeight: 48,
                  minWidth: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: t.spacing.sm,
                  opacity: onlineLoading ? 0.5 : 1,
                }}>
                {onlineLoading ? (
                  <ActivityIndicator color={t.colors.primary} />
                ) : (
                  <Text
                    style={{
                      fontSize: t.fontSize.base,
                      color: t.colors.primary,
                      fontWeight: '700',
                    }}>
                    搜索
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </GlassView>
        <FlatList
          style={{flex: 1}}
          data={results}
          ListHeaderComponent={listHeader}
          refreshControl={
            <RefreshControl
              refreshing={mode === 'bilibili' ? onlineLoading : favoriteLoading}
              onRefresh={() => {
                if (mode === 'bilibili') {
                  void refreshOnlineResults();
                } else {
                  void loadFavorites(true);
                }
              }}
              tintColor={t.colors.primary}
              colors={[t.colors.primary]}
            />
          }
          keyExtractor={item => item.bvid}
          renderItem={({item}) => resultItem(item)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          onScrollBeginDrag={() => {
            if (mode === 'bilibili') {
              onlineEndReachedArmedRef.current = true;
            }
          }}
          onEndReached={() => {
            if (
              mode === 'bilibili' &&
              didSearch &&
              onlineHasMore &&
              onlineEndReachedArmedRef.current
            ) {
              onlineEndReachedArmedRef.current = false;
              void runOnlineSearch(onlinePage + 1);
            }
          }}
          onEndReachedThreshold={0.45}
          contentContainerStyle={{flexGrow: 1, paddingBottom: 24}}
          ListEmptyComponent={
            <View
              accessibilityLiveRegion="polite"
              style={{
                alignItems: 'center',
                paddingVertical: t.spacing.xxl,
                paddingHorizontal: t.spacing.md,
              }}>
              {isLoadingResults ? (
                <ActivityIndicator color={t.colors.primary} />
              ) : (
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 20,
                    backgroundColor: t.colors.surfaceHigh,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Icon
                    accessible={false}
                    name={error ? 'wifi-off' : 'magnify'}
                    size={30}
                    color={t.colors.textSub}
                  />
                </View>
              )}
              <Text
                style={{
                  fontSize: t.fontSize.lg,
                  fontWeight: '600',
                  lineHeight: 25,
                  color: t.colors.text,
                  textAlign: 'center',
                  marginTop: t.spacing.lg,
                }}>
                {isLoadingResults
                  ? mode === 'bilibili'
                    ? '正在搜索 B 站内容…'
                    : '正在读取收藏…'
                  : error
                  ? '暂时无法显示结果'
                  : mode === 'bilibili'
                  ? didSearch
                    ? '没有找到匹配的视频'
                    : '想听什么，搜一下'
                  : query.trim()
                  ? '没有找到匹配的收藏'
                  : '在收藏中找回喜欢'}
              </Text>
              {!isLoadingResults && (
                <Text
                  style={{
                    fontSize: t.fontSize.sm,
                    lineHeight: 22,
                    color: t.colors.textSub,
                    textAlign: 'center',
                    marginTop: t.spacing.sm,
                  }}>
                  {error
                    ? '请根据上方提示检查后重试。'
                    : mode === 'bilibili'
                    ? didSearch
                      ? '试试其他关键词，或放宽标签与时长条件。'
                      : '输入关键词或兴趣标签，发现 B 站音乐视频。'
                    : query.trim()
                    ? '试试其他关键词，或切换标题与作者搜索。'
                    : '支持搜索本机已同步的收藏视频。'}
                </Text>
              )}
              {error && !isLoadingResults && (
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.7}
                  onPress={() =>
                    mode === 'bilibili'
                      ? runOnlineSearch(1)
                      : loadFavorites(true)
                  }
                  style={{
                    minHeight: 48,
                    paddingHorizontal: t.spacing.lg,
                    marginTop: t.spacing.md,
                    justifyContent: 'center',
                    borderRadius: 14,
                    backgroundColor: t.colors.primaryLight,
                  }}>
                  <Text
                    style={{
                      fontSize: t.fontSize.base,
                      fontWeight: '600',
                      color: t.colors.primary,
                    }}>
                    重试
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          }
          ListFooterComponent={
            results.length > 0 ? (
              <View
                style={{paddingVertical: t.spacing.lg, alignItems: 'center'}}>
                {isLoadingResults ? (
                  <ActivityIndicator color={t.colors.primary} />
                ) : (
                  <Text
                    style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
                    {mode === 'bilibili' && onlineHasMore
                      ? '继续下滑，发现更多结果'
                      : '已显示全部结果'}
                  </Text>
                )}
              </View>
            ) : null
          }
        />
      </View>

      <Modal
        visible={sortVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSortVisible(false)}>
        <View
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: t.colors.overlay,
          }}>
          <TouchableWithoutFeedback
            accessible={false}
            onPress={() => setSortVisible(false)}>
            <View
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
              }}
            />
          </TouchableWithoutFeedback>
          <View
            accessibilityViewIsModal
            style={{
              width: '100%',
              maxWidth: 640,
              maxHeight: '85%',
              alignSelf: 'center',
              padding: t.spacing.xl,
              paddingBottom:
                Math.max(insets.bottom, t.spacing.md) + t.spacing.md,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              backgroundColor: t.colors.surfaceRaised,
            }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: t.spacing.md,
              }}>
              <Text
                accessibilityRole="header"
                style={{
                  flex: 1,
                  fontSize: t.fontSize.xl,
                  fontWeight: '700',
                  color: t.colors.text,
                }}>
                结果排序
              </Text>
              <IconButton
                name="close"
                accessibilityLabel="关闭排序"
                onPress={() => setSortVisible(false)}
              />
            </View>
            <ScrollView
              style={{flexShrink: 1}}
              showsVerticalScrollIndicator={false}>
              {SORT_OPTIONS.map(option => (
                <TouchableOpacity
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{selected: sort === option.key}}
                  activeOpacity={0.7}
                  onPress={() => {
                    setSort(option.key);
                    setSortVisible(false);
                  }}
                  style={{
                    minHeight: 56,
                    padding: t.spacing.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: t.spacing.sm,
                    borderRadius: 14,
                    backgroundColor:
                      sort === option.key
                        ? t.colors.primaryLight
                        : 'transparent',
                  }}>
                  <Text
                    style={{
                      flex: 1,
                      fontSize: t.fontSize.base,
                      fontWeight: sort === option.key ? '600' : '400',
                      color:
                        sort === option.key ? t.colors.primary : t.colors.text,
                    }}>
                    {option.title}
                  </Text>
                  {sort === option.key && (
                    <Icon
                      accessible={false}
                      name="check"
                      size={22}
                      color={t.colors.primary}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <FavoriteFolderPickerSheet
        visible={favoritePickerVisible}
        video={selectedVideo}
        onSaved={folderIds => {
          if (!selectedVideo || !uid) {
            return;
          }
          const video = searchVideoToFavoriteVideo(selectedVideo);
          const savedVideo = {
            ...video,
            folderIds: [...new Set([...(video.folderIds ?? []), ...folderIds])],
          };
          setLocalFavoriteState(current => {
            const bvids =
              current.uid === uid ? new Set(current.bvids) : new Set<string>();
            bvids.add(selectedVideo.bvid);
            return {uid, bvids};
          });
          setFavoriteIndex(current => [
            savedVideo,
            ...current.filter(item => item.bvid !== savedVideo.bvid),
          ]);
          for (const folderId of folderIds) {
            useFolderDataStore.getState().upsertVideoInCurrentFolder(folderId, {
              ...savedVideo,
              folderIds: [folderId],
            });
          }
        }}
        onClose={() => {
          setFavoritePickerVisible(false);
          setSelectedVideo(null);
        }}
      />
    </View>
  );
};
