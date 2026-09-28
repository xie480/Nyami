import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StatusBar,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Header} from '../components/Header';
import {IconButton} from '../components/IconButton';
import {useHomeRecommendations} from '../hooks/useHomeRecommendations';
import {loadMorePersonalizedSongs} from '../services/homeRecommendationService';
import {prefetchAudioUrl} from '../services/dataPrefetcher';
import {loadQueue, resolveCurrentTrack} from '../services/trackPlayer';
import {searchVideoToFavoriteVideo} from '../services/transformers';
import {useAuthStore} from '../store/authStore';
import {usePlayerStore} from '../store/playerStore';
import {useProgressStore} from '../store/progressStore';
import {useTheme} from '../theme';
import type {TagRecommendation} from '../types/domain';

export const SongRecommendationsScreen = ({navigation}: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const {uid, feed, refreshing, refresh} = useHomeRecommendations();
  const [songs, setSongs] = useState<TagRecommendation[]>(feed.songs);
  const [page, setPage] = useState(feed.songPage);
  const [hasMore, setHasMore] = useState(feed.songHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const loadControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setSongs(feed.songs);
    setPage(feed.songPage);
    setHasMore(feed.songHasMore);
  }, [uid, feed.updatedAt, feed.songs, feed.songPage, feed.songHasMore]);

  useEffect(() => () => {
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
  }, []);

  const loadMore = useCallback(async () => {
    if (!uid || !hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const nextPage = page + 1;
    try {
      const result = await loadMorePersonalizedSongs(
        uid,
        nextPage,
        songs.map(song => song.bvid),
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        useAuthStore.getState().userId !== uid
      ) {
        return;
      }
      const knownBvids = new Set(songs.map(song => song.bvid));
      const nextSongs = result.recommendations.filter(song => {
        if (knownBvids.has(song.bvid)) return false;
        knownBvids.add(song.bvid);
        return true;
      });
      if (nextSongs.length > 0) setSongs(current => [...current, ...nextSongs]);
      setPage(nextPage);
      setHasMore(result.hasMore);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '加载推荐歌曲失败';
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.SHORT);
        } else {
          Alert.alert('加载失败', message);
        }
      }
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore, page, songs, uid]);

  const startPlayback = useCallback((selectedSong: TagRecommendation) => {
    const queue = songs.map(searchVideoToFavoriteVideo);
    if (queue.length === 0 || !uid) return;
    try {
      usePlayerStore.getState().setPlayMode('sequential');
      usePlayerStore.getState().setQueue(queue, selectedSong.bvid, {
        isPersonalized: true,
        recommendationPage: page,
        recommendationHasMore: hasMore,
      });
      usePlayerStore.getState().setResolving(true);
      useProgressStore.getState().resetProgress();
      const selectedIndex = queue.findIndex(song => song.bvid === selectedSong.bvid);
      prefetchAudioUrl(selectedSong.bvid).catch(() => {});
      const previousSong = selectedIndex > 0 ? queue[selectedIndex - 1] : undefined;
      if (previousSong) prefetchAudioUrl(previousSong.bvid, previousSong.parts?.[0]?.cid).catch(() => {});
      navigation.navigate('Player');
      void (async () => {
        try {
          const revision = await loadQueue(queue, selectedSong.bvid);
          if (!revision) {
            throw new Error(usePlayerStore.getState().playbackError || '推荐歌曲暂时无法播放');
          }
          resolveCurrentTrack(revision).catch(() => {});
        } catch (error) {
          usePlayerStore.getState().setResolving(false);
          const message = error instanceof Error ? error.message : '推荐歌曲暂时无法播放';
          Alert.alert('播放失败', message);
        }
      })();
    } catch (error) {
      usePlayerStore.getState().setResolving(false);
      const message = error instanceof Error ? error.message : '推荐歌曲暂时无法播放';
      Alert.alert('播放失败', message);
    }
  }, [hasMore, navigation, page, songs, uid]);

  const renderSong = useCallback(({item, index}: {item: TagRecommendation; index: number}) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`播放 ${item.title}`}
      activeOpacity={0.75}
      onPress={() => startPlayback(item)}
      style={{flexDirection: 'row', alignItems: 'center', paddingVertical: t.spacing.sm, borderBottomWidth: 1, borderBottomColor: t.colors.divider}}>
      <Text style={{width: 30, color: t.colors.textHint, fontSize: t.fontSize.xs, textAlign: 'center'}}>{index + 1}</Text>
      <FastImage
        source={{uri: item.cover}}
        style={{width: 58, height: 58, borderRadius: 12, marginHorizontal: t.spacing.sm, backgroundColor: t.colors.surfaceHigh}}
        resizeMode={FastImage.resizeMode.cover}
      />
      <View style={{flex: 1, marginRight: t.spacing.sm}}>
        <Text style={{fontSize: t.fontSize.sm, fontWeight: '600', color: t.colors.text}} numberOfLines={1}>{item.title}</Text>
        <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 4}} numberOfLines={1}>
          {item.author} · {item.matchedTags.slice(0, 2).join(' / ')}
        </Text>
      </View>
      <IconButton
        name="play-circle"
        size={30}
        color={t.colors.primary}
        accessibilityLabel={`播放 ${item.title}`}
        onPress={() => startPlayback(item)}
      />
    </TouchableOpacity>
  ), [startPlayback, t.colors, t.fontSize, t.spacing]);

  const listHeader = (
    <View style={{paddingVertical: t.spacing.md}}>
      <Text style={{fontSize: t.fontSize.xxl, fontWeight: '800', color: t.colors.text}}>按你的收藏画像推荐</Text>
      <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 5}}>
        {feed.updatedAt ? `推荐已更新 · ${new Date(feed.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : '推荐歌曲会根据收藏 tag 画像生成'}
      </Text>
      {feed.failedSearchCount > 0 && (
        <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, marginTop: 5}}>
          部分画像关键词搜索失败，可下拉刷新后重试。
        </Text>
      )}
    </View>
  );

  const listFooter = loadingMore ? (
    <View style={{flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: t.spacing.lg}}>
      <ActivityIndicator size="small" color={t.colors.primary} />
      <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginLeft: t.spacing.sm}}>正在加载更多歌曲…</Text>
    </View>
  ) : hasMore && songs.length > 0 ? (
    <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, textAlign: 'center', paddingVertical: t.spacing.lg}}>下滑列表加载更多推荐</Text>
  ) : songs.length > 0 ? (
    <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, textAlign: 'center', paddingVertical: t.spacing.lg}}>已经到底了</Text>
  ) : null;

  return (
    <View style={{flex: 1, backgroundColor: t.glass ? 'transparent' : t.colors.background}}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <Header
        title="歌曲推荐"
        showBack
        noBorder
        right={(
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="刷新歌曲推荐"
            disabled={!uid || refreshing}
            onPress={() => void refresh('manual')}
            style={{width: 42, alignItems: 'center', opacity: !uid || refreshing ? 0.5 : 1}}>
            {refreshing ? <ActivityIndicator size="small" color={t.colors.primary} /> : <Icon name="refresh" size={22} color={t.colors.primary} />}
          </TouchableOpacity>
        )}
      />
      <FlatList
        data={songs}
        keyExtractor={item => item.bvid}
        renderItem={renderSong}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        contentContainerStyle={{paddingHorizontal: t.spacing.lg, paddingBottom: Math.max(insets.bottom, t.spacing.xl), flexGrow: songs.length === 0 ? 1 : undefined}}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh('manual')}
            tintColor={t.colors.primary}
          />
        )}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={1.2}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={(
          <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: t.spacing.xl}}>
            <Icon name="music-note-off" size={36} color={t.colors.textHint} />
            <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub, textAlign: 'center', marginTop: t.spacing.md}}>
              {refreshing ? '正在整理推荐歌曲…' : '暂时没有推荐歌曲；同步收藏并补齐 tag 后可生成画像'}
            </Text>
          </View>
        )}
      />
    </View>
  );
};
