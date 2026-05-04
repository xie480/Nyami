import React, { useEffect, useState, useCallback, useRef } from 'react';
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
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import TrackPlayer from 'react-native-track-player';
import { IconButton } from '../components/IconButton';
import { SafeAreaView, StatusBar } from 'react-native';
import { Header } from '../components/Header';
import { Loading } from '../components/Loading';
import { Empty } from '../components/Empty';
import { ErrorView } from '../components/ErrorView';
import { MiniPlayer } from '../components/MiniPlayer';
import { Button } from '../components/Button';
import { favoriteService } from '../services';
import { loadQueue } from '../services/trackPlayer';
import { usePlayerStore } from '../store/playerStore';
import { formatDuration } from '../utils/format';
import { useTheme } from '../theme';
import { useSyncStore } from '../store/syncStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FavoriteVideo } from '../types/domain';

export const VideosScreen = ({ route, navigation }: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { mediaId, title } = route.params;
  const setQueue = usePlayerStore((s) => s.setQueue);
  const insertNext = usePlayerStore((s) => s.insertNext);
  // pagination refs
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const listRef = useRef<FavoriteVideo[]>([]);

  const [list, setList] = useState<FavoriteVideo[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initing, setIniting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<FavoriteVideo | null>(null);

  // 新增搜索和排序状态
  const [searchQuery, setSearchQuery] = useState('');
  // 定义排序枚举
  enum SortOption {
    TitleAsc = 'title_asc',
    TitleDesc = 'title_desc',
    DurationAsc = 'duration_asc',
    DurationDesc = 'duration_desc',
    FavoriteTimeAsc = 'favtime_asc',
    FavoriteTimeDesc = 'favtime_desc',
  }
  const [sortOption, setSortOption] = useState<SortOption>(SortOption.FavoriteTimeDesc);
  const [sortModalVisible, setSortModalVisible] = useState(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const globalIndex = favoriteService.getGlobalIndex();
      if (globalIndex.length > 0) {
        const folderVideos = globalIndex.filter(v => v.folderIds?.includes(mediaId));
        if (folderVideos.length > 0) {
          if (pageRef.current === 1) {
            setList(folderVideos);
            listRef.current = folderVideos;
            setHasMore(false);
            hasMoreRef.current = false;
          }
          setError(null);
          setLoading(false);
          loadingRef.current = false;
          setIniting(false);
          return;
        }
      }

      const r = await favoriteService.getVideos(mediaId, pageRef.current);
      const newList = [...listRef.current, ...r.list];
      setList(newList);
      listRef.current = newList;
      setHasMore(r.hasMore);
      hasMoreRef.current = r.hasMore;
      pageRef.current += 1;
      setPage(pageRef.current);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      loadingRef.current = false;
      setIniting(false);
    }
  }, [mediaId]);

  // Reset pagination when mediaId changes
  useEffect(() => {
    setList([]);
    setPage(1);
    setHasMore(true);
    setLoading(false);
    setIniting(true);
    setError(null);
    pageRef.current = 1;
    hasMoreRef.current = true;
    loadingRef.current = false;
    listRef.current = [];
    loadMore();
  }, [mediaId]);

  const ensureAllLoaded = async () => {
    while (hasMoreRef.current) {
      await loadMore();
    }
  };

  const playFrom = async (idx: number) => {
    try {
      const target = list[idx];
      setQueue(list, target.bvid);
      await loadQueue(list, target.bvid);
      await TrackPlayer.play();
      navigation.navigate('Player');
    } catch (e: any) {
      const msg = e.message || '播放失败';
      if (Platform.OS === 'android') {
        ToastAndroid.show(msg, ToastAndroid.SHORT);
      } else {
        Alert.alert('播放错误', msg);
      }
    }
  };

  const playAll = async () => {
    try {
      if (hasMoreRef.current) await ensureAllLoaded();
      await playFrom(0);
    } catch (e: any) {
      const msg = e.message || '播放全部失败';
      if (Platform.OS === 'android') {
        ToastAndroid.show(msg, ToastAndroid.SHORT);
      } else {
        Alert.alert('播放错误', msg);
      }
    }
  };

  const shuffle = async () => {
    try {
      if (hasMoreRef.current) await ensureAllLoaded();
      const shuffled = [...list].sort(() => Math.random() - 0.5);
      setList(shuffled);
      listRef.current = shuffled;
      await playFrom(0);
    } catch (e: any) {
      const msg = e.message || '随机播放失败';
      if (Platform.OS === 'android') {
        ToastAndroid.show(msg, ToastAndroid.SHORT);
      } else {
        Alert.alert('播放错误', msg);
      }
    }
  };

  // Filtering and sorting for display
  const filteredList = list.filter(v => v.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const displayedList = (() => {
    switch (sortOption) {
      case SortOption.TitleAsc:
        return [...filteredList].sort((a, b) => a.title.localeCompare(b.title));
      case SortOption.TitleDesc:
        return [...filteredList].sort((a, b) => b.title.localeCompare(a.title));
      case SortOption.DurationAsc:
        return [...filteredList].sort((a, b) => a.duration - b.duration);
      case SortOption.DurationDesc:
        return [...filteredList].sort((a, b) => b.duration - a.duration);
      case SortOption.FavoriteTimeAsc:
        return [...filteredList].reverse(); // 逆序得到时间正序
      case SortOption.FavoriteTimeDesc:
      default:
        return filteredList; // 原始顺序即收藏时间逆序
    }
  })();

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    actions: {
      flexDirection: 'row',
      padding: t.spacing.lg,
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
      backgroundColor: t.colors.background,
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
    <SafeAreaView style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <Header title={`${title} (${list.length})`} showBack />
      {/* 搜索 + 排序栏 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md }}>
        <View style={[s.searchBar, { flex: 1 }]}>
          <Icon name="magnify" size={20} color={t.colors.textHint} />
          <TextInput
            style={{ flex: 1, marginLeft: t.spacing.sm, color: t.colors.text, fontSize: t.fontSize.base, padding: 0 }}
            placeholder="搜索收藏夹内歌曲"
            placeholderTextColor={t.colors.textHint}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        <IconButton name="sort-variant" size={24} color={t.colors.text} style={{ marginLeft: t.spacing.sm }} onPress={() => setSortModalVisible(true)} />
      </View>

      {initing ? (
        <Loading />
      ) : error && displayedList.length === 0 ? (
        <ErrorView message={error} onRetry={loadMore} />
      ) : displayedList.length === 0 ? (
        <Empty title="收藏夹是空的" />
      ) : (
        <FlatList
          data={displayedList}
          keyExtractor={(it) => it.bvid}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={s.actions}>
              <Button title="▶ 全部播放" onPress={playAll} style={s.actionBtn} />
              <Button title="🔀 随机播放" variant="secondary" onPress={shuffle} style={s.actionBtn} />
            </View>
          }
          renderItem={({ item, index }) => (
            <TouchableOpacity activeOpacity={0.7} style={s.item} onPress={() => playFrom(index)}>
              <FastImage source={{ uri: item.cover }} style={s.cover} />
              <View style={s.info}>
                <Text style={s.title} numberOfLines={2}>{item.title}</Text>
                <View style={s.meta}>
                  <Text style={s.upper} numberOfLines={1}>{item.upper.name}</Text>
                  <Text style={s.duration}>{formatDuration(item.duration)}</Text>
                </View>
              </View>
              <IconButton name="dots-vertical" size={24} color={t.colors.text}
                onPress={() => {
                  setSelectedVideo(item);
                  setModalVisible(true);
                }} />
            </TouchableOpacity>
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
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
            <Button title="标题正序" onPress={() => { setSortOption(SortOption.TitleAsc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm }} />
            <Button title="标题逆序" onPress={() => { setSortOption(SortOption.TitleDesc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm }} />
            <Button title="时长正序" onPress={() => { setSortOption(SortOption.DurationAsc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm }} />
            <Button title="时长逆序" onPress={() => { setSortOption(SortOption.DurationDesc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm }} />
            <Button title="收藏时间正序" onPress={() => { setSortOption(SortOption.FavoriteTimeAsc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm }} />
            <Button title="收藏时间逆序" onPress={() => { setSortOption(SortOption.FavoriteTimeDesc); setSortModalVisible(false); }} style={{ marginBottom: t.spacing.sm }} />
            <Button title="关闭" variant="secondary" onPress={() => setSortModalVisible(false)} />
          </View>
        </View>
      </Modal>
      <MiniPlayer />
    </SafeAreaView>
  );
};
