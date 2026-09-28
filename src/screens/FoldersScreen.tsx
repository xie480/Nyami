import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
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
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSelectionStore } from '../store/selectionStore';
import { usePlayerStore } from '../store/playerStore';
import { useProgressStore } from '../store/progressStore';
import { IconButton } from '../components/IconButton';
import { Loading } from '../components/Loading';
import { Empty } from '../components/Empty';
import { ErrorView } from '../components/ErrorView';
import { Button } from '../components/Button';
import { favoriteService, loadGlobalIndexCache } from '../services/favoriteService';
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
  const [searchActive, setSearchActive] = useState(false);
  const [folderTab, setFolderTab] = useState<'all' | 'owned' | 'collected'>('all');
  const [createFolderVisible, setCreateFolderVisible] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
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

  const visiblePlaylistItems = playlistItems?.filter(item =>
    folderTab === 'all' ||
    (folderTab === 'owned' && item.origin === 'owned') ||
    (folderTab === 'collected' && item.origin !== 'owned'),
  ) ?? null;
  const ownedPlaylistCount = playlistItems?.filter(item => item.origin === 'owned').length ?? 0;
  const collectedPlaylistCount = playlistItems?.filter(item => item.origin !== 'owned').length ?? 0;

  const visibleGlobalIndex = favoriteService.getGlobalIndex(hiddenFolderIds, visibleSourceKeys);
  const searchableGlobalIndex = favoriteService.getGlobalIndex(
    [],
    importedCatalog.map(source => source.sourceKey),
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isGlobalSearch = searchActive && normalizedSearchQuery.length > 0;
  const isGlobalIndexEmpty = searchableGlobalIndex.length === 0;
  const isSearchDisabled = isSyncing || isGlobalIndexEmpty;
  const filteredVideos = useMemo(() => {
    if (!isGlobalSearch) {
      return [];
    }
    return searchableGlobalIndex.filter(video => {
      const relatedFolderNames = [
        ...(video.folderIds ?? []).map(folderId => allFolders?.find(folder => folder.id === folderId)?.title ?? ''),
        ...(video.sourceKeys ?? []).map(sourceKey => importedCatalog.find(source => source.sourceKey === sourceKey)?.title ?? ''),
      ];
      const searchableText = [video.title, video.upper?.name, ...relatedFolderNames].join(' ');
      return searchableText.toLowerCase().includes(normalizedSearchQuery);
    });
  }, [allFolders, importedCatalog, isGlobalSearch, normalizedSearchQuery, searchableGlobalIndex]);

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
      if (searchActive || searchQuery.length > 0) {
        setSearchQuery('');
        setSearchActive(false);
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [searchActive, searchQuery]);

  useEffect(() => {
    StatusBar.setBarStyle(t.isDark ? 'light-content' : 'dark-content');
    StatusBar.setTranslucent(true);
  }, [t.isDark]);

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

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
      setNewFolderTitle('');
      if (allFolders !== null) {
        setAllFolders(previous => previous
          ? [...previous.filter(item => item.id !== folder.id), folder]
          : [folder]);
      }
      setCreateFolderVisible(false);
      const message = '收藏夹已创建';
      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
      else Alert.alert('完成', message);
    } catch (createError) {
      setFavoriteError(createError instanceof Error ? createError.message : '新建收藏夹失败');
    } finally {
      setCreateFolderLoading(false);
    }
  };

  const openCreateFolder = () => {
    if (!uid) {
      Alert.alert('需要登录', '请先登录 B 站账号后再创建收藏夹');
      return;
    }
    setNewFolderTitle('');
    setFavoriteError(null);
    setCreateFolderVisible(true);
  };

  const cancelSearch = () => {
    setSearchQuery('');
    setSearchActive(false);
  };

  const statusBarHeight = Platform.OS === 'android' ? Math.max(insets.top, StatusBar.currentHeight ?? 0) : insets.top;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    list: {
      paddingHorizontal: t.spacing.lg,
      paddingTop: t.spacing.md,
      paddingBottom: insets.bottom + 136,
      gap: t.spacing.md,
    },
  });

  const handleRandomPlayAll = async () => {
    const shuffled = await favoriteService.getRandomVideos(undefined, 100, hiddenFolderIds, visibleSourceKeys);
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

  const folderTabs = !searchActive && playlistItems !== null ? (
    <View style={{paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md}}>
      <View style={{flexDirection: 'row', padding: 4, borderRadius: t.radius.full, backgroundColor: t.colors.surfaceHigh}}>
        {([
          {key: 'all', title: '全部', count: playlistItems.length},
          {key: 'owned', title: '我创建', count: ownedPlaylistCount},
          {key: 'collected', title: '我收藏', count: collectedPlaylistCount},
        ] as const).map(tab => {
          const selected = folderTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              accessibilityRole="button"
              accessibilityState={{selected}}
              onPress={() => setFolderTab(tab.key)}
              style={{flex: 1, minHeight: 40, borderRadius: t.radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? t.colors.primary : 'transparent'}}>
              <Text style={{color: selected ? t.colors.onPrimary : t.colors.textSub, fontSize: t.fontSize.sm, fontWeight: selected ? '600' : '400'}}>
                {tab.title} {tab.count}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  ) : null;

  return (
    // 【性能优化】collapsable=false 确保 Android 上屏幕容器不被 View 融合优化
    <View style={s.container} {...(Platform.OS === 'android' ? { collapsable: false as any } : {})}>
      <StatusBar
        barStyle={t.isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      {searchActive ? (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: t.spacing.lg,
          paddingTop: statusBarHeight + t.spacing.sm,
          paddingBottom: t.spacing.md,
        }}>
          <View style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 48,
            paddingHorizontal: t.spacing.md,
            borderRadius: t.radius.full,
            backgroundColor: t.colors.surfaceHigh,
            opacity: isSearchDisabled ? 0.65 : 1,
          }}>
            <Icon name="magnify" size={22} color={t.colors.textHint} />
            <TextInput
              autoFocus={searchActive}
              style={{flex: 1, marginLeft: t.spacing.sm, color: t.colors.text, fontSize: t.fontSize.base, padding: 0}}
              placeholder={isSyncing ? '索引同步中，暂不可搜索' : isGlobalIndexEmpty ? '全局索引为空，暂不可搜' : '搜索全收藏夹'}
              placeholderTextColor={t.colors.textHint}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              editable={!isSearchDisabled}
            />
            {searchQuery.length > 0 && (
              <IconButton
                name="close-circle"
                size={20}
                color={t.colors.textHint}
                onPress={() => setSearchQuery('')}
              />
            )}
          </View>
          <TouchableOpacity onPress={cancelSearch} style={{paddingLeft: t.spacing.md, paddingVertical: t.spacing.sm}}>
            <Text style={{fontSize: t.fontSize.base, color: t.colors.primary}}>取消</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: t.spacing.lg,
          paddingTop: statusBarHeight + t.spacing.sm,
          paddingBottom: t.spacing.sm,
        }}>
          <Text style={{fontSize: 27, fontWeight: '700', color: t.colors.text}}>收藏夹</Text>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <IconButton
              name="magnify"
              size={27}
              color={t.colors.text}
              onPress={() => setSearchActive(true)}
            />
            <IconButton
              name="plus"
              size={28}
              color={t.colors.text}
              style={{marginLeft: t.spacing.sm}}
              onPress={openCreateFolder}
            />
          </View>
        </View>
      )}

      {importedSyncError && !isGlobalSearch && (
        <Text style={{ color: t.colors.textHint, fontSize: t.fontSize.xs, textAlign: 'center', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm }}>
          外部收藏来源同步失败，仍显示上次同步目录：{importedSyncError}
        </Text>
      )}

      {folderTabs}

      {playlistItems === null && !error ? (
        <Loading />
      ) : error && playlistItems === null ? (
        <ErrorView message={error} onRetry={() => load(true)} />
      ) : searchActive && normalizedSearchQuery.length === 0 ? (
        <Empty title="搜索全收藏夹" hint="输入视频名称或 UP 主，查找本机已同步的收藏内容" />
      ) : !isGlobalSearch && visiblePlaylistItems!.length === 0 ? (
        <Empty
          title={folderTab === 'owned' ? '还没有自己创建的收藏夹' : folderTab === 'collected' ? '还没有收藏的合集' : '没有可见的收藏夹'}
          hint="可在设置的收藏夹偏好中选择要显示的来源"
        />
      ) : isGlobalSearch && filteredVideos.length === 0 ? (
        <Empty
          title="没有匹配的收藏内容"
          hint="尝试使用视频名称或 UP 主重新搜索"
        />
      ) : isGlobalSearch ? (
        <FlatList
          style={{flex: 1}}
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
            length: 108,
            offset: 108 * index,
            index,
          })}
          // =================================
          ListHeaderComponent={
            <View style={{paddingHorizontal: t.spacing.xs, paddingBottom: t.spacing.sm}}>
              <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
                共 <Text style={{color: t.colors.primary, fontWeight: '600'}}>{filteredVideos.length}</Text> 条收藏内容
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: t.spacing.md }} />}
          renderItem={({ item, index }) => {
            const folderTitle = item.folderIds
              ?.map(folderId => allFolders?.find(folder => folder.id === folderId)?.title)
              .find(Boolean);
            const sourceTitle = item.sourceKeys
              ?.map(sourceKey => importedCatalog.find(source => source.sourceKey === sourceKey)?.title)
              .find(Boolean);
            const collectionTitle = folderTitle || sourceTitle;
            return (
              <TouchableOpacity
                activeOpacity={0.72}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: t.spacing.sm,
                  paddingHorizontal: t.spacing.sm,
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
                    source={{uri: item.cover}}
                    style={{width: 122, height: 76, borderRadius: 12, backgroundColor: t.colors.surfaceHigh}}
                    resizeMode={FastImage.resizeMode.cover}
                  />
                  <View style={{position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.66)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 7}}>
                    <Text style={{color: '#fff', fontSize: 10}}>{formatDuration(item.duration)}</Text>
                  </View>
                </View>
                <View style={{flex: 1, marginLeft: t.spacing.md, justifyContent: 'center'}}>
                  <Text style={{fontSize: t.fontSize.base, color: t.colors.text, fontWeight: '600', marginBottom: t.spacing.xs}} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <View style={{flexDirection: 'row', alignItems: 'center'}}>
                    <Icon name="account-outline" size={14} color={t.colors.textHint} />
                    <Text style={{fontSize: t.fontSize.sm, color: t.colors.textHint, marginLeft: 3, flex: 1}} numberOfLines={1}>
                      {item.upper?.name || '未知 UP 主'}
                    </Text>
                  </View>
                  <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 4}} numberOfLines={1}>
                    {collectionTitle ? `收藏夹 · ${collectionTitle}` : '已同步收藏内容'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      ) : (
        <FlatList
          style={{flex: 1}}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          data={visiblePlaylistItems}
          // ========== 性能优化参数 ==========
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
          ListHeaderComponent={
            <View style={{marginBottom: t.spacing.xs}}>
              <View style={{flexDirection: 'row', alignItems: 'center', marginTop: t.spacing.md, padding: t.spacing.md, borderRadius: 22, backgroundColor: t.colors.primaryLight}}>
                <TouchableOpacity activeOpacity={0.75} onPress={handleRandomPlayAll} style={{flex: 1, flexDirection: 'row', alignItems: 'center'}}>
                  <View style={{width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.primary}}>
                    <Icon name="play" size={25} color={t.colors.onPrimary} />
                  </View>
                  <View style={{flex: 1, marginLeft: t.spacing.md}}>
                    <Text style={{fontSize: t.fontSize.md, color: t.colors.text, fontWeight: '600'}}>全局随机播放</Text>
                    <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub, marginTop: 3}}>{visibleGlobalIndex.length} 个已同步视频</Text>
                  </View>
                  <Icon name="shuffle-variant" size={24} color={t.colors.primary} />
                </TouchableOpacity>
                <IconButton
                  name={isMultiSelectMode ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={21}
                  color={t.colors.textSub}
                  style={{marginLeft: t.spacing.xs}}
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
          renderItem={({ item }) => {
            const coverUri = item.source?.cover || visibleGlobalIndex.find(video => video.folderIds?.includes(item.id))?.cover;
            const itemKind = item.origin === 'owned' ? '我创建' : item.origin === 'collectedFavorite' ? '他人收藏夹' : '订阅合集';
            return (
              <TouchableOpacity
                activeOpacity={0.72}
                disabled={isMultiSelectMode && item.origin !== 'owned'}
                onPress={() => {
                if (isMultiSelectMode) {
                  if (item.origin === 'owned') toggle(item.id);
                } else {
                  if (item.origin === 'owned') {
                    navigation.navigate('Videos', {
                      mediaId: item.id,
                      title: item.title,
                      mediaCount: item.mediaCount,
                      cover: coverUri,
                    });
                  } else if (item.source) {
                    navigation.navigate('Videos', {source: item.source});
                  }
                }
              }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: t.spacing.sm,
                  backgroundColor: t.colors.surface,
                  borderRadius: 20,
                  borderWidth: isGlass ? 0.5 : 0,
                  borderColor: isGlass ? (t.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.6)') : 'transparent',
                  ...Platform.select({
                    ios: {shadowColor: '#15122A', shadowOffset: {width: 0, height: 2}, shadowOpacity: isGlass ? 0.04 : 0.06, shadowRadius: 8},
                    android: {elevation: isGlass ? 0 : 2},
                  }),
                }}>
              {isMultiSelectMode && item.origin === 'owned' && (
                <View style={{ padding: 6 }}>
                  <Icon
                    name={selectedIds.has(item.id) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={24}
                    color={t.colors.text}
                  />
                </View>
              )}
              <View style={{width: 74, height: 74, borderRadius: 17, overflow: 'hidden', backgroundColor: t.colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: t.spacing.md}}>
                {coverUri ? (
                  <FastImage source={{uri: coverUri}} style={{width: '100%', height: '100%'}} resizeMode={FastImage.resizeMode.cover} />
                ) : (
                  <Icon name={item.origin === 'subscribedSeason' ? 'view-grid-outline' : item.origin === 'collectedFavorite' ? 'folder-heart-outline' : 'folder-music-outline'} size={29} color={t.colors.primary} />
                )}
              </View>
              <View style={{flex: 1, minHeight: 60, justifyContent: 'center'}}>
                <Text style={{fontSize: t.fontSize.md, color: t.colors.text, fontWeight: '600'}} numberOfLines={1}>{item.title}</Text>
                <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub, marginTop: 5}} numberOfLines={1}>
                  {item.ownerName ? `${item.ownerName} · ` : ''}{item.mediaCount} 个视频
                </Text>
                <Text style={{fontSize: t.fontSize.xs, color: t.colors.primary, marginTop: 4}} numberOfLines={1}>{itemKind}</Text>
              </View>
              {!isMultiSelectMode && (
                <Icon name="chevron-right" size={22} color={t.colors.textHint} />
              )}
              </TouchableOpacity>
            );
          }}
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
        visible={createFolderVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!createFolderLoading) {
            setCreateFolderVisible(false);
          }
        }}
      >
        <View style={{flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)'}}>
          <View style={{
            maxHeight: '80%',
            padding: t.spacing.lg,
            paddingBottom: Math.max(insets.bottom, t.spacing.lg),
            backgroundColor: t.colors.surface,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
          }}>
            <View style={{width: 40, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: t.colors.divider, marginBottom: t.spacing.md}} />
            <Text style={{fontSize: t.fontSize.lg, color: t.colors.text, fontWeight: '700'}}>新建收藏夹</Text>
            <TextInput
              value={newFolderTitle}
              onChangeText={setNewFolderTitle}
              placeholder="输入收藏夹名称"
              placeholderTextColor={t.colors.textHint}
              autoFocus
              style={{minHeight: 48, marginTop: t.spacing.lg, paddingHorizontal: t.spacing.md, color: t.colors.text, backgroundColor: t.colors.surfaceHigh, borderRadius: 16}}
            />
            <TouchableOpacity
              onPress={() => setNewFolderIsPrivate(value => !value)}
              style={{flexDirection: 'row', alignItems: 'center', paddingVertical: t.spacing.md}}>
              <Icon name={newFolderIsPrivate ? 'lock-outline' : 'earth'} size={19} color={t.colors.primary} />
              <Text style={{color: t.colors.text, fontSize: t.fontSize.sm, marginLeft: t.spacing.xs}}>
                {newFolderIsPrivate ? '私密收藏夹' : '公开收藏夹'} · 点按切换
              </Text>
            </TouchableOpacity>
            {favoriteError && (
              <Text style={{color: t.colors.error, fontSize: t.fontSize.sm, marginVertical: t.spacing.xs}}>
                {favoriteError}
              </Text>
            )}
            <Button
              title="创建收藏夹"
              onPress={handleCreateFavoriteFolder}
              disabled={!newFolderTitle.trim()}
              loading={createFolderLoading}
              style={{height: 48, marginTop: t.spacing.sm}}
            />
            <Button
              title="关闭"
              variant="secondary"
              onPress={() => setCreateFolderVisible(false)}
              disabled={createFolderLoading}
              style={{height: 40, marginTop: t.spacing.sm}}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};
