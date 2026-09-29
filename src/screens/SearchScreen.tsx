import React, {useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react';
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
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';
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
import type {FavoriteVideo, OnlineVideoSearchResult, OnlineVideoSearchSort} from '../types/domain';

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
  const uid = useAuthStore(state => state.userId);
  const setQueue = usePlayerStore(state => state.setQueue);
  const [mode, setMode] = useState<SearchMode>('bilibili');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [tagFilter, setTagFilter] = useState('');
  const [onlineResults, setOnlineResults] = useState<OnlineVideoSearchResult[]>([]);
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
  const [selectedVideo, setSelectedVideo] = useState<OnlineVideoSearchResult | null>(null);
  const requestId = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const onlineLoadingRef = useRef(false);
  const onlineEndReachedArmedRef = useRef(false);
  const favoriteRequestId = useRef(0);
  const favoriteRequestController = useRef<AbortController | null>(null);
  const recommendationDurationFilterEnabled = useSettingsStore(state => state.recommendationDurationFilterEnabled);
  const recommendationDurationLimitMinutes = useSettingsStore(state => state.recommendationDurationLimitMinutes);
  const setRecommendationDurationFilterEnabled = useSettingsStore(state => state.setRecommendationDurationFilterEnabled);
  const previousDurationFilter = useRef({
    enabled: recommendationDurationFilterEnabled,
    minutes: recommendationDurationLimitMinutes,
  });

  const loadFavorites = useCallback(async (forceCatalog = false) => {
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
      const sources = await importedPlaylistService.getCollectedPlaylists(uid, forceCatalog, controller.signal);
      if (controller.signal.aborted || currentRequestId !== favoriteRequestId.current || useAuthStore.getState().userId !== uid) return;
      useImportedPlaylistStore.getState().setCatalog(uid, sources);
      await loadGlobalIndexCache();
      if (controller.signal.aborted || currentRequestId !== favoriteRequestId.current || useAuthStore.getState().userId !== uid) return;
      if (storage.getString('lastUid') !== uid) {
        setFavoriteIndex([]);
        setError('收藏索引正在随账号切换，请稍后重试');
        return;
      }
      const allSourceKeys = sources.map(source => source.sourceKey);
      setFavoriteSourceKeys(allSourceKeys);
      const refreshedIndex = favoriteService.getGlobalIndex([], allSourceKeys);
      setFavoriteIndex(refreshedIndex);

      const keyword = deferredQuery.trim();
      const refreshKey = getFavoriteSearchRefreshKey(uid, keyword);
      const matchingVideos = keyword
        ? refreshedIndex.filter(video =>
            video.title.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()) ||
            (video.upper?.name ?? '').toLocaleLowerCase().includes(keyword.toLocaleLowerCase()),
          )
        : [];
      usePlayerStore.getState().replaceQueueFromSearchRefresh(
        refreshKey,
        matchingVideos,
      );
    } catch (loadError) {
      if (!controller.signal.aborted && currentRequestId === favoriteRequestId.current) {
        setError(loadError instanceof Error ? loadError.message : '读取本地收藏失败');
      }
    } finally {
      if (currentRequestId === favoriteRequestId.current) {
        favoriteRequestController.current = null;
        setFavoriteLoading(false);
      }
    }
  }, [deferredQuery, uid]);

  useFocusEffect(
    useCallback(() => {
      if (mode === 'favorites') void loadFavorites();
      return () => {
        if (mode === 'favorites') {
          favoriteRequestId.current += 1;
          favoriteRequestController.current?.abort();
          favoriteRequestController.current = null;
        }
      };
    }, [loadFavorites, mode]),
  );

  useEffect(() => () => {
    requestId.current += 1;
    requestController.current?.abort();
    favoriteRequestId.current += 1;
    favoriteRequestController.current?.abort();
  }, []);

  const runOnlineSearch = useCallback(async (page = 1) => {
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
    if (page > 1 && onlineLoadingRef.current) return;
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
      if (currentRequestId !== requestId.current || controller.signal.aborted) return;
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
        const combined = page === 1 ? response.results : [...current, ...response.results];
        return Array.from(new Map(combined.map(item => [item.bvid, item])).values());
      });
      setOnlinePage(page);
      setOnlineHasMore(response.hasMore);
      setDidSearch(true);
    } catch (searchError) {
      if (currentRequestId === requestId.current && !controller.signal.aborted) {
        setError(searchError instanceof Error ? searchError.message : 'B 站搜索失败');
      }
    } finally {
      if (currentRequestId === requestId.current) {
        onlineLoadingRef.current = false;
        setOnlineLoading(false);
      }
    }
  }, [query, recommendationDurationFilterEnabled, recommendationDurationLimitMinutes, sort, tagFilter, uid]);

  const refreshOnlineResults = useCallback(async () => {
    const keyword = query.trim() || tagFilter.trim();
    if (!keyword || !uid || onlineLoadingRef.current) return;

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
        const response = await fetchOnlineVideoSearchPage(criteria, page, controller.signal);
        response.results.forEach(video => refreshedResults.set(video.bvid, video));
        hasMore = response.hasMore;
        if (!hasMore) break;
        page += 1;
      }
      if (controller.signal.aborted || currentRequestId !== requestId.current) return;

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
      if (currentRequestId === requestId.current && !controller.signal.aborted) {
        setError(refreshError instanceof Error ? refreshError.message : '刷新 B 站搜索结果失败');
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

  useEffect(() => subscribeOnlineSearchRefresh(snapshot => {
    if (mode !== 'bilibili') return;
    const keyword = query.trim() || tagFilter.trim();
    const refreshKey = getOnlineSearchRefreshKey({
      keyword,
      tagFilter: tagFilter.trim(),
      sort,
      durationLimitSeconds: recommendationDurationFilterEnabled
        ? recommendationDurationLimitMinutes * 60
        : null,
    });
    if (snapshot.refreshKey !== refreshKey) return;
    if (usePlayerStore.getState().playContext?.refreshKey !== refreshKey) return;

    setOnlineResults(snapshot.results);
    setOnlinePage(snapshot.page);
    setOnlineHasMore(snapshot.hasMore);
    setDidSearch(true);
    setError(null);
  }), [
    mode,
    query,
    recommendationDurationFilterEnabled,
    recommendationDurationLimitMinutes,
    sort,
    tagFilter,
  ]);

  useEffect(() => {
    if (mode !== 'favorites' || !uid) return;
    return subscribeGlobalIndexRevision(() => {
      setFavoriteIndex(favoriteService.getGlobalIndex([], favoriteSourceKeys));
    });
  }, [favoriteSourceKeys, mode, uid]);

  useEffect(() => {
    const changed =
      previousDurationFilter.current.enabled !== recommendationDurationFilterEnabled ||
      previousDurationFilter.current.minutes !== recommendationDurationLimitMinutes;
    previousDurationFilter.current = {
      enabled: recommendationDurationFilterEnabled,
      minutes: recommendationDurationLimitMinutes,
    };
    if (!changed) return;
    if (mode === 'bilibili' && (didSearch || onlineLoading) && (query.trim() || tagFilter.trim())) {
      void runOnlineSearch(1);
    }
  }, [didSearch, mode, onlineLoading, query, recommendationDurationFilterEnabled, recommendationDurationLimitMinutes, runOnlineSearch, tagFilter]);

  const sortedOnlineResults = useMemo(
    () => sortOnlineVideoSearchResults(onlineResults, sort),
    [onlineResults, sort],
  );
  const favoriteBvids = useMemo(
    () => new Set(favoriteIndex.filter(video => video.folderIds?.length).map(video => video.bvid)),
    [favoriteIndex],
  );

  const favoriteSearchIndex = useMemo(
    () => favoriteIndex.map(video => ({
      video,
      normalizedTitle: video.title.toLocaleLowerCase(),
      normalizedAuthor: (video.upper?.name ?? '').toLocaleLowerCase(),
    })),
    [favoriteIndex],
  );

  const filteredFavorites = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return favoriteSearchIndex
      .filter(item => item.normalizedTitle.includes(normalized) || item.normalizedAuthor.includes(normalized))
      .map(item => item.video);
  }, [deferredQuery, favoriteSearchIndex]);

  const playVideo = useCallback((video: FavoriteVideo) => {
    try {
      const queue = mode === 'bilibili'
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
      const playContext = mode === 'bilibili'
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
              ? getFavoriteSearchRefreshKey(uid, deferredQuery)
              : undefined,
            favoriteSearch: uid
              ? {uid, keyword: deferredQuery.trim()}
              : undefined,
          };
      if (mode === 'bilibili') usePlayerStore.getState().setPlayMode('sequential');
      setQueue(queue, video.bvid, playContext);
      usePlayerStore.getState().setResolving(true);
      useProgressStore.getState().resetProgress();
      const selectedIndex = queue.findIndex(item => item.bvid === video.bvid);
      prefetchAudioUrl(video.bvid, video.parts?.[0]?.cid).catch(() => {});
      const previousVideo = selectedIndex > 0 ? queue[selectedIndex - 1] : undefined;
      if (previousVideo) {
        prefetchAudioUrl(previousVideo.bvid, previousVideo.parts?.[0]?.cid).catch(() => {});
      }
      navigation.navigate('Player');
      void (async () => {
        try {
          const revision = await loadQueue(queue, video.bvid);
          if (!revision) {
            throw new Error(usePlayerStore.getState().playbackError || '视频暂时无法播放');
          }
          resolveCurrentTrack(revision).catch(() => {});
        } catch (playError) {
          usePlayerStore.getState().setResolving(false);
          Alert.alert('播放失败', playError instanceof Error ? playError.message : '视频暂时无法播放');
        }
      })();
    } catch (playError) {
      usePlayerStore.getState().setResolving(false);
      Alert.alert('播放失败', playError instanceof Error ? playError.message : '视频暂时无法播放');
    }
  }, [deferredQuery, filteredFavorites, mode, navigation, onlineHasMore, onlinePage, query, recommendationDurationFilterEnabled, recommendationDurationLimitMinutes, setQueue, sort, sortedOnlineResults, tagFilter, uid]);

  const glassBackground = t.glass?.colors.glass.bg ?? t.colors.surface;
  const glassBorder = t.glass?.colors.glass.border ?? t.colors.divider;
  const results: Array<OnlineVideoSearchResult | FavoriteVideo> = mode === 'bilibili'
    ? sortedOnlineResults
    : filteredFavorites;
  const isLoadingResults = onlineLoading ||
    (mode === 'favorites' && (favoriteLoading || query !== deferredQuery));

  const resultItem = (item: OnlineVideoSearchResult | FavoriteVideo) => {
    const isOnline = mode === 'bilibili';
    return (
      <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.sm, padding: t.spacing.sm, borderRadius: 18, backgroundColor: glassBackground, borderWidth: 1, borderColor: glassBorder}}>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.75}
          onPress={() => void playVideo(isOnline ? searchVideoToFavoriteVideo(item as OnlineVideoSearchResult) : item as FavoriteVideo)}>
          <FastImage
            source={{uri: item.cover}}
            style={{width: 112, height: 76, borderRadius: 13, backgroundColor: t.colors.surfaceHigh}}
            resizeMode={FastImage.resizeMode.cover}
          />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.75}
          onPress={() => void playVideo(isOnline ? searchVideoToFavoriteVideo(item as OnlineVideoSearchResult) : item as FavoriteVideo)}
          style={{flex: 1, marginHorizontal: t.spacing.sm}}>
          <Text style={{fontSize: t.fontSize.sm, fontWeight: '700', color: t.colors.text, lineHeight: 20}} numberOfLines={2}>{item.title}</Text>
          <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 4}} numberOfLines={1}>
            {isOnline ? (item as OnlineVideoSearchResult).author : (item as FavoriteVideo).upper?.name || '未知 UP 主'}
            {' · '}{formatDuration(item.duration)}
          </Text>
          {isOnline && (item as OnlineVideoSearchResult).tags.length > 0 && (
            <Text style={{fontSize: 10, color: t.colors.primary, marginTop: 3}} numberOfLines={1}>
              {(item as OnlineVideoSearchResult).tags.slice(0, 3).join(' · ')}
            </Text>
          )}
        </TouchableOpacity>
        <View style={{alignItems: 'center'}}>
          <IconButton
            name="play-circle-outline"
            size={25}
            color={t.colors.primary}
            onPress={() => void playVideo(isOnline ? searchVideoToFavoriteVideo(item as OnlineVideoSearchResult) : item as FavoriteVideo)}
          />
          {isOnline && (
            <IconButton
              name={
                (localFavoriteState.uid === uid && localFavoriteState.bvids.has(item.bvid)) ||
                favoriteBvids.has(item.bvid)
                  ? 'heart'
                  : 'heart-outline'
              }
              size={22}
              color={
                (localFavoriteState.uid === uid && localFavoriteState.bvids.has(item.bvid)) ||
                favoriteBvids.has(item.bvid)
                  ? t.colors.primary
                  : t.colors.textSub
              }
              onPress={() => {
                setSelectedVideo(item as OnlineVideoSearchResult);
                setFavoritePickerVisible(true);
              }}
            />
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{flex: 1, backgroundColor: t.glass ? 'transparent' : t.colors.background}}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <Header
        title={mode === 'bilibili' ? 'B 站全站搜索' : '收藏夹搜索'}
        showBack
        noBorder
        right={(
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => {
              const nextMode: SearchMode = mode === 'bilibili' ? 'favorites' : 'bilibili';
              requestController.current?.abort();
              requestId.current += 1;
              onlineLoadingRef.current = false;
              onlineEndReachedArmedRef.current = false;
              setOnlineLoading(false);
              setMode(nextMode);
              setError(null);
            }}
            style={{minWidth: 48, alignItems: 'center'}}>
            <Text style={{fontSize: 10, color: t.colors.primary, textAlign: 'center'}}>
              {mode === 'bilibili' ? '收藏夹搜索' : 'B站搜索'}
            </Text>
          </TouchableOpacity>
        )}
      />

      <View style={{flex: 1, paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm}}>
        <GlassView borderRadius={22} backgroundColor={glassBackground} borderColor={glassBorder} noShadow>
          <View style={{height: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.spacing.md}}>
            <Icon name="magnify" size={22} color={t.colors.textSub} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => mode === 'bilibili' && void runOnlineSearch(1)}
              returnKeyType="search"
              placeholder={mode === 'bilibili' ? '搜索视频、番剧、UP 主等全站内容' : '搜索本地已同步的收藏视频'}
              placeholderTextColor={t.colors.textHint}
              style={{flex: 1, marginHorizontal: t.spacing.sm, paddingVertical: 0, color: t.colors.text, fontSize: t.fontSize.base}}
            />
            {query.length > 0 && <IconButton name="close-circle" size={20} color={t.colors.textHint} onPress={() => setQuery('')} />}
            {mode === 'bilibili' && (
              <TouchableOpacity onPress={() => void runOnlineSearch(1)} disabled={onlineLoading} style={{paddingHorizontal: t.spacing.sm, borderLeftWidth: 1, borderLeftColor: glassBorder}}>
                <Text style={{fontSize: t.fontSize.sm, color: t.colors.primary, fontWeight: '700'}}>{onlineLoading ? '搜索中' : '搜索'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </GlassView>

        {mode === 'bilibili' ? (
          <>
            <View style={{flexDirection: 'row', alignItems: 'center', marginTop: t.spacing.md}}>
              <Icon name="tag-outline" size={18} color={t.colors.textSub} />
              <TextInput
                value={tagFilter}
                onChangeText={setTagFilter}
                placeholder="按 tag 筛选，例如：日语、治愈"
                placeholderTextColor={t.colors.textHint}
                onSubmitEditing={() => void runOnlineSearch(1)}
                style={{flex: 1, minHeight: 40, marginLeft: t.spacing.xs, paddingHorizontal: t.spacing.sm, borderRadius: 14, backgroundColor: glassBackground, color: t.colors.text, fontSize: t.fontSize.xs}}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="切换推荐搜索时长筛选"
                onPress={() => setRecommendationDurationFilterEnabled(!recommendationDurationFilterEnabled)}
                style={{flexDirection: 'row', alignItems: 'center', marginLeft: t.spacing.xs, paddingHorizontal: 9, paddingVertical: 9, borderRadius: 16, borderWidth: 1, borderColor: recommendationDurationFilterEnabled ? t.colors.primary : glassBorder}}>
                <Icon name="clock-outline" size={15} color={recommendationDurationFilterEnabled ? t.colors.primary : t.colors.textSub} />
                <Text style={{fontSize: 10, color: recommendationDurationFilterEnabled ? t.colors.primary : t.colors.textSub, marginLeft: 4}}>
                  {recommendationDurationFilterEnabled ? `≤${recommendationDurationLimitMinutes}分` : '不限时长'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: t.spacing.sm, marginBottom: t.spacing.sm}}>
              <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint}}>
                tag 与时长在 B 站结果中筛选 · {onlineResults.length} 个结果
              </Text>
              <TouchableOpacity onPress={() => setSortVisible(true)} style={{flexDirection: 'row', alignItems: 'center', padding: 5}}>
                <Icon name="sort" size={17} color={t.colors.textSub} />
                <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginLeft: 4}}>{SORT_OPTIONS.find(option => option.key === sort)?.title}</Text>
                <Icon name="chevron-down" size={16} color={t.colors.textSub} />
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, marginTop: t.spacing.md, marginBottom: t.spacing.sm}}>
            搜索范围：本机已同步的全部自有收藏夹及外部来源
          </Text>
        )}

        {error && <Text style={{fontSize: t.fontSize.xs, color: t.colors.error, marginBottom: t.spacing.sm}}>{error}</Text>}
        <FlatList
          style={{flex: 1}}
          data={results}
          refreshControl={(
            <RefreshControl
              refreshing={mode === 'bilibili' ? onlineLoading : favoriteLoading}
              onRefresh={() => {
                if (mode === 'bilibili') void refreshOnlineResults();
                else void loadFavorites(true);
              }}
              tintColor={t.colors.primary}
              colors={[t.colors.primary]}
            />
          )}
          keyExtractor={item => item.bvid}
          renderItem={({item}) => resultItem(item)}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          onScrollBeginDrag={() => {
            if (mode === 'bilibili') onlineEndReachedArmedRef.current = true;
          }}
          onEndReached={() => {
            if (mode === 'bilibili' && didSearch && onlineHasMore && onlineEndReachedArmedRef.current) {
              onlineEndReachedArmedRef.current = false;
              void runOnlineSearch(onlinePage + 1);
            }
          }}
          onEndReachedThreshold={0.45}
          contentContainerStyle={{flexGrow: 1, paddingBottom: Math.max(insets.bottom, t.spacing.xl)}}
          ListEmptyComponent={!isLoadingResults ? (
            <View style={{alignItems: 'center', paddingVertical: t.spacing.xxl}}>
              <Icon name="magnify" size={38} color={t.colors.textHint} />
              <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub, textAlign: 'center', marginTop: t.spacing.md}}>
                {mode === 'bilibili'
                  ? didSearch ? '没有符合当前 tag 与时长条件的视频' : '输入关键词或 tag，开始搜索 B 站全站内容'
                  : query.trim() ? '本地收藏中没有匹配内容' : '输入关键词搜索全收藏夹'}
              </Text>
            </View>
          ) : null}
          ListFooterComponent={(
            <View>
              {isLoadingResults && <ActivityIndicator color={t.colors.primary} style={{padding: t.spacing.lg}} />}
              {mode === 'bilibili' && didSearch && onlineHasMore && !onlineLoading && (
                <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, textAlign: 'center', paddingVertical: t.spacing.md}}>
                  下滑加载更多结果
                </Text>
              )}
            </View>
          )}
        />
      </View>

      <Modal visible={sortVisible} transparent animationType="fade" onRequestClose={() => setSortVisible(false)}>
        <View style={{flex: 1, justifyContent: 'center', padding: t.spacing.xl, backgroundColor: 'rgba(0,0,0,0.42)'}}>
          <TouchableWithoutFeedback onPress={() => setSortVisible(false)}>
            <View style={{position: 'absolute', top: 0, right: 0, bottom: 0, left: 0}} />
          </TouchableWithoutFeedback>
          <View style={{padding: t.spacing.md, borderRadius: 20, backgroundColor: t.isDark ? '#202126' : '#fff'}}>
            <Text style={{fontSize: t.fontSize.base, fontWeight: '700', color: t.colors.text, marginBottom: t.spacing.sm}}>搜索结果排序</Text>
            {SORT_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.key}
                onPress={() => {setSort(option.key); setSortVisible(false);}}
                style={{minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
                <Text style={{fontSize: t.fontSize.sm, color: t.colors.text}}>{option.title}</Text>
                {sort === option.key && <Icon name="check" size={20} color={t.colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      <FavoriteFolderPickerSheet
        visible={favoritePickerVisible}
        video={selectedVideo}
        onSaved={folderIds => {
          if (!selectedVideo || !uid) return;
          const video = searchVideoToFavoriteVideo(selectedVideo);
          const savedVideo = {
            ...video,
            folderIds: [...new Set([...(video.folderIds ?? []), ...folderIds])],
          };
          setLocalFavoriteState(current => {
            const bvids = current.uid === uid ? new Set(current.bvids) : new Set<string>();
            bvids.add(selectedVideo.bvid);
            return {uid, bvids};
          });
          setFavoriteIndex(current => [
            savedVideo,
            ...current.filter(item => item.bvid !== savedVideo.bvid),
          ]);
          for (const folderId of folderIds) {
            useFolderDataStore.getState().upsertVideoInCurrentFolder(
              folderId,
              {...savedVideo, folderIds: [folderId]},
            );
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
