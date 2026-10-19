import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useFocusEffect, useIsFocused} from '@react-navigation/native';
import {useNetworkRecoveryRefresh} from '../hooks/useNetworkRecoveryRefresh';
import {Button} from '../components/Button';
import {Loading} from '../components/Loading';
import {Header} from '../components/Header';
import {IconButton} from '../components/IconButton';
import {
  TagProfilePipeline,
  TagProfileRadar,
} from '../components/TagProfileVisualization';
import {
  favoriteService,
  ensureGlobalIndexCacheLoaded,
  getGlobalIndexFingerprint,
  getGlobalIndexRevision,
  isGlobalIndexCacheLoaded,
  subscribeGlobalIndexRevision,
} from '../services/favoriteService';
import {prefetchAudioUrl} from '../services/dataPrefetcher';
import {
  backfillFavoriteTags,
  getTagProfileCacheRevision,
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
const TAG_PROFILE_CACHE_LIMIT = 4;
let cachedProfileUid: string | null = null;
let cachedProfileIndexRevision: number | null = null;
const tagProfileSnapshots = new Map<string, TagProfile>();

interface PersistedTagProfileSnapshot {
  uid: string;
  scopeKey: string;
  indexFingerprint: string;
  tagCacheRevision: number;
  profile: TagProfile;
}

function getTagProfileScopeKey(
  uid: string,
  hiddenFolderIds: number[],
  visibleSourceKeys: string[],
): string {
  return JSON.stringify([
    uid,
    [...new Set(hiddenFolderIds)].sort((left, right) => left - right),
    [...new Set(visibleSourceKeys)].sort(),
  ]);
}

function readPersistedTagProfileSnapshot(
  uid: string,
  hiddenFolderIds: number[],
  visibleSourceKeys: string[],
): PersistedTagProfileSnapshot | null {
  const snapshot = storage.getJSON<PersistedTagProfileSnapshot>(
    `tagProfileSnapshot:v1:${uid}`,
  );
  if (
    snapshot?.uid !== uid ||
    snapshot.scopeKey !==
      getTagProfileScopeKey(uid, hiddenFolderIds, visibleSourceKeys) ||
    !snapshot.profile ||
    !Array.isArray(snapshot.profile.preferences)
  ) {
    return null;
  }
  return snapshot;
}

function persistTagProfileSnapshot(
  uid: string,
  hiddenFolderIds: number[],
  visibleSourceKeys: string[],
  indexFingerprint: string,
  tagCacheRevision: number,
  profile: TagProfile,
): void {
  storage.setJSON(`tagProfileSnapshot:v1:${uid}`, {
    uid,
    scopeKey: getTagProfileScopeKey(uid, hiddenFolderIds, visibleSourceKeys),
    indexFingerprint,
    tagCacheRevision,
    profile,
  } satisfies PersistedTagProfileSnapshot);
}

function getTagProfileSnapshotKey(
  uid: string,
  indexRevision: number,
  hiddenFolderIds: number[],
  visibleSourceKeys: string[],
): string {
  return JSON.stringify([
    uid,
    indexRevision,
    [...new Set(hiddenFolderIds)].sort((left, right) => left - right),
    [...new Set(visibleSourceKeys)].sort(),
  ]);
}

function prepareTagProfileCache(uid: string, indexRevision: number): void {
  if (
    cachedProfileUid === uid &&
    cachedProfileIndexRevision === indexRevision
  ) {
    return;
  }
  tagProfileSnapshots.clear();
  cachedProfileUid = uid;
  cachedProfileIndexRevision = indexRevision;
}

function getCachedTagProfile(
  uid: string,
  indexRevision: number,
  snapshotKey: string,
): TagProfile | null {
  prepareTagProfileCache(uid, indexRevision);
  const profile = tagProfileSnapshots.get(snapshotKey);
  if (!profile) {
    return null;
  }
  tagProfileSnapshots.delete(snapshotKey);
  tagProfileSnapshots.set(snapshotKey, profile);
  return profile;
}

function cacheTagProfile(
  uid: string,
  indexRevision: number,
  snapshotKey: string,
  profile: TagProfile,
): void {
  prepareTagProfileCache(uid, indexRevision);
  tagProfileSnapshots.delete(snapshotKey);
  tagProfileSnapshots.set(snapshotKey, profile);
  while (tagProfileSnapshots.size > TAG_PROFILE_CACHE_LIMIT) {
    const oldestKey = tagProfileSnapshots.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    tagProfileSnapshots.delete(oldestKey);
  }
}

/**
 * 展示当前本地收藏视频的 tag 画像，并按兴趣 tag 搜索音乐视频。
 * 画像只在设备本地计算，视频 tag 快照复用收藏账号切换时的数据库清理生命周期。
 */
export const TagRecommendationsScreen = ({navigation}: any) => {
  const t = useTheme();
  const {width, fontScale} = useWindowDimensions();
  const compact = width < 380 || fontScale > 1.2;
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
    uid
      ? state.visibleSourceKeysByUid[uid] ?? EMPTY_VISIBLE_SOURCE_KEYS
      : EMPTY_VISIBLE_SOURCE_KEYS,
  );
  const setQueue = usePlayerStore(state => state.setQueue);
  const cachedScreenSnapshot = useMemo(() => {
    if (!uid || storage.getString('lastUid') !== uid) {
      return null;
    }
    return readPersistedTagProfileSnapshot(
      uid,
      hiddenFolderIds,
      visibleSourceKeys,
    );
  }, [hiddenFolderIds, uid, visibleSourceKeys]);
  const [favorites, setFavorites] = useState<FavoriteVideo[]>([]);
  const [profile, setProfile] = useState<TagProfile | null>(
    () => cachedScreenSnapshot?.profile ?? null,
  );
  const [recommendations, setRecommendations] = useState<TagRecommendation[]>(
    [],
  );
  const [progress, setProgress] = useState<TagBackfillProgress>(EMPTY_PROGRESS);
  const [stage, setStage] = useState<ScreenStage>('idle');
  const [initialLoading, setInitialLoading] = useState(!cachedScreenSnapshot);
  const [failedSearchCount, setFailedSearchCount] = useState(0);
  const [recommendationHasMore, setRecommendationHasMore] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [profileView, setProfileView] = useState<'radar' | 'pipeline'>('radar');
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const loadedUid = useRef<string | null>(cachedScreenSnapshot ? uid : null);
  const loadedSnapshotKey = useRef<string | null>(null);
  const loadedTagCacheRevision = useRef<number | null>(null);
  const activeSnapshotKey = useRef<string | null>(null);
  const activeSnapshotController = useRef<AbortController | null>(null);
  const backgroundBackfillWasRunning = useRef(false);

  const loadSnapshot = useCallback(
    async (refreshProfile = false) => {
      if (!uid) {
        loadedUid.current = null;
        loadedSnapshotKey.current = null;
        activeSnapshotKey.current = null;
        activeSnapshotController.current?.abort();
        activeSnapshotController.current = null;
        requestController.current?.abort();
        requestController.current = null;
        loadedTagCacheRevision.current = null;
        tagProfileSnapshots.clear();
        cachedProfileUid = null;
        cachedProfileIndexRevision = null;
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
      const normalizedHiddenFolderIds = [...new Set(hiddenFolderIds)].sort(
        (left, right) => left - right,
      );
      const normalizedVisibleSourceKeys = [
        ...new Set(visibleSourceKeys),
      ].sort();
      const persistedProfile = readPersistedTagProfileSnapshot(
        requestUid,
        normalizedHiddenFolderIds,
        normalizedVisibleSourceKeys,
      );
      if (!refreshProfile && persistedProfile) {
        setProfile(persistedProfile.profile);
        setInitialLoading(false);
      } else if (!refreshProfile) {
        setProfile(null);
        setInitialLoading(true);
      }
      const scopeKey = JSON.stringify([
        requestUid,
        normalizedHiddenFolderIds,
        normalizedVisibleSourceKeys,
      ]);
      let requestKey = scopeKey;
      if (isGlobalIndexCacheLoaded()) {
        const currentRevision = getGlobalIndexRevision();
        const currentSnapshotKey = getTagProfileSnapshotKey(
          requestUid,
          currentRevision,
          normalizedHiddenFolderIds,
          normalizedVisibleSourceKeys,
        );
        const currentTagCacheRevision = getTagProfileCacheRevision();
        requestKey = JSON.stringify([
          currentSnapshotKey,
          currentTagCacheRevision,
        ]);
        if (
          !refreshProfile &&
          loadedSnapshotKey.current === currentSnapshotKey &&
          loadedTagCacheRevision.current === currentTagCacheRevision
        ) {
          return;
        }
      }
      if (activeSnapshotKey.current === requestKey && !refreshProfile) {
        return;
      }

      const controller = new AbortController();
      requestController.current?.abort();
      requestController.current = controller;
      activeSnapshotKey.current = requestKey;
      activeSnapshotController.current = controller;
      if (refreshProfile || !persistedProfile) {
        setInitialLoading(true);
      }
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
        await ensureGlobalIndexCacheLoaded();
        if (
          controller.signal.aborted ||
          useAuthStore.getState().userId !== requestUid ||
          storage.getString('lastUid') !== requestUid
        ) {
          return;
        }
        const indexRevision = getGlobalIndexRevision();
        const snapshotKey = getTagProfileSnapshotKey(
          requestUid,
          indexRevision,
          normalizedHiddenFolderIds,
          normalizedVisibleSourceKeys,
        );
        const indexFingerprint = getGlobalIndexFingerprint();
        const tagCacheRevision = getTagProfileCacheRevision();
        const persistedSnapshot = readPersistedTagProfileSnapshot(
          requestUid,
          normalizedHiddenFolderIds,
          normalizedVisibleSourceKeys,
        );
        if (!refreshProfile) {
          if (
            loadedSnapshotKey.current === snapshotKey &&
            loadedTagCacheRevision.current === tagCacheRevision
          ) {
            return;
          }
          const persistedSnapshotIsCurrent =
            persistedSnapshot?.indexFingerprint === indexFingerprint &&
            persistedSnapshot.tagCacheRevision === tagCacheRevision;
          const cachedProfile = persistedSnapshotIsCurrent
            ? getCachedTagProfile(requestUid, indexRevision, snapshotKey) ??
              persistedSnapshot.profile
            : null;
          if (cachedProfile) {
            const cachedFavorites =
              await favoriteService.getGlobalIndexYielding(
                normalizedHiddenFolderIds,
                normalizedVisibleSourceKeys,
                controller.signal,
              );
            if (controller.signal.aborted) {
              return;
            }
            loadedUid.current = requestUid;
            loadedSnapshotKey.current = snapshotKey;
            loadedTagCacheRevision.current = tagCacheRevision;
            setFavorites(cachedFavorites);
            setProfile(cachedProfile);
            cacheTagProfile(
              requestUid,
              indexRevision,
              snapshotKey,
              cachedProfile,
            );
            return;
          }
        }
        setInitialLoading(true);
        const localFavorites = await favoriteService.getGlobalIndexYielding(
          normalizedHiddenFolderIds,
          normalizedVisibleSourceKeys,
          controller.signal,
        );
        if (controller.signal.aborted) {
          return;
        }
        setFavorites(localFavorites);
        const {profile: cachedProfile} = await loadTagProfile(
          localFavorites,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          useAuthStore.getState().userId !== requestUid ||
          storage.getString('lastUid') !== requestUid ||
          getGlobalIndexRevision() !== indexRevision ||
          getGlobalIndexFingerprint() !== indexFingerprint ||
          getTagProfileCacheRevision() !== tagCacheRevision
        ) {
          return;
        }
        cacheTagProfile(requestUid, indexRevision, snapshotKey, cachedProfile);
        persistTagProfileSnapshot(
          requestUid,
          normalizedHiddenFolderIds,
          normalizedVisibleSourceKeys,
          indexFingerprint,
          tagCacheRevision,
          cachedProfile,
        );
        setProfile(cachedProfile);
        loadedSnapshotKey.current = snapshotKey;
        loadedTagCacheRevision.current = tagCacheRevision;
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
    },
    [uid, hiddenFolderIds, visibleSourceKeys],
  );

  useFocusEffect(
    useCallback(() => {
      loadSnapshot();
      return () => {
        // 路由失焦时保留首轮本地读取，避免下一次进入画像页再次加载。
        setStage('idle');
      };
    }, [loadSnapshot]),
  );

  useNetworkRecoveryRefresh(() => loadSnapshot(true), Boolean(uid && error));

  useEffect(() => {
    if (!uid) {
      return;
    }
    return subscribeGlobalIndexRevision(() => {
      if (isFocused && loadedSnapshotKey.current) {
        loadSnapshot();
      }
    });
  }, [isFocused, loadSnapshot, uid]);

  useEffect(
    () => () => {
      requestController.current?.abort();
      requestController.current = null;
    },
    [],
  );

  useEffect(() => {
    if (backgroundBackfillStatus === 'running') {
      backgroundBackfillWasRunning.current = true;
      return;
    }
    if (backgroundBackfillWasRunning.current) {
      backgroundBackfillWasRunning.current = false;
      if (activeSnapshotController.current) {
        activeSnapshotController.current.abort();
        activeSnapshotController.current = null;
        activeSnapshotKey.current = null;
      }
      if (isFocused) {
        loadSnapshot(true);
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
        useAuthStore.getState().userId !== requestUid ||
        storage.getString('lastUid') !== requestUid
      ) {
        return;
      }
      setProfile(result.profile);
      const indexRevision = getGlobalIndexRevision();
      const indexFingerprint = getGlobalIndexFingerprint();
      const tagCacheRevision = getTagProfileCacheRevision();
      const snapshotKey = getTagProfileSnapshotKey(
        requestUid,
        indexRevision,
        hiddenFolderIds,
        visibleSourceKeys,
      );
      cacheTagProfile(requestUid, indexRevision, snapshotKey, result.profile);
      persistTagProfileSnapshot(
        requestUid,
        hiddenFolderIds,
        visibleSourceKeys,
        indexFingerprint,
        tagCacheRevision,
        result.profile,
      );
      loadedSnapshotKey.current = snapshotKey;
      loadedTagCacheRevision.current = tagCacheRevision;

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
  }, [favorites, hiddenFolderIds, initialLoading, uid, visibleSourceKeys]);

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
  const displayedFavoriteCount = profile?.totalVideoCount ?? favorites.length;
  const surface = t.glass?.colors.glass.bg ?? t.colors.surface;
  const border = t.glass?.colors.glass.border ?? t.colors.divider;

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
        title="用户画像"
        showBack
        noBorder
        right={
          <IconButton
            name="refresh"
            accessibilityLabel="刷新用户画像"
            disabled={initialLoading || isWorking}
            onPress={() => loadSnapshot(true)}
          />
        }
      />
      {initialLoading ? (
        <Loading text="正在读取本地收藏与标签缓存" />
      ) : (
        <ScrollView
          style={{flex: 1, width: '100%', maxWidth: 880, alignSelf: 'center'}}
          contentContainerStyle={{
            paddingHorizontal: t.spacing.xl,
            paddingTop: t.spacing.lg,
            paddingBottom: 24,
          }}
          showsVerticalScrollIndicator={false}>
          <Text
            accessibilityRole="header"
            style={{
              fontSize: 28,
              lineHeight: 38,
              fontWeight: '700',
              color: t.colors.text,
            }}>
            你的音乐轮廓
          </Text>
          <Text
            style={{
              color: t.colors.textSub,
              fontSize: t.fontSize.base,
              lineHeight: 24,
              marginTop: t.spacing.sm,
            }}>
            每一次收藏，都在记录你的喜好。
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: t.spacing.sm,
              marginTop: t.spacing.xl,
              marginBottom: t.spacing.lg,
            }}>
            {[
              {label: '收藏视频', value: displayedFavoriteCount},
              {label: '已读取视频', value: profile?.resolvedVideoCount ?? 0},
              {label: '含有效标签', value: profile?.taggedVideoCount ?? 0},
            ].map(item => (
              <View
                key={item.label}
                style={{
                  flex: 1,
                  minWidth: 80,
                  padding: t.spacing.md,
                  borderRadius: 16,
                  backgroundColor: surface,
                  borderWidth: 1,
                  borderColor: border,
                }}>
                <Text
                  style={{
                    fontSize: t.fontSize.xxl,
                    fontWeight: '700',
                    color: t.colors.text,
                  }}>
                  {item.value}
                </Text>
                <Text
                  style={{
                    fontSize: t.fontSize.xs,
                    lineHeight: 20,
                    color: t.colors.textSub,
                    marginTop: t.spacing.xs,
                  }}>
                  {item.label}
                </Text>
              </View>
            ))}
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: t.spacing.sm,
              marginBottom: t.spacing.xl,
            }}>
            <Icon
              accessible={false}
              name="shield-check-outline"
              size={20}
              color={t.colors.textSub}
            />
            <Text
              style={{
                flex: 1,
                color: t.colors.textSub,
                fontSize: t.fontSize.sm,
                lineHeight: 22,
              }}>
              画像在本机计算；查询仅发送视频 BVID
              和兴趣标签。已完成的标签缓存会保留。
            </Text>
          </View>

          <View
            style={{
              flexDirection: 'row',
              padding: t.spacing.xs,
              gap: t.spacing.xs,
              borderRadius: 18,
              backgroundColor: t.colors.surfaceHigh,
            }}>
            {(
              [
                {key: 'radar', title: '兴趣雷达'},
                {key: 'pipeline', title: '推荐路径'},
              ] as const
            ).map(tab => {
              const selected = profileView === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  accessibilityRole="button"
                  accessibilityState={{selected}}
                  activeOpacity={0.7}
                  onPress={() => setProfileView(tab.key)}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    padding: t.spacing.sm,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: selected ? border : 'transparent',
                    backgroundColor: selected
                      ? t.colors.surface
                      : 'transparent',
                  }}>
                  <Text
                    style={{
                      color: selected ? t.colors.primary : t.colors.textSub,
                      fontSize: t.fontSize.base,
                      fontWeight: selected ? '700' : '500',
                    }}>
                    {tab.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {profile && (
            <View
              style={{
                marginTop: t.spacing.lg,
                padding: t.spacing.lg,
                borderRadius: 20,
                backgroundColor: surface,
                borderWidth: 1,
                borderColor: border,
              }}>
              <Text
                accessibilityRole="header"
                style={{
                  color: t.colors.text,
                  fontSize: t.fontSize.lg,
                  fontWeight: '700',
                }}>
                {profileView === 'radar' ? '经常听见的兴趣' : '从收藏到推荐'}
              </Text>
              <Text
                style={{
                  color: t.colors.textSub,
                  fontSize: t.fontSize.sm,
                  lineHeight: 21,
                  marginTop: t.spacing.sm,
                }}>
                根据收藏视频的标签出现频次，整理你的音乐偏好。
              </Text>
              {profile.preferences.length > 0 ? (
                profileView === 'radar' ? (
                  <TagProfileRadar preferences={profile.preferences} />
                ) : (
                  <TagProfilePipeline profile={profile} />
                )
              ) : (
                <View
                  style={{alignItems: 'center', paddingVertical: t.spacing.xl}}>
                  <Icon
                    accessible={false}
                    name="tag-search-outline"
                    size={32}
                    color={t.colors.textSub}
                  />
                  <Text
                    style={{
                      color: t.colors.textSub,
                      fontSize: t.fontSize.base,
                      lineHeight: 24,
                      textAlign: 'center',
                      marginTop: t.spacing.md,
                    }}>
                    还没有可用的兴趣标签
                  </Text>
                  <Text
                    style={{
                      color: t.colors.textSub,
                      fontSize: t.fontSize.sm,
                      lineHeight: 22,
                      textAlign: 'center',
                      marginTop: t.spacing.sm,
                    }}>
                    读取收藏视频标签后，这里会呈现你的音乐喜好。
                  </Text>
                </View>
              )}
            </View>
          )}

          {(stage === 'tags' || showBackgroundProgress) && (
            <View
              style={{
                marginTop: t.spacing.lg,
                padding: t.spacing.lg,
                borderRadius: 20,
                backgroundColor: surface,
                borderWidth: 1,
                borderColor: border,
              }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.spacing.md,
                }}>
                <Text
                  accessibilityLiveRegion="polite"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: t.colors.text,
                    fontSize: t.fontSize.base,
                    lineHeight: 24,
                    fontWeight: '600',
                  }}>
                  {isBackgroundBackfillActive
                    ? '后台正在读取兴趣标签'
                    : backgroundBackfillStatus === 'paused' && stage !== 'tags'
                    ? '后台读取已暂停'
                    : '正在读取兴趣标签'}
                </Text>
                <Text
                  style={{
                    color: t.colors.primary,
                    fontSize: t.fontSize.xl,
                    fontWeight: '700',
                  }}>
                  {progressPercent}%
                </Text>
              </View>
              <Text
                style={{
                  color: t.colors.textSub,
                  fontSize: t.fontSize.sm,
                  lineHeight: 21,
                  marginTop: t.spacing.sm,
                }}>
                已完成 {displayedProgress.completedVideoCount} /{' '}
                {displayedProgress.totalVideoCount} 个视频
              </Text>
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="读取兴趣标签进度"
                accessibilityValue={{min: 0, max: 100, now: progressPercent}}
                style={{
                  height: 8,
                  marginTop: t.spacing.lg,
                  borderRadius: 4,
                  overflow: 'hidden',
                  backgroundColor: t.colors.surfaceHigh,
                }}>
                <View
                  style={{
                    height: '100%',
                    width: `${progressPercent}%`,
                    borderRadius: 4,
                    backgroundColor: t.colors.primary,
                  }}
                />
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: t.spacing.sm,
                  marginTop: t.spacing.lg,
                }}>
                {[
                  {
                    label: '有标签',
                    value: displayedProgress.successfulVideoCount,
                  },
                  {label: '无标签', value: displayedProgress.emptyVideoCount},
                  {
                    label: '读取失败',
                    value: displayedProgress.failedVideoCount,
                  },
                ].map(item => (
                  <View
                    key={item.label}
                    style={{
                      flex: 1,
                      minWidth: 72,
                      padding: t.spacing.sm,
                      borderRadius: 12,
                      backgroundColor: t.colors.surfaceHigh,
                    }}>
                    <Text
                      style={{
                        color: t.colors.textSub,
                        fontSize: t.fontSize.xs,
                        lineHeight: 20,
                      }}>
                      {item.label}
                    </Text>
                    <Text
                      style={{
                        color: t.colors.text,
                        fontSize: t.fontSize.lg,
                        fontWeight: '600',
                        marginTop: t.spacing.xs,
                      }}>
                      {item.value}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {(progress.paused ||
            (backgroundBackfillStatus === 'paused' && stage !== 'tags')) && (
            <View
              accessibilityLiveRegion="polite"
              style={{
                marginTop: t.spacing.lg,
                padding: t.spacing.lg,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: border,
                backgroundColor: surface,
              }}>
              <Text
                style={{
                  fontSize: t.fontSize.base,
                  fontWeight: '600',
                  color: t.colors.text,
                }}>
                标签读取已暂停
              </Text>
              <Text
                style={{
                  fontSize: t.fontSize.sm,
                  lineHeight: 22,
                  color: t.colors.textSub,
                  marginTop: t.spacing.sm,
                }}>
                {progress.paused
                  ? '可能与登录、网络或限流有关，本轮未继续在线搜索。已读取标签会保留，稍后可重试。'
                  : '已写入的标签会保留；点击下方按钮可继续生成推荐。'}
              </Text>
            </View>
          )}
          {((backgroundBackfillStatus === 'error' && backgroundBackfillError) ||
            error) && (
            <View
              accessibilityLiveRegion="polite"
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: t.spacing.sm,
                marginTop: t.spacing.lg,
                padding: t.spacing.lg,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: border,
                backgroundColor: surface,
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
                {error || `后台提取失败：${backgroundBackfillError}`}
              </Text>
            </View>
          )}

          <View style={{marginTop: t.spacing.xl}}>
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
                !uid || favorites.length === 0 || initialLoading || isWorking
              }
            />
            <Text
              style={{
                color: t.colors.textSub,
                fontSize: t.fontSize.sm,
                lineHeight: 22,
                marginTop: t.spacing.md,
                textAlign: 'center',
              }}>
              {favorites.length === 0 &&
              (!profile || profile.totalVideoCount === 0)
                ? '先同步至少一个收藏夹，再生成音乐推荐。'
                : '根据收藏标签，在 B 站音乐区寻找相似内容。'}
            </Text>
          </View>

          {failedSearchCount > 0 && (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: t.colors.textSub,
                fontSize: t.fontSize.sm,
                lineHeight: 22,
                marginTop: t.spacing.lg,
              }}>
              有 {failedSearchCount}{' '}
              个兴趣标签搜索失败，当前结果可能不完整，稍后可重新生成。
            </Text>
          )}
          {hasGenerated && recommendations.length === 0 && (
            <View
              style={{
                alignItems: 'center',
                padding: t.spacing.xl,
                marginTop: t.spacing.xl,
                borderRadius: 20,
                backgroundColor: surface,
                borderWidth: 1,
                borderColor: border,
              }}>
              <Icon
                accessible={false}
                name="music-note-search-outline"
                size={32}
                color={t.colors.textSub}
              />
              <Text
                style={{
                  color: t.colors.text,
                  fontSize: t.fontSize.lg,
                  fontWeight: '600',
                  lineHeight: 26,
                  marginTop: t.spacing.md,
                }}>
                暂未找到匹配的音乐
              </Text>
              <Text
                style={{
                  color: t.colors.textSub,
                  fontSize: t.fontSize.sm,
                  lineHeight: 22,
                  textAlign: 'center',
                  marginTop: t.spacing.sm,
                }}>
                可以丰富收藏内容，再次生成推荐。
              </Text>
            </View>
          )}

          {recommendations.length > 0 && (
            <View style={{marginTop: t.spacing.xxl}}>
              <Text
                accessibilityRole="header"
                style={{
                  color: t.colors.text,
                  fontSize: t.fontSize.xl,
                  fontWeight: '700',
                }}>
                与你的喜好相近
              </Text>
              <Text
                style={{
                  color: t.colors.textSub,
                  fontSize: t.fontSize.sm,
                  lineHeight: 21,
                  marginTop: t.spacing.sm,
                  marginBottom: t.spacing.lg,
                }}>
                为你找到 {recommendations.length} 个音乐视频
              </Text>
              {recommendations.map(item => (
                <TouchableOpacity
                  key={item.bvid}
                  accessibilityRole="button"
                  accessibilityLabel={`播放推荐 ${item.title}，${item.author}`}
                  activeOpacity={0.75}
                  onPress={() => handlePlayRecommendation(item)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: t.spacing.md,
                    marginBottom: t.spacing.sm,
                    borderRadius: 16,
                    backgroundColor: surface,
                    borderWidth: 1,
                    borderColor: border,
                  }}>
                  <View
                    style={{
                      width: compact ? 76 : 96,
                      height: 76,
                      borderRadius: 12,
                      overflow: 'hidden',
                      backgroundColor: t.colors.surfaceHigh,
                    }}>
                    <FastImage
                      source={{uri: item.cover}}
                      style={{width: '100%', height: '100%'}}
                      resizeMode={FastImage.resizeMode.cover}
                    />
                    <View
                      style={{
                        position: 'absolute',
                        bottom: 4,
                        right: 4,
                        paddingHorizontal: 5,
                        paddingVertical: 3,
                        borderRadius: 5,
                        backgroundColor: 'rgba(15,15,20,0.8)',
                      }}>
                      <Text style={{color: '#fff', fontSize: t.fontSize.xs}}>
                        {formatDuration(item.duration)}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={{
                      flex: 1,
                      minWidth: 0,
                      marginHorizontal: t.spacing.md,
                    }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: t.colors.text,
                        fontSize: t.fontSize.base,
                        lineHeight: 23,
                        fontWeight: '600',
                      }}>
                      {item.title}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: t.colors.textSub,
                        fontSize: t.fontSize.sm,
                        marginTop: t.spacing.xs,
                      }}>
                      {item.author}
                    </Text>
                    {item.matchedTags.length > 0 && (
                      <Text
                        numberOfLines={1}
                        style={{
                          color: t.colors.textSub,
                          fontSize: t.fontSize.xs,
                          marginTop: t.spacing.xs,
                        }}>
                        匹配：{item.matchedTags.slice(0, 2).join(' · ')}
                      </Text>
                    )}
                  </View>
                  <Icon
                    accessible={false}
                    name="play-circle-outline"
                    size={26}
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
