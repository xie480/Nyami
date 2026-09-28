// src/components/PlaylistPanel.tsx (refactored)
import React, { useCallback, memo, useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity as RNTouchableOpacity, FlatList, ListRenderItemInfo, ActivityIndicator, Alert, Platform, ToastAndroid } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme';
import { GlassView } from './GlassView';
import { usePlayerStore } from '../store/playerStore';
import { IconButton } from './IconButton';
import type { FavoriteVideo } from '../types/domain';
import { formatDuration } from '../utils/format';
import { playSpecificPart, loadQueue, playQueuedTrack } from '../services/trackPlayer';
import {fetchOnlineVideoSearchPage} from '../services/onlineVideoSearchService';
import {searchVideoToFavoriteVideo} from '../services/transformers';
import { useFolderDataStore } from '../store/folderDataStore';
import { useSyncStore } from '../store/syncStore';
import { useAuthStore } from '../store/authStore';
import { loadMorePersonalizedSongs } from '../services/homeRecommendationService';

const QUEUE_LOAD_AHEAD_TRACKS = 5;
const EMPTY_PLAYLIST_QUEUE: FavoriteVideo[] = [];
const QUEUE_ITEM_HEIGHT = 56;
const QUEUE_ITEM_SPACING = 8;
const QUEUE_PART_ROW_HEIGHT = 28;
const QUEUE_PARTS_SPACING = 4;

function getQueueItemExtraHeight(video: FavoriteVideo | undefined, expandedBvid: string | null): number {
  if (!video || video.bvid !== expandedBvid || !video.parts || video.parts.length <= 1) return 0;
  return video.parts.length * QUEUE_PART_ROW_HEIGHT + QUEUE_PARTS_SPACING;
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
}: PlaylistItemProps) {
  const t = useTheme();
  return (
    <View>
      <View style={[styles.item, { backgroundColor: isCurrent ? t.colors.primaryLight : t.colors.surface }]}>
        <RNTouchableOpacity style={styles.infoTouchable} onPress={() => onPlay(item.bvid)} activeOpacity={0.6}>
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
            <RNTouchableOpacity onPress={() => onExpandToggle(item.bvid)} style={styles.expandButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={t.colors.textHint} />
            </RNTouchableOpacity>
          )}
          <IconButton name="delete" size={20} color={t.colors.error} onPress={() => onRemove(item.bvid)} />
        </View>
      </View>
      {isExpanded && item.parts && item.parts.length > 1 && (
        <View style={[styles.partsContainer, { borderLeftColor: t.colors.divider }]}>
          {item.parts.map(part => (
            <RNTouchableOpacity
              key={part.cid}
              style={styles.partItem}
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
  const [hasOpened, setHasOpened] = useState(false);
  const listRef = useRef<any>(null);
  const loadingMoreRef = useRef(false);
  const listEndReachedArmedRef = useRef(false);
  const lastAutoLoadPageRef = useRef<string | null>(null);
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
    // 不等待解析或音量淡出完成，先让播放列表开始收起。
    onClose();
    try {
      let played = false;
      try {
        played = await playQueuedTrack(bvid);
      } catch {
        played = false;
      }
      if (!played) {
        const q = usePlayerStore.getState().queue;
        if (!q.some(video => video.bvid === bvid)) return;
        const loaded = await loadQueue(q, bvid);
        if (loaded === 0) throw new Error('歌曲暂时无法切换，请稍后重试');
      }
      usePlayerStore.getState().setCurrentBvid(bvid);
    } catch (error) {
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
      />
    ),
    [t.colors.primary, expandedBvid, handlePlayBvid, handlePartPress, handleExpandToggle, handleRemove, currentBvid]
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
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: info.index,
        animated: false,
        viewPosition: 0.5,
      });
    }, 0);
  }, []);

  const getItemLayout = useCallback((data: ArrayLike<FavoriteVideo> | null | undefined, index: number) => {
    const items = data ?? queue;
    let offset = index * (QUEUE_ITEM_HEIGHT + QUEUE_ITEM_SPACING);
    for (let itemIndex = 0; itemIndex < index; itemIndex += 1) {
      offset += getQueueItemExtraHeight(items[itemIndex], expandedBvid);
    }
    const item = items[index];
    return {
      length: QUEUE_ITEM_HEIGHT + QUEUE_ITEM_SPACING + getQueueItemExtraHeight(item, expandedBvid),
      offset,
      index,
    };
  }, [expandedBvid, queue]);

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
          ListFooterComponent={renderFooter}
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        {isGlass ? (
          <GlassView style={{ maxHeight: '80%', borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingBottom: 20 }} borderRadius={12}>
            {playlistContent}
          </GlassView>
        ) : (
          <View style={[styles.container, { backgroundColor: t.colors.background }]}>{playlistContent}</View>
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
    maxHeight: '80%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: 20,
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
    height: QUEUE_ITEM_HEIGHT,
    paddingVertical: 0,
    paddingHorizontal: 12,
    marginVertical: 4,
    borderRadius: 8,
    position: 'relative',
  },
  infoTouchable: {
    flex: 1,
    paddingRight: 80,
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
  },
  sub: {
    fontSize: 12,
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
    padding: 4,
    marginRight: 4,
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
    height: QUEUE_PART_ROW_HEIGHT,
    paddingVertical: 0,
    paddingRight: 8,
  },
  partTitle: {
    flex: 1,
    fontSize: 13,
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
    fontSize: 11,
    color: '#999',
  },
});
