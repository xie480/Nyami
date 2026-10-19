// src/components/PlaylistPanel.tsx (refactored)
import React, { useCallback, memo, useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity as RNTouchableOpacity, FlatList, ListRenderItemInfo, ActivityIndicator, Alert, Platform, ToastAndroid, RefreshControl, useWindowDimensions } from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme';
import { GlassView } from './GlassView';
import { usePlayerStore } from '../store/playerStore';
import type {PlayContext} from '../store/playerStore';
import { IconButton } from './IconButton';
import type { FavoriteVideo, OnlineVideoSearchResult } from '../types/domain';
import { formatDuration } from '../utils/format';
import { playSpecificPart, loadQueue, playQueuedTrack } from '../services/trackPlayer';
import {
  fetchOnlineVideoSearchPage,
  getOnlineSearchRefreshKey,
  publishOnlineSearchRefresh,
} from '../services/onlineVideoSearchService';
import {searchVideoToFavoriteVideo} from '../services/transformers';
import {favoriteService, loadGlobalIndexCache} from '../services/favoriteService';
import {importedPlaylistService} from '../services/importedPlaylistService';
import { useFolderDataStore } from '../store/folderDataStore';
import { useSyncStore } from '../store/syncStore';
import { useAuthStore } from '../store/authStore';
import {storage} from '../core/storage';
import { loadMorePersonalizedSongs } from '../services/homeRecommendationService';
import {getFavoriteSearchRefreshKey} from '../utils/playbackRefreshKey';
import {filterFavoriteVideos} from '../utils/favoriteSearch';
import {useReducedMotion} from '../hooks/useReducedMotion';

const QUEUE_LOAD_AHEAD_TRACKS = 5;
const EMPTY_PLAYLIST_QUEUE: FavoriteVideo[] = [];
const QUEUE_ITEM_HEIGHT = 72;
const QUEUE_ITEM_SPACING = 8;
const QUEUE_PART_ROW_HEIGHT = 48;
const QUEUE_PARTS_SPACING = 4;
const QUEUE_TITLE_LINE_HEIGHT = 18;
const QUEUE_SUBTITLE_LINE_HEIGHT = 14;
const QUEUE_PART_LINE_HEIGHT = 18;

function getPlaybackSourceIdentity(context: PlayContext | null): string | PlayContext | null {
  if (context?.refreshKey) {
    return `refresh:${context.refreshKey}`;
  }
  if (context?.sourceKey) {
    return `source:${context.sourceKey}`;
  }
  if (context?.folderId != null) {
    return `folder:${context.folderId}`;
  }
  if (context?.isPersonalized) {
    return 'personalized';
  }
  // Anonymous queues have no stable source key, so only the same context is safe.
  return context;
}

function getQueueItemExtraHeight(video: FavoriteVideo | undefined, expandedBvid: string | null, partHeight: number): number {
  if (!video || video.bvid !== expandedBvid || !video.parts || video.parts.length <= 1) return 0;
  return video.parts.length * partHeight + QUEUE_PARTS_SPACING;
}

interface PlaylistItemProps {
  item: FavoriteVideo;
  onPlay: (bvid: string) => void;
  isExpanded: boolean;
  onPartPress: (bvid: string, cid: number, partTitle: string) => void;
  onExpandToggle: (bvid: string) => void;
  onRemove: (bvid: string) => void;
  isCurrent: boolean;
  primaryColor: string;
  itemHeight: number;
  partHeight: number;
}

