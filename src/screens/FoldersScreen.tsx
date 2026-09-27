import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  View,
  FlatList,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  ToastAndroid,
  Text,
  TextInput,
  StatusBar,
  BackHandler,
  Modal,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSelectionStore } from '../store/selectionStore';
import { usePlayerStore } from '../store/playerStore';
import { useProgressStore } from '../store/progressStore';
import { IconButton } from '../components/IconButton';
import { Loading } from '../components/Loading';
import { Empty } from '../components/Empty';
import { ErrorView } from '../components/ErrorView';
import { MiniPlayer } from '../components/MiniPlayer';
import { Button } from '../components/Button';
import { favoriteService, loadGlobalIndexCache } from '../services/favoriteService';
import { biliApi } from '../services/biliApi';
import {
  matchesOnlineVideoSearch,
  searchVideoToFavoriteVideo,
  trimSearchVideo,
} from '../services/transformers';
import { importedPlaylistService } from '../services/importedPlaylistService';
import { appendQueue as tpAppendQueue, loadQueue, playWithIntent, resolveCurrentTrack } from '../services/trackPlayer';
import { useAuthStore } from '../store/authStore';
import { prefetchAudioUrl } from '../services/dataPrefetcher';
import { useSettingsStore } from '../store/settingsStore';
import { useImportedPlaylistStore } from '../store/importedPlaylistStore';
import { useSyncStore } from '../store/syncStore';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  FavoriteFolder,
  ImportedPlaylist,
  OnlineVideoSearchResult,
} from '../types/domain';
import FastImage from 'react-native-fast-image';
import { formatDuration } from '../utils/format';

interface HomePlaylistItem {
  sourceKey: string;
  origin: 'owned' | 'collectedFavorite' | 'subscribedSeason';
  id: number;
  title: string;
  mediaCount: number;
  ownerName?: string;
  source?: ImportedPlaylist;
}

const EMPTY_IMPORTED_CATALOG: ImportedPlaylist[] = [];
const EMPTY_VISIBLE_SOURCE_KEYS: string[] = [];

