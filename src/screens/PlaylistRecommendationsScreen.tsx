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
import type {NativeScrollEvent, NativeSyntheticEvent} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {GlassView} from '../components/GlassView';
import {Header} from '../components/Header';
import {SubscribePlaylistButton} from '../components/SubscribePlaylistButton';
import {config} from '../config';
import {
  loadMoreRecommendedCollections,
  refreshRecommendedCollections,
} from '../services/homeRecommendationService';
import {useAuthStore} from '../store/authStore';
import {useRecommendationStore} from '../store/recommendationStore';
import {useTheme} from '../theme';
import type {CollectionRecommendation} from '../types/domain';

/** 展示首页个性化筛选出的外部收藏夹与合集，详情沿用现有视频列表路由。 */
export const PlaylistRecommendationsScreen = ({navigation}: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const uid = useAuthStore(state => state.userId);
  const feed = useRecommendationStore(state =>
    uid
      ? state.feedsByUid[uid] ?? state.getFeed(uid)
      : state.getFeed(''),
  );
  const [collections, setCollections] = useState(feed.collections);
  const [hasMore, setHasMore] = useState(
    feed.collectionsHasMore ?? feed.collections.length >= config.recommendations.homePlaylistLimit,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshingCollections, setRefreshingCollections] = useState(false);
  const [checkedNoNewCollections, setCheckedNoNewCollections] = useState(false);
  const loadingMoreRef = useRef(false);
  const refreshingCollectionsRef = useRef(false);
  const loadControllerRef = useRef<AbortController | null>(null);
  const hasScrolledListRef = useRef(false);
  const canRefreshAtEndRef = useRef(true);

  useEffect(() => {
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
    loadingMoreRef.current = false;
    refreshingCollectionsRef.current = false;
    setLoadingMore(false);
    setRefreshingCollections(false);
    setCheckedNoNewCollections(false);
    hasScrolledListRef.current = false;
    canRefreshAtEndRef.current = true;
    setCollections(feed.collections);
    setHasMore(
      feed.collectionsHasMore ?? feed.collections.length >= config.recommendations.homePlaylistLimit,
    );
  }, [uid, feed.updatedAt, feed.collections, feed.collectionsHasMore]);

  useEffect(() => () => {
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
  }, []);

  const refreshCollections = useCallback(async () => {
    if (!uid || refreshingCollectionsRef.current || loadingMoreRef.current) return;
    refreshingCollectionsRef.current = true;
    setRefreshingCollections(true);
    setCheckedNoNewCollections(false);
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    canRefreshAtEndRef.current = false;
    const controller = new AbortController();
    loadControllerRef.current = controller;
    try {
      const result = await refreshRecommendedCollections(
        uid,
        controller.signal,
        collections.map(source => source.sourceKey),
      );
      if (controller.signal.aborted || useAuthStore.getState().userId !== uid) return;
      const knownSourceKeys = new Set(collections.map(source => source.sourceKey));
      const nextCollections = result.collections.filter(source => {
        if (knownSourceKeys.has(source.sourceKey)) return false;
        knownSourceKeys.add(source.sourceKey);
        return true;
      });
      setCollections(current => {
        return nextCollections.length > 0 ? [...current, ...nextCollections] : current;
      });
      setCheckedNoNewCollections(nextCollections.length === 0 && !result.hasMore);
      setHasMore(result.hasMore);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '更新合集推荐失败';
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.SHORT);
        } else {
          Alert.alert('更新失败', message);
        }
      }
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
      }
      refreshingCollectionsRef.current = false;
      setRefreshingCollections(false);
    }
  }, [collections, uid]);

  const refreshAtEnd = useCallback(() => {
    if (!uid || refreshingCollectionsRef.current || loadingMoreRef.current) return;
    canRefreshAtEndRef.current = false;
    void refreshCollections();
  }, [refreshCollections, uid]);

  const handleListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
    if (contentOffset.y > 8) {
      hasScrolledListRef.current = true;
    }
    const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (distanceFromEnd > 120) {
      canRefreshAtEndRef.current = true;
      return;
    }
    if (
      hasScrolledListRef.current &&
      !hasMore &&
      canRefreshAtEndRef.current
    ) {
      refreshAtEnd();
    }
  }, [hasMore, refreshAtEnd]);

  const loadMore = useCallback(async () => {
    if (!uid || refreshingCollectionsRef.current || !hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setCheckedNoNewCollections(false);
    const controller = new AbortController();
    loadControllerRef.current = controller;
    try {
      const result = await loadMoreRecommendedCollections(
        uid,
        controller.signal,
        collections.map(source => source.sourceKey),
      );
      if (controller.signal.aborted || useAuthStore.getState().userId !== uid) return;

      const knownSourceKeys = new Set(collections.map(source => source.sourceKey));
      const nextCollections = result.collections.filter(source => {
        if (knownSourceKeys.has(source.sourceKey)) return false;
        knownSourceKeys.add(source.sourceKey);
        return true;
      });
      if (nextCollections.length > 0) {
        setCollections(current => [...current, ...nextCollections]);
      }
      setCheckedNoNewCollections(nextCollections.length === 0 && !result.hasMore);
      setHasMore(result.hasMore);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '加载合集推荐失败';
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
  }, [collections, hasMore, uid]);

  const handleEndReached = useCallback(() => {
    if (hasMore) {
      void loadMore();
      return;
    }
    if (hasScrolledListRef.current && canRefreshAtEndRef.current) {
      refreshAtEnd();
    }
  }, [hasMore, loadMore, refreshAtEnd]);

  const openSource = useCallback((source: CollectionRecommendation) => {
    navigation.navigate('Videos', {
      source,
      title: source.title,
      includeVideoParts: true,
    });
  }, [navigation]);

  const glassBackground = t.glass?.colors.glass.bg ?? t.colors.surface;
  const glassBorder = t.glass?.colors.glass.border ?? t.colors.divider;

  const renderCollection = useCallback(({item: source}: {item: CollectionRecommendation}) => (
    <View style={{marginBottom: t.spacing.md}}>
      <GlassView borderRadius={22} backgroundColor={glassBackground} borderColor={glassBorder} noShadow noBlur minimal>
        <View style={{flexDirection: 'row', padding: t.spacing.sm}}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`打开 ${source.title}`}
            activeOpacity={0.8}
            onPress={() => openSource(source)}>
            <View style={{width: 116, height: 128, borderRadius: 16, overflow: 'hidden', backgroundColor: t.colors.surfaceHigh}}>
              {source.cover ? (
                <FastImage source={{uri: source.cover}} style={{width: '100%', height: '100%'}} resizeMode={FastImage.resizeMode.cover} />
              ) : (
                <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
                  <Icon name="playlist-music" size={34} color={t.colors.primary} />
                </View>
              )}
              <View style={{position: 'absolute', bottom: 7, left: 7, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, backgroundColor: 'rgba(10,10,16,0.72)'}}>
                <Icon name="play" size={13} color="#fff" />
                <Text style={{fontSize: 10, color: '#fff', marginLeft: 3}}>{source.mediaCount}</Text>
              </View>
            </View>
          </TouchableOpacity>
          <View style={{flex: 1, minWidth: 0, marginLeft: t.spacing.md, paddingVertical: 3, justifyContent: 'space-between'}}>
            <View style={{flexDirection: 'row', alignItems: 'flex-start'}}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`打开 ${source.title}`}
                activeOpacity={0.8}
                onPress={() => openSource(source)}
                style={{flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start'}}>
                <Text style={{flex: 1, color: t.colors.text, fontSize: t.fontSize.base, lineHeight: 21, fontWeight: '700'}} numberOfLines={2}>
                  {source.title}
                </Text>
                <Icon name="chevron-right" size={21} color={t.colors.textHint} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity activeOpacity={0.8} onPress={() => openSource(source)}>
              <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 4}} numberOfLines={1}>
                {source.ownerName || 'B 站 UP 主'} · {source.kind === 'subscribedSeason' ? '订阅合集' : '他人收藏夹'}
              </Text>
              <Text style={{fontSize: t.fontSize.xs, lineHeight: 17, color: t.colors.textHint, marginTop: 5}} numberOfLines={3}>
                {source.description?.trim() || `B 站暂未提供简介 · 收录 ${source.mediaCount} 个视频`}
              </Text>
              <View style={{flexDirection: 'row', flexWrap: 'wrap', marginTop: 4}}>
                {source.matchedTags.slice(0, 3).map(tag => (
                  <View key={`${source.sourceKey}:${tag}`} style={{paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: t.colors.primaryLight, marginRight: 5, marginBottom: 3}}>
                    <Text style={{fontSize: 10, color: t.colors.primary}}>{tag}</Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
            <View style={{alignItems: 'flex-end', marginTop: t.spacing.xs}}>
              <SubscribePlaylistButton source={source} compact />
            </View>
          </View>
        </View>
      </GlassView>
    </View>
  ), [glassBackground, glassBorder, openSource, t.colors, t.fontSize, t.spacing]);

  const listHeader = (
    <View style={{paddingHorizontal: t.spacing.xs, marginBottom: t.spacing.md}}>
      <Text style={{fontSize: t.fontSize.xxl, lineHeight: 34, fontWeight: '800', color: t.colors.text}}>
        听见同好收藏的好歌
      </Text>
      <Text style={{fontSize: t.fontSize.sm, lineHeight: 21, color: t.colors.textSub, marginTop: 5}}>
        根据你的收藏画像，从已收藏的他人歌单与订阅合集中挑选。
      </Text>
      <View style={{flexDirection: 'row', alignItems: 'center', marginTop: t.spacing.md}}>
        <Icon name="creation" size={18} color={t.colors.primary} />
        <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginLeft: 6}}>
          {refreshingCollections ? '正在检查新合集…' : feed.updatedAt ? `推荐快照 · ${new Date(feed.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : '手动刷新可检查新合集'}
        </Text>
      </View>
      {feed.error && (
        <View style={{padding: t.spacing.md, borderRadius: 16, marginTop: t.spacing.md, backgroundColor: t.colors.error + '18'}}>
          <Text style={{fontSize: t.fontSize.xs, color: t.colors.error}}>{feed.error}</Text>
        </View>
      )}
    </View>
  );

  const listFooter = loadingMore ? (
    <View style={{flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: t.spacing.lg}}>
      <ActivityIndicator size="small" color={t.colors.primary} />
      <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub, marginLeft: t.spacing.sm}}>正在加载更多合集…</Text>
    </View>
  ) : hasMore && collections.length > 0 ? (
    <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, textAlign: 'center', paddingVertical: t.spacing.lg}}>继续下滑加载更多合集</Text>
  ) : collections.length > 0 ? (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="检查新的合集推荐"
      disabled={!uid || refreshingCollections}
      onPress={() => void refreshCollections()}
      style={{alignItems: 'center', paddingVertical: t.spacing.lg}}>
      <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, textAlign: 'center'}}>
        {refreshingCollections
          ? '正在检查新合集…'
          : checkedNoNewCollections
            ? '已检查当前来源 · 没有可追加的合集'
            : '已经到底了 · 点击检查新合集'}
      </Text>
    </TouchableOpacity>
  ) : null;

  return (
    <View style={{flex: 1, backgroundColor: t.glass ? 'transparent' : t.colors.background}}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <Header
        title="为你推荐的合集"
        showBack
        noBorder
        right={(
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="手动刷新合集推荐"
            disabled={!uid || refreshingCollections || loadingMore}
            onPress={() => void refreshCollections()}
            style={{width: 42, alignItems: 'center', opacity: refreshingCollections || loadingMore ? 0.5 : 1}}>
            {refreshingCollections || loadingMore ? <ActivityIndicator size="small" color={t.colors.primary} /> : <Icon name="refresh" size={22} color={t.colors.primary} />}
          </TouchableOpacity>
        )}
      />
      <FlatList
        data={collections}
        keyExtractor={item => item.sourceKey}
        renderItem={renderCollection}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        contentContainerStyle={{paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, paddingBottom: Math.max(insets.bottom, t.spacing.xl), flexGrow: collections.length === 0 ? 1 : undefined}}
        refreshControl={(
          <RefreshControl
            refreshing={refreshingCollections}
            onRefresh={() => void refreshCollections()}
            tintColor={t.colors.primary}
          />
        )}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.8}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={(
          <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: t.spacing.xl}}>
            <Icon name="playlist-remove" size={38} color={t.colors.textHint} />
            <Text style={{fontSize: t.fontSize.base, color: t.colors.textSub, textAlign: 'center', marginTop: t.spacing.md}}>
              暂时没有可推荐的外部收藏夹或订阅合集
            </Text>
            <Text style={{fontSize: t.fontSize.xs, color: t.colors.textHint, textAlign: 'center', marginTop: t.spacing.xs}}>
              可先在 B 站收藏喜欢的他人歌单，再手动刷新。
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('VisibleFolders')} style={{marginTop: t.spacing.md}}>
              <Text style={{fontSize: t.fontSize.sm, color: t.colors.primary}}>管理首页播放列表偏好</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
};
