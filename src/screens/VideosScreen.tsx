import React, { useEffect, useState, useCallback, useRef, memo } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  ToastAndroid,
  Modal,
  TextInput,
  RefreshControl,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { IconButton } from '../components/IconButton';
import { SubscribePlaylistButton } from '../components/SubscribePlaylistButton';
import { StatusBar } from 'react-native';
import { Loading } from '../components/Loading';
import { Empty } from '../components/Empty';
import { ErrorView } from '../components/ErrorView';
import { Button } from '../components/Button';
import { favoriteService } from '../services';
import { loadQueue, insertNext, resolveCurrentTrack } from '../services/trackPlayer';
import { usePlayerStore } from '../store/playerStore';
import { useProgressStore } from '../store/progressStore';
import { prefetchAudioUrl } from '../services/dataPrefetcher';
import { formatDuration } from '../utils/format';
import { useTheme } from '../theme';
import { useSyncStore } from '../store/syncStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FavoriteVideo, ImportedPlaylist } from '../types/domain';
import { useFolderDataStore, SortOption } from '../store/folderDataStore';
import {useNetworkRecoveryRefresh} from '../hooks/useNetworkRecoveryRefresh';

// ========== 精细粒度的 Item 组件（React.memo 消除无关重渲染） ==========
interface VideoItemProps {
  item: FavoriteVideo;
  index: number;
  onPlay: (index: number) => void;
  onMenu: (item: FavoriteVideo) => void;
  textColor: string;
  textHintColor: string;
  surfaceHighColor: string;
  fontSizeBase: number;
  fontSizeSm: number;
  spacingSm: number;
  spacingMd: number;
  spacingLg: number;
  surfaceColor: string;
}

const VideoItem = memo(function VideoItem({
  item, index, onPlay, onMenu,
  textColor, textHintColor, surfaceHighColor,
  fontSizeBase, fontSizeSm, spacingSm, spacingMd, spacingLg, surfaceColor,
}: VideoItemProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacingSm,
        paddingHorizontal: spacingSm,
        marginHorizontal: spacingLg,
        marginVertical: spacingSm,
        borderRadius: 18,
        backgroundColor: surfaceColor,
      }}
      onPress={() => onPlay(index)}
    >
      <View>
        <FastImage
          source={{uri: item.cover}}
          style={{width: 116, height: 72, borderRadius: 12, backgroundColor: surfaceHighColor}}
          resizeMode={FastImage.resizeMode.cover}
        />
        <View style={{position: 'absolute', bottom: 4, right: 4, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 7, backgroundColor: 'rgba(0,0,0,0.68)'}}>
          <Text style={{color: '#fff', fontSize: 10}}>{formatDuration(item.duration)}</Text>
        </View>
      </View>
      <View style={{ flex: 1, marginLeft: spacingMd }}>
        <Text
          style={{
            fontSize: fontSizeBase,
            color: textColor,
            fontWeight: '500',
            marginBottom: spacingSm / 2,
          }}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            style={{
              fontSize: fontSizeSm,
              color: textHintColor,
              flex: 1,
            }}
            numberOfLines={1}
          >
            {item.upper.name}
          </Text>
        </View>
      </View>
      <IconButton
        name="dots-vertical"
        size={24}
        color={textColor}
        onPress={() => onMenu(item)}
      />
    </TouchableOpacity>
  );
});
// ========== Item 组件结束 ==========

function showQueueStartError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert('播放错误', message);
  }
  usePlayerStore.getState().setQueueLoading(false);
  usePlayerStore.getState().setResolving(false);
}

