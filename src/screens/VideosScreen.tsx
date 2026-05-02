import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, FlatList, TouchableOpacity, Text, StyleSheet,
  ActivityIndicator,
  Alert, Platform, ToastAndroid,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import TrackPlayer from 'react-native-track-player';
import { IconButton } from '../components/IconButton';
import { SafeAreaView, StatusBar } from 'react-native';
import { Header } from '../components/Header';
// Removed duplicate import, already imported above
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FavoriteVideo } from '../types/domain';

export const VideosScreen = ({ route, navigation }: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { mediaId, title } = route.params;
  const setQueue = usePlayerStore((s) => s.setQueue);
  const insertNext = usePlayerStore((s) => s.insertNext);
  // Refs to keep pagination state up‑to‑date across closures
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

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const r = await favoriteService.getVideos(mediaId, pageRef.current);
      // Merge with existing list using ref to avoid stale closures
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

  // Reset pagination refs when mediaId changes
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

  // Ensure all pages are loaded before playing whole list
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

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    actions: {
      flexDirection: 'row', padding: t.spacing.lg, gap: t.spacing.md,
    },
    actionBtn: { flex: 1 },
    item: {
      flexDirection: 'row',
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.md,
    },
    cover: {
      width: 112, height: 70, borderRadius: t.radius.sm,
      backgroundColor: t.colors.surfaceHigh,
    },
    info: { flex: 1, marginLeft: t.spacing.md, justifyContent: 'space-between' },
    title: { fontSize: t.fontSize.base, color: t.colors.text },
    meta: { flexDirection: 'row', justifyContent: 'space-between' },
    upper: { fontSize: t.fontSize.xs, color: t.colors.textSub },
    duration: { fontSize: t.fontSize.xs, color: t.colors.textHint },
    footer: { padding: t.spacing.lg, alignItems: 'center' },
  });

  return (
    <SafeAreaView style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <Header title={`${title} (${list.length})`} showBack />
      {initing ? (
        <Loading />
      ) : error && list.length === 0 ? (
        <ErrorView message={error} onRetry={loadMore} />
      ) : list.length === 0 ? (
        <Empty title="收藏夹是空的" />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(it) => it.bvid}
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
                  insertNext(item);
                  const msg = '已添加至下一首播放';
                  if (Platform.OS === 'android') {
                    ToastAndroid.show(msg, ToastAndroid.SHORT);
                  } else {
                    Alert.alert('', msg);
                  }
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
      <MiniPlayer />
    </SafeAreaView>
  );
};
