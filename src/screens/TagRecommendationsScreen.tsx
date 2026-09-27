import React, {useCallback, useRef, useState} from 'react';
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
import {useFocusEffect} from '@react-navigation/native';
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
import {storage} from '../core/storage';
import {usePlayerStore} from '../store/playerStore';
import {useProgressStore} from '../store/progressStore';
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

/**
 * 展示当前本地收藏视频的 tag 画像，并按兴趣 tag 搜索音乐视频。
 * 画像只在设备本地计算，视频 tag 快照复用收藏账号切换时的数据库清理生命周期。
 */
export const TagRecommendationsScreen = ({navigation}: any) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const uid = useAuthStore(state => state.userId);
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
  const [hasGenerated, setHasGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const loadedUid = useRef<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    if (!uid) {
      loadedUid.current = null;
      setFavorites([]);
      setProfile(null);
      setRecommendations([]);
      setFailedSearchCount(0);
      setHasGenerated(false);
      setInitialLoading(false);
      return;
    }

    const requestUid = uid;
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    setInitialLoading(true);
    setError(null);
    if (loadedUid.current !== requestUid) {
      loadedUid.current = requestUid;
      setRecommendations([]);
      setFailedSearchCount(0);
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
      const localFavorites = favoriteService.getGlobalIndex();
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
      if (!controller.signal.aborted) {
        setInitialLoading(false);
        setStage(current => (current === 'search' ? 'idle' : current));
      }
    }
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      loadSnapshot();
      return () => {
        requestController.current?.abort();
        requestController.current = null;
        setStage('idle');
      };
    }, [loadSnapshot]),
  );

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
    setProgress(EMPTY_PROGRESS);
    setError(null);
    setRecommendations([]);
    setFailedSearchCount(0);
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
        setQueue(queueVideos, video.bvid);
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
    [navigation, recommendations, setQueue],
  );

  const isWorking = stage !== 'idle';
  const progressPercent =
    progress.totalVideoCount > 0
      ? Math.min(
          100,
          Math.round(
            (progress.completedVideoCount / progress.totalVideoCount) * 100,
          ),
        )
      : 0;

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
          paddingTop: insets.top + t.spacing.sm,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: t.spacing.md,
        }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="返回收藏夹"
          onPress={() => navigation.goBack()}
          style={{padding: t.spacing.sm, marginRight: t.spacing.sm}}>
          <Icon name="arrow-left" size={24} color={t.colors.text} />
        </TouchableOpacity>
        <Text
          style={{
            color: t.colors.text,
            fontSize: t.fontSize.lg,
            fontWeight: '600',
          }}>
          收藏标签推荐
        </Text>
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
          contentContainerStyle={{
            paddingHorizontal: t.spacing.lg,
            paddingBottom: insets.bottom + t.spacing.xl,
          }}
          showsVerticalScrollIndicator={false}>
          <Text
            style={{
              color: t.colors.textSub,
              fontSize: t.fontSize.sm,
              lineHeight: 21,
            }}>
            根据本机已同步的 {favorites.length} 个收藏视频统计兴趣标签，再到 B
            站音乐分区寻找相似视频。画像在本机计算；查询会向 B 站发送单个视频
            BVID 和兴趣标签。
          </Text>
          <Text
            style={{
              color: t.colors.textHint,
              fontSize: t.fontSize.xs,
              lineHeight: 18,
              marginTop: t.spacing.xs,
            }}>
            首次读取会逐个请求视频标签；返回此页可中断，已完成的缓存会保留并可续读。
          </Text>

          {profile && (
            <View
              style={{
                marginTop: t.spacing.lg,
                padding: t.spacing.lg,
                borderRadius: t.radius.lg,
                backgroundColor: t.colors.surface,
              }}>
              <Text
                style={{
                  color: t.colors.text,
                  fontSize: t.fontSize.md,
                  fontWeight: '600',
                }}>
                兴趣画像
              </Text>
              <Text
                style={{
                  color: t.colors.textHint,
                  fontSize: t.fontSize.xs,
                  marginTop: t.spacing.xs,
                }}>
                已读取 {profile.resolvedVideoCount}/{profile.totalVideoCount}{' '}
                个视频；其中 {profile.taggedVideoCount} 个视频含可用于画像的标签
              </Text>
              {profile.preferences.length > 0 ? (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    marginTop: t.spacing.md,
                  }}>
                  {profile.preferences.slice(0, 12).map(preference => (
                    <View
                      key={`${preference.tagId}:${preference.tagName}`}
                      style={{
                        paddingHorizontal: t.spacing.sm,
                        paddingVertical: t.spacing.xs,
                        borderRadius: t.radius.md,
                        backgroundColor: t.colors.surfaceHigh,
                        marginRight: t.spacing.xs,
                        marginBottom: t.spacing.xs,
                      }}>
                      <Text
                        style={{color: t.colors.text, fontSize: t.fontSize.xs}}>
                        {preference.tagName} · {preference.videoCount}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text
                  style={{
                    color: t.colors.textHint,
                    fontSize: t.fontSize.sm,
                    marginTop: t.spacing.md,
                  }}>
                  还没有可用的标签数据。点击下方按钮读取收藏视频 tag。
                </Text>
              )}
            </View>
          )}

          {stage === 'tags' && (
            <View style={{marginTop: t.spacing.md}}>
              <View
                style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                <Text
                  style={{color: t.colors.textSub, fontSize: t.fontSize.sm}}>
                  正在读取标签
                </Text>
                <Text
                  style={{color: t.colors.textHint, fontSize: t.fontSize.sm}}>
                  {progress.completedVideoCount}/{progress.totalVideoCount}
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
                有标签 {progress.successfulVideoCount} · 无标签{' '}
                {progress.emptyVideoCount} · 失败 {progress.failedVideoCount}
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
              stage === 'tags'
                ? '正在读取标签'
                : stage === 'search'
                ? '正在搜索音乐推荐'
                : '读取标签并生成推荐'
            }
            onPress={handleBuildRecommendations}
            loading={isWorking}
            disabled={!uid || favorites.length === 0 || initialLoading}
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
