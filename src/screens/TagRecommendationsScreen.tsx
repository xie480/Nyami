import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useFocusEffect, useIsFocused} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Button} from '../components/Button';
import {
  favoriteService,
  loadGlobalIndexCache,
} from '../services/favoriteService';
import {prefetchAudioUrl} from '../services/dataPrefetcher';
import {
  backfillFavoriteTags,
  loadTagProfile,
  searchTagRecommendations,
  type TagBackfillProgress,
} from '../services/tagRecommendationService';
import {searchVideoToFavoriteVideo} from '../services/transformers';
import {
  loadQueue,
  playWithIntent,
  resolveCurrentTrack,
} from '../services/trackPlayer';
import {useAuthStore} from '../store/authStore';
import {useSettingsStore} from '../store/settingsStore';
import {useImportedPlaylistStore} from '../store/importedPlaylistStore';
import {storage} from '../core/storage';
import {usePlayerStore} from '../store/playerStore';
import {useProgressStore} from '../store/progressStore';
import {useTagBackfillStore} from '../store/tagBackfillStore';
import {useTheme} from '../theme';
import type {
  FavoriteVideo,
  TagProfile,
  TagRecommendation,
} from '../types/domain';
import {formatDuration} from '../utils/format';

type ScreenStage = 'idle' | 'tags' | 'search';

const EMPTY_PROGRESS: TagBackfillProgress = {
  totalVideoCount: 0,
  completedVideoCount: 0,
  successfulVideoCount: 0,
  emptyVideoCount: 0,
  failedVideoCount: 0,
  paused: false,
};

const EMPTY_VISIBLE_SOURCE_KEYS: string[] = [];

/**
 * 展示当前本地收藏视频的 tag 画像，并按兴趣 tag 搜索音乐视频。
 * 画像只在设备本地计算，视频 tag 快照复用收藏账号切换时的数据库清理生命周期。
 */