const PlaylistItem = memo(function PlaylistItem({
  item,
  onPlay,
  isExpanded,
  onPartPress,
  onExpandToggle,
  onRemove,
  isCurrent,
  primaryColor,
  itemHeight,
  partHeight,
}: PlaylistItemProps) {
  const t = useTheme();
  return (
    <View>
      <View style={[styles.item, {height: itemHeight, backgroundColor: isCurrent ? t.colors.primaryLight : t.colors.surface}]}>
        <RNTouchableOpacity accessibilityRole="button" accessibilityLabel={`播放 ${item.title}，${item.upper?.name || '未知 UP 主'}`} accessibilityState={{selected: isCurrent}} style={[styles.infoTouchable, {minHeight: itemHeight}]} onPress={() => onPlay(item.bvid)} activeOpacity={0.6}>
          <View style={styles.info}>
            <Text
              style={[{ color: t.colors.text }, styles.title, isCurrent && { color: primaryColor, fontWeight: '700' }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {item.title}
            </Text>
            <Text style={[styles.sub, { color: t.colors.textSub }]} numberOfLines={1} ellipsizeMode="tail">
              {item.upper?.name || '未知 UP 主'}
            </Text>
          </View>
        </RNTouchableOpacity>
        <View style={styles.actions}>
          {item.parts && item.parts.length > 1 && (
            <RNTouchableOpacity accessibilityRole="button" accessibilityLabel={isExpanded ? '收起分 P' : '展开分 P'} accessibilityState={{expanded: isExpanded}} onPress={() => onExpandToggle(item.bvid)} style={styles.expandButton}>
              <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={t.colors.textHint} />
            </RNTouchableOpacity>
          )}
          <IconButton name="delete" size={20} accessibilityLabel={`从队列移除 ${item.title}`} color={t.colors.textSub} onPress={() => onRemove(item.bvid)} />
        </View>
      </View>
      {isExpanded && item.parts && item.parts.length > 1 && (
        <View style={[styles.partsContainer, { borderLeftColor: t.colors.divider }]}>
          {item.parts.map(part => (
            <RNTouchableOpacity
              key={part.cid}
              accessibilityRole="button"
              accessibilityLabel={`播放分 P ${part.title}`}
              style={[styles.partItem, {height: partHeight}]}
              onPress={() => onPartPress(item.bvid, part.cid, part.title)}
              activeOpacity={0.7}
            >
              <Text style={[styles.partTitle, { color: t.colors.textSub }]} numberOfLines={1}>
                {part.title}
              </Text>
              <Text style={[styles.partDuration, { color: t.colors.textHint }]}>{formatDuration(part.duration)}</Text>
            </RNTouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
});

/**
 * 全局播放列表面板，支持当前播放高亮、自动定位。
 * 通过 Zustand playerStore 与原生 TrackPlayer 同步。
 */
export const PlaylistPanel = ({ visible, onClose }: { visible: boolean; onClose: () => void }) => {
  const t = useTheme();
  const reducedMotion = useReducedMotion();
  const {height: windowHeight, fontScale = 1} = useWindowDimensions();
  // 两行主信息和单行分 P 使用明确的 lineHeight；额外空间容纳行间距与上下留白。
  // 渲染和虚拟列表定位必须共享高度，否则系统字体变大后会跳到错误的歌曲。
  const itemHeight = Math.max(QUEUE_ITEM_HEIGHT, Math.ceil((QUEUE_TITLE_LINE_HEIGHT + QUEUE_SUBTITLE_LINE_HEIGHT) * fontScale + 24));
  const partHeight = Math.max(QUEUE_PART_ROW_HEIGHT, Math.ceil(QUEUE_PART_LINE_HEIGHT * fontScale + 16));
  const insets = useSafeAreaInsets();
  const panelBounds = {
    maxHeight: Math.max(0, windowHeight - insets.top) * 0.8,
    paddingBottom: Math.max(insets.bottom, 20),
  };
  // 面板关闭时返回稳定的空值，避免全局队列变化让隐藏的 FlatList 反复重渲染。
  const queue = usePlayerStore((s) => visible ? s.queue : EMPTY_PLAYLIST_QUEUE);
  const currentBvid = usePlayerStore((s) => visible ? s.currentBvid : null);
  const playContext = usePlayerStore((s) => visible ? s.playContext : null);
  const appendQueue = usePlayerStore((s) => s.appendQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const queueLoading = usePlayerStore((s) => visible && s.queueLoading);
  const playMode = usePlayerStore((s) => visible ? s.playMode : 'sequential');
  const togglePlayMode = usePlayerStore((s) => s.togglePlayMode);
  const syncStatus = useSyncStore((s) => s.syncStatus);
  const [expandedBvid, setExpandedBvid] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const listRef = useRef<any>(null);
  const loadingMoreRef = useRef(false);
  const refreshingRef = useRef(false);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const listEndReachedArmedRef = useRef(false);
  const lastAutoLoadPageRef = useRef<string | null>(null);
  const trackSelectionRevisionRef = useRef(0);
  // 用于精确判断自动滚动触发时机，拦截分页加载时的无意识滚动
  const prevVisibleRef = useRef(visible);
  const prevBvidRef = useRef(currentBvid);
  const prevPlayModeRef = useRef(playMode);

  const initialIndex = React.useMemo(() => {
    if (currentBvid && queue.length > 0) {
      const idx = queue.findIndex((v) => v.bvid === currentBvid);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  }, [currentBvid, queue]);

  // 点击歌曲条目：立即跳转播放
  const handlePress = useCallback(async (bvid: string) => {
    const selectionRevision = ++trackSelectionRevisionRef.current;
    const selectionSource = getPlaybackSourceIdentity(usePlayerStore.getState().playContext);
    const selectionUid = useAuthStore.getState().userId;
    const isSelectionCurrent = () =>
      selectionRevision === trackSelectionRevisionRef.current &&
      useAuthStore.getState().userId === selectionUid &&
      getPlaybackSourceIdentity(usePlayerStore.getState().playContext) === selectionSource;
    // 不等待解析或音量淡出完成，先让播放列表开始收起。
    onClose();
    try {
      let played = false;
      try {
        played = await playQueuedTrack(bvid);
      } catch {
        played = false;
      }
      if (!isSelectionCurrent()) {
        return;
      }
      if (!played) {
        const q = usePlayerStore.getState().queue;
        if (!q.some(video => video.bvid === bvid)) return;
        const loaded = await loadQueue(q, bvid);
        if (!isSelectionCurrent()) {
          return;
        }
        if (loaded === 0) throw new Error('歌曲暂时无法切换，请稍后重试');
      }
      if (!isSelectionCurrent()) {
        return;
      }
      usePlayerStore.getState().setCurrentBvid(bvid);
    } catch (error) {
      if (!isSelectionCurrent()) {
        return;
      }
      const message = error instanceof Error ? error.message : '切换歌曲失败';
      if (Platform.OS === 'android') {
        ToastAndroid.show(message, ToastAndroid.SHORT);
      } else {
        Alert.alert('切换失败', message);
      }
    }
  }, [onClose]);

  const handlePlayBvid = useCallback((bvid: string) => {
    void handlePress(bvid);
  }, [handlePress]);
  const handleRemove = useCallback((bvid: string) => {
    void removeFromQueue(bvid);
  }, [removeFromQueue]);
  const handleExpandToggle = useCallback((bvid: string) => {
    setExpandedBvid(previous => previous === bvid ? null : bvid);
  }, []);

  const handlePartPress = useCallback(async (bvid: string, cid: number, partTitle: string) => {
    try {
      await playSpecificPart(bvid, cid, partTitle);
      onClose();
    } catch {}
  }, [onClose]);

  useEffect(() => {
    if (visible) setHasOpened(true);
  }, [visible]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FavoriteVideo>) => (
      <PlaylistItem
        item={item}
        onPlay={handlePlayBvid}
        isExpanded={expandedBvid === item.bvid}
        onPartPress={handlePartPress}
        onExpandToggle={handleExpandToggle}
        onRemove={handleRemove}
        isCurrent={item.bvid === currentBvid}
        primaryColor={t.colors.primary}
        itemHeight={itemHeight}
        partHeight={partHeight}
      />
    ),
    [t.colors.primary, expandedBvid, handlePlayBvid, handlePartPress, handleExpandToggle, handleRemove, currentBvid, itemHeight, partHeight]
  );

  // 精确控制的自动滚动逻辑：
  // - 仅在面板刚打开、当前播放歌曲切换、或播放模式切换（队列重排）时触发
  // - 严格拦截因分页加载（queue 末尾追加）导致的滚动跳转，保持用户浏览视野不变
  useEffect(() => {
    const prevVisible = prevVisibleRef.current;
    const prevBvid = prevBvidRef.current;
    const prevPlayMode = prevPlayModeRef.current;

    // 更新 ref 为当前值
    prevVisibleRef.current = visible;
    prevBvidRef.current = currentBvid;
    prevPlayModeRef.current = playMode;

    // 判断是否是合法的自动定位触发场景
    const shouldScroll =
      (!prevVisible && visible)   // 1) 面板从关闭变为打开
      || (prevBvid !== currentBvid) // 2) 播放歌曲切换
      || (prevPlayMode !== playMode); // 3) 播放模式切换（队列重排）

    if (shouldScroll && visible && currentBvid && queue.length > 0) {
      const idx = queue.findIndex(v => v.bvid === currentBvid);
      if (idx >= 0) {
        const timer = setTimeout(() => {
          listRef.current?.scrollToIndex({
            index: idx,
            animated: false,
            viewPosition: 0.5,
          });
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [queue, currentBvid, visible, playMode]);

  const handleScrollToIndexFailed = useCallback((info: any) => {
    setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: info.index,
        animated: false,
        viewPosition: 0.5,
      });
    }, 0);
  }, []);

  const getItemLayout = useCallback((data: ArrayLike<FavoriteVideo> | null | undefined, index: number) => {
    const items = data ?? queue;
    let offset = index * (itemHeight + QUEUE_ITEM_SPACING);
    for (let itemIndex = 0; itemIndex < index; itemIndex += 1) {
      offset += getQueueItemExtraHeight(items[itemIndex], expandedBvid, partHeight);
    }
    const item = items[index];
    return {
      length: itemHeight + QUEUE_ITEM_SPACING + getQueueItemExtraHeight(item, expandedBvid, partHeight),
      offset,
      index,
    };
  }, [expandedBvid, queue, itemHeight, partHeight]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMoreRef.current || !playContext) return;
    const playerState = usePlayerStore.getState();
    if (playerState.playMode !== 'sequential' || playerState.queueLoading) return;

    if (playContext.isPersonalized) {
      if (playContext.recommendationHasMore === false) return;
      const uid = useAuthStore.getState().userId;
      if (!uid) return;

      const nextPage = (playContext.recommendationPage ?? 1) + 1;
      let activeContext = playContext;
      loadingMoreRef.current = true;
      setLoadingMore(true);
      playerState.setQueueLoading(true);
      try {
        const result = await loadMorePersonalizedSongs(
          uid,
          nextPage,
          playerState.queue.map(video => video.bvid),
          new AbortController().signal,
        );
        const latestPlayer = usePlayerStore.getState();
        if (
          latestPlayer.playContext !== playContext ||
          useAuthStore.getState().userId !== uid
        ) {
          return;
        }
        const existingBvids = new Set(latestPlayer.queue.map(video => video.bvid));
        const newItems = result.recommendations
          .filter(video => !existingBvids.has(video.bvid))
          .map(searchVideoToFavoriteVideo);
        if (newItems.length > 0) await latestPlayer.appendQueue(newItems);

        const currentContext = usePlayerStore.getState().playContext;
        if (currentContext === playContext) {
          activeContext = {
            ...currentContext,
            recommendationPage: nextPage,
            recommendationHasMore: result.hasMore,
          };
          usePlayerStore.getState().setPlayContext(activeContext);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '加载推荐歌曲失败';
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.SHORT);
        } else {
          Alert.alert('加载失败', message);
        }
      } finally {
        loadingMoreRef.current = false;
        setLoadingMore(false);
        if (usePlayerStore.getState().playContext === activeContext) {
          usePlayerStore.getState().setQueueLoading(false);
        }
      }
      return;
    }

    if (playContext.onlineSearch) {
      const searchContext = playContext.onlineSearch;
      if (!searchContext.hasMore) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
      try {
        const nextPage = searchContext.page + 1;
        const response = await fetchOnlineVideoSearchPage(searchContext, nextPage);
        const latestPlayer = usePlayerStore.getState();
        if (latestPlayer.playContext?.onlineSearch !== searchContext) return;
        const existingBvids = new Set(latestPlayer.queue.map(video => video.bvid));
        const newItems = response.results
          .filter(video => !existingBvids.has(video.bvid))
          .map(searchVideoToFavoriteVideo);
        if (newItems.length > 0) await latestPlayer.appendQueue(newItems);

        const currentContext = usePlayerStore.getState().playContext;
        if (currentContext?.onlineSearch === searchContext) {
          usePlayerStore.getState().setPlayContext({
            ...currentContext,
            onlineSearch: {
              ...searchContext,
              page: nextPage,
              hasMore: response.hasMore,
            },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '加载 B 站搜索结果失败';
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.SHORT);
        } else {
          Alert.alert('加载失败', message);
        }
      } finally {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
      return;
    }

    if (!playContext.folderId && !playContext.sourceKey) return;

    const folderStore = useFolderDataStore.getState();
    // 仅当当前播放来源与全局 Store 中的列表来源一致时才继续分页。
    const matchesSource = playContext.sourceKey
      ? folderStore.sourceKey === playContext.sourceKey
      : folderStore.folderId === playContext.folderId;
    if (!matchesSource) return;
    if (!folderStore.hasMore || folderStore.loading) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const beforeBvids = new Set(folderStore.getDisplayedList().map(video => video.bvid));
      await folderStore.loadMore();
      const latestFolderStore = useFolderDataStore.getState();
      const latestPlayContext = usePlayerStore.getState().playContext;
      const stillMatchesSource = playContext.sourceKey
        ? latestFolderStore.sourceKey === playContext.sourceKey && latestPlayContext?.sourceKey === playContext.sourceKey
        : latestFolderStore.folderId === playContext.folderId && latestPlayContext?.folderId === playContext.folderId;
      if (!stillMatchesSource) return;
      const afterList = latestFolderStore.getDisplayedList();

      const newItems = afterList.filter(video => !beforeBvids.has(video.bvid));
      if (newItems.length > 0) {
        await appendQueue(newItems);
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [playContext, appendQueue]);

  const handleRefresh = useCallback(async () => {
    if (!visible || !playContext || refreshingRef.current || loadingMoreRef.current) return;
    if (syncStatus === 'syncing' && !playContext.onlineSearch) {
      const message = '全局索引同步中，请完成后再刷新本地列表';
      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
      else Alert.alert('暂不可刷新', message);
      return;
    }
    const refreshKey = playContext.refreshKey ?? playContext.sourceKey;
    if (!refreshKey) {
      const message = '当前播放列表没有可刷新的来源';
      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
      else Alert.alert('无法刷新', message);
      return;
    }

    refreshingRef.current = true;
    setRefreshing(true);
    const controller = new AbortController();
    refreshControllerRef.current = controller;

    try {
      if (playContext.onlineSearch) {
        const searchContext = playContext.onlineSearch;
        const criteria = {
          keyword: searchContext.keyword,
          tagFilter: searchContext.tagFilter,
          sort: searchContext.sort,
          durationLimitSeconds: searchContext.durationLimitSeconds,
        };
        const onlineRefreshKey = getOnlineSearchRefreshKey(criteria);
        const latestPlayer = usePlayerStore.getState();
        if (latestPlayer.playContext?.refreshKey !== onlineRefreshKey) return;

        const refreshedResults = new Map<string, OnlineVideoSearchResult>();
        let fetchedPage = 0;
        let hasMore = true;
        for (let page = 1; page <= Math.max(1, searchContext.page) && hasMore; page += 1) {
          const response = await fetchOnlineVideoSearchPage(criteria, page, controller.signal);
          response.results.forEach(video => refreshedResults.set(video.bvid, video));
          fetchedPage = page;
          hasMore = response.hasMore;
          if (controller.signal.aborted) return;
        }

        const results = Array.from(refreshedResults.values());
        const videos = results.map(searchVideoToFavoriteVideo);
        const currentPlayer = usePlayerStore.getState();
        if (currentPlayer.playContext?.refreshKey !== onlineRefreshKey) return;
        const replaced = currentPlayer.replaceQueueFromSearchRefresh(onlineRefreshKey, videos);
        if (!replaced) return;
        const updatedContext = usePlayerStore.getState().playContext;
        if (updatedContext?.refreshKey === onlineRefreshKey) {
          usePlayerStore.getState().setPlayContext({
            ...updatedContext,
            onlineSearch: {
              ...searchContext,
              page: fetchedPage,
              hasMore,
            },
          });
        }
        publishOnlineSearchRefresh({
          refreshKey: onlineRefreshKey,
          criteria,
          results,
          page: fetchedPage,
          hasMore,
        });
        return;
      }

      if (playContext.favoriteSearch) {
        const {uid, keyword, mode} = playContext.favoriteSearch;
        if (!uid || useAuthStore.getState().userId !== uid) {
          throw new Error('登录账号已变化，请重新进入收藏夹搜索');
        }
        const sources = await importedPlaylistService.getCollectedPlaylists(
          uid,
          true,
          controller.signal,
        );
        await loadGlobalIndexCache();
        if (controller.signal.aborted || useAuthStore.getState().userId !== uid) return;
        if (storage.getString('lastUid') !== uid) {
          throw new Error('收藏索引正在随账号切换，请稍后重试');
        }

        const refreshedIndex = favoriteService.getGlobalIndex(
          [],
          sources.map(source => source.sourceKey),
        );
        const results = filterFavoriteVideos(refreshedIndex, keyword, mode);
        usePlayerStore.getState().replaceQueueFromSearchRefresh(
          getFavoriteSearchRefreshKey(uid, keyword, mode),
          results,
        );
        return;
      }

      const sourceKey = playContext.sourceKey;
      if (!sourceKey) throw new Error('播放列表来源已失效');
      const folderStore = useFolderDataStore.getState();
      const matchesSource = folderStore.sourceKey === sourceKey && (
        playContext.folderId == null || folderStore.folderId === playContext.folderId
      );
      if (!matchesSource) {
        throw new Error('请返回歌曲列表后再刷新当前播放来源');
      }
      if (folderStore.loading || folderStore.isRefreshing) {
        throw new Error('歌曲列表正在加载或刷新，请稍后再试');
      }

      const previousBvids = new Set(
        folderStore.getDisplayedList().map(video => video.bvid),
      );
      if (playContext.folderId != null) {
        await folderStore.refreshFolder(playContext.folderId, controller.signal);
      } else {
        await folderStore.refreshImportedSource(controller.signal);
      }
      if (controller.signal.aborted) return;

      const refreshedStore = useFolderDataStore.getState();
      if (refreshedStore.sourceKey !== sourceKey) return;
      const sourceVideos = refreshedStore.getDisplayedList();
      const addedVideos = sourceVideos.filter(video => !previousBvids.has(video.bvid));
      usePlayerStore.getState().syncQueueFromSourceRefresh(
        sourceKey,
        sourceVideos,
        addedVideos,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : '刷新播放列表失败';
      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
      else Alert.alert('刷新失败', message);
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
        refreshingRef.current = false;
        setRefreshing(false);
      }
    }
  }, [playContext, syncStatus, visible]);

  useEffect(() => {
    if (!visible) {
      refreshControllerRef.current?.abort();
    }
    return () => refreshControllerRef.current?.abort();
  }, [visible]);

  useEffect(() => {
    if (!currentBvid || playMode !== 'sequential' || !playContext?.sourceKey) return;
    const currentIndex = queue.findIndex(video => video.bvid === currentBvid);
    if (currentIndex < 0 || queue.length - currentIndex > QUEUE_LOAD_AHEAD_TRACKS) return;

    const folderStore = useFolderDataStore.getState();
    if (
      folderStore.sourceKey !== playContext.sourceKey ||
      !folderStore.hasMore ||
      folderStore.loading
    ) {
      return;
    }
    const pageKey = `${playContext.sourceKey}:${folderStore.page}`;
    if (lastAutoLoadPageRef.current === pageKey) return;
    lastAutoLoadPageRef.current = pageKey;
    void handleLoadMore();
  }, [queue, currentBvid, playContext, playMode, handleLoadMore]);

  // 列表底部加载指示器：仅在分页请求进行中（loadingMore）时渲染
  const renderFooter = useCallback(() => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={t.colors.primary} />
        <Text style={[styles.footerText, { color: t.colors.textSub }]}>加载更多…</Text>
      </View>
    );
  }, [loadingMore, t.colors]);

  const isGlass = !!t.glass;

  const playlistContent = (
    <>
      <View style={[styles.header, { borderBottomColor: t.colors.divider }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { color: t.colors.text, marginRight: 8 }]}>播放列表</Text>
          {queueLoading && (
            <ActivityIndicator size="small" color={t.colors.primary} style={{ marginRight: 8 }} />
          )}
          <IconButton
            name={playMode === 'shuffle' ? 'shuffle' : 'repeat'}
            accessibilityLabel={playMode === 'shuffle' ? '随机播放，切换到顺序播放' : '顺序播放，切换到随机播放'}
            size={20}
            color={t.colors.text}
            onPress={togglePlayMode}
            disabled={syncStatus === 'syncing'}
          />
        </View>
        <IconButton name="close" size={24} color={t.colors.text} onPress={onClose} />
      </View>
      {hasOpened && (
        <FlatList
          ref={listRef}
          style={styles.queueViewport}
          data={queue}
          keyExtractor={(item) => item.bvid}
          renderItem={renderItem}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          onScrollBeginDrag={() => {
            listEndReachedArmedRef.current = true;
          }}
          contentContainerStyle={styles.list}
          initialScrollIndex={initialIndex}
          getItemLayout={getItemLayout}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          showsVerticalScrollIndicator={false}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={t.colors.primary}
              colors={[t.colors.primary]}
            />
          )}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={<Text style={{color: t.colors.textSub, textAlign: 'center', padding: 32}}>播放队列为空，选择一首喜欢的歌开始。</Text>}
          onEndReached={() => {
            if (!listEndReachedArmedRef.current) return;
            listEndReachedArmedRef.current = false;
            void handleLoadMore();
          }}
          onEndReachedThreshold={0.5}
        />
      )}
    </>
  );

  return (
    <Modal visible={visible} animationType={reducedMotion ? 'none' : 'slide'} transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        {isGlass ? (
          <GlassView style={StyleSheet.flatten([styles.container, panelBounds])} backgroundColor={t.colors.surfaceRaised} borderRadius={24} noShadow noBlur minimal constrainContent>
            {playlistContent}
          </GlassView>
        ) : (
          <View style={[styles.container, panelBounds, { backgroundColor: t.colors.surfaceRaised }]}>{playlistContent}</View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  container: {
    flexShrink: 1,
    minHeight: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  queueViewport: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 0,
    paddingHorizontal: 12,
    marginVertical: 4,
    borderRadius: 8,
    position: 'relative',
  },
  infoTouchable: {
    flex: 1,
    paddingRight: 104,
    justifyContent: 'center',
  },
  info: {
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    lineHeight: QUEUE_TITLE_LINE_HEIGHT,
    fontWeight: '500',
  },
  sub: {
    fontSize: 12,
    lineHeight: QUEUE_SUBTITLE_LINE_HEIGHT,
    color: '#666',
    marginTop: 2,
  },
  actions: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  expandButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partsContainer: {
    marginLeft: 20,
    borderLeftWidth: 1,
    borderLeftColor: '#ddd',
    paddingLeft: 8,
    marginBottom: 4,
  },
  partItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 0,
    paddingRight: 8,
  },
  partTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: QUEUE_PART_LINE_HEIGHT,
    color: '#555',
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  footerText: {
    marginLeft: 8,
    fontSize: 13,
  },
  partDuration: {
    fontSize: 12,
    lineHeight: QUEUE_PART_LINE_HEIGHT,
    color: '#999',
  },
});