export const FoldersScreen = ({ navigation }: any) => {
  const t = useTheme();
  const isGlass = !!t.glass;
  const uid = useAuthStore((s) => s.userId);
  const hiddenFolderIds = useSettingsStore((s) => s.hiddenFolderIds);
  const importedCatalog = useImportedPlaylistStore(s =>
    uid
      ? s.catalogByUid[uid] ?? EMPTY_IMPORTED_CATALOG
      : EMPTY_IMPORTED_CATALOG,
  );
  const visibleSourceKeys = useImportedPlaylistStore(s =>
    uid
      ? s.visibleSourceKeysByUid[uid] ?? EMPTY_VISIBLE_SOURCE_KEYS
      : EMPTY_VISIBLE_SOURCE_KEYS,
  );
  const setImportedCatalog = useImportedPlaylistStore((s) => s.setCatalog);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const toggle = useSelectionStore((s) => s.toggle);
  const clear = useSelectionStore((s) => s.clear);
  const [allFolders, setAllFolders] = useState<FavoriteFolder[] | null>(null);
  const [, setGlobalIndexReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedSyncError, setImportedSyncError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const insets = useSafeAreaInsets();
  const syncStatus = useSyncStore((s) => s.syncStatus);
  const isSyncing = syncStatus === 'syncing';

  // 根据用户偏好过滤出可见的收藏夹
  const folders = allFolders
    ? allFolders.filter((f) => !hiddenFolderIds.includes(f.id))
    : null;

  // 全局搜索关键字
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'title' | 'author' | 'online'>('title');
  const [onlineFilter, setOnlineFilter] = useState<'title' | 'tag'>('title');
  const [onlineResults, setOnlineResults] = useState<OnlineVideoSearchResult[]>([]);
  const [onlineSearchPage, setOnlineSearchPage] = useState(0);
  const [onlineHasMore, setOnlineHasMore] = useState(false);
  const [onlineHasSearched, setOnlineHasSearched] = useState(false);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const onlineRequestId = useRef(0);
  const onlineAbortController = useRef<AbortController | null>(null);
  const onlineLoadingRef = useRef(false);
  const [favoritePickerVisible, setFavoritePickerVisible] = useState(false);
  const [favoriteTargetFolders, setFavoriteTargetFolders] = useState<FavoriteFolder[]>([]);
  const [selectedFavoriteTargetIds, setSelectedFavoriteTargetIds] = useState<number[]>([]);
  const [selectedOnlineVideo, setSelectedOnlineVideo] = useState<OnlineVideoSearchResult | null>(null);
  const [favoriteTargetsLoading, setFavoriteTargetsLoading] = useState(false);
  const [favoriteWriteLoading, setFavoriteWriteLoading] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createFolderLoading, setCreateFolderLoading] = useState(false);
  const [newFolderTitle, setNewFolderTitle] = useState('');
  const [newFolderIsPrivate, setNewFolderIsPrivate] = useState(true);
  const visibleImportedSources = importedCatalog.filter(source => visibleSourceKeys.includes(source.sourceKey));
  const playlistItems: HomePlaylistItem[] | null = allFolders !== null || visibleImportedSources.length > 0
    ? [
        ...(folders ?? []).map(folder => ({
          sourceKey: `ownedFavorite:${folder.id}`,
          origin: 'owned' as const,
          id: folder.id,
          title: folder.title,
          mediaCount: folder.mediaCount,
        })),
        ...visibleImportedSources.map(source => ({
          sourceKey: source.sourceKey,
          origin: source.kind,
          id: source.remoteId,
          title: source.title,
          mediaCount: source.mediaCount,
          ownerName: source.ownerName,
          source,
        })),
      ]
    : null;

  const globalIndex = favoriteService.getGlobalIndex(hiddenFolderIds);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isOnlineSearch = searchMode === 'online';
  const isGlobalSearch = !isOnlineSearch && normalizedSearchQuery.length > 0;
  const isGlobalIndexEmpty = globalIndex.length === 0;
  const isSearchDisabled = !isOnlineSearch && (isSyncing || isGlobalIndexEmpty);
  const filteredVideos = useMemo(() => {
    if (!isGlobalSearch) {
      return [];
    }
    return globalIndex.filter(video => {
      const searchableText = searchMode === 'title'
        ? video.title
        : video.upper?.name || '';
      return searchableText.toLowerCase().includes(normalizedSearchQuery);
    });
  }, [globalIndex, isGlobalSearch, normalizedSearchQuery, searchMode]);

  const load = useCallback(
    async (force = false) => {
      if (!uid) return;
      setError(null);
      setImportedSyncError(null);
      try {
        const data = await favoriteService.getFolders(uid, force);
        setAllFolders(data);
      } catch (e: any) {
        setError(e.message || '加载失败');
      }
      try {
        const sources = await importedPlaylistService.getCollectedPlaylists(uid, force);
        setImportedCatalog(uid, sources);
      } catch (e: any) {
        setImportedSyncError(e.message || '外部收藏来源同步失败');
      }
      setRefreshing(false);
    },
    [uid, setImportedCatalog]
  );

  useEffect(() => {
    load();
  }, [load]);

  // 【修复】组件挂载时确保全局索引缓存已加载，并触发重新渲染以更新 isGlobalIndexEmpty
  useEffect(() => {
    loadGlobalIndexCache().then(() => setGlobalIndexReady(true));
  }, []);

  useEffect(() => {
    const onBackPress = () => {
      if (searchQuery.length > 0) {
        onlineAbortController.current?.abort();
        onlineRequestId.current += 1;
        onlineLoadingRef.current = false;
        setOnlineLoading(false);
        setOnlineResults([]);
        setOnlineHasSearched(false);
        setSearchQuery('');
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [searchQuery]);

  useEffect(() => {
    StatusBar.setBarStyle(t.isDark ? 'light-content' : 'dark-content');
    StatusBar.setTranslucent(true);
  }, [t.isDark]);

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const runOnlineSearch = useCallback(async (
    page = 1,
    field: 'title' | 'tag' = onlineFilter,
  ) => {
    const keyword = searchQuery.trim();
    if (!keyword) {
      setOnlineError('请输入搜索关键词');
      setOnlineHasSearched(false);
      setOnlineResults([]);
      return;
    }
    if (!uid) {
      setOnlineError('请先登录 B 站账号后再搜索');
      setOnlineHasSearched(false);
      return;
    }
    if (page > 1 && onlineLoadingRef.current) return;

    if (page === 1) onlineAbortController.current?.abort();
    const controller = new AbortController();
    onlineAbortController.current = controller;
    const requestId = ++onlineRequestId.current;
    onlineLoadingRef.current = true;
    setOnlineLoading(true);
    setOnlineError(null);
    if (page === 1) {
      setOnlineHasSearched(false);
      setOnlineResults([]);
    }

    try {
      const response = await biliApi.searchVideos(keyword, page, controller.signal);
      if (requestId !== onlineRequestId.current) return;
      const pageResults = (response.result || [])
        .filter(item => item.aid > 0 && !!item.bvid)
        .map(trimSearchVideo)
        .filter(item => matchesOnlineVideoSearch(item, keyword, field));
      setOnlineResults(previous => {
        const next = page === 1 ? pageResults : [...previous, ...pageResults];
        return Array.from(new Map(next.map(item => [item.bvid, item])).values());
      });
      setOnlineSearchPage(page);
      setOnlineHasMore(page < (response.numPages ?? page));
      setOnlineHasSearched(true);
    } catch (searchError) {
      if (requestId === onlineRequestId.current && !controller.signal.aborted) {
        setOnlineError(searchError instanceof Error ? searchError.message : 'B 站搜索失败');
      }
    } finally {
      if (requestId === onlineRequestId.current) {
        onlineLoadingRef.current = false;
        setOnlineLoading(false);
      }
    }
  }, [onlineFilter, searchQuery, uid]);

  useEffect(() => () => {
    onlineRequestId.current += 1;
    onlineAbortController.current?.abort();
    onlineLoadingRef.current = false;
  }, []);

  const openFavoriteTargetPicker = useCallback(async (video: OnlineVideoSearchResult) => {
    if (!uid) {
      Alert.alert('需要登录', '请先登录 B 站账号后再收藏视频');
      return;
    }
    const requestUid = uid;
    setSelectedOnlineVideo(video);
    setFavoritePickerVisible(true);
    setFavoriteTargetsLoading(true);
    setFavoriteError(null);
    setCreatingFolder(false);
    try {
      const folders = await favoriteService.getFolders(requestUid, true);
      if (useAuthStore.getState().userId !== requestUid) return;
      const ownedFolders = folders.filter(folder => String(folder.mid) === requestUid);
      setFavoriteTargetFolders(ownedFolders);
      setSelectedFavoriteTargetIds(previous =>
        previous.filter(id => ownedFolders.some(folder => folder.id === id)),
      );
    } catch (targetError) {
      setFavoriteError(targetError instanceof Error ? targetError.message : '加载收藏夹失败');
    } finally {
      setFavoriteTargetsLoading(false);
    }
  }, [uid]);

  const handleCreateFavoriteFolder = async () => {
    if (!uid || createFolderLoading) return;
    setCreateFolderLoading(true);
    setFavoriteError(null);
    try {
      const folder = await favoriteService.createFavoriteFolder(
        uid,
        newFolderTitle,
        newFolderIsPrivate ? 1 : 0,
      );
      setFavoriteTargetFolders(previous => [
        ...previous.filter(item => item.id !== folder.id),
        folder,
      ]);
      setSelectedFavoriteTargetIds(previous =>
        previous.includes(folder.id) ? previous : [...previous, folder.id],
      );
      setNewFolderTitle('');
      setCreatingFolder(false);
      if (allFolders !== null) {
        setAllFolders(previous => previous
          ? [...previous.filter(item => item.id !== folder.id), folder]
          : [folder]);
      }
    } catch (createError) {
      setFavoriteError(createError instanceof Error ? createError.message : '新建收藏夹失败');
    } finally {
      setCreateFolderLoading(false);
    }
  };

  const handleAddOnlineVideoToFavorites = async () => {
    if (!uid || !selectedOnlineVideo || favoriteWriteLoading) return;
    if (selectedFavoriteTargetIds.length === 0) {
      setFavoriteError('请至少勾选一个收藏夹');
      return;
    }
    setFavoriteWriteLoading(true);
    setFavoriteError(null);
    try {
      const result = await favoriteService.addSearchResultToFolders(
        uid,
        selectedOnlineVideo,
        selectedFavoriteTargetIds,
      );
      const confirmedCount = result.confirmedFolderIds.length;
      const missingCount = result.unconfirmedFolderIds.length;
      const refreshedFolders = await favoriteService.getFolders(uid);
      setFavoriteTargetFolders(refreshedFolders.filter(folder => String(folder.mid) === uid));
      setAllFolders(refreshedFolders);

      if (confirmedCount === 0) {
        setFavoriteError(
          result.writeErrorMessage || 'B 站尚未确认收藏状态；请刷新收藏夹确认后再操作。',
        );
        return;
      }
      if (missingCount > 0) {
        setFavoriteError(
          `B 站已确认 ${confirmedCount} 个收藏夹，另有 ${missingCount} 个尚未确认。${result.writeErrorMessage ? ` ${result.writeErrorMessage}` : ''}`,
        );
        return;
      }

      setFavoritePickerVisible(false);
      setSelectedOnlineVideo(null);
      const message = 'B 站已确认收藏，本地索引已更新';
      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
      else Alert.alert('完成', message);
    } catch (writeError) {
      setFavoriteError(writeError instanceof Error ? writeError.message : '收藏写入失败');
    } finally {
      setFavoriteWriteLoading(false);
    }
  };

  const statusBarHeight = Platform.OS === 'android' ? Math.max(insets.top, StatusBar.currentHeight ?? 0) : insets.top;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    list: { padding: t.spacing.lg, gap: t.spacing.md },
  });

  const handleRandomPlayAll = async () => {
    const shuffled = await favoriteService.getRandomVideos(undefined, 100, hiddenFolderIds);
    if (shuffled.length === 0) {
      if (Platform.OS === 'android') {
        ToastAndroid.show(
          '全局索引为空或正在同步中，请稍后再试',
          ToastAndroid.SHORT
        );
      } else {
        Alert.alert('提示', '全局索引为空或正在同步中，请稍后再试');
      }
      return;
    }
    setQueue(shuffled, shuffled[0]?.bvid);
    // ======== 【P0防闪烁优化】跳转前清空旧播放上下文 ========
    usePlayerStore.getState().setResolving(true);
    useProgressStore.getState().resetProgress();
    // 【P0性能优化】极速并发预取：与 loadQueue Bridge 调用并行执行
    const target = shuffled[0];
    if (target) {
      prefetchAudioUrl(target.bvid, target.parts?.[0]?.cid).catch(() => {});
    }
    const version = await loadQueue(shuffled, shuffled[0]?.bvid);
    // 【修复E】显式调用 play()，不再依赖 _pendingPlay 事件标志
    await playWithIntent();
    // 【P0性能优化】主动触发解析，跳过 PlaybackError 等待
    resolveCurrentTrack(version).catch(() => {});
    navigation.navigate('Player');
  };

  return (
    // 【性能优化】collapsable=false 确保 Android 上屏幕容器不被 View 融合优化
    <View style={s.container} {...(Platform.OS === 'android' ? { collapsable: false as any } : {})}>
      <StatusBar
        barStyle={t.isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      {/* 搜索栏 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: t.spacing.lg,
          paddingVertical: t.spacing.md,
          paddingTop: t.spacing.md + statusBarHeight,
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: t.colors.surfaceHigh,
            borderRadius: 20,
            paddingHorizontal: t.spacing.md,
            height: 40,
            opacity: isSearchDisabled ? 0.4 : 1,
          }}
        >
          <Icon name="magnify" size={20} color={t.colors.textHint} />
          <TextInput
            style={{
              flex: 1,
              marginLeft: t.spacing.sm,
              color: isSearchDisabled ? t.colors.textHint : t.colors.text,
              fontSize: t.fontSize.base,
              padding: 0,
            }}
            placeholder={isOnlineSearch ? '输入名称或 tag 后搜索 B 站' : isSyncing ? '索引同步中，暂不可搜索' : isGlobalIndexEmpty ? '全局索引为空，暂不可搜索' : searchMode === 'title' ? '请输入歌曲名' : '请输入作者'}
            placeholderTextColor={t.colors.textHint}
            value={searchQuery}
            onChangeText={value => {
              setSearchQuery(value);
              if (isOnlineSearch) {
                onlineAbortController.current?.abort();
                onlineRequestId.current += 1;
                onlineLoadingRef.current = false;
                setOnlineLoading(false);
                setOnlineResults([]);
                setOnlineHasSearched(false);
                setOnlineHasMore(false);
                setOnlineError(null);
              }
            }}
            onSubmitEditing={() => isOnlineSearch && runOnlineSearch(1)}
            returnKeyType={isOnlineSearch ? 'search' : 'default'}
            editable={isOnlineSearch || !isSearchDisabled}
          />
          {isOnlineSearch && (
            <IconButton
              name="magnify"
              size={22}
              color={t.colors.primary}
              disabled={!searchQuery.trim() || onlineLoading}
              onPress={() => runOnlineSearch(1)}
            />
          )}
          <IconButton
            name={searchMode === 'title' ? 'music-note' : searchMode === 'author' ? 'account' : 'web'}
            size={24}
            color={t.colors.text}
            style={{ marginLeft: t.spacing.sm }}
            onPress={() => {
              if (searchMode === 'online') {
                onlineAbortController.current?.abort();
                onlineRequestId.current += 1;
                onlineLoadingRef.current = false;
                setOnlineLoading(false);
              } else {
                setOnlineResults([]);
                setOnlineSearchPage(0);
                setOnlineHasMore(false);
                setOnlineHasSearched(false);
                setOnlineError(null);
              }
              setSearchMode(mode => mode === 'title' ? 'author' : mode === 'author' ? 'online' : 'title');
            }}
          />
        </View>
        <IconButton
          name="cog-outline"
          size={24}
          color={t.colors.text}
          style={{ marginLeft: t.spacing.md }}
          onPress={() => navigation.navigate('Settings')}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="打开收藏标签推荐"
          onPress={() => navigation.navigate('TagRecommendations')}
          style={{padding: 6, marginLeft: t.spacing.xs}}
        >
          <Icon name="tag-heart-outline" size={24} color={t.colors.primary} />
        </TouchableOpacity>
      </View>

      {isOnlineSearch && (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: t.spacing.lg,
          paddingBottom: t.spacing.sm,
        }}>
          <Text style={{ color: t.colors.textHint, fontSize: t.fontSize.sm, marginRight: t.spacing.sm }}>B 站在线搜索</Text>
          {(['title', 'tag'] as const).map(field => (
            <TouchableOpacity
              key={field}
              onPress={() => {
                setOnlineFilter(field);
                if (searchQuery.trim()) runOnlineSearch(1, field);
              }}
              style={{
                paddingHorizontal: t.spacing.md,
                paddingVertical: 5,
                marginRight: t.spacing.xs,
                borderRadius: 14,
                backgroundColor: onlineFilter === field ? t.colors.primary : t.colors.surfaceHigh,
              }}
            >
              <Text style={{
                color: onlineFilter === field ? t.colors.onPrimary : t.colors.text,
                fontSize: t.fontSize.sm,
              }}>{field === 'title' ? '名称' : 'Tag'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {importedSyncError && !isGlobalSearch && !isOnlineSearch && (
        <Text style={{ color: t.colors.textHint, fontSize: t.fontSize.xs, textAlign: 'center', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm }}>
          外部收藏来源同步失败，仍显示上次同步目录：{importedSyncError}
        </Text>
      )}

      {isOnlineSearch ? (
        !onlineHasSearched && onlineLoading ? (
          <Loading />
        ) : onlineError && !onlineHasSearched ? (
          <ErrorView message={onlineError} onRetry={() => runOnlineSearch(1)} />
        ) : !onlineHasSearched ? (
          <Empty title="搜索 B 站视频" hint="输入视频名称或 tag，再点击搜索按钮" />
        ) : (
          <FlatList
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            data={onlineResults}
            keyExtractor={item => item.bvid}
            removeClippedSubviews
            maxToRenderPerBatch={10}
            windowSize={5}
            initialNumToRender={10}
            ItemSeparatorComponent={() => <View style={{height: t.spacing.md}} />}
            ListHeaderComponent={onlineError ? (
              <Text style={{color: t.colors.error, fontSize: t.fontSize.sm, marginBottom: t.spacing.sm}}>
                {onlineError}
              </Text>
            ) : null}
            ListEmptyComponent={(
              <View style={{alignItems: 'center', paddingVertical: t.spacing.xl}}>
                <Text style={{color: t.colors.textHint, fontSize: t.fontSize.base}}>
                  这一页没有匹配的{onlineFilter === 'title' ? '名称' : 'tag'}结果
                </Text>
                {onlineHasMore && (
                  <Button
                    title="继续搜索后续结果"
                    variant="text"
                    onPress={() => runOnlineSearch(onlineSearchPage + 1)}
                    loading={onlineLoading}
                  />
                )}
              </View>
            )}
            ListFooterComponent={onlineResults.length > 0 ? (
              <View style={{paddingVertical: t.spacing.md, alignItems: 'center'}}>
                {onlineHasMore ? (
                  <Button
                    title="加载更多"
                    variant="secondary"
                    onPress={() => runOnlineSearch(onlineSearchPage + 1)}
                    loading={onlineLoading}
                    style={{height: 40}}
                  />
                ) : (
                  <Text style={{color: t.colors.textHint, fontSize: t.fontSize.xs}}>到底了</Text>
                )}
              </View>
            ) : null}
            renderItem={({item}) => (
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: t.spacing.sm,
                paddingHorizontal: t.spacing.md,
                backgroundColor: t.colors.surface,
                borderRadius: t.radius.lg,
              }}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={{flex: 1, flexDirection: 'row', alignItems: 'center'}}
                  onPress={async () => {
                    try {
                      const queueVideos = onlineResults
                        .slice(0, 100)
                        .map(searchVideoToFavoriteVideo);
                      setQueue(queueVideos, item.bvid);
                      usePlayerStore.getState().setResolving(true);
                      useProgressStore.getState().resetProgress();
                      prefetchAudioUrl(item.bvid).catch(() => {});
                      const version = await loadQueue(queueVideos, item.bvid);
                      await playWithIntent();
                      resolveCurrentTrack(version).catch(() => {});
                      navigation.navigate('Player');
                    } catch (playError) {
                      const message = playError instanceof Error ? playError.message : '播放失败';
                      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
                      else Alert.alert('播放错误', message);
                      usePlayerStore.getState().setResolving(false);
                    }
                  }}
                >
                  <View>
                    <FastImage
                      source={{uri: item.cover}}
                      style={{width: 104, height: 66, borderRadius: 8, backgroundColor: t.colors.surfaceHigh}}
                      resizeMode={FastImage.resizeMode.cover}
                    />
                    <View style={{
                      position: 'absolute',
                      bottom: 4,
                      right: 4,
                      backgroundColor: 'rgba(0,0,0,0.6)',
                      paddingHorizontal: 4,
                      paddingVertical: 2,
                      borderRadius: 4,
                    }}>
                      <Text style={{color: '#fff', fontSize: 10}}>{formatDuration(item.duration)}</Text>
                    </View>
                  </View>
                  <View style={{flex: 1, marginLeft: t.spacing.md}}>
                    <Text
                      style={{fontSize: t.fontSize.base, color: t.colors.text, fontWeight: '500'}}
                      numberOfLines={2}
                    >{item.title}</Text>
                    <Text
                      style={{fontSize: t.fontSize.sm, color: t.colors.textHint, marginTop: t.spacing.xs}}
                      numberOfLines={1}
                    >{item.author}</Text>
                    <Text
                      style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 3}}
                      numberOfLines={1}
                    >{item.tags.slice(0, 3).join(' · ') || '暂无 tag'}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`收藏 ${item.title}`}
                  onPress={() => openFavoriteTargetPicker(item)}
                  style={{padding: t.spacing.sm, marginLeft: t.spacing.xs}}
                >
                  <Icon name="folder-heart-outline" size={25} color={t.colors.primary} />
                </TouchableOpacity>
              </View>
            )}
          />
        )
      ) : playlistItems === null && !error ? (
        <Loading />
      ) : error && playlistItems === null ? (
        <ErrorView message={error} onRetry={() => load(true)} />
      ) : !isGlobalSearch && playlistItems!.length === 0 ? (
        <Empty
          title="没有可见的收藏夹"
          hint="可在设置 > 可见收藏夹偏好中选择自有收藏夹、他人收藏夹或订阅合集"
        />
      ) : isGlobalSearch && filteredVideos.length === 0 ? (
        <Empty
          title="没有匹配的歌曲"
          hint="尝试更换搜索词或搜索模式"
        />
      ) : isGlobalSearch ? (
        <FlatList
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          data={filteredVideos}
          keyExtractor={(it) => it.bvid}
          // ========== 性能优化参数 ==========
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
          getItemLayout={(_data, index) => ({
            length: 96,
            offset: 96 * index,
            index,
          })}
          // =================================
          ItemSeparatorComponent={() => <View style={{ height: t.spacing.md }} />}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                paddingVertical: t.spacing.sm,
                paddingHorizontal: t.spacing.lg,
                backgroundColor: t.colors.surface,
                borderRadius: t.radius.lg,
              }}
              onPress={async () => {
                const video = filteredVideos[index];
                if (!video) return;
                try {
                  const MAX_QUEUE = 100;
                  const queueVideos = filteredVideos.length > MAX_QUEUE
                    ? filteredVideos.slice(0, MAX_QUEUE)
                    : filteredVideos;
                  setQueue(queueVideos, video.bvid);
                  // 【P0防闪烁优化】跳转前清空旧播放上下文
                  usePlayerStore.getState().setResolving(true);
                  useProgressStore.getState().resetProgress();
                  prefetchAudioUrl(video.bvid, video.parts?.[0]?.cid).catch(() => {});
                  const version = await loadQueue(queueVideos, video.bvid);
                  await playWithIntent();
                  resolveCurrentTrack(version).catch(() => {});
                  navigation.navigate('Player');
                } catch (e: any) {
                  const msg = e.message || '播放失败';
                  if (Platform.OS === 'android') {
                    ToastAndroid.show(msg, ToastAndroid.SHORT);
                  } else {
                    Alert.alert('播放错误', msg);
                  }
                  usePlayerStore.getState().setResolving(false);
                }
              }}
            >
              <View>
                <FastImage
                  source={{ uri: item.cover }}
                  style={{
                    width: 120,
                    height: 75,
                    borderRadius: 8,
                    backgroundColor: t.colors.surfaceHigh,
                  }}
                  resizeMode={FastImage.resizeMode.cover}
                />
                <View
                  style={{
                    position: 'absolute',
                    bottom: 4,
                    right: 4,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    paddingHorizontal: 4,
                    paddingVertical: 2,
                    borderRadius: 4,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 10 }}>
                    {formatDuration(item.duration)}
                  </Text>
                </View>
              </View>
              <View style={{ flex: 1, marginLeft: t.spacing.md, justifyContent: 'center' }}>
                <Text
                  style={{
                    fontSize: t.fontSize.base,
                    color: t.colors.text,
                    fontWeight: '500',
                    marginBottom: t.spacing.xs,
                  }}
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Icon name="account-outline" size={14} color={t.colors.textHint} />
                  <Text
                    style={{
                      fontSize: t.fontSize.sm,
                      color: t.colors.textHint,
                      marginLeft: 2,
                      flex: 1,
                    }}
                    numberOfLines={1}
                  >
                    {item.upper?.name || '未知作者'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          data={playlistItems}
          // ========== 性能优化参数 ==========
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
          getItemLayout={(_data, index) => ({
            length: 72,
            offset: 72 * index,
            index,
          })}
          // =================================
          ListHeaderComponent={
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: t.spacing.md,
              }}
            >
              {/* 随机播放全部 */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center' }}
                onPress={handleRandomPlayAll}
              >
                <Icon name="play-circle" size={28} color={t.colors.text} />
                <Text
                  style={{
                    marginLeft: t.spacing.sm,
                    fontSize: t.fontSize.lg,
                    color: t.colors.text,
                    fontWeight: '500',
                  }}
                >
                  全局随机播放
                </Text>
              </TouchableOpacity>

              {/* 右侧按钮组 */}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {/* 设置按钮已在右上角保留，此处已移除 */}
                <IconButton
                  name={isMultiSelectMode ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={24}
                  color={t.colors.text}
                  style={{ marginLeft: t.spacing.sm }}
                  onPress={() => {
                    if (isMultiSelectMode) {
                      setIsMultiSelectMode(false);
                      clear();
                    } else {
                      setIsMultiSelectMode(true);
                    }
                  }}
                />
              </View>
            </View>
          }
          keyExtractor={(it) => it.sourceKey}
          ItemSeparatorComponent={() => (
            <View style={{ height: t.spacing.md }} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.colors.primary}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.7}
              disabled={isMultiSelectMode && item.origin !== 'owned'}
              onPress={() => {
                if (isMultiSelectMode) {
                  if (item.origin === 'owned') toggle(item.id);
                } else {
                  if (item.origin === 'owned') {
                    navigation.navigate('Videos', {
                      mediaId: item.id,
                      title: item.title,
                    });
                  } else if (item.source) {
                    navigation.navigate('Videos', {source: item.source});
                  }
                }
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: t.spacing.md,
                paddingHorizontal: t.spacing.lg,
                backgroundColor: t.colors.surface,
                borderRadius: t.radius.lg,
                borderWidth: isGlass ? 0.5 : 0,
                borderColor: isGlass ? (t.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.6)') : 'transparent',
                ...Platform.select({
                  ios: {
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: isGlass ? 1 : 2 },
                    shadowOpacity: isGlass ? 0.04 : 0.08,
                    shadowRadius: isGlass ? 4 : 8,
                  },
                  android: { elevation: isGlass ? 0 : 3 },
                }),
              }}
            >
              {isMultiSelectMode && item.origin === 'owned' && (
                <View style={{ padding: 6 }}>
                  <Icon
                    name={selectedIds.has(item.id) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={24}
                    color={t.colors.text}
                  />
                </View>
              )}
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: t.radius.md,
                  backgroundColor: t.colors.primaryLight,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: t.spacing.md,
                }}
              >
                <Icon
                  name={item.origin === 'subscribedSeason' ? 'view-grid-outline' : item.origin === 'collectedFavorite' ? 'folder-heart-outline' : 'folder-music-outline'}
                  size={22}
                  color={t.colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text
                    style={{ flex: 1, fontSize: t.fontSize.md, color: t.colors.text, fontWeight: '500' }}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <View style={{ borderWidth: 1, borderColor: t.colors.primary, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginLeft: t.spacing.sm }}>
                    <Text style={{ color: t.colors.primary, fontSize: t.fontSize.xs }}>
                      {item.origin === 'owned' ? '我的收藏夹' : item.origin === 'collectedFavorite' ? '他人收藏夹' : '订阅合集'}
                    </Text>
                  </View>
                </View>
                <Text
                  style={{ fontSize: t.fontSize.sm, color: t.colors.textSub, marginTop: 2 }}
                  numberOfLines={1}
                >
                  {item.ownerName ? `${item.ownerName} · ` : ''}{item.mediaCount} 个视频
                </Text>
              </View>
              {!isMultiSelectMode && (
                <Icon name="chevron-right" size={22} color={t.colors.textHint} />
              )}
            </TouchableOpacity>
          )}
        />
      )}
      {/* Mix Play Bar */}
      {selectedIds.size > 0 && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: t.spacing.md,
            backgroundColor: t.colors.surface,
            borderTopWidth: 1,
            borderColor: t.colors.divider,
          }}
        >
          <Button
            title="混合播放"
            onPress={async () => {
              try {
                const ids = Array.from(selectedIds);
                // 从选中的收藏夹中随机获取视频
                const results = await Promise.all(
                  ids.map(id => favoriteService.getRandomVideos(id.toString(), 50))
                );
                let allVideos = results.flat();
                
                // 再次打乱混合后的结果
                const shuffled = allVideos.sort(() => Math.random() - 0.5);

                if (shuffled.length === 0) {
                   throw new Error('选中的收藏夹为空');
                }

                // Append to queue and start playback
                await tpAppendQueue(shuffled);
                await playWithIntent();
                clear();

                if (Platform.OS === 'android') {
                  ToastAndroid.show('已开始混合播放', ToastAndroid.SHORT);
                } else {
                  Alert.alert('提示', '已开始混合播放');
                }
              } catch (e: any) {
                const msg = e.message || '混合播放失败';
                if (Platform.OS === 'android') {
                  ToastAndroid.show(msg, ToastAndroid.SHORT);
                } else {
                  Alert.alert('错误', msg);
                }
              }
            }}
          />
          <IconButton
            name="close"
            size={24}
            color={t.colors.text}
            onPress={clear}
          />
        </View>
      )}
      <Modal
        visible={favoritePickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!favoriteWriteLoading && !createFolderLoading) {
            setFavoritePickerVisible(false);
            setSelectedOnlineVideo(null);
          }
        }}
      >
        <View style={{flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)'}}>
          <View style={{
            maxHeight: '88%',
            padding: t.spacing.lg,
            paddingBottom: Math.max(insets.bottom, t.spacing.lg),
            backgroundColor: t.colors.surface,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
          }}>
            <Text style={{fontSize: t.fontSize.lg, color: t.colors.text, fontWeight: '600'}}>
              收藏到 B 站收藏夹
            </Text>
            <Text
              style={{fontSize: t.fontSize.sm, color: t.colors.textSub, marginTop: t.spacing.xs}}
              numberOfLines={2}
            >{selectedOnlineVideo?.title}</Text>
            <Text style={{fontSize: t.fontSize.sm, color: t.colors.textHint, marginTop: t.spacing.md}}>
              勾选一个或多个自有收藏夹
            </Text>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{maxHeight: 240, marginTop: t.spacing.sm}}
            >
              {favoriteTargetsLoading ? (
                <ActivityIndicator color={t.colors.primary} style={{padding: t.spacing.lg}} />
              ) : favoriteTargetFolders.length === 0 ? (
                <Text style={{color: t.colors.textHint, fontSize: t.fontSize.sm, paddingVertical: t.spacing.md}}>
                  当前账号没有可用的自有收藏夹，可新建一个。
                </Text>
              ) : favoriteTargetFolders.map(folder => {
                const checked = selectedFavoriteTargetIds.includes(folder.id);
                return (
                  <TouchableOpacity
                    key={folder.id}
                    disabled={favoriteWriteLoading || favoriteTargetsLoading}
                    onPress={() =>
                      setSelectedFavoriteTargetIds(previous =>
                        previous.includes(folder.id)
                          ? previous.filter(id => id !== folder.id)
                          : [...previous, folder.id],
                      )
                    }
                    style={{
                      minHeight: 48,
                      flexDirection: 'row',
                      alignItems: 'center',
                      borderBottomWidth: 1,
                      borderBottomColor: t.colors.divider,
                    }}
                  >
                    <Icon
                      name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={22}
                      color={checked ? t.colors.primary : t.colors.textHint}
                    />
                    <Text
                      style={{
                        flex: 1,
                        color: t.colors.text,
                        fontSize: t.fontSize.base,
                        marginLeft: t.spacing.md,
                      }}
                      numberOfLines={1}
                    >
                      {folder.title}
                    </Text>
                    <Text style={{color: t.colors.textHint, fontSize: t.fontSize.xs}}>
                      {folder.mediaCount}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Button
              title={creatingFolder ? '取消新建' : '＋ 新建收藏夹'}
              variant="text"
              disabled={favoriteWriteLoading || createFolderLoading}
              onPress={() => {
                setCreatingFolder(value => !value);
                setFavoriteError(null);
              }}
              style={{alignSelf: 'flex-start', marginTop: t.spacing.xs}}
            />
            {creatingFolder && (
              <View style={{marginBottom: t.spacing.sm}}>
                <TextInput
                  value={newFolderTitle}
                  onChangeText={setNewFolderTitle}
                  placeholder="收藏夹名称"
                  placeholderTextColor={t.colors.textHint}
                  style={{
                    minHeight: 44,
                    paddingHorizontal: t.spacing.md,
                    color: t.colors.text,
                    backgroundColor: t.colors.surfaceHigh,
                    borderRadius: t.radius.md,
                  }}
                />
                <TouchableOpacity
                  onPress={() => setNewFolderIsPrivate(value => !value)}
                  style={{flexDirection: 'row', alignItems: 'center', paddingVertical: t.spacing.sm}}
                >
                  <Icon
                    name={newFolderIsPrivate ? 'lock-outline' : 'earth'}
                    size={18}
                    color={t.colors.primary}
                  />
                  <Text style={{color: t.colors.text, fontSize: t.fontSize.sm, marginLeft: t.spacing.xs}}>
                    新建为{newFolderIsPrivate ? '私密' : '公开'}收藏夹（点按切换）
                  </Text>
                </TouchableOpacity>
                <Button
                  title="创建并选中"
                  variant="secondary"
                  onPress={handleCreateFavoriteFolder}
                  disabled={!newFolderTitle.trim() || favoriteWriteLoading}
                  loading={createFolderLoading}
                  style={{height: 40}}
                />
              </View>
            )}
            {favoriteError && (
              <Text style={{color: t.colors.error, fontSize: t.fontSize.sm, marginVertical: t.spacing.xs}}>
                {favoriteError}
              </Text>
            )}
            <Button
              title={`收藏到所选收藏夹（${selectedFavoriteTargetIds.length}）`}
              onPress={handleAddOnlineVideoToFavorites}
              disabled={favoriteTargetsLoading || createFolderLoading || selectedFavoriteTargetIds.length === 0}
              loading={favoriteWriteLoading}
              style={{height: 44, marginTop: t.spacing.sm}}
            />
            <Button
              title="关闭"
              variant="secondary"
              onPress={() => {
                setFavoritePickerVisible(false);
                setSelectedOnlineVideo(null);
              }}
              disabled={favoriteWriteLoading || createFolderLoading}
              style={{height: 40, marginTop: t.spacing.sm}}
            />
          </View>
        </View>
      </Modal>
      <MiniPlayer />
    </View>
  );
};
