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
import {Header} from '../components/Header';
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

  useEffect(
    () => () => {
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
    },
    [],
  );

  const loadMore = useCallback(async () => {
    if (!uid || !hasMore || loadingMoreRef.current) {
      return;
    }
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
      if (controller.signal.aborted || useAuthStore.getState().userId !== uid) {
        return;
      }
      const knownBvids = new Set(songs.map(song => song.bvid));
      const nextSongs = result.recommendations.filter(song => {
        if (knownBvids.has(song.bvid)) {
          return false;
        }
        knownBvids.add(song.bvid);
        return true;
      });
      if (nextSongs.length > 0) {
        setSongs(current => [...current, ...nextSongs]);
      }
      setPage(nextPage);
      setHasMore(result.hasMore);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message =
          error instanceof Error ? error.message : '加载推荐歌曲失败';
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

  const startPlayback = useCallback(
    (selectedSong: TagRecommendation) => {
      const queue = songs.map(searchVideoToFavoriteVideo);
      if (queue.length === 0 || !uid) {
        return;
      }
      try {
        usePlayerStore.getState().setPlayMode('sequential');
        usePlayerStore.getState().setQueue(queue, selectedSong.bvid, {
          isPersonalized: true,
          recommendationPage: page,
          recommendationHasMore: hasMore,
        });
        usePlayerStore.getState().setResolving(true);
        useProgressStore.getState().resetProgress();
        const selectedIndex = queue.findIndex(
          song => song.bvid === selectedSong.bvid,
        );
        prefetchAudioUrl(selectedSong.bvid).catch(() => {});
        const previousSong =
          selectedIndex > 0 ? queue[selectedIndex - 1] : undefined;
        if (previousSong) {
          prefetchAudioUrl(
            previousSong.bvid,
            previousSong.parts?.[0]?.cid,
          ).catch(() => {});
        }
        navigation.navigate('Player');
        void (async () => {
          try {
            const revision = await loadQueue(queue, selectedSong.bvid);
            if (!revision) {
              throw new Error(
                usePlayerStore.getState().playbackError ||
                  '推荐歌曲暂时无法播放',
              );
            }
            resolveCurrentTrack(revision).catch(() => {});
          } catch (error) {
            usePlayerStore.getState().setResolving(false);
            const message =
              error instanceof Error ? error.message : '推荐歌曲暂时无法播放';
            Alert.alert('播放失败', message);
          }
        })();
      } catch (error) {
        usePlayerStore.getState().setResolving(false);
        const message =
          error instanceof Error ? error.message : '推荐歌曲暂时无法播放';
        Alert.alert('播放失败', message);
      }
    },
    [hasMore, navigation, page, songs, uid],
  );

  const renderSong = useCallback(
    ({item, index}: {item: TagRecommendation; index: number}) => (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`第 ${index + 1} 首，播放 ${item.title}，${
          item.author
        }`}
        activeOpacity={0.75}
        onPress={() => startPlayback(item)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: t.spacing.md,
          marginBottom: t.spacing.sm,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: t.colors.divider,
          backgroundColor: t.glass?.colors.glass.bg ?? t.colors.surface,
        }}>
        <FastImage
          source={{uri: item.cover}}
          style={{
            width: 60,
            height: 60,
            borderRadius: 12,
            backgroundColor: t.colors.surfaceHigh,
          }}
          resizeMode={FastImage.resizeMode.cover}
        />
        <View style={{flex: 1, minWidth: 0, marginHorizontal: t.spacing.md}}>
          <Text
            style={{
              fontSize: t.fontSize.base,
              lineHeight: 23,
              fontWeight: '600',
              color: t.colors.text,
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
            {[item.author, ...item.matchedTags.slice(0, 1)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Icon
          accessible={false}
          name="play-circle-outline"
          size={26}
          color={t.colors.primary}
        />
      </TouchableOpacity>
    ),
    [startPlayback, t.colors, t.fontSize, t.glass, t.spacing],
  );

  const listHeader = (
    <View style={{paddingTop: t.spacing.lg, paddingBottom: t.spacing.xl}}>
      <Text
        accessibilityRole="header"
        style={{
          fontSize: 28,
          lineHeight: 38,
          fontWeight: '700',
          color: t.colors.text,
        }}>
        此刻想听
      </Text>
      <Text
        style={{
          fontSize: t.fontSize.base,
          lineHeight: 24,
          color: t.colors.textSub,
          marginTop: t.spacing.sm,
        }}>
        从你的收藏与兴趣标签出发， 听见下一首喜欢。
      </Text>
      <Text
        accessibilityLiveRegion="polite"
        style={{
          fontSize: t.fontSize.sm,
          lineHeight: 21,
          color: t.colors.textSub,
          marginTop: t.spacing.md,
        }}>
        {refreshing
          ? '正在为你更新推荐…'
          : feed.updatedAt
          ? `更新于 ${new Date(feed.updatedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : '下拉刷新，获取音乐推荐'}
      </Text>
      {feed.failedSearchCount > 0 && (
        <Text
          style={{
            fontSize: t.fontSize.sm,
            lineHeight: 21,
            color: t.colors.textSub,
            marginTop: t.spacing.sm,
          }}>
          部分兴趣标签搜索失败，稍后下拉刷新可重试。
        </Text>
      )}
      {feed.error && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: t.spacing.sm,
            padding: t.spacing.md,
            borderWidth: 1,
            borderColor: t.colors.divider,
            borderRadius: 14,
            marginTop: t.spacing.lg,
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
              color: t.colors.text,
              fontSize: t.fontSize.sm,
              lineHeight: 22,
            }}>
            {feed.error}
          </Text>
        </View>
      )}
      {songs.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: t.spacing.md,
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: t.spacing.lg,
          }}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="播放全部推荐歌曲"
            activeOpacity={0.7}
            onPress={() => startPlayback(songs[0])}
            style={{
              minHeight: 48,
              paddingHorizontal: t.spacing.lg,
              paddingVertical: t.spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing.sm,
              borderRadius: 14,
              backgroundColor: t.colors.primary,
            }}>
            <Icon
              accessible={false}
              name="play"
              size={22}
              color={t.colors.onPrimary}
            />
            <Text
              style={{
                fontSize: t.fontSize.base,
                fontWeight: '600',
                color: t.colors.onPrimary,
              }}>
              播放推荐
            </Text>
          </TouchableOpacity>
          <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
            {songs.length} 首为你而选
          </Text>
        </View>
      )}
    </View>
  );

  const listFooter = loadingMore ? (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: t.spacing.sm,
        paddingVertical: t.spacing.lg,
      }}>
      <ActivityIndicator size="small" color={t.colors.primary} />
      <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
        正在加载更多歌曲…
      </Text>
    </View>
  ) : hasMore && songs.length > 0 ? (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.7}
      disabled={!uid || refreshing}
      onPress={() => loadMore()}
      style={{
        minHeight: 48,
        padding: t.spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: t.colors.divider,
        borderRadius: 14,
        marginTop: t.spacing.sm,
      }}>
      <Text
        style={{
          fontSize: t.fontSize.sm,
          fontWeight: '600',
          color: t.colors.primary,
        }}>
        加载更多推荐
      </Text>
    </TouchableOpacity>
  ) : songs.length > 0 ? (
    <Text
      style={{
        fontSize: t.fontSize.sm,
        color: t.colors.textSub,
        textAlign: 'center',
        paddingVertical: t.spacing.xl,
      }}>
      已显示全部推荐，下拉可更新
    </Text>
  ) : null;

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
      <Header
        title="歌曲推荐"
        showBack
        noBorder
        right={
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="刷新歌曲推荐"
            accessibilityState={{
              disabled: !uid || refreshing,
              busy: refreshing,
            }}
            activeOpacity={0.7}
            disabled={!uid || refreshing}
            onPress={() => refresh('manual')}
            style={{
              width: 48,
              height: 48,
              justifyContent: 'center',
              alignItems: 'center',
              opacity: !uid || refreshing ? 0.5 : 1,
            }}>
            {refreshing ? (
              <ActivityIndicator size="small" color={t.colors.primary} />
            ) : (
              <Icon
                accessible={false}
                name="refresh"
                size={22}
                color={t.colors.primary}
              />
            )}
          </TouchableOpacity>
        }
      />
      <FlatList
        style={{width: '100%', maxWidth: 880, alignSelf: 'center'}}
        data={songs}
        keyExtractor={item => item.bvid}
        renderItem={renderSong}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        contentContainerStyle={{
          paddingHorizontal: t.spacing.xl,
          paddingBottom: 24,
          flexGrow: songs.length === 0 ? 1 : undefined,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh('manual')}
            tintColor={t.colors.primary}
            colors={[t.colors.primary]}
          />
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={1.8}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              paddingVertical: t.spacing.xxl,
              paddingHorizontal: t.spacing.lg,
            }}>
            {refreshing ? (
              <ActivityIndicator color={t.colors.primary} />
            ) : (
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 24,
                  backgroundColor: t.colors.surfaceHigh,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Icon
                  accessible={false}
                  name="music-note-outline"
                  size={34}
                  color={t.colors.textSub}
                />
              </View>
            )}
            <Text
              style={{
                fontSize: t.fontSize.lg,
                lineHeight: 26,
                fontWeight: '600',
                color: t.colors.text,
                textAlign: 'center',
                marginTop: t.spacing.lg,
              }}>
              {refreshing
                ? '正在整理推荐歌曲…'
                : feed.error
                ? '推荐暂时没有加载成功'
                : '让推荐更懂你的喜好'}
            </Text>
            {!refreshing && (
              <>
                <Text
                  style={{
                    fontSize: t.fontSize.sm,
                    lineHeight: 22,
                    color: t.colors.textSub,
                    textAlign: 'center',
                    marginTop: t.spacing.sm,
                  }}>
                  {feed.error
                    ? '稍后重试，继续发现喜欢的音乐。'
                    : '同步收藏并读取兴趣标签，即可开始你的音乐推荐。'}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.7}
                  disabled={Boolean(feed.error) && !uid}
                  onPress={() =>
                    feed.error
                      ? refresh('manual')
                      : navigation.navigate('TagRecommendations')
                  }
                  style={{
                    minHeight: 48,
                    justifyContent: 'center',
                    paddingHorizontal: t.spacing.lg,
                    marginTop: t.spacing.lg,
                    borderRadius: 14,
                    backgroundColor: t.colors.primaryLight,
                  }}>
                  <Text
                    style={{
                      fontSize: t.fontSize.base,
                      fontWeight: '600',
                      color: t.colors.primary,
                    }}>
                    {feed.error ? '重新加载推荐' : '查看用户画像'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        }
      />
    </View>
  );
};