export const TagRecommendationsScreen = ({navigation}: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const uid = useAuthStore(state => state.userId);
  const backgroundBackfillStatus = useTagBackfillStore(state =>
    state.uid === uid ? state.status : 'idle',
  );
  const backgroundBackfillProgress = useTagBackfillStore(state =>
    state.uid === uid ? state.progress : EMPTY_PROGRESS,
  );
  const backgroundBackfillError = useTagBackfillStore(state =>
    state.uid === uid ? state.error : null,
  );
  const hiddenFolderIds = useSettingsStore(state => state.hiddenFolderIds);
  const visibleSourceKeys = useImportedPlaylistStore(state =>
    uid ? state.visibleSourceKeysByUid[uid] ?? EMPTY_VISIBLE_SOURCE_KEYS : EMPTY_VISIBLE_SOURCE_KEYS,
  );
  const setQueue = usePlayerStore(state => state.setQueue);
  const [favorites, setFavorites] = useState<FavoriteVideo[]>([]);
  const [profile, setProfile] = useState<TagProfile | null>(null);
  const [recommendations, setRecommendations] = useState<TagRecommendation[]>(
    [],
  );
  const [progress, setProgress] = useState<TagBackfillProgress>(EMPTY_PROGRESS);
  const [stage, setStage] = useState<ScreenStage>('idle');
  const [initialLoading, setInitialLoading] = useState(true);
  const [failedSearchCount, setFailedSearchCount] = useState(0);
  const [recommendationHasMore, setRecommendationHasMore] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [profileView, setProfileView] = useState<'tags' | 'listening'>('tags');
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const loadedUid = useRef<string | null>(null);
  const loadedSnapshotKey = useRef<string | null>(null);
  const activeSnapshotKey = useRef<string | null>(null);
  const activeSnapshotController = useRef<AbortController | null>(null);
  const backgroundBackfillWasRunning = useRef(false);

  const loadSnapshot = useCallback(async () => {
    if (!uid) {
      loadedUid.current = null;
      loadedSnapshotKey.current = null;
      activeSnapshotKey.current = null;
      activeSnapshotController.current?.abort();
      activeSnapshotController.current = null;
      requestController.current?.abort();
      requestController.current = null;
      setFavorites([]);
      setProfile(null);
      setRecommendations([]);
      setFailedSearchCount(0);
      setRecommendationHasMore(false);
      setHasGenerated(false);
      setInitialLoading(false);
      return;
    }

    const requestUid = uid;
    const snapshotKey = JSON.stringify([
      requestUid,
      [...new Set(hiddenFolderIds)].sort((left, right) => left - right),
      [...new Set(visibleSourceKeys)].sort(),
    ]);
    if (
      loadedSnapshotKey.current === snapshotKey ||
      activeSnapshotKey.current === snapshotKey
    ) {
      return;
    }

    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    activeSnapshotKey.current = snapshotKey;
    activeSnapshotController.current = controller;
    setInitialLoading(true);
    setError(null);
    if (loadedUid.current !== requestUid) {
      loadedUid.current = requestUid;
      setRecommendations([]);
      setFailedSearchCount(0);
      setRecommendationHasMore(false);
      setHasGenerated(false);
    }

    try {
      if (storage.getString('lastUid') !== requestUid) {
        setFavorites([]);
        setProfile(null);
        setError('本机收藏数据正在随账号切换清理，请稍后返回此页重试。');
        return;
      }
      await loadGlobalIndexCache();
      if (
        controller.signal.aborted ||
        useAuthStore.getState().userId !== requestUid ||
        storage.getString('lastUid') !== requestUid
      ) {
        return;
      }
      const localFavorites = favoriteService.getGlobalIndex(hiddenFolderIds, visibleSourceKeys);
      setFavorites(localFavorites);
      const {profile: cachedProfile} = await loadTagProfile(localFavorites);
      if (
        controller.signal.aborted ||
        useAuthStore.getState().userId !== requestUid ||
        storage.getString('lastUid') !== requestUid
      ) {
        return;
      }
      setProfile(cachedProfile);
      loadedSnapshotKey.current = snapshotKey;
    } catch (loadError) {
      if (!controller.signal.aborted) {
        setError(
          loadError instanceof Error ? loadError.message : '读取收藏画像失败',
        );
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
      }
      if (activeSnapshotController.current === controller) {
        activeSnapshotKey.current = null;
        activeSnapshotController.current = null;
      }
      if (!controller.signal.aborted) {
        setInitialLoading(false);
        setStage(current => (current === 'search' ? 'idle' : current));
      }
    }
  }, [uid, hiddenFolderIds, visibleSourceKeys]);

  useFocusEffect(
    useCallback(() => {
      loadSnapshot();
      return () => {
        // 路由失焦时保留首轮本地读取，避免下一次进入画像页再次加载。
        setStage('idle');
      };
    }, [loadSnapshot]),
  );

  useEffect(() => () => {
    requestController.current?.abort();
    requestController.current = null;
  }, []);

  useEffect(() => {
    if (backgroundBackfillStatus === 'running') {
      backgroundBackfillWasRunning.current = true;
      return;
    }
    if (backgroundBackfillWasRunning.current) {
      backgroundBackfillWasRunning.current = false;
      loadedSnapshotKey.current = null;
      if (activeSnapshotController.current) {
        activeSnapshotController.current.abort();
        activeSnapshotController.current = null;
        activeSnapshotKey.current = null;
      }
      if (isFocused) {
        loadSnapshot();
      }
    }
  }, [backgroundBackfillStatus, isFocused, loadSnapshot]);

  /** 读取未缓存标签并从已有在线搜索接口生成推荐。 */
  const handleBuildRecommendations = useCallback(async () => {
    if (!uid || favorites.length === 0 || initialLoading) {
      return;
    }
    const requestUid = uid;
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    setStage('tags');
    useTagBackfillStore.getState().finish(requestUid, 'idle');
    setProgress(EMPTY_PROGRESS);
    setError(null);
    setRecommendations([]);
    setFailedSearchCount(0);
    setRecommendationHasMore(false);
    setHasGenerated(false);

    try {
      const result = await backfillFavoriteTags(
        requestUid,
        favorites,
        controller.signal,
        setProgress,
      );
      if (
        controller.signal.aborted ||
        useAuthStore.getState().userId !== requestUid
      ) {
        return;
      }
      setProfile(result.profile);

      if (result.progress.paused) {
        setStage('idle');
        return;
      }

      if (result.profile.preferences.length === 0) {
        setHasGenerated(true);
        setStage('idle');
        return;
      }

      setStage('search');
      const searchResult = await searchTagRecommendations(
        result.profile,
        favorites,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        useAuthStore.getState().userId !== requestUid
      ) {
        return;
      }
      setRecommendations(searchResult.recommendations);
      setFailedSearchCount(searchResult.failedSearchCount);
      setRecommendationHasMore(searchResult.hasMore);
      setHasGenerated(true);
      setStage('idle');
    } catch (buildError) {
      if (!controller.signal.aborted) {
        setError(
          buildError instanceof Error ? buildError.message : '生成标签推荐失败',
        );
      }
      setStage('idle');
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
      }
    }
  }, [favorites, initialLoading, uid]);

  /** 将推荐结果组成播放队列，沿用现有播放器的意图与预取流程。 */
  const handlePlayRecommendation = useCallback(
    async (video: TagRecommendation) => {
      try {
        const queueVideos = recommendations.map(searchVideoToFavoriteVideo);
        setQueue(queueVideos, video.bvid, {
          isPersonalized: true,
          recommendationPage: 1,
          recommendationHasMore,
        });
        usePlayerStore.getState().setResolving(true);
        useProgressStore.getState().resetProgress();
        prefetchAudioUrl(video.bvid).catch(() => {});
        const version = await loadQueue(queueVideos, video.bvid);
        await playWithIntent();
        resolveCurrentTrack(version).catch(() => {});
        navigation.navigate('Player');
      } catch (playError) {
        const message =
          playError instanceof Error ? playError.message : '播放失败';
        Alert.alert('播放错误', message);
        usePlayerStore.getState().setResolving(false);
      }
    },
    [navigation, recommendationHasMore, recommendations, setQueue],
  );

  const isBackgroundBackfillActive = backgroundBackfillStatus === 'running';
  const showBackgroundProgress =
    isBackgroundBackfillActive ||
    (backgroundBackfillStatus === 'paused' && stage === 'idle');
  const displayedProgress = showBackgroundProgress
    ? backgroundBackfillProgress
    : progress;
  const isWorking = stage !== 'idle' || isBackgroundBackfillActive;
  const progressPercent =
    displayedProgress.totalVideoCount > 0
      ? Math.min(
          100,
          Math.round(
            (displayedProgress.completedVideoCount /
              displayedProgress.totalVideoCount) *
              100,
          ),
        )
      : 0;
  const strongestTagCount = Math.max(1, ...(profile?.preferences.map(item => item.videoCount) ?? [1]));
  const profileTags = profile?.preferences.slice(0, 12) ?? [];

  return (
    <View style={{flex: 1, backgroundColor: t.colors.background}}>
      <StatusBar
        barStyle={t.isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: insets.top + t.spacing.sm,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: t.spacing.sm,
        }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="返回收藏夹"
          onPress={() => navigation.goBack()}
          style={{width: 40, height: 40, alignItems: 'center', justifyContent: 'center'}}>
          <Icon name="arrow-left" size={24} color={t.colors.text} />
        </TouchableOpacity>
        <Text
          style={{
            position: 'absolute',
            left: 58,
            right: 58,
            color: t.colors.text,
            fontSize: t.fontSize.lg,
            fontWeight: '700',
            textAlign: 'center',
          }}>
          用户画像
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="刷新用户画像"
          onPress={loadSnapshot}
          style={{width: 40, height: 40, alignItems: 'center', justifyContent: 'center'}}>
          <Icon name="refresh" size={22} color={t.colors.text} />
        </TouchableOpacity>
      </View>

      {initialLoading ? (
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <ActivityIndicator color={t.colors.primary} />
          <Text style={{color: t.colors.textHint, marginTop: t.spacing.md}}>
            正在读取本地收藏与标签缓存
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{flex: 1}}
          contentContainerStyle={{
            paddingHorizontal: t.spacing.lg,
            paddingBottom: insets.bottom + 136,
          }}
          showsVerticalScrollIndicator={false}>
          <Text style={{color: t.colors.textSub, fontSize: t.fontSize.sm, lineHeight: 22}}>
            根据本机已同步的 {favorites.length} 个收藏视频统计兴趣标签，再到 B 站音乐区寻找相似内容。
          </Text>
          <Text style={{color: t.colors.textHint, fontSize: t.fontSize.xs, lineHeight: 18, marginTop: t.spacing.xs}}>
            画像在本机计算；查询仅发送视频 BVID 和兴趣标签。离开页面会中断手动生成，已完成缓存会保留。
          </Text>

          <View style={{flexDirection: 'row', padding: 4, marginTop: t.spacing.lg, borderRadius: t.radius.full, backgroundColor: t.colors.surfaceHigh}}>
            {([
              {key: 'tags', title: '兴趣标签'},
              {key: 'listening', title: '听歌偏好'},
            ] as const).map(tab => {
              const selected = profileView === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  accessibilityRole="button"
                  accessibilityState={{selected}}
                  onPress={() => setProfileView(tab.key)}
                  style={{flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.full, backgroundColor: selected ? t.colors.primary : 'transparent'}}>
                  <Text style={{color: selected ? t.colors.onPrimary : t.colors.textSub, fontSize: t.fontSize.sm, fontWeight: selected ? '600' : '400'}}>{tab.title}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {profile && (
            <View
              style={{
                marginTop: t.spacing.lg,
                padding: t.spacing.lg,
                borderRadius: 24,
                backgroundColor: t.colors.surface,
              }}>
              <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
                <Text style={{color: t.colors.text, fontSize: t.fontSize.md, fontWeight: '700'}}>
                  {profileView === 'tags' ? '兴趣标签' : '兴趣画像'}
                </Text>
                <Text style={{color: t.colors.textHint, fontSize: t.fontSize.xs}}>
                  已读取 {profile.resolvedVideoCount}/{profile.totalVideoCount} 个视频
                </Text>
              </View>
              <Text style={{color: t.colors.textSub, fontSize: t.fontSize.sm, marginTop: t.spacing.xs}}>
                {profile.taggedVideoCount} 个视频含可用于画像的标签
              </Text>
              {profile.preferences.length > 0 ? profileView === 'tags' ? (
                <View style={{flexDirection: 'row', flexWrap: 'wrap', marginTop: t.spacing.md}}>
                  {profileTags.map((preference, index) => (
                    <View
                      key={`${preference.tagId}:${preference.tagName}`}
                      style={{paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.sm, borderRadius: t.radius.full, backgroundColor: index < 3 ? t.colors.primary : t.colors.primaryLight, marginRight: t.spacing.xs, marginBottom: t.spacing.xs}}>
                      <Text style={{color: index < 3 ? t.colors.onPrimary : t.colors.text, fontSize: t.fontSize.sm, fontWeight: index < 3 ? '600' : '400'}}>
                        {preference.tagName} · {preference.videoCount}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={{marginTop: t.spacing.lg}}>
                  {profile.preferences.slice(0, 5).map(preference => {
                    const relativeWidth = Math.max(6, Math.round((preference.videoCount / strongestTagCount) * 100));
                    const coverage = profile.totalVideoCount > 0
                      ? Math.round((preference.videoCount / profile.totalVideoCount) * 100)
                      : 0;
                    return (
                      <View key={`${preference.tagId}:${preference.tagName}`} style={{flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.md}}>
                        <Text style={{width: 88, color: t.colors.text, fontSize: t.fontSize.sm}} numberOfLines={1}>{preference.tagName}</Text>
                        <View style={{flex: 1, height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: t.colors.surfaceHigh}}>
                          <View style={{height: '100%', width: `${relativeWidth}%`, borderRadius: 7, backgroundColor: t.colors.primary}} />
                        </View>
                        <Text style={{width: 44, textAlign: 'right', color: t.colors.textSub, fontSize: t.fontSize.xs}}>{coverage}%</Text>
                      </View>
                    );
                  })}
                  <Text style={{color: t.colors.textHint, fontSize: t.fontSize.xs, marginTop: t.spacing.xs}}>
                    百分比表示该标签覆盖的已同步收藏视频，横条长度按当前标签频次缩放。
                  </Text>
                </View>
              ) : (
                <Text style={{color: t.colors.textHint, fontSize: t.fontSize.sm, marginTop: t.spacing.md}}>
                  还没有可用的标签数据。点击下方按钮读取收藏视频 tag。
                </Text>
              )}
            </View>
          )}

          {(stage === 'tags' || showBackgroundProgress) && (
            <View style={{marginTop: t.spacing.md}}>
              <View
                style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                <Text
                  style={{color: t.colors.textSub, fontSize: t.fontSize.sm}}>
                  {isBackgroundBackfillActive
                    ? '同步后正在后台读取标签'
                    : backgroundBackfillStatus === 'paused' && stage !== 'tags'
                      ? '后台读取已暂停'
                      : '正在读取标签'}
                </Text>
                <Text
                  style={{color: t.colors.textHint, fontSize: t.fontSize.sm}}>
                  {displayedProgress.completedVideoCount}/
                  {displayedProgress.totalVideoCount}
                </Text>
              </View>
              <View
                style={{
                  height: 6,
                  marginTop: t.spacing.xs,
                  borderRadius: 3,
                  backgroundColor: t.colors.surfaceHigh,
                }}>
                <View
                  style={{
                    height: 6,
                    width: `${progressPercent}%`,
                    borderRadius: 3,
                    backgroundColor: t.colors.primary,
                  }}
                />
              </View>
              <Text
                style={{
                  color: t.colors.textHint,
                  fontSize: t.fontSize.xs,
                  marginTop: t.spacing.xs,
                }}>
                有标签 {displayedProgress.successfulVideoCount} · 无标签{' '}
                {displayedProgress.emptyVideoCount} · 失败{' '}
                {displayedProgress.failedVideoCount}
              </Text>
            </View>
          )}

          {progress.paused && (
            <Text
              style={{
                color: t.colors.textHint,
                fontSize: t.fontSize.xs,
                marginTop: t.spacing.sm,
              }}>
              采集因登录、网络或限流问题暂停，本轮未继续在线搜索。已读取标签会保留，稍后可重试。
            </Text>
          )}

          {backgroundBackfillStatus === 'paused' && stage !== 'tags' && (
            <Text
              style={{
                color: t.colors.textHint,
                fontSize: t.fontSize.xs,
                marginTop: t.spacing.sm,
              }}>
              后台提取已暂停，已写入的标签会保留；可以点击下方按钮继续生成推荐。
            </Text>
          )}

          {backgroundBackfillStatus === 'error' && backgroundBackfillError && (
            <Text
              style={{
                color: t.colors.error,
                fontSize: t.fontSize.xs,
                marginTop: t.spacing.sm,
              }}>
              后台提取失败：{backgroundBackfillError}
            </Text>
          )}

          {error && (
            <Text
              style={{
                color: t.colors.error,
                fontSize: t.fontSize.sm,
                marginTop: t.spacing.md,
              }}>
              {error}
            </Text>
          )}

          <Button
            title={
              isBackgroundBackfillActive
                ? '后台正在读取兴趣标签'
                : stage === 'tags'
                ? '正在读取标签'
                : stage === 'search'
                ? '正在搜索音乐推荐'
                : '读取标签并生成推荐'
            }
            onPress={handleBuildRecommendations}
            loading={isWorking}
            disabled={
              !uid ||
              favorites.length === 0 ||
              initialLoading ||
              isBackgroundBackfillActive
            }
            style={{marginTop: t.spacing.lg}}
          />

          {favorites.length === 0 && (
            <Text
              style={{
                color: t.colors.textHint,
                fontSize: t.fontSize.sm,
                textAlign: 'center',
                marginTop: t.spacing.md,
              }}>
              先同步至少一个收藏夹，再生成标签推荐。
            </Text>
          )}

          {failedSearchCount > 0 && (
            <Text
              style={{
                color: t.colors.textHint,
                fontSize: t.fontSize.xs,
                marginTop: t.spacing.md,
              }}>
              有 {failedSearchCount} 个兴趣标签搜索失败，当前结果可能不完整。
            </Text>
          )}

          {hasGenerated && recommendations.length === 0 && (
            <Text
              style={{
                color: t.colors.textHint,
                fontSize: t.fontSize.sm,
                marginTop: t.spacing.md,
                textAlign: 'center',
              }}>
              暂未找到匹配的音乐视频，可以调整收藏标签后再次生成。
            </Text>
          )}

          {recommendations.length > 0 && (
            <View style={{marginTop: t.spacing.xl}}>
              <Text
                style={{
                  color: t.colors.text,
                  fontSize: t.fontSize.md,
                  fontWeight: '600',
                  marginBottom: t.spacing.md,
                }}>
                为你找到 {recommendations.length} 个音乐视频
              </Text>
              {recommendations.map(item => (
                <TouchableOpacity
                  key={item.bvid}
                  accessibilityRole="button"
                  accessibilityLabel={`播放推荐：${item.title}`}
                  activeOpacity={0.75}
                  onPress={() => handlePlayRecommendation(item)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: t.spacing.md,
                    marginBottom: t.spacing.sm,
                    borderRadius: t.radius.lg,
                    backgroundColor: t.colors.surface,
                  }}>
                  <View>
                    <FastImage
                      source={{uri: item.cover}}
                      style={{
                        width: 100,
                        height: 64,
                        borderRadius: 8,
                        backgroundColor: t.colors.surfaceHigh,
                      }}
                      resizeMode={FastImage.resizeMode.cover}
                    />
                    <View
                      style={{
                        position: 'absolute',
                        bottom: 3,
                        right: 3,
                        paddingHorizontal: 4,
                        paddingVertical: 2,
                        borderRadius: 3,
                        backgroundColor: 'rgba(0,0,0,0.65)',
                      }}>
                      <Text style={{color: '#fff', fontSize: 10}}>
                        {formatDuration(item.duration)}
                      </Text>
                    </View>
                  </View>
                  <View style={{flex: 1, marginLeft: t.spacing.md}}>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: t.colors.text,
                        fontSize: t.fontSize.sm,
                        fontWeight: '500',
                      }}>
                      {item.title}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: t.colors.textHint,
                        fontSize: t.fontSize.xs,
                        marginTop: t.spacing.xs,
                      }}>
                      {item.author}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: t.colors.primary,
                        fontSize: t.fontSize.xs,
                        marginTop: t.spacing.xs,
                      }}>
                      匹配：{item.matchedTags.join(' · ')}
                    </Text>
                  </View>
                  <Icon
                    name="play-circle-outline"
                    size={28}
                    color={t.colors.primary}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};