export const VideosScreen = ({ route, navigation }: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { mediaId, title } = route.params;
  const source = route.params.source as ImportedPlaylist | undefined;
  const includeVideoParts = Boolean(route.params.includeVideoParts || source);
  const listTitle = source?.title ?? title ?? '播放列表';
  const setQueue = usePlayerStore((s) => s.setQueue);
  
  const {
    list,
    hasMore,
    loading,
    error,
    searchQuery,
    sortOption,
    initFolder,
    initImportedSource,
    loadMore,
    setSearchQuery,
    setSortOption,
    getDisplayedList,
    isRefreshing,
    refreshFolder,
    refreshImportedSource,
  } = useFolderDataStore();

  const [initing, setIniting] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<FavoriteVideo | null>(null);
  const [sortModalVisible, setSortModalVisible] = useState(false);

  const syncStatus = useSyncStore((s) => s.syncStatus);
  const isSyncing = syncStatus === 'syncing';
  const globalIndex = favoriteService.getGlobalIndex();
  const isGlobalIndexEmpty = globalIndex.length === 0;
  const isSearchDisabled = source ? false : isSyncing || isGlobalIndexEmpty;

  // 【性能优化】mountedRef：防止页面卸载后的异步操作更新已卸载组件的状态
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // ========== 增量刷新按钮逻辑 ==========
  // 防抖锁：防止用户在刷新动画未结束时再次点击
  const refreshLockRef = useRef(false);

  /**
   * 处理刷新点击事件。
   * 内置防抖：若已有刷新任务在执行则静默忽略。
   * 刷新完成后通过 Toast（Android）或 Alert（iOS）反馈结果。
   */
  const handleRefresh = useCallback(async (showFeedback = true) => {
    // Step 1: 防抖检测，避免重复触发
    if (refreshLockRef.current || isRefreshing || loading) return;
    refreshLockRef.current = true;

    try {
      const previousBvids = new Set(
        useFolderDataStore.getState().getDisplayedList().map(video => video.bvid),
      );
      const newCount = source
        ? await refreshImportedSource()
        : await refreshFolder(mediaId);
      const refreshedList = useFolderDataStore.getState().getDisplayedList();
      const addedVideos = refreshedList.filter(video => !previousBvids.has(video.bvid));
      const refreshKey = source?.sourceKey ?? `ownedFavorite:${mediaId}`;
      usePlayerStore.getState().syncQueueFromSourceRefresh(
        refreshKey,
        refreshedList,
        addedVideos,
      );
      // Step 2: 组件卸载后跳过 UI 反馈
      if (!mountedRef.current || !showFeedback) return;

      if (newCount > 0) {
        const msg = `新视频同步完成，共 ${newCount} 个`;
        if (Platform.OS === 'android') {
          ToastAndroid.show(msg, ToastAndroid.SHORT);
        } else {
          Alert.alert('同步完成', msg);
        }
      } else {
        const msg = '暂无新增视频';
        if (Platform.OS === 'android') {
          ToastAndroid.show(msg, ToastAndroid.SHORT);
        } else {
          Alert.alert('检查完毕', msg);
        }
      }
    } catch (e: any) {
      if (!mountedRef.current || !showFeedback) return;
      const msg = e.message || '刷新失败，请稍后重试';
      if (Platform.OS === 'android') {
        ToastAndroid.show(msg, ToastAndroid.SHORT);
      } else {
        Alert.alert('刷新失败', msg);
      }
    } finally {
      // 延迟释放锁，确保 loading 动画完全过渡
      setTimeout(() => {
        refreshLockRef.current = false;
      }, 500);
    }
  }, [mediaId, source, refreshFolder, refreshImportedSource, isRefreshing, loading]);

  useNetworkRecoveryRefresh(async () => {
    const state = useFolderDataStore.getState();
    if (state.list.length === 0 && state.error) {
      await state.loadMore();
      return;
    }
    await handleRefresh(false);
  }, Boolean(error));
  // ========== 增量刷新按钮逻辑结束 ==========

  useEffect(() => {
    setIniting(true);
    if (source) {
      initImportedSource(source);
    } else if (mediaId) {
      initFolder(mediaId);
    }
    setIniting(false);
  }, [mediaId, source, initFolder, initImportedSource]);

  const displayedList = getDisplayedList();
  const totalVideoCount = source?.mediaCount ?? route.params.mediaCount ?? list.length;
  const heroCover = source?.cover || route.params.cover || displayedList[0]?.cover;
  const statusBarHeight = Platform.OS === 'android'
    ? Math.max(insets.top, StatusBar.currentHeight ?? 0)
    : insets.top;

  const playFrom = useCallback(async (idx: number) => {
    try {
      const target = displayedList[idx];
      if (!target) return;
      const context = source
        ? { sourceKey: source.sourceKey, sortOption, searchQuery, includeVideoParts }
        : { folderId: mediaId, sourceKey: `ownedFavorite:${mediaId}`, sortOption, searchQuery, includeVideoParts };

      // 【修复】强制切换为顺序播放模式，避免 shuffle 模式触发大量请求
      if (usePlayerStore.getState().playMode !== 'sequential') {
        usePlayerStore.getState().setPlayMode('sequential');
      }

      // 立即使用当前已加载的列表数据构建播放队列（零网络请求）
      setQueue(displayedList, target.bvid, context);

      // ======== 【P0防闪烁优化】跳转前清空旧播放上下文 ========
      // 1. 重置进度数据：清除上一首歌曲的位置/时长残留，防止 PlayerScreen 挂载时
      //    进度条短暂显示旧数据（10-200ms 闪烁窗口期）
      // 2. 设置 isResolving=true：PlayerScreen 据此使用 fallbackTrack 而非旧 activeTrack
      usePlayerStore.getState().setResolving(true);
      useProgressStore.getState().resetProgress();

      // ======== 【P0性能优化】极速并发预取 ========
      // 在 loadQueue（Bridge 调用，耗时）执行的同时，发起网络请求获取真实音频 URL。
      // 两者完全并行：Bridge 和网络请求互不阻塞。
      // Promise 去重（cache.ts）确保后续 resolveCurrentTrack 的 getInfo 调用
      // 直接复用此 Promise，而非发起第二次网络请求。
      prefetchAudioUrl(target.bvid, target.parts?.[0]?.cid).catch(() => {});
      const previousTarget = idx > 0 ? displayedList[idx - 1] : undefined;
      if (previousTarget) {
        prefetchAudioUrl(previousTarget.bvid, previousTarget.parts?.[0]?.cid).catch(() => {});
      }
      // ↑ fire-and-forget，不阻塞主流程，网络请求在后台与 Bridge 并行执行

      // 【关键修复】立即导航，不等待 loadQueue Bridge 调用完成
      // PlayerScreen 使用 playerStore 中的 currentVideo 作为后备渲染，
      // 在 TrackPlayer 还未就绪时显示歌曲信息，避免"未播放"闪烁
      navigation.navigate('Player');

      void (async () => {
        try {
          const version = await loadQueue(displayedList, target.bvid);
          if (!version) {
            throw new Error(usePlayerStore.getState().playbackError || '歌曲暂时无法播放');
          }
          resolveCurrentTrack(version).catch(() => {});
        } catch (error) {
          showQueueStartError(error, '播放失败');
        }
      })();
    } catch (e: any) {
      const msg = e.message || '播放失败';
      if (Platform.OS === 'android') {
        ToastAndroid.show(msg, ToastAndroid.SHORT);
      } else {
        Alert.alert('播放错误', msg);
      }
      usePlayerStore.getState().setQueueLoading(false);
      // 发生错误时清除乐观加载状态
      usePlayerStore.getState().setResolving(false);
    }
  }, [displayedList, includeVideoParts, mediaId, navigation, setQueue, source, sortOption, searchQuery]);

  const playAll = useCallback(async () => {
    try {
      const currentList = useFolderDataStore.getState().getDisplayedList();
      if (currentList.length === 0) return;

      // 强制顺序模式
      if (usePlayerStore.getState().playMode !== 'sequential') {
        usePlayerStore.getState().setPlayMode('sequential');
      }

      const target = currentList[0];
      const context = source
        ? { sourceKey: source.sourceKey, sortOption, searchQuery, includeVideoParts }
        : { folderId: mediaId, sourceKey: `ownedFavorite:${mediaId}`, sortOption, searchQuery, includeVideoParts };
      setQueue(currentList, target.bvid, context);
      // 【P0防闪烁优化】跳转前清空旧播放上下文
      usePlayerStore.getState().setResolving(true);
      useProgressStore.getState().resetProgress();
      // 【P0性能优化】极速并发预取
      prefetchAudioUrl(target.bvid, target.parts?.[0]?.cid).catch(() => {});
      navigation.navigate('Player');
      void (async () => {
        try {
          const version = await loadQueue(currentList, target.bvid);
          if (!version) {
            throw new Error(usePlayerStore.getState().playbackError || '歌曲暂时无法播放');
          }
          resolveCurrentTrack(version).catch(() => {});
        } catch (error) {
          showQueueStartError(error, '播放全部失败');
        }
      })();
    } catch (e: any) {
      const msg = e.message || '播放全部失败';
      if (Platform.OS === 'android') {
        ToastAndroid.show(msg, ToastAndroid.SHORT);
      } else {
        Alert.alert('播放错误', msg);
      }
      usePlayerStore.getState().setQueueLoading(false);
      usePlayerStore.getState().setResolving(false);
    }
  }, [includeVideoParts, mediaId, navigation, setQueue, source, sortOption, searchQuery]);

  const shuffle = useCallback(async () => {
    try {
      // 自有收藏夹沿用数据库抽样；导入来源只打乱当前已加载列表。
      let shuffled = source
        ? [...displayedList]
        : await favoriteService.getRandomVideos(mediaId.toString(), 100);
      if (shuffled.length === 0) return;

      if (source) {
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
          const swapIndex = Math.floor(Math.random() * (index + 1));
          [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }
      }

      const target = shuffled[0];
      const context = source
        ? { sourceKey: source.sourceKey, sortOption, searchQuery, includeVideoParts }
        : { folderId: mediaId, sourceKey: `ownedFavorite:${mediaId}`, sortOption, searchQuery, includeVideoParts };
      
      usePlayerStore.getState().setPlayMode('shuffle');
      setQueue(shuffled, target.bvid, context);
      // 【P0防闪烁优化】跳转前清空旧播放上下文
      usePlayerStore.getState().setResolving(true);
      useProgressStore.getState().resetProgress();
      // 【P0性能优化】极速并发预取
      prefetchAudioUrl(target.bvid, target.parts?.[0]?.cid).catch(() => {});
      navigation.navigate('Player');
      void (async () => {
        try {
          const version = await loadQueue(shuffled, target.bvid);
          if (!version) {
            throw new Error(usePlayerStore.getState().playbackError || '歌曲暂时无法播放');
          }
          resolveCurrentTrack(version).catch(() => {});
        } catch (error) {
          showQueueStartError(error, '随机播放失败');
        }
      })();
    } catch (e: any) {
      const msg = e.message || '随机播放失败';
      if (Platform.OS === 'android') {
        ToastAndroid.show(msg, ToastAndroid.SHORT);
      } else {
        Alert.alert('播放错误', msg);
      }
      usePlayerStore.getState().setResolving(false);
    }
  }, [displayedList, includeVideoParts, mediaId, navigation, setQueue, source, sortOption, searchQuery]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    actions: {
      flexDirection: 'row',
      gap: t.spacing.md,
    },
    actionBtn: { flex: 1 },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: 20,
      paddingHorizontal: t.spacing.md,
      height: 40,
      marginHorizontal: t.spacing.lg,
      marginVertical: t.spacing.md,
    },
    item: {
      flexDirection: 'row',
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.md,
    },
    cover: {
      width: 112,
      height: 70,
      borderRadius: t.radius.sm,
      backgroundColor: t.colors.surfaceHigh,
    },
    info: { flex: 1, marginLeft: t.spacing.md, justifyContent: 'space-between' },
    title: { fontSize: t.fontSize.base, color: t.colors.text },
    meta: { flexDirection: 'row', justifyContent: 'space-between' },
    upper: { fontSize: t.fontSize.xs, color: t.colors.textSub },
    duration: { fontSize: t.fontSize.xs, color: t.colors.textHint },
    footer: { padding: t.spacing.lg, alignItems: 'center' },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: t.isDark ? '#17181B' : '#FAFBFD',
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
      padding: t.spacing.lg,
      maxHeight: '80%',
    },
    modalTitle: {
      fontSize: t.fontSize.lg,
      fontWeight: '600',
      marginBottom: t.spacing.md,
      textAlign: 'center',
    },
  });

  // No longer using cycleSort, sorting handled via modal

  return (
    // 【性能优化】collapsable=false 确保 Android 上屏幕容器不被 View 融合优化
    <View style={s.container} {...(Platform.OS === 'android' ? { collapsable: false as any } : {})}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <View style={{height: 252, overflow: 'hidden', backgroundColor: t.colors.primaryDark}}>
        {heroCover ? (
          <FastImage source={{uri: heroCover}} style={StyleSheet.absoluteFillObject} resizeMode={FastImage.resizeMode.cover} />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, {alignItems: 'center', justifyContent: 'center'}]}>
            <Icon name="folder-music-outline" size={72} color="rgba(255,255,255,0.18)" />
          </View>
        )}
        <LinearGradient
          pointerEvents="none"
          colors={t.isDark ? ['rgba(8,8,12,0.08)', 'rgba(8,8,12,0.94)'] : ['rgba(12,10,22,0.02)', 'rgba(12,10,22,0.84)']}
          style={StyleSheet.absoluteFillObject}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="返回收藏夹"
          onPress={() => navigation.goBack()}
          style={{alignSelf: 'flex-start', marginTop: statusBarHeight + 5, marginLeft: t.spacing.md, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(12,10,22,0.32)'}}>
          <Icon name="chevron-left" size={28} color="#fff" />
        </TouchableOpacity>
        {source ? (
          <View style={{position: 'absolute', top: statusBarHeight + 5, right: t.spacing.md, zIndex: 2}}>
            <SubscribePlaylistButton source={source} compact />
          </View>
        ) : null}
        <View style={{position: 'absolute', left: t.spacing.lg, right: t.spacing.lg, bottom: t.spacing.lg}}>
          <View style={{alignSelf: 'flex-start', paddingHorizontal: t.spacing.sm, paddingVertical: 4, borderRadius: t.radius.full, backgroundColor: t.colors.primary}}>
            <Text style={{fontSize: t.fontSize.xs, fontWeight: '600', color: t.colors.onPrimary}}>
              {source?.kind === 'subscribedSeason' ? '订阅合集' : source ? '收藏夹' : '我创建'}
            </Text>
          </View>
          <Text style={{fontSize: 25, lineHeight: 31, fontWeight: '700', color: '#fff', marginTop: t.spacing.sm}} numberOfLines={2}>{listTitle}</Text>
          <Text style={{fontSize: t.fontSize.sm, color: 'rgba(255,255,255,0.88)', marginTop: t.spacing.xs}} numberOfLines={1}>
            {source?.ownerName ? `${source.ownerName} · ` : '我的收藏 · '}{totalVideoCount} 个视频
          </Text>
          {source?.description ? (
            <Text style={{fontSize: t.fontSize.xs, lineHeight: 17, color: 'rgba(255,255,255,0.82)', marginTop: t.spacing.xs}} numberOfLines={2}>
              {source.description}
            </Text>
          ) : null}
        </View>
      </View>
      {/* 搜索 + 排序栏 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md}}>
        <View style={[s.searchBar, { flex: 1, height: 46, marginHorizontal: 0, marginVertical: 0, borderRadius: t.radius.full }]}>
          <Icon name="magnify" size={20} color={t.colors.textHint} />
          <TextInput
            style={{ flex: 1, marginLeft: t.spacing.sm, color: isSearchDisabled ? t.colors.textHint : t.colors.text, fontSize: t.fontSize.base, padding: 0 }}
            placeholder={isSyncing ? "索引同步中，暂不可搜索" : isGlobalIndexEmpty ? "全局索引为空，暂不可搜索" : source ? "搜索合集内视频" : "搜索收藏夹内视频"}
            placeholderTextColor={t.colors.textHint}
            value={searchQuery}
            onChangeText={setSearchQuery} editable={!isSearchDisabled}
          />
        </View>
        {/* 增量刷新按钮：点击触发单收藏夹增量同步 */}
        {isRefreshing ? (
          <ActivityIndicator
            size="small"
            color={t.colors.primary}
            style={{ marginLeft: t.spacing.sm, width: 40, height: 40, justifyContent: 'center', alignItems: 'center' }}
          />
        ) : (
          <IconButton
            name="refresh"
            size={24}
            color={t.colors.text}
            style={{ marginLeft: t.spacing.sm }}
            disabled={isSearchDisabled || isRefreshing || loading}
            onPress={handleRefresh}
          />
        )}
        <IconButton name="sort-variant" size={24} color={t.colors.text} style={{ marginLeft: t.spacing.sm }} disabled={isSearchDisabled} onPress={() => setSortModalVisible(true)} />
      </View>

      {initing || (loading && displayedList.length === 0) ? (
        <Loading />
      ) : error && displayedList.length === 0 ? (
        <ErrorView message={error} onRetry={loadMore} />
      ) : displayedList.length === 0 ? (
        <Empty title="播放列表是空的" />
      ) : (
        <FlatList
          data={displayedList}
          contentContainerStyle={{paddingBottom: insets.bottom + 136}}
          keyExtractor={(it) => it.bvid}
          showsVerticalScrollIndicator={false}
          // ========== 性能优化参数 ==========
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
          // =================================
          ListHeaderComponent={
            <View style={{paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.xs}}>
              <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: t.spacing.md}}>
                <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>共 {totalVideoCount} 个视频</Text>
                <TouchableOpacity onPress={() => setSortModalVisible(true)} style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.spacing.sm, paddingVertical: 6, borderRadius: t.radius.full, backgroundColor: t.colors.surfaceHigh}}>
                  <Icon name="sort" size={17} color={t.colors.textSub} />
                  <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginLeft: 4}}>排序</Text>
                  <Icon name="chevron-down" size={17} color={t.colors.textSub} />
                </TouchableOpacity>
              </View>
              <View style={s.actions}>
                <Button title="▶  全部播放" onPress={playAll} style={s.actionBtn} />
                <Button title="⤨  随机播放" variant="secondary" onPress={shuffle} style={s.actionBtn} />
              </View>
            </View>
          }
          renderItem={({ item, index }) => (
            <VideoItem
              item={item}
              index={index}
              onPlay={playFrom}
              onMenu={(v) => { setSelectedVideo(v); setModalVisible(true); }}
              textColor={t.colors.text}
              textHintColor={t.colors.textHint}
              surfaceHighColor={t.colors.surfaceHigh}
              surfaceColor={t.colors.surface}
              fontSizeBase={t.fontSize.base}
              fontSizeSm={t.fontSize.sm}
              spacingSm={t.spacing.sm}
              spacingMd={t.spacing.md}
              spacingLg={t.spacing.lg}
            />
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={(
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void handleRefresh()}
              enabled={!isSearchDisabled && !loading}
              tintColor={t.colors.primary}
              colors={[t.colors.primary]}
            />
          )}
          ListFooterComponent={
            hasMore && loading ? (
              <View style={s.footer}>
                <ActivityIndicator color={t.colors.primary} />
              </View>
            ) : !hasMore ? (
              <View style={s.footer}>
                <Text style={{ color: t.colors.textHint, fontSize: t.fontSize.xs }}>到底了</Text>
              </View>
            ) : null
          }
        />
      )}
      {/* Bottom Action Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle} numberOfLines={1}>{selectedVideo?.title}</Text>
            <Button
              title="下一首播放"
              variant="secondary"
              onPress={() => {
                if (selectedVideo) {
                  insertNext(selectedVideo);
                  if (Platform.OS === 'android') {
                    ToastAndroid.show('已添加到下一首播放', ToastAndroid.SHORT);
                  }
                }
                setModalVisible(false);
              }}
              style={{ marginBottom: t.spacing.sm, height: 36 }}
            />
            <Button title="取消" variant="secondary" onPress={() => setModalVisible(false)} />
          </View>
        </View>
      </Modal>
      {/* 排序弹窗 */}
      <Modal
        visible={sortModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSortModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>排序方式</Text>
            <Button title="标题正序" variant="secondary" onPress={() => { setSortOption(SortOption.TitleAsc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm, height: 36 }} />
            <Button title="标题逆序" variant="secondary" onPress={() => { setSortOption(SortOption.TitleDesc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm, height: 36 }} />
            <Button title="时长正序" variant="secondary" onPress={() => { setSortOption(SortOption.DurationAsc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm, height: 36 }} />
            <Button title="时长逆序" variant="secondary" onPress={() => { setSortOption(SortOption.DurationDesc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm, height: 36 }} />
            <Button title="收藏时间正序" variant="secondary" onPress={() => { setSortOption(SortOption.FavoriteTimeAsc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm, height: 36 }} />
            <Button title="收藏时间逆序" variant="secondary" onPress={() => { setSortOption(SortOption.FavoriteTimeDesc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm, height: 36 }} />
            <Button title="关闭" variant="secondary" onPress={() => setSortModalVisible(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
};
