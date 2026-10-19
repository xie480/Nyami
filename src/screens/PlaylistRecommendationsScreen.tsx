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
  useWindowDimensions,
} from 'react-native';
import type {NativeScrollEvent, NativeSyntheticEvent} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
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
import {useNetworkRecoveryRefresh} from '../hooks/useNetworkRecoveryRefresh';

/** 展示首页个性化筛选出的外部收藏夹与合集，详情沿用现有视频列表路由。 */
export const PlaylistRecommendationsScreen = ({navigation}: any) => {
  const t = useTheme();
  const {width, fontScale} = useWindowDimensions();
  const compact = width < 380 || fontScale > 1.2;
  const uid = useAuthStore(state => state.userId);
  const feed = useRecommendationStore(state =>
    uid ? state.feedsByUid[uid] ?? state.getFeed(uid) : state.getFeed(''),
  );
  const [collections, setCollections] = useState(feed.collections);
  const [hasMore, setHasMore] = useState(
    feed.collectionsHasMore ??
      feed.collections.length >= config.recommendations.homePlaylistLimit,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshingCollections, setRefreshingCollections] = useState(false);
  const [checkedNoNewCollections, setCheckedNoNewCollections] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
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
    setRefreshFailed(false);
    hasScrolledListRef.current = false;
    canRefreshAtEndRef.current = true;
    setCollections(feed.collections);
    setHasMore(
      feed.collectionsHasMore ??
        feed.collections.length >= config.recommendations.homePlaylistLimit,
    );
  }, [uid, feed.updatedAt, feed.collections, feed.collectionsHasMore]);

  useEffect(
    () => () => {
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
    },
    [],
  );

  const refreshCollections = useCallback(async () => {
    if (!uid || refreshingCollectionsRef.current || loadingMoreRef.current) {
      return;
    }
    refreshingCollectionsRef.current = true;
    setRefreshFailed(false);
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
      if (controller.signal.aborted || useAuthStore.getState().userId !== uid) {
        return;
      }
      setRefreshFailed(false);
      const knownSourceKeys = new Set(
        collections.map(source => source.sourceKey),
      );
      const nextCollections = result.collections.filter(source => {
        if (knownSourceKeys.has(source.sourceKey)) {
          return false;
        }
        knownSourceKeys.add(source.sourceKey);
        return true;
      });
      setCollections(current => {
        return nextCollections.length > 0
          ? [...current, ...nextCollections]
          : current;
      });
      setCheckedNoNewCollections(
        nextCollections.length === 0 && !result.hasMore,
      );
      setHasMore(result.hasMore);
    } catch (error) {
      if (!controller.signal.aborted) {
        setRefreshFailed(true);
        const message =
          error instanceof Error ? error.message : '更新合集推荐失败';
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

  useNetworkRecoveryRefresh(
    () => refreshCollections(),
    Boolean(uid && refreshFailed),
  );

  const refreshAtEnd = useCallback(() => {
    if (!uid || refreshingCollectionsRef.current || loadingMoreRef.current) {
      return;
    }
    canRefreshAtEndRef.current = false;
    void refreshCollections();
  }, [refreshCollections, uid]);

  const handleListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
      if (contentOffset.y > 8) {
        hasScrolledListRef.current = true;
      }
      const distanceFromEnd =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
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
    },
    [hasMore, refreshAtEnd],
  );

  const loadMore = useCallback(async () => {
    if (
      !uid ||
      refreshingCollectionsRef.current ||
      !hasMore ||
      loadingMoreRef.current
    ) {
      return;
    }
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
      if (controller.signal.aborted || useAuthStore.getState().userId !== uid) {
        return;
      }

      const knownSourceKeys = new Set(
        collections.map(source => source.sourceKey),
      );
      const nextCollections = result.collections.filter(source => {
        if (knownSourceKeys.has(source.sourceKey)) {
          return false;
        }
        knownSourceKeys.add(source.sourceKey);
        return true;
      });
      if (nextCollections.length > 0) {
        setCollections(current => [...current, ...nextCollections]);
      }
      setCheckedNoNewCollections(
        nextCollections.length === 0 && !result.hasMore,
      );
      setHasMore(result.hasMore);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message =
          error instanceof Error ? error.message : '加载合集推荐失败';
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

  const openSource = useCallback(
    (source: CollectionRecommendation) => {
      navigation.navigate('Videos', {
        source,
        title: source.title,
        includeVideoParts: true,
      });
    },
    [navigation],
  );

  const glassBackground = t.glass?.colors.glass.bg ?? t.colors.surface;
  const glassBorder = t.glass?.colors.glass.border ?? t.colors.divider;

  const renderCollection = useCallback(
    ({item: source}: {item: CollectionRecommendation}) => (
      <View style={{marginBottom: t.spacing.lg}}>
        <GlassView
          borderRadius={20}
          backgroundColor={glassBackground}
          borderColor={glassBorder}
          noShadow
          noBlur
          minimal>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`打开 ${source.title}，${source.mediaCount} 个视频`}
            activeOpacity={0.78}
            onPress={() => openSource(source)}
            style={{padding: t.spacing.lg}}>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <View
                style={{
                  width: compact ? 84 : 104,
                  height: compact ? 84 : 104,
                  borderRadius: 14,
                  overflow: 'hidden',
                  backgroundColor: t.colors.surfaceHigh,
                }}>
                {source.cover ? (
                  <FastImage
                    source={{uri: source.cover}}
                    style={{width: '100%', height: '100%'}}
                    resizeMode={FastImage.resizeMode.cover}
                  />
                ) : (
                  <View
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Icon
                      accessible={false}
                      name="playlist-music"
                      size={34}
                      color={t.colors.textSub}
                    />
                  </View>
                )}
              </View>
              <View style={{flex: 1, minWidth: 0, marginLeft: t.spacing.md}}>
                <Text
                  style={{
                    color: t.colors.text,
                    fontSize: t.fontSize.base,
                    lineHeight: 23,
                    fontWeight: '700',
                  }}
                  numberOfLines={2}>
                  {source.title}
                </Text>
                <Text
                  style={{
                    fontSize: t.fontSize.sm,
                    color: t.colors.textSub,
                    marginTop: t.spacing.sm,
                  }}
                  numberOfLines={1}>
                  {source.ownerName || 'B 站 UP 主'}
                </Text>
                <Text
                  style={{
                    fontSize: t.fontSize.xs,
                    color: t.colors.textSub,
                    marginTop: t.spacing.xs,
                  }}>
                  {source.mediaCount} 个视频
                </Text>
              </View>
            </View>
            <Text
              style={{
                fontSize: t.fontSize.sm,
                lineHeight: 22,
                color: t.colors.textSub,
                marginTop: t.spacing.md,
              }}
              numberOfLines={2}>
              {source.description?.trim() ||
                `来自${source.ownerName || '同好'}的${
                  source.kind === 'subscribedSeason' ? '订阅合集' : '收藏夹'
                }`}
            </Text>
            {source.matchedTags.length > 0 && (
              <Text
                style={{
                  fontSize: t.fontSize.xs,
                  lineHeight: 20,
                  color: t.colors.textSub,
                  marginTop: t.spacing.sm,
                }}
                numberOfLines={1}>
                {source.matchedTags.slice(0, 3).join(' · ')}
              </Text>
            )}
          </TouchableOpacity>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: t.spacing.sm,
              borderTopWidth: 1,
              borderTopColor: glassBorder,
              paddingHorizontal: t.spacing.lg,
              paddingVertical: t.spacing.sm,
            }}>
            <Text style={{fontSize: t.fontSize.xs, color: t.colors.textSub}}>
              {source.kind === 'subscribedSeason' ? '订阅合集' : '他人收藏夹'}
            </Text>
            <SubscribePlaylistButton source={source} compact />
          </View>
        </GlassView>
      </View>
    ),
    [
      compact,
      glassBackground,
      glassBorder,
      openSource,
      t.colors,
      t.fontSize,
      t.spacing,
    ],
  );

  const listHeader = (
    <View style={{marginBottom: t.spacing.xl}}>
      <Text
        accessibilityRole="header"
        style={{
          fontSize: 28,
          lineHeight: 38,
          fontWeight: '700',
          color: t.colors.text,
        }}>
        同好珍藏
      </Text>
      <Text
        style={{
          fontSize: t.fontSize.base,
          lineHeight: 24,
          color: t.colors.textSub,
          marginTop: t.spacing.sm,
        }}>
        从你收藏的他人歌单与订阅合集中， 挑选值得慢慢听的好音乐。
      </Text>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: t.spacing.sm,
          alignItems: 'center',
          marginTop: t.spacing.lg,
        }}>
        <View
          style={{
            paddingHorizontal: t.spacing.md,
            paddingVertical: t.spacing.sm,
            borderRadius: 10,
            backgroundColor: t.colors.surfaceHigh,
          }}>
          <Text
            style={{
              fontSize: t.fontSize.sm,
              color: t.colors.text,
              fontWeight: '600',
            }}>
            {collections.length} 份推荐
          </Text>
        </View>
        <Text
          accessibilityLiveRegion="polite"
          style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
          {refreshingCollections
            ? '正在检查新合集…'
            : feed.updatedAt
            ? `更新于 ${new Date(feed.updatedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : '下拉可更新推荐'}
        </Text>
      </View>
      {(feed.error || refreshFailed) && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            padding: t.spacing.lg,
            borderRadius: 16,
            marginTop: t.spacing.lg,
            borderWidth: 1,
            borderColor: glassBorder,
            backgroundColor: t.colors.surface,
          }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: t.spacing.sm,
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
                fontSize: t.fontSize.sm,
                lineHeight: 22,
                color: t.colors.text,
              }}>
              {feed.error || '更新暂未完成，已有推荐仍可浏览，请稍后重试。'}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.7}
            disabled={!uid || refreshingCollections || loadingMore}
            onPress={() => refreshCollections()}
            style={{
              minHeight: 48,
              justifyContent: 'center',
              alignSelf: 'flex-start',
              opacity: !uid || refreshingCollections || loadingMore ? 0.5 : 1,
            }}>
            <Text
              style={{
                fontSize: t.fontSize.sm,
                fontWeight: '600',
                color: t.colors.primary,
              }}>
              重新加载推荐
            </Text>
          </TouchableOpacity>
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
        paddingVertical: t.spacing.lg,
        gap: t.spacing.sm,
      }}>
      <ActivityIndicator size="small" color={t.colors.primary} />
      <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
        正在加载更多合集…
      </Text>
    </View>
  ) : hasMore && collections.length > 0 ? (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.7}
      disabled={!uid || refreshingCollections}
      onPress={() => loadMore()}
      style={{
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        padding: t.spacing.md,
        borderWidth: 1,
        borderColor: glassBorder,
        borderRadius: 14,
        marginBottom: t.spacing.md,
      }}>
      <Text
        style={{
          fontSize: t.fontSize.sm,
          fontWeight: '600',
          color: t.colors.primary,
        }}>
        加载更多合集
      </Text>
    </TouchableOpacity>
  ) : collections.length > 0 ? (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="检查新的合集推荐"
      accessibilityState={{
        disabled: !uid || refreshingCollections,
        busy: refreshingCollections,
      }}
      activeOpacity={0.7}
      disabled={!uid || refreshingCollections}
      onPress={() => refreshCollections()}
      style={{
        minHeight: 56,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: t.spacing.lg,
      }}>
      <Text
        style={{
          fontSize: t.fontSize.sm,
          lineHeight: 22,
          color: t.colors.textSub,
          textAlign: 'center',
        }}>
        {refreshingCollections
          ? '正在检查新合集…'
          : checkedNoNewCollections
          ? '已检查当前来源，暂时没有新合集'
          : '已浏览全部，点击检查新合集'}
      </Text>
    </TouchableOpacity>
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
        title="合集推荐"
        showBack
        noBorder
        right={
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="刷新合集推荐"
            accessibilityState={{
              disabled: !uid || refreshingCollections || loadingMore,
              busy: refreshingCollections || loadingMore,
            }}
            activeOpacity={0.7}
            disabled={!uid || refreshingCollections || loadingMore}
            onPress={() => refreshCollections()}
            style={{
              width: 48,
              height: 48,
              justifyContent: 'center',
              alignItems: 'center',
              opacity: !uid || refreshingCollections || loadingMore ? 0.5 : 1,
            }}>
            {refreshingCollections || loadingMore ? (
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
        data={collections}
        keyExtractor={item => item.sourceKey}
        renderItem={renderCollection}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        contentContainerStyle={{
          paddingHorizontal: t.spacing.xl,
          paddingTop: t.spacing.lg,
          paddingBottom: 24,
          flexGrow: collections.length === 0 ? 1 : undefined,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshingCollections}
            onRefresh={() => void refreshCollections()}
            tintColor={t.colors.primary}
            colors={[t.colors.primary]}
          />
        }
        onScroll={handleListScroll}
        scrollEventThrottle={16}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.8}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
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
            {refreshingCollections ? (
              <ActivityIndicator color={t.colors.primary} />
            ) : (
              <View
                style={{
                  width: 72,
                  height: 72,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 24,
                  backgroundColor: t.colors.surfaceHigh,
                }}>
                <Icon
                  accessible={false}
                  name="playlist-music-outline"
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
              {refreshingCollections
                ? '正在整理推荐合集…'
                : feed.error || refreshFailed
                ? '暂时无法获取合集'
                : '还没有推荐合集'}
            </Text>
            {!refreshingCollections && (
              <>
                <Text
                  style={{
                    fontSize: t.fontSize.sm,
                    lineHeight: 22,
                    color: t.colors.textSub,
                    textAlign: 'center',
                    marginTop: t.spacing.sm,
                  }}>
                  {feed.error || refreshFailed
                    ? '推荐来源暂时没有加载成功，请稍后重试。'
                    : '先在 B 站收藏喜欢的他人歌单，再回到这里刷新推荐。'}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.7}
                  disabled={!uid && Boolean(feed.error || refreshFailed)}
                  onPress={() =>
                    feed.error || refreshFailed
                      ? refreshCollections()
                      : navigation.navigate('VisibleFolders')
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
                    {feed.error || refreshFailed
                      ? '重新加载推荐'
                      : '管理播放列表偏好'}
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
