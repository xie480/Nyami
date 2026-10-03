import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  IOSCategory,
  IOSCategoryMode,
  IOSCategoryOptions,
  Track,
  State,
} from 'react-native-track-player';
import {AppState, ToastAndroid, Platform} from 'react-native';
import LoggerService from './LoggerService';
import {audioService, invalidateDomainCache} from './audioService';
import {audioCache} from './audioCache';
import {netStatus} from './netStatus';
import {useSettingsStore} from '../store/settingsStore';
import {config} from '../config';
import {usePlayerStore} from '../store/playerStore';
import {performanceMonitor} from './performanceMonitor';
import type {FavoriteVideo, VideoPart} from '../types/domain';
import {storage} from '../core/storage';
import {useProgressStore} from '../store/progressStore';
import {getCachedUrl, setCachedUrl, invalidateUrl} from './urlCache';
import {persistVideoPartsToDb} from '../db/operations';
import {useAuthStore} from '../store/authStore';
import {loadMorePersonalizedSongs} from './homeRecommendationService';
import {searchVideoToFavoriteVideo} from './transformers';
import {consumeExpiredSleepTimer} from './sleepTimer';

let _ready = false;

const MIN_NATIVE_BUFFER = 8;
const TARGET_NATIVE_BUFFER = 12;
let queueRevision = 0;
const videoPartsLoadPromises = new Map<string, Promise<void>>();
const hydratedTrackCache = new Map<string, {tracks: Track[]; expiresAt: number}>();
const trackHydrationPromises = new Map<string, Promise<Track[]>>();
let queueMaintenanceRequested = false;
let queueMaintenancePromise: Promise<void> | null = null;
let queueEndRecoveryPromise: Promise<void> | null = null;
let nativeQueueMutation: Promise<void> = Promise.resolve();
let playbackIntent = false;
let userPauseRevision = 0;
let pendingNetworkPlaybackRetry: {
  bvid: string;
  cid?: number;
  pauseRevision: number;
} | null = null;
let personalizedPageController: AbortController | null = null;
let audioTransitionRevision = 0;
let volumeFadeRevision = 0;
let preferredPlayerVolume = 1;
let lastFadeInTrackKey: string | null = null;
let lastFadeInStartedAt = 0;
let naturalFadeOutTrackKey: string | null = null;
let activeVolumeFade: {
  revision: number;
  targetVolume: number;
  promise: Promise<void>;
} | null = null;
const playbackErrorAttempts = new Map<string, number>();
const playbackErrorRecoveries = new Map<string, Promise<void>>();

function beginAudioTransition(): number {
  audioTransitionRevision += 1;
  lastFadeInTrackKey = null;
  return audioTransitionRevision;
}

function trackFadeKey(track?: Track): string | null {
  if (!track?.id) return null;
  return `${track.id}:${(track as any).cid ?? ''}`;
}

function fadePlayerVolumeTo(
  targetVolume: number,
  durationMs: number,
  transitionRevision: number,
): Promise<void> {
  const currentFade = activeVolumeFade;
  if (
    currentFade &&
    currentFade.revision === transitionRevision &&
    currentFade.targetVolume === targetVolume
  ) {
    return currentFade.promise;
  }

  const fadeRevision = ++volumeFadeRevision;
  const promise = (async () => {
    try {
      const startVolume = await TrackPlayer.getVolume();
      if (
        transitionRevision !== audioTransitionRevision ||
        fadeRevision !== volumeFadeRevision
      ) {
        return;
      }
      const steps = config.playback.fadeStepCount;
      const stepDelayMs = durationMs / steps;
      for (let step = 1; step <= steps; step += 1) {
        if (
          transitionRevision !== audioTransitionRevision ||
          fadeRevision !== volumeFadeRevision
        ) {
          return;
        }
        const progress = step / steps;
        const volume = startVolume + (targetVolume - startVolume) * progress;
        await TrackPlayer.setVolume(volume);
        if (step < steps) {
          await new Promise<void>(resolve => setTimeout(resolve, stepDelayMs));
        }
      }
    } catch {
      // Volume transition failures must not block playback controls.
    }
  })();
  const transition = {revision: transitionRevision, targetVolume, promise};
  activeVolumeFade = transition;
  void promise.finally(() => {
    if (activeVolumeFade === transition) {
      activeVolumeFade = null;
    }
  });
  return promise;
}

async function fadeInActiveTrack(
  transitionRevision: number,
  knownTrack?: Track,
): Promise<void> {
  if (transitionRevision !== audioTransitionRevision) return;
  let track: Track | undefined;
  try {
    track = knownTrack ?? await TrackPlayer.getActiveTrack();
  } catch {
    return;
  }
  const key = trackFadeKey(track);
  if (!key || transitionRevision !== audioTransitionRevision) return;
  if (
    lastFadeInTrackKey === key &&
    Date.now() - lastFadeInStartedAt < config.playback.fadeInDurationMs
  ) {
    return;
  }
  lastFadeInTrackKey = key;
  lastFadeInStartedAt = Date.now();
  try {
    await TrackPlayer.setVolume(0);
  } catch {
    return;
  }
  if (transitionRevision === audioTransitionRevision) {
    void fadePlayerVolumeTo(
      preferredPlayerVolume,
      config.playback.fadeInDurationMs,
      transitionRevision,
    );
  }
}

async function playTrackWithFadeIn(transitionRevision: number): Promise<boolean> {
  if (transitionRevision !== audioTransitionRevision) return false;
  try {
    await TrackPlayer.setVolume(0);
  } catch {
    // Volume transition support must not prevent the track from playing.
  }
  if (transitionRevision !== audioTransitionRevision) return false;
  await TrackPlayer.play();
  if (transitionRevision !== audioTransitionRevision) return false;
  playbackIntent = true;
  void fadeInActiveTrack(transitionRevision);
  return true;
}

async function fadeOutForTransition(transitionRevision: number): Promise<void> {
  if (transitionRevision !== audioTransitionRevision) return;
  if (!playbackIntent) {
    try {
      await TrackPlayer.setVolume(0);
    } catch {}
    return;
  }
  await fadePlayerVolumeTo(
    0,
    config.playback.fadeOutDurationMs,
    transitionRevision,
  );
}

function handlePlaybackProgress(
  position: number,
  duration: number,
  trackIndex: number,
) {
  if (!playbackIntent || !Number.isFinite(position) || !Number.isFinite(duration)) {
    return;
  }

  const remainingSeconds = duration - position;
  const fadeOutLeadSeconds = config.playback.fadeOutLeadMs / 1000;
  const trackKey = `index:${trackIndex}`;
  if (remainingSeconds > fadeOutLeadSeconds) {
    if (naturalFadeOutTrackKey === trackKey) {
      naturalFadeOutTrackKey = null;
      void fadePlayerVolumeTo(
        preferredPlayerVolume,
        config.playback.fadeInDurationMs,
        audioTransitionRevision,
      );
    }
    return;
  }

  if (remainingSeconds <= 0 || naturalFadeOutTrackKey === trackKey) {
    return;
  }

  naturalFadeOutTrackKey = trackKey;
  void fadePlayerVolumeTo(
    0,
    config.playback.fadeOutDurationMs,
    audioTransitionRevision,
  );
}

function advanceQueueRevision(): number {
  queueRevision += 1;
  clearPendingSkipRequests();
  personalizedPageController?.abort();
  personalizedPageController = null;
  usePlayerStore.getState().setQueueLoading(false);
  playbackErrorAttempts.clear();
  return queueRevision;
}

function withNativeQueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeQueueMutation.then(operation, operation);
  nativeQueueMutation = result.then(() => undefined, () => undefined);
  return result;
}

function findNativeNextIndex(
  nativeQueue: Track[],
  activeIndex: number | undefined,
  endedBvid: string | undefined,
  logicalQueue: FavoriteVideo[],
): number {
  if (typeof activeIndex === 'number' && activeIndex >= 0) {
    return activeIndex + 1 < nativeQueue.length ? activeIndex + 1 : -1;
  }

  const endedIndex = nativeQueue.findIndex(track => track.id === endedBvid);
  if (endedIndex !== -1) {
    return endedIndex + 1 < nativeQueue.length ? endedIndex + 1 : -1;
  }

  const logicalIndex = logicalQueue.findIndex(video => video.bvid === endedBvid);
  for (let i = Math.max(0, logicalIndex + 1); i < logicalQueue.length; i++) {
    const nativeIndex = nativeQueue.findIndex(
      track => track.id === logicalQueue[i].bvid,
    );
    if (nativeIndex !== -1) {
      return nativeIndex;
    }
  }
  return -1;
}

export async function setupPlayer() {
  if (_ready) {
    return;
  }
  try {
    const mixWithOthers = useSettingsStore.getState().mixWithOthers;
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: !mixWithOthers,
      iosCategory: IOSCategory.Playback,
      iosCategoryMode: IOSCategoryMode.Default,
      iosCategoryOptions: mixWithOthers
        ? [IOSCategoryOptions.MixWithOthers]
        : [],
    });
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
      },
      color: 0xfffb7299,
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
        Capability.Stop,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      progressUpdateEventInterval: config.playback.progressUpdateIntervalSeconds,
    });
    await TrackPlayer.setVolume(preferredPlayerVolume);

    AppState.addEventListener('change', async nextAppState => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        try {
          const progress = useProgressStore.getState();
          if (progress.position > 0) {
            storage.setNumber('lastPlaybackPosition', progress.position);
          }
        } catch (e) {}
      }
    });

    if (!usePlayerStore.persist.hasHydrated()) {
      await new Promise<void>(resolve => {
        const unsub = usePlayerStore.persist.onFinishHydration(() => {
          unsub();
          resolve();
        });
      });
    }

    const store = usePlayerStore.getState();
    if (store.queue && store.queue.length > 0 && store.currentBvid) {
      try {
        const revision = queueRevision;
        const currentBvid = store.currentBvid;
        const currentIdx = store.queue.findIndex(v => v.bvid === currentBvid);

        if (currentIdx !== -1) {
          const targetVideo = store.queue[currentIdx];
          const realTracks = await hydrateVideo(targetVideo);
          if (realTracks.length > 0 && revision === queueRevision) {
            await withNativeQueueMutation(async () => {
              if (revision !== queueRevision) {
                return;
              }
              await TrackPlayer.reset();
              if (revision !== queueRevision) {
                return;
              }
              await TrackPlayer.add(realTracks);

              const lastPosition = storage.getNumber('lastPlaybackPosition');
              if (lastPosition && lastPosition > 0) {
                await TrackPlayer.seekTo(lastPosition);
              }
              await TrackPlayer.pause();
              playbackIntent = false;
            });

            // 异步水合后续轨道
            if (revision === queueRevision) {
              maintainQueueBuffer().catch(() => {});
            }
          }
        }
      } catch (e) {
        LoggerService.error(
          'TrackPlayer',
          'setupPlayer',
          'Cold start hydration failed',
          e,
        );
      }
    }
  } catch (e) {
    LoggerService.error('TrackPlayer', 'setupPlayer', 'setupPlayer error:', e);
  }
  _ready = true;
}

function getHydratedTrackCacheKey(v: FavoriteVideo, targetCid?: number): string {
  const settings = useSettingsStore.getState();
  const cid = targetCid ?? v.parts?.[0]?.cid ?? 'default';
  return `${v.bvid}:${cid}:${settings.quality}:${settings.expandMultiPart ? 'parts' : 'single'}`;
}

function invalidateHydratedTrackCache(bvid: string): void {
  const keyPrefix = `${bvid}:`;
  for (const key of hydratedTrackCache.keys()) {
    if (key.startsWith(keyPrefix)) hydratedTrackCache.delete(key);
  }
}

async function hydrateVideo(
  v: FavoriteVideo,
  targetCid?: number,
): Promise<Track[]> {
  const cacheKey = getHydratedTrackCacheKey(v, targetCid);
  const now = Date.now();
  const cached = hydratedTrackCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    hydratedTrackCache.delete(cacheKey);
    hydratedTrackCache.set(cacheKey, cached);
    return cached.tracks;
  }
  if (cached) hydratedTrackCache.delete(cacheKey);

  const pending = trackHydrationPromises.get(cacheKey);
  if (pending) return pending;

  const hydration = hydrateVideoUncached(v, targetCid);
  trackHydrationPromises.set(cacheKey, hydration);
  try {
    const tracks = await hydration;
    if (tracks.length > 0) {
      hydratedTrackCache.set(cacheKey, {
        tracks,
        expiresAt: Date.now() + config.playback.hydratedTrackCacheTtlMs,
      });
      while (hydratedTrackCache.size > config.playback.hydratedTrackCacheLimit) {
        const oldestKey = hydratedTrackCache.keys().next().value;
        if (!oldestKey) break;
        hydratedTrackCache.delete(oldestKey);
      }
    }
    return tracks;
  } finally {
    if (trackHydrationPromises.get(cacheKey) === hydration) {
      trackHydrationPromises.delete(cacheKey);
    }
  }
}

async function hydrateVideoUncached(
  v: FavoriteVideo,
  targetCid?: number,
): Promise<Track[]> {
  try {
    const quality = useSettingsStore.getState().quality;
    const cid =
      targetCid ?? (v.parts && v.parts.length > 0 ? v.parts[0].cid : undefined);

    const cacheKey = cid ? `${v.bvid}-${cid}` : v.bvid;
    const playContext = usePlayerStore.getState().playContext;
    const isPersonalizedNoCache =
      !!playContext?.isPersonalized &&
      !useSettingsStore.getState().cachePersonalizedRecommendations;
    const isNoCacheFolder = v.folderIds?.some(id =>
      useSettingsStore.getState().noCacheFolderIds?.includes(id),
    ) ?? false;
    const shouldCacheAudio = !isNoCacheFolder && !isPersonalizedNoCache;
    if (!targetCid && !v.parts?.length) {
      void ensureCurrentVideoParts(v.bvid, queueRevision);
    }

    let url = '';
    let headers: Record<string, string> | undefined;
    let effectiveCid = cid;
    let title = v.title;
    let partsToExpand: VideoPart[] = [];

    const cachedPath = !isNoCacheFolder
      ? await audioCache.has(cacheKey, quality)
      : null;
    if (cachedPath) {
      url = `file://${cachedPath}`;
    } else {
      const cachedUrlEntry = getCachedUrl(v.bvid, cid);
      if (cachedUrlEntry) {
        url = cachedUrlEntry.url;
        headers = cachedUrlEntry.headers;
        // effectiveCid = cachedUrlEntry.cid; // CachedUrlEntry doesn't have cid, it's in the key
      } else {
        const info = await audioService.getInfo(v.bvid, quality, cid);
        url = info.audio.baseUrl;
        headers = {Referer: config.referer, 'User-Agent': config.userAgent};
        effectiveCid = cid ?? info.cid;
        setCachedUrl(v.bvid, url, headers, effectiveCid);

        if (shouldCacheAudio) {
          audioCache.download(cacheKey, quality, url, headers).catch(() => {});
        }

        if (!cid && info.parts && info.parts.length > 1) {
          title = `${info.title} - ${info.parts[0].title}`;
          storeVideoParts(v.bvid, info.parts);
          if (useSettingsStore.getState().expandMultiPart) {
            partsToExpand = info.parts.slice(1);
          }
        }
      }
    }

    const tracks: Track[] = [
      {
        id: v.bvid,
        url: url,
        title: title,
        artist: v.upper?.name || '未知作者',
        artwork: v.cover,
        duration: v.duration,
        userAgent: config.userAgent,
        headers: headers,
        cid: effectiveCid,
      } as Track,
    ];

    if (partsToExpand.length > 0) {
      const partTracks = await Promise.all(
        partsToExpand.map(async part => {
          const partInfo = await audioService.getInfo(
            v.bvid,
            quality,
            part.cid,
          );
          return {
            id: v.bvid,
            url: partInfo.audio.baseUrl,
            title: `${v.title} - ${part.title}`,
            artist: v.upper?.name || '未知作者',
            artwork: v.cover,
            duration: part.duration,
            userAgent: config.userAgent,
            headers: {Referer: config.referer, 'User-Agent': config.userAgent},
            cid: part.cid,
          } as Track;
        }),
      );
      tracks.push(...partTracks);
    }

    return tracks;
  } catch (error) {
    LoggerService.error(
      'TrackPlayer',
      'hydrateVideo',
      `Failed to hydrate ${v.bvid}`,
      error,
    );
    return [];
  }
}

async function maintainQueueBufferOnce(revision: number): Promise<void> {
  let logicalQueue = usePlayerStore.getState().queue;
  const nativeQueue = await TrackPlayer.getQueue();
  const activeIndex = await TrackPlayer.getActiveTrackIndex();

  if (revision !== queueRevision || typeof activeIndex !== 'number') {
    return;
  }

  const remaining = nativeQueue.length - 1 - activeIndex;
  LoggerService.info(
    'TrackPlayer',
    'maintainQueueBuffer',
    `revision: ${revision}, nativeLength: ${nativeQueue.length}, activeIndex: ${activeIndex}, remaining: ${remaining}`,
  );

  if (remaining >= MIN_NATIVE_BUFFER) {
    return;
  }

  const need = TARGET_NATIVE_BUFFER - remaining;
  const activeTrack = nativeQueue[activeIndex];
  if (!activeTrack?.id) {
    return;
  }

  const logicalIndex = logicalQueue.findIndex(v => v.bvid === activeTrack.id);
  if (logicalIndex === -1) {
    return;
  }

  const playerState = usePlayerStore.getState();
  const playContext = playerState.playContext;
  const logicalRemaining = logicalQueue.length - logicalIndex - 1;
  if (
    playContext?.isPersonalized &&
    playContext.recommendationHasMore !== false &&
    logicalRemaining < need &&
    !playerState.queueLoading
  ) {
    const uid = useAuthStore.getState().userId;
    if (uid) {
      const page = (playContext.recommendationPage ?? 1) + 1;
      const controller = new AbortController();
      personalizedPageController = controller;
      playerState.setQueueLoading(true);
      try {
        const result = await loadMorePersonalizedSongs(
          uid,
          page,
          logicalQueue.map(video => video.bvid),
          controller.signal,
        );
        if (
          revision !== queueRevision ||
          controller.signal.aborted ||
          useAuthStore.getState().userId !== uid
        ) {
          return;
        }

        const latestState = usePlayerStore.getState();
        if (!latestState.playContext?.isPersonalized) return;
        const knownVideoIds = new Set(latestState.queue.map(video => video.bvid));
        const nextVideos = result.recommendations
          .filter(video => !knownVideoIds.has(video.bvid))
          .map(searchVideoToFavoriteVideo);
        const nextContext = {
          ...latestState.playContext,
          recommendationPage: page,
          recommendationHasMore: result.hasMore,
        };
        if (nextVideos.length > 0) {
          const combinedQueue = [...latestState.queue, ...nextVideos];
          usePlayerStore.setState({
            queue: combinedQueue,
            originalQueue: [...latestState.originalQueue, ...nextVideos],
            playContext: nextContext,
          });
          logicalQueue = combinedQueue;
        } else {
          latestState.setPlayContext(nextContext);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          LoggerService.warn(
            'maintainQueueBuffer',
            'personalizedRecommendations',
            '个性化推荐续页失败；当前队列继续播放',
            error,
          );
        }
      } finally {
        if (personalizedPageController === controller) {
          personalizedPageController = null;
        }
        usePlayerStore.getState().setQueueLoading(false);
      }
    }
  }

  const nativeIds = new Set(nativeQueue.map(t => t.id));
  let addedCount = 0;
  let i = logicalIndex + 1;

  while (addedCount < need && i < logicalQueue.length) {
    if (revision !== queueRevision) {
      return;
    }

    const video = logicalQueue[i];
    if (!nativeIds.has(video.bvid)) {
      try {
        const tracks = await hydrateVideo(video);
        if (revision !== queueRevision) {
          return;
        }

        if (tracks.length > 0) {
          const appended = await withNativeQueueMutation(async () => {
            if (revision !== queueRevision) {
              return false;
            }

            const latestQueue = await TrackPlayer.getQueue();
            if (latestQueue.some(track => track.id === video.bvid)) {
              return false;
            }
            const latestActiveIndex = await TrackPlayer.getActiveTrackIndex();
            if (revision !== queueRevision) {
              return false;
            }
            if (typeof latestActiveIndex === 'number') {
              const latestActiveTrack = latestQueue[latestActiveIndex];
              const latestLogicalQueue = usePlayerStore.getState().queue;
              const latestLogicalIndex = latestLogicalQueue.findIndex(
                item => item.bvid === latestActiveTrack?.id,
              );
              const candidateIndex = latestLogicalQueue.findIndex(
                item => item.bvid === video.bvid,
              );
              if (
                latestLogicalIndex !== -1 &&
                candidateIndex !== -1 &&
                candidateIndex <= latestLogicalIndex
              ) {
                return false;
              }
            }

            await TrackPlayer.add(tracks);
            return true;
          });

          if (appended) {
            nativeIds.add(video.bvid);
            addedCount++;
            LoggerService.info(
              'TrackPlayer',
              'maintainQueueBuffer',
              `revision: ${revision}, 即时追加成功: ${video.bvid}`,
            );
          }
        } else {
          LoggerService.warn(
            'TrackPlayer',
            'maintainQueueBuffer',
            `跳过失效视频: ${video.bvid}`,
          );
        }
      } catch (e) {
        LoggerService.warn(
          'TrackPlayer',
          'maintainQueueBuffer',
          `解析异常跳过: ${video.bvid}`,
          e,
        );
      }
    }
    i++;
  }
}

async function runQueueBufferMaintenance(): Promise<void> {
  try {
    while (queueMaintenanceRequested) {
      queueMaintenanceRequested = false;
      await maintainQueueBufferOnce(queueRevision);
    }
  } finally {
    queueMaintenancePromise = null;
    if (queueMaintenanceRequested) {
      await maintainQueueBuffer();
    }
  }
}

function maintainQueueBuffer(): Promise<void> {
  queueMaintenanceRequested = true;
  if (!queueMaintenancePromise) {
    queueMaintenancePromise = runQueueBufferMaintenance();
  }
  return queueMaintenancePromise;
}

export async function loadQueue(
  videos: FavoriteVideo[],
  startBvid?: string,
): Promise<number> {
  if (!videos || videos.length === 0) {
    return 0;
  }

  const revision = advanceQueueRevision();
  const pauseRevision = userPauseRevision;
  usePlayerStore.getState().setPlaybackError(null);
  usePlayerStore.getState().setResolving(true);
  try {
    const startIndex = Math.max(
      0,
      startBvid ? videos.findIndex(v => v.bvid === startBvid) : 0,
    );

    const targetVideo = videos[startIndex];
    const previousVideo = startIndex > 0 ? videos[startIndex - 1] : undefined;
    if (previousVideo) {
      // 与当前歌曲解析并行，让用户立即点上一首时复用正在完成的请求。
      void hydrateVideo(previousVideo);
    }

    // 1. 仅水合当前目标歌曲 (Fast Path)，实现秒播
    const targetTracks = await hydrateVideo(targetVideo);
    if (revision !== queueRevision) {
      return 0;
    }

    if (targetTracks.length === 0) {
      usePlayerStore.getState().setPlaybackError('加载音频失败，请检查网络');
      return 0;
    }

    // 2. 串行重置并播放首曲；过期的加载不能覆盖较新的队列。
    const audioRevision = beginAudioTransition();
    const loaded = await withNativeQueueMutation(async () => {
      if (revision !== queueRevision) {
        return false;
      }
      await fadeOutForTransition(audioRevision);
      if (
        revision !== queueRevision ||
        (audioRevision !== audioTransitionRevision &&
          pauseRevision === userPauseRevision)
      ) {
        return false;
      }
      playbackIntent = false;
      await TrackPlayer.reset();
      if (revision !== queueRevision) {
        return false;
      }
      await TrackPlayer.add(targetTracks);
      if (revision !== queueRevision) {
        return false;
      }
      if (pauseRevision !== userPauseRevision && !playbackIntent) {
        return true;
      }
      const started = await playTrackWithFadeIn(audioRevision);
      return started || (pauseRevision !== userPauseRevision && !playbackIntent);
    });
    if (!loaded || revision !== queueRevision) {
      return 0;
    }

    if (targetTracks[0]) {
      autoCache(targetTracks[0].id as string);
    }

    usePlayerStore.getState().setCurrentQueue(videos, startBvid);

    // 3. 触发后台水合后续轨道 (Slow Path)
    // 依赖 maintainQueueBuffer 自动补齐 TARGET_NATIVE_BUFFER
    maintainQueueBuffer().catch(e => {
      LoggerService.error(
        'TrackPlayer',
        'loadQueue',
        'Background hydration failed',
        e,
      );
    });

    return 1;
  } finally {
    if (revision === queueRevision) {
      usePlayerStore.getState().setResolving(false);
    }
  }
}

export async function playWithIntent(): Promise<void> {
  if (playbackIntent) return;
  const audioRevision = beginAudioTransition();
  await withNativeQueueMutation(async () => {
    await playTrackWithFadeIn(audioRevision);
  });
}

function storeVideoParts(bvid: string, parts: VideoPart[]): void {
  if (parts.length <= 1) return;
  usePlayerStore.getState().updateVideoParts(bvid, parts);
  persistVideoPartsToDb(bvid, parts).catch(() => {});
}

function ensureCurrentVideoParts(
  bvid: string,
  expectedQueueRevision: number,
): Promise<void> {
  const currentPlayer = usePlayerStore.getState();
  const currentVideo = currentPlayer.queue.find(video => video.bvid === bvid);
  const context = currentPlayer.playContext;
  if (
    currentPlayer.currentBvid !== bvid ||
    !currentVideo ||
    currentVideo.parts?.length ||
    !(context?.includeVideoParts || context?.onlineSearch || context?.isPersonalized)
  ) {
    return Promise.resolve();
  }

  const pendingLoad = videoPartsLoadPromises.get(bvid);
  if (pendingLoad) return pendingLoad;

  let loadPromise!: Promise<void>;
  loadPromise = (async () => {
    try {
      const info = await audioService.getVideoInfo(bvid);
      const latestPlayer = usePlayerStore.getState();
      const latestVideo = latestPlayer.queue.find(video => video.bvid === bvid);
      if (
        expectedQueueRevision !== queueRevision ||
        latestPlayer.currentBvid !== bvid ||
        !latestVideo ||
        latestVideo.parts?.length
      ) {
        return;
      }
      const parts = (info.pages ?? []).map(page => ({
        cid: page.cid,
        page: page.page,
        title: page.part,
        duration: page.duration,
      }));
      storeVideoParts(bvid, parts);
    } catch {
      // 分P列表属于附加信息，详情失败不影响当前音频继续播放。
    } finally {
      if (videoPartsLoadPromises.get(bvid) === loadPromise) {
        videoPartsLoadPromises.delete(bvid);
      }
    }
  })();
  videoPartsLoadPromises.set(bvid, loadPromise);
  return loadPromise;
}

export async function pausePlayback(): Promise<void> {
  const wasPlaying = playbackIntent;
  const audioRevision = beginAudioTransition();
  userPauseRevision += 1;
  playbackIntent = false;
  await withNativeQueueMutation(async () => {
    if (wasPlaying) {
      await fadePlayerVolumeTo(
        0,
        config.playback.fadeOutDurationMs,
        audioRevision,
      );
    } else {
      try {
        await TrackPlayer.setVolume(0);
      } catch {}
    }
    if (audioRevision !== audioTransitionRevision) return;
    await TrackPlayer.pause();
    playbackIntent = false;
  });
}

export async function playQueuedTrack(bvid: string): Promise<boolean> {
  const revision = queueRevision;
  const pauseRevision = userPauseRevision;
  const audioRevision = beginAudioTransition();
  return withNativeQueueMutation(async () => {
    if (revision !== queueRevision) {
      return false;
    }
    await fadeOutForTransition(audioRevision);
    if (revision !== queueRevision || audioRevision !== audioTransitionRevision) {
      return false;
    }
    const nativeQueue = await TrackPlayer.getQueue();
    const nativeIndex = nativeQueue.findIndex(track => track.id === bvid);
    if (revision !== queueRevision) {
      return false;
    }
    if (nativeIndex === -1) {
      return false;
    }
    await TrackPlayer.skip(nativeIndex);
    if (revision !== queueRevision) {
      return false;
    }
    if (pauseRevision !== userPauseRevision && !playbackIntent) {
      return true;
    }
    await TrackPlayer.play();
    playbackIntent = true;
    void fadeInActiveTrack(audioTransitionRevision);
    usePlayerStore.getState().setCurrentBvid(bvid);
    usePlayerStore.getState().setPlaybackError(null);
    return true;
  });
}

export async function resolveCurrentTrack(_version: number): Promise<void> {
  // 废弃
}

export async function insertNext(video: FavoriteVideo): Promise<void> {
  const revision = advanceQueueRevision();
  const cur = usePlayerStore.getState();
  const logicalQueue = [...cur.queue];

  const activeTrack = await TrackPlayer.getActiveTrack();
  const currentBvid = activeTrack?.id as string | undefined;

  let insertPos = logicalQueue.length;
  if (currentBvid) {
    const idx = logicalQueue.findIndex(v => v.bvid === currentBvid);
    if (idx !== -1) {
      insertPos = idx + 1;
    }
  }

  if (revision !== queueRevision) {
    return;
  }
  logicalQueue.splice(insertPos, 0, video);
  const originalQueue = [
    ...(cur.originalQueue.length > 0 ? cur.originalQueue : cur.queue),
  ];
  const originalCurrentIndex = originalQueue.findIndex(
    item => item.bvid === currentBvid,
  );
  originalQueue.splice(
    originalCurrentIndex === -1 ? originalQueue.length : originalCurrentIndex + 1,
    0,
    video,
  );
  usePlayerStore.setState({queue: logicalQueue, originalQueue});

  const realTracks = await hydrateVideo(video);
  if (revision !== queueRevision) {
    return;
  }

  if (realTracks.length > 0) {
    await withNativeQueueMutation(async () => {
      if (revision !== queueRevision) {
        return;
      }
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      if (revision !== queueRevision) {
        return;
      }
      if (typeof activeIndex === 'number') {
        await TrackPlayer.add(realTracks, activeIndex + 1);
      }
    });
  }
  maintainQueueBuffer().catch(() => {});
}

export async function removeFromQueue(bvid: string): Promise<void> {
  advanceQueueRevision();
  const cur = usePlayerStore.getState();
  const filtered = cur.queue.filter(v => v.bvid !== bvid);
  const originalQueue = (
    cur.originalQueue.length > 0 ? cur.originalQueue : cur.queue
  ).filter(video => video.bvid !== bvid);
  usePlayerStore.setState({queue: filtered, originalQueue});

  // 工业级方案：禁止在运行时 remove native queue，仅更新 logical queue
  maintainQueueBuffer().catch(() => {});
}

export async function reorderQueue(
  videos: FavoriteVideo[],
  startBvid?: string,
): Promise<void> {
  advanceQueueRevision();
  if (videos.length === 0) {
    usePlayerStore.getState().setQueue([], undefined);
    const audioRevision = beginAudioTransition();
    await withNativeQueueMutation(async () => {
      await fadeOutForTransition(audioRevision);
      if (audioRevision !== audioTransitionRevision) return;
      await TrackPlayer.reset();
      playbackIntent = false;
    });
    return;
  }

  const cur = usePlayerStore.getState();
  cur.setCurrentQueue(videos, startBvid ?? cur.currentBvid ?? undefined);

  const activeTrack = await TrackPlayer.getActiveTrack();
  const currentBvid = activeTrack?.id as string | undefined;

  if (!currentBvid) {
    await loadQueue(videos, startBvid);
    return;
  }

  const newCurrentIndex = videos.findIndex(v => v.bvid === currentBvid);
  if (newCurrentIndex === -1) {
    // 当前播放的歌曲被移除了，重新初始化队列
    await loadQueue(videos, startBvid);
    return;
  }

  // 工业级方案：禁止在运行时 remove native queue，仅更新 logical queue
  // 依赖 maintainQueueBuffer 自动补充新的后续轨道
  maintainQueueBuffer().catch(() => {});
}

export async function appendQueue(
  videos: FavoriteVideo[],
  startBvid?: string,
): Promise<void> {
  if (videos.length === 0) {
    return;
  }

  advanceQueueRevision();
  const cur = usePlayerStore.getState();
  const combined = [...cur.queue, ...videos];
  const originalQueue = [
    ...(cur.originalQueue.length > 0 ? cur.originalQueue : cur.queue),
    ...videos,
  ];
  usePlayerStore.setState({queue: combined, originalQueue});

  maintainQueueBuffer().catch(() => {});
}

async function autoCache(bvid: string, cid?: number) {
  const s = useSettingsStore.getState();
  const playContext = usePlayerStore.getState().playContext;
  if (playContext?.isPersonalized && !s.cachePersonalizedRecommendations) {
    return;
  }
  if (!s.autoCacheOnWifi || !netStatus.isWifi()) {
    return;
  }

  const videoInQueue = usePlayerStore
    .getState()
    .queue.find(v => v.bvid === bvid);
  const isNoCache =
    videoInQueue?.folderIds?.some(id => s.noCacheFolderIds?.includes(id)) ??
    false;
  if (isNoCache) {
    return;
  }

  const cacheKey = cid ? `${bvid}-${cid}` : bvid;
  if (await audioCache.has(cacheKey, s.quality)) {
    return;
  }
  try {
    const info = await audioService.getInfo(bvid, s.quality, cid);
    await audioCache.download(cacheKey, s.quality, info.audio.baseUrl, {
      Referer: config.referer,
      'User-Agent': config.userAgent,
    });
  } catch {}
}

export async function resumePlayback(): Promise<void> {
  if (playbackIntent) return;
  const audioRevision = beginAudioTransition();
  await withNativeQueueMutation(async () => {
    await playTrackWithFadeIn(audioRevision);
  }).catch(() => {});
}

let lastSkipToastTime = 0;
let isSkipping = false;
let skipRequestInFlight = false;
let skipRequestDrainPromise: Promise<void> | null = null;
let pendingQueueEndRecoveryIndex: number | null = null;

interface PendingSkipRequest {
  direction: 'next' | 'previous';
  pauseRevision: number;
  resolve: () => void;
}

const pendingSkipRequests: PendingSkipRequest[] = [];

function clearPendingSkipRequests(): void {
  for (const request of pendingSkipRequests.splice(0)) {
    request.resolve();
  }
}

function startPendingQueueEndRecovery(): void {
  if (pendingQueueEndRecoveryIndex === null) return;
  const endedTrackIndex = pendingQueueEndRecoveryIndex;
  pendingQueueEndRecoveryIndex = null;
  void recoverQueueAfterEnd(endedTrackIndex).catch(error => {
    LoggerService.error(
      'TrackPlayer',
      'PlaybackQueueEnded',
      '延迟恢复队列结束状态失败',
      error,
    );
  });
}

function scheduleSkipRequestDrain(): void {
  if (
    skipRequestDrainPromise ||
    isSkipping ||
    pendingSkipRequests.length === 0
  ) {
    return;
  }

  let drainPromise!: Promise<void>;
  drainPromise = drainSkipRequests().finally(() => {
    if (skipRequestDrainPromise === drainPromise) {
      skipRequestDrainPromise = null;
    }
    if (!isSkipping && pendingSkipRequests.length > 0) {
      scheduleSkipRequestDrain();
    }
  });
  skipRequestDrainPromise = drainPromise;
}

async function drainSkipRequests(): Promise<void> {
  while (pendingSkipRequests.length > 0) {
    const recovery = queueEndRecoveryPromise;
    if (recovery) {
      await recovery.catch(() => {});
    }
    if (isSkipping) return;

    const request = pendingSkipRequests.shift();
    if (!request) continue;
    isSkipping = true;
    skipRequestInFlight = true;
    try {
      if (request.direction === 'next') {
        await performNextSkip(request.pauseRevision);
      } else {
        await performPreviousSkip(request.pauseRevision);
      }
    } finally {
      skipRequestInFlight = false;
      isSkipping = false;
      request.resolve();
      startPendingQueueEndRecovery();
    }
  }
}

function enqueueSkipRequest(
  direction: PendingSkipRequest['direction'],
  pauseRevision: number,
): Promise<void> {
  const queueCapacity = Math.max(1, usePlayerStore.getState().queue.length);
  const outstandingRequests =
    pendingSkipRequests.length + (skipRequestInFlight ? 1 : 0);
  if (outstandingRequests >= queueCapacity) {
    return Promise.resolve();
  }

  let resolveRequest!: () => void;
  const requestPromise = new Promise<void>(resolve => {
    resolveRequest = resolve;
  });
  pendingSkipRequests.push({
    direction,
    pauseRevision,
    resolve: resolveRequest,
  });
  scheduleSkipRequestDrain();
  return requestPromise;
}

function skipToNextWithPauseRevision(pauseRevision: number): Promise<void> {
  return enqueueSkipRequest('next', pauseRevision);
}

async function performNextSkip(pauseRevision: number): Promise<void> {
  const revision = queueRevision;
  try {
    let skipped = await skipNativeQueueToNext(pauseRevision);
    if (revision !== queueRevision) return;
    const hasLogicalNext = !skipped && await hasLogicalNextTrack();
    if (hasLogicalNext) {
      const buffered = await ensureNextLogicalTrackBuffered(revision);
      if (buffered && revision === queueRevision) {
        skipped = await skipNativeQueueToNext(pauseRevision);
      }
    }

    if (skipped) {
      maintainQueueBuffer().catch(() => {});
    }
    if (!skipped && hasLogicalNext) {
      usePlayerStore.getState().setPlaybackError('下一首暂时无法加载，请检查网络后重试');
      showQueueNotReadyToast();
    } else if (skipped) {
      usePlayerStore.getState().setPlaybackError(null);
    }
  } catch (e) {
    LoggerService.error(
      'TrackPlayer',
      'skipToNext',
      'Error skipping to next',
      e,
    );
    usePlayerStore.getState().setPlaybackError('下一首暂时无法加载，请检查网络后重试');
    showQueueNotReadyToast();
    maintainQueueBuffer().catch(() => {});
  }
}

function showQueueNotReadyToast(message = '下一首暂时无法播放，请检查网络后重试') {
  const now = Date.now();
  if (now - lastSkipToastTime > 2000) {
    if (Platform.OS === 'android') {
      try {
        ToastAndroid.show(message, ToastAndroid.SHORT);
      } catch (e) {}
    }
    lastSkipToastTime = now;
  }
}

async function hasLogicalNextTrack(): Promise<boolean> {
  const activeTrack = await TrackPlayer.getActiveTrack();
  const activeBvid = (activeTrack?.id as string | undefined)
    ?? usePlayerStore.getState().currentBvid
    ?? undefined;
  const logicalQueue = usePlayerStore.getState().queue;
  const logicalIndex = logicalQueue.findIndex(video => video.bvid === activeBvid);
  return logicalIndex !== -1 && logicalIndex + 1 < logicalQueue.length;
}

async function ensureNextLogicalTrackBuffered(revision: number): Promise<boolean> {
  const snapshot = await withNativeQueueMutation(async () => {
    if (revision !== queueRevision) return null;
    const nativeQueue = await TrackPlayer.getQueue();
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    const activeTrack = await TrackPlayer.getActiveTrack();
    const currentBvid = (activeTrack?.id as string | undefined)
      ?? usePlayerStore.getState().currentBvid
      ?? undefined;
    const currentIndex = typeof activeIndex === 'number' && activeIndex >= 0
      ? activeIndex
      : nativeQueue.findIndex(track => track.id === currentBvid);
    const logicalQueue = usePlayerStore.getState().queue;
    const logicalIndex = logicalQueue.findIndex(video => video.bvid === currentBvid);
    const nextVideo = logicalIndex >= 0 ? logicalQueue[logicalIndex + 1] : undefined;
    if (!currentBvid || currentIndex < 0 || !nextVideo) return null;
    return {
      currentBvid,
      nextVideo,
      alreadyBuffered: nativeQueue.some(
        (track, index) => index > currentIndex && track.id === nextVideo.bvid,
      ),
    };
  });
  if (!snapshot || revision !== queueRevision) return false;
  if (snapshot.alreadyBuffered) return true;

  const tracks = await hydrateVideo(snapshot.nextVideo);
  if (tracks.length === 0 || revision !== queueRevision) return false;

  return withNativeQueueMutation(async () => {
    if (revision !== queueRevision) return false;
    const nativeQueue = await TrackPlayer.getQueue();
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    const activeTrack = await TrackPlayer.getActiveTrack();
    const currentBvid = (activeTrack?.id as string | undefined)
      ?? usePlayerStore.getState().currentBvid
      ?? undefined;
    const currentIndex = typeof activeIndex === 'number' && activeIndex >= 0
      ? activeIndex
      : nativeQueue.findIndex(track => track.id === currentBvid);
    if (currentBvid !== snapshot.currentBvid || currentIndex < 0) return false;

    const latestQueue = usePlayerStore.getState().queue;
    const logicalIndex = latestQueue.findIndex(video => video.bvid === currentBvid);
    if (latestQueue[logicalIndex + 1]?.bvid !== snapshot.nextVideo.bvid) return false;
    if (
      nativeQueue.some(
        (track, index) => index > currentIndex && track.id === snapshot.nextVideo.bvid,
      )
    ) {
      return true;
    }

    await TrackPlayer.add(tracks, currentIndex + 1);
    return true;
  });
}

async function skipNativeQueueToNext(pauseRevision: number): Promise<boolean> {
  const revision = queueRevision;
  return withNativeQueueMutation(async () => {
    if (revision !== queueRevision) {
      return false;
    }
    const nativeQueue = await TrackPlayer.getQueue();
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    const activeTrack = await TrackPlayer.getActiveTrack();
    if (revision !== queueRevision) {
      return false;
    }
    const currentIndex =
      typeof activeIndex === 'number' && activeIndex >= 0
        ? activeIndex
        : nativeQueue.findIndex(track => track.id === activeTrack?.id);
    const remaining =
      currentIndex >= 0 ? nativeQueue.length - 1 - currentIndex : 0;
    if (remaining <= 0) {
      return false;
    }
    const audioRevision = beginAudioTransition();
    await fadeOutForTransition(audioRevision);
    if (
      revision !== queueRevision ||
      audioRevision !== audioTransitionRevision
    ) {
      return false;
    }
    if (typeof activeIndex === 'number' && activeIndex >= 0) {
      await TrackPlayer.skipToNext();
    } else {
      await TrackPlayer.skip(currentIndex + 1);
    }
    if (pauseRevision !== userPauseRevision && !playbackIntent) {
      return true;
    }
    if (!playbackIntent) {
      return playTrackWithFadeIn(audioRevision);
    }
    await TrackPlayer.play();
    playbackIntent = true;
    void fadeInActiveTrack(audioRevision);
    return true;
  });
}

export function skipToNext() {
  return skipToNextWithPauseRevision(userPauseRevision);
}

export function skipToPrevious() {
  return enqueueSkipRequest('previous', userPauseRevision);
}

async function performPreviousSkip(pauseRevision: number): Promise<void> {
  const revision = queueRevision;
  try {
    const position = await withNativeQueueMutation(async () => {
      if (revision !== queueRevision) return null;
      const nativeQueue = await TrackPlayer.getQueue();
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      const activeTrack = await TrackPlayer.getActiveTrack();
      const reportedIndex =
        typeof activeIndex === 'number' && activeIndex >= 0
          ? activeIndex
          : nativeQueue.findIndex(track => {
              if (track.id !== activeTrack?.id) return false;
              const queueCid = (track as Track & {cid?: number}).cid;
              const activeCid = (activeTrack as (Track & {cid?: number}) | undefined)?.cid;
              return activeCid === undefined || queueCid === activeCid;
            });
      return {
        activeTrack,
        activeId: (activeTrack?.id as string | undefined) ?? usePlayerStore.getState().currentBvid ?? undefined,
        activeIndex: reportedIndex,
        logicalQueue: [...usePlayerStore.getState().queue],
      };
    });
    if (!position || revision !== queueRevision) return;

    const logicalIndex = position.logicalQueue.findIndex(
      video => video.bvid === position.activeId,
    );
    const previousVideo = logicalIndex > 0
      ? position.logicalQueue[logicalIndex - 1]
      : undefined;
    const needsLogicalPrevious = position.activeIndex <= 0 && Boolean(previousVideo);
    const previousTracks = needsLogicalPrevious && previousVideo
      ? await hydrateVideo(previousVideo)
      : [];
    if (revision !== queueRevision) return;
    if (needsLogicalPrevious && previousTracks.length === 0) {
      usePlayerStore.getState().setPlaybackError('上一首暂时无法加载，请检查网络后重试');
      showQueueNotReadyToast('上一首暂时无法播放，请检查网络后重试');
      return;
    }

    const skipped = await withNativeQueueMutation(async () => {
      if (revision !== queueRevision) return false;
      const nativeQueue = await TrackPlayer.getQueue();
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      const activeTrack = await TrackPlayer.getActiveTrack();
      const currentId = (activeTrack?.id as string | undefined)
        ?? usePlayerStore.getState().currentBvid
        ?? undefined;
      const snapshotCid = (position.activeTrack as (Track & {cid?: number}) | undefined)?.cid;
      const currentCid = (activeTrack as (Track & {cid?: number}) | undefined)?.cid;
      if (
        currentId !== position.activeId ||
        (snapshotCid !== undefined && currentCid !== snapshotCid)
      ) {
        return false;
      }
      const currentIndex =
        typeof activeIndex === 'number' && activeIndex >= 0
          ? activeIndex
          : nativeQueue.findIndex(track => {
              if (track.id !== activeTrack?.id) return false;
              const queueCid = (track as Track & {cid?: number}).cid;
              return currentCid === undefined || queueCid === currentCid;
            });

      const audioRevision = beginAudioTransition();
      await fadeOutForTransition(audioRevision);
      if (
        revision !== queueRevision ||
        audioRevision !== audioTransitionRevision
      ) {
        return false;
      }
      if (currentIndex > 0) {
        // 原生队列已有前一轨时，优先保留同一视频的分P切换行为。
        await TrackPlayer.skipToPrevious();
      } else if (previousVideo && previousTracks.length > 0) {
        // 搜索/推荐从中间歌曲起播时，loadQueue 只装入当前曲和后续缓冲；
        // 把前一首插到活动轨之前，避免上一首按钮落在空的原生队列边界。
        const insertionIndex = currentIndex < 0 ? 0 : currentIndex;
        await TrackPlayer.add(previousTracks, insertionIndex);
        await TrackPlayer.skip(insertionIndex);
      } else {
        await TrackPlayer.skipToPrevious();
      }
      if (revision !== queueRevision) {
        return false;
      }
      if (pauseRevision !== userPauseRevision && !playbackIntent) {
        return true;
      }
      if (!playbackIntent) {
        return playTrackWithFadeIn(audioRevision);
      }
      await TrackPlayer.play();
      playbackIntent = true;
      void fadeInActiveTrack(audioRevision);
      return true;
    });
    if (skipped) {
      usePlayerStore.getState().setPlaybackError(null);
    }
  } catch (e) {
    LoggerService.error(
      'TrackPlayer',
      'skipToPrevious',
      'Error skipping to previous',
      e,
    );
    usePlayerStore.getState().setPlaybackError('上一首暂时无法加载，请检查网络后重试');
    showQueueNotReadyToast('上一首暂时无法播放，请检查网络后重试');
  }
}

async function recoverQueueAfterEnd(endedTrackIndex: number): Promise<void> {
  if (isSkipping) {
    pendingQueueEndRecoveryIndex = endedTrackIndex;
    return;
  }
  if (queueEndRecoveryPromise) {
    return queueEndRecoveryPromise;
  }

  const revision = queueRevision;
  queueEndRecoveryPromise = (async () => {
    if (!playbackIntent) {
      return;
    }
    const playbackState = await TrackPlayer.getPlaybackState();
    if (
      playbackState.state === State.Playing ||
      playbackState.state === State.Buffering ||
      playbackState.state === State.Loading
    ) {
      return;
    }

    const nativeQueue = await TrackPlayer.getQueue();
    const activeTrack = await TrackPlayer.getActiveTrack();
    if (revision !== queueRevision) {
      return;
    }
    const endedTrack = nativeQueue[endedTrackIndex] ?? activeTrack;
    const endedBvid = (endedTrack?.id as string | undefined)
      ?? usePlayerStore.getState().currentBvid
      ?? undefined;
    const logicalQueue = usePlayerStore.getState().queue;
    const logicalIndex = logicalQueue.findIndex(video => video.bvid === endedBvid);
    if (logicalIndex === -1 || logicalIndex + 1 >= logicalQueue.length) {
      return;
    }

    await maintainQueueBuffer();
    if (revision !== queueRevision) {
      return;
    }

    let latestNativeQueue = await TrackPlayer.getQueue();
    let latestActiveIndex = await TrackPlayer.getActiveTrackIndex();
    let latestLogicalQueue = usePlayerStore.getState().queue;
    let nextNativeIndex = findNativeNextIndex(
      latestNativeQueue,
      latestActiveIndex,
      endedBvid,
      latestLogicalQueue,
    );

    // 如果补队列因当前轨道索引暂不可用而未完成，至少尝试解析并加入逻辑下一首。
    if (nextNativeIndex === -1) {
      latestLogicalQueue = usePlayerStore.getState().queue;
      const latestLogicalIndex = latestLogicalQueue.findIndex(
        video => video.bvid === endedBvid,
      );
      const nextVideo = latestLogicalQueue[latestLogicalIndex + 1];
      if (!nextVideo || latestLogicalIndex === -1) {
        return;
      }

      const tracks = await hydrateVideo(nextVideo);
      if (revision !== queueRevision || tracks.length === 0) {
        usePlayerStore.getState().setPlaybackError('下一首暂时无法加载，请检查网络后重试');
        showQueueNotReadyToast();
        return;
      }

      await withNativeQueueMutation(async () => {
        if (revision !== queueRevision) {
          return;
        }
        latestNativeQueue = await TrackPlayer.getQueue();
        if (revision !== queueRevision) {
          return;
        }
        if (!latestNativeQueue.some(track => track.id === nextVideo.bvid)) {
          await TrackPlayer.add(tracks);
        }
      });
      latestNativeQueue = await TrackPlayer.getQueue();
      latestActiveIndex = await TrackPlayer.getActiveTrackIndex();
      latestLogicalQueue = usePlayerStore.getState().queue;
      nextNativeIndex = findNativeNextIndex(
        latestNativeQueue,
        latestActiveIndex,
        endedBvid,
        latestLogicalQueue,
      );
    }

    if (revision !== queueRevision) {
      return;
    }

    const resumed = await withNativeQueueMutation(async () => {
      if (revision !== queueRevision) {
        return false;
      }
      latestNativeQueue = await TrackPlayer.getQueue();
      latestActiveIndex = await TrackPlayer.getActiveTrackIndex();
      if (revision !== queueRevision) {
        return false;
      }
      latestLogicalQueue = usePlayerStore.getState().queue;
      nextNativeIndex = findNativeNextIndex(
        latestNativeQueue,
        latestActiveIndex,
        endedBvid,
        latestLogicalQueue,
      );
      if (nextNativeIndex === -1) {
        return false;
      }

      await TrackPlayer.skip(nextNativeIndex);
      if (revision !== queueRevision) {
        return false;
      }
      if (!playbackIntent) {
        return false;
      }
      await TrackPlayer.play();
      playbackIntent = true;
      return true;
    });

    if (resumed) {
      usePlayerStore.getState().setPlaybackError(null);
    } else if (revision === queueRevision && playbackIntent) {
      usePlayerStore.getState().setPlaybackError('下一首暂时无法加载，请检查网络后重试');
      showQueueNotReadyToast();
    }
  })().finally(() => {
    queueEndRecoveryPromise = null;
    if (revision !== queueRevision) {
      TrackPlayer.getPlaybackState()
        .then(state => {
          if (state.state === State.Ended) {
            return recoverQueueAfterEnd(endedTrackIndex);
          }
          return undefined;
        })
        .catch(error => {
          LoggerService.warn(
            'TrackPlayer',
            'PlaybackQueueEnded',
            '检查队列代次变更后的恢复状态失败',
            error,
          );
        });
    }
  });

  return queueEndRecoveryPromise;
}

function buildPlaybackErrorKey(
  track: Track,
  activeIndex: number | undefined,
  revision: number,
): string {
  const cid = (track as any).cid;
  return `${revision}:${track.id}:${typeof cid === 'number' ? cid : 'default'}:${activeIndex ?? -1}`;
}

async function skipAfterPlaybackError(
  pauseRevision: number,
  reason: string,
): Promise<void> {
  if (await hasLogicalNextTrack()) {
    usePlayerStore.getState().setPlaybackError(`${reason}，正在切换下一首`);
    await skipToNextWithPauseRevision(pauseRevision);
    return;
  }
  usePlayerStore.getState().setPlaybackError(`${reason}，请点击重试`);
}

async function processPlaybackError(
  error: unknown,
  track: Track,
  activeIndex: number | undefined,
  revision: number,
  pauseRevision: number,
  key: string,
  manualRetry: boolean,
): Promise<void> {
  if (error) {
    LoggerService.error('TrackPlayer', 'PlaybackError', '播放错误:', error);
  }

  const bvid = String(track.id);
  const trackCid = (track as any).cid;
  const cid = typeof trackCid === 'number' ? trackCid : undefined;

  if (revision !== queueRevision) {
    return;
  }
  if (!playbackIntent) {
    pendingNetworkPlaybackRetry = null;
    usePlayerStore.getState().setPlaybackError('播放失败，请检查网络后重试');
    return;
  }
  if (!netStatus.isOnline) {
    pendingNetworkPlaybackRetry = {
      bvid,
      ...(cid != null ? {cid} : {}),
      pauseRevision,
    };
    usePlayerStore.getState().setPlaybackError('网络不可用，恢复网络后可重试');
    return;
  }

  const playbackErrorKey = key;
  const attempts = manualRetry
    ? 0
    : playbackErrorAttempts.get(playbackErrorKey) ?? 0;
  if (manualRetry) {
    playbackErrorAttempts.delete(playbackErrorKey);
  }
  if (attempts > 0) {
    await skipAfterPlaybackError(pauseRevision, '当前歌曲重试失败');
    return;
  }
  playbackErrorAttempts.set(playbackErrorKey, 1);

  const video = usePlayerStore.getState().queue.find(item => item.bvid === bvid);
  if (!video) {
    if (await hasLogicalNextTrack()) {
      usePlayerStore.getState().setPlaybackError('当前歌曲不在播放队列中，正在切换下一首');
      await skipToNextWithPauseRevision(pauseRevision);
    } else {
      usePlayerStore.getState().setPlaybackError('当前歌曲不在播放队列中，无法自动重试');
    }
    return;
  }

  try {
    if (typeof track.url === 'string' && track.url.startsWith('file://')) {
      await audioCache.remove(
        bvid,
        useSettingsStore.getState().quality,
        cid,
      );
    }
    audioService.invalidate(bvid, cid);
    invalidateUrl(bvid, cid);
    invalidateDomainCache();
    invalidateHydratedTrackCache(bvid);

    const refreshedTracks = await hydrateVideo(video, cid);
    if (revision !== queueRevision) {
      return;
    }
    const replacement = refreshedTracks[0];
    if (!replacement) {
      await skipAfterPlaybackError(pauseRevision, '重新加载音频失败');
      return;
    }

    const replacementResult = await withNativeQueueMutation(async () => {
      if (revision !== queueRevision) {
        return 'stale' as const;
      }
      const latestActiveIndex = await TrackPlayer.getActiveTrackIndex();
      const latestTrack = await TrackPlayer.getActiveTrack();
      if (revision !== queueRevision) {
        return 'stale' as const;
      }
      if (
        latestTrack?.id !== bvid ||
        (cid != null && (latestTrack as any).cid !== cid)
      ) {
        return 'stale' as const;
      }
      if (typeof latestActiveIndex !== 'number' || latestActiveIndex < 0) {
        return 'failed' as const;
      }

      const audioRevision = beginAudioTransition();
      await fadeOutForTransition(audioRevision);
      if (
        revision !== queueRevision ||
        audioRevision !== audioTransitionRevision
      ) {
        return 'stale' as const;
      }

      await TrackPlayer.remove(latestActiveIndex);
      if (revision !== queueRevision) {
        return 'stale' as const;
      }
      await TrackPlayer.add(replacement, latestActiveIndex);
      if (revision !== queueRevision) {
        return 'stale' as const;
      }
      await TrackPlayer.skip(latestActiveIndex);
      usePlayerStore.getState().setCurrentBvid(bvid);
      usePlayerStore.getState().setCurrentCid(cid ?? null);

      if (pauseRevision !== userPauseRevision && !playbackIntent) {
        return 'paused' as const;
      }
      await TrackPlayer.play();
      playbackIntent = true;
      void fadeInActiveTrack(audioRevision);
      return 'replaced' as const;
    });

    if (replacementResult === 'stale') {
      return;
    }
    if (replacementResult === 'replaced' || replacementResult === 'paused') {
      pendingNetworkPlaybackRetry = null;
      usePlayerStore.getState().setPlaybackError(null);
      maintainQueueBuffer().catch(() => {});
      return;
    }

    const latestTrack = await TrackPlayer.getActiveTrack();
    if (revision !== queueRevision || latestTrack?.id !== bvid) {
      return;
    }
    await skipAfterPlaybackError(pauseRevision, '重新加载音频失败');
  } catch (recoveryError) {
    LoggerService.error(
      'TrackPlayer',
      'PlaybackError',
      '重新解析并替换失败曲目失败',
      recoveryError,
    );
    if (revision === queueRevision) {
      await skipAfterPlaybackError(pauseRevision, '重新加载音频失败');
    }
  }
}

async function handlePlaybackError(
  error: unknown,
  manualRetry = false,
  requestedPauseRevision = userPauseRevision,
): Promise<void> {
  const activeTrack = await TrackPlayer.getActiveTrack();
  if (!activeTrack?.id) {
    usePlayerStore.getState().setPlaybackError('播放失败，请检查网络后重试');
    return;
  }
  const activeIndex = await TrackPlayer.getActiveTrackIndex();
  const revision = queueRevision;
  const key = buildPlaybackErrorKey(activeTrack, activeIndex, revision);

  if (!manualRetry) {
    const state = await TrackPlayer.getPlaybackState();
    if (
      state.state === State.Playing ||
      state.state === State.Buffering ||
      state.state === State.Loading
    ) {
      return;
    }
  }

  const existingRecovery = playbackErrorRecoveries.get(key);
  if (existingRecovery) {
    await existingRecovery.catch(() => {});
    return;
  }

  const recovery = processPlaybackError(
    error,
    activeTrack,
    activeIndex,
    revision,
    requestedPauseRevision,
    key,
    manualRetry,
  );
  playbackErrorRecoveries.set(key, recovery);
  try {
    await recovery;
  } finally {
    if (playbackErrorRecoveries.get(key) === recovery) {
      playbackErrorRecoveries.delete(key);
    }
  }
}

export async function retryCurrentTrack(): Promise<void> {
  playbackIntent = true;
  const pauseRevision = userPauseRevision;
  try {
    const playbackState = await TrackPlayer.getPlaybackState();
    if (playbackState.state === State.Ended && await hasLogicalNextTrack()) {
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      usePlayerStore.getState().setPlaybackError(null);
      await recoverQueueAfterEnd(activeIndex ?? 0);
      return;
    }
    await handlePlaybackError(undefined, true, pauseRevision);
  } catch (error) {
    LoggerService.error('TrackPlayer', 'retryCurrentTrack', '手动重试播放失败', error);
    usePlayerStore.getState().setPlaybackError('重试失败，请稍后再试');
  }
}

/** 网络恢复时只重试因离线失败且用户播放意图仍有效的同一曲目。 */
export async function retryInterruptedPlaybackAfterNetworkRecovery(): Promise<void> {
  const pending = pendingNetworkPlaybackRetry;
  if (!pending) return;

  if (
    !netStatus.isOnline ||
    !playbackIntent ||
    pending.pauseRevision !== userPauseRevision ||
    usePlayerStore.getState().currentBvid !== pending.bvid
  ) {
    pendingNetworkPlaybackRetry = null;
    return;
  }

  try {
    const activeTrack = await TrackPlayer.getActiveTrack();
    if (
      !playbackIntent ||
      pending.pauseRevision !== userPauseRevision ||
      usePlayerStore.getState().currentBvid !== pending.bvid ||
      activeTrack?.id !== pending.bvid ||
      (pending.cid != null && (activeTrack as any).cid !== pending.cid)
    ) {
      pendingNetworkPlaybackRetry = null;
      return;
    }
    pendingNetworkPlaybackRetry = null;
    await handlePlaybackError(undefined, true, pending.pauseRevision);
  } catch (error) {
    LoggerService.warn(
      'TrackPlayer',
      'networkRecovery',
      '网络恢复后重试当前曲目失败',
      error,
    );
  }
}

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, resumePlayback);
  TrackPlayer.addEventListener(Event.RemotePause, pausePlayback);
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    const wasPlaying = playbackIntent;
    const audioRevision = beginAudioTransition();
    userPauseRevision += 1;
    playbackIntent = false;
    return withNativeQueueMutation(async () => {
      if (wasPlaying) {
        await fadePlayerVolumeTo(
          0,
          config.playback.fadeOutDurationMs,
          audioRevision,
        );
      } else {
        try {
          await TrackPlayer.setVolume(0);
        } catch {}
      }
      if (audioRevision !== audioTransitionRevision) return;
      await TrackPlayer.stop();
      playbackIntent = false;
    });
  });

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, event => {
    if (consumeExpiredSleepTimer()) {
      pausePlayback().catch(error => {
        LoggerService.warn('TrackPlayer', 'SleepTimer', '定时暂停失败', error);
      });
    }
    handlePlaybackProgress(event.position, event.duration, event.track);
  });

  // 极简切歌：原生队列中已经是真实 URL，直接 skip
  TrackPlayer.addEventListener(Event.RemoteNext, skipToNext);
  TrackPlayer.addEventListener(Event.RemotePrevious, skipToPrevious);

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, ({track}) => {
    recoverQueueAfterEnd(track).catch(error => {
      LoggerService.error(
        'TrackPlayer',
        'PlaybackQueueEnded',
        '队列结束后恢复下一首失败',
        error,
      );
    });
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, ({position}) =>
    TrackPlayer.seekTo(position),
  );

  TrackPlayer.addEventListener(Event.PlaybackState, async playbackState => {
    const playerState = (playbackState as any).state;

    if (playerState === State.Playing && consumeExpiredSleepTimer()) {
      try {
        await pausePlayback();
      } catch (error) {
        LoggerService.warn('TrackPlayer', 'SleepTimer', '定时暂停失败', error);
      }
      return;
    }

    if (playerState === State.Paused || playerState === State.Stopped) {
      try {
        const progress = useProgressStore.getState();
        if (progress.position > 0) {
          storage.setNumber('lastPlaybackPosition', progress.position);
        }
      } catch (e) {}
    }

    const activeTrack = await TrackPlayer.getActiveTrack();
    if (!activeTrack?.id) {
      return;
    }
    const bvid = activeTrack.id as string;
    if (playerState === State.Playing) {
      performanceMonitor.firstFrame(bvid);
      performanceMonitor.stallEnd(bvid);
    } else if (playerState === State.Buffering) {
      performanceMonitor.stallStart(bvid);
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async e => {
    if (e.index === undefined) {
      return;
    }

    const activeTrack = await TrackPlayer.getActiveTrack();
    if (!activeTrack?.id) {
      return;
    }

    const bvid = activeTrack.id as string;
    usePlayerStore.getState().setCurrentBvid(bvid);
    usePlayerStore.getState().setPlaybackError(null);

    const trackCid = (activeTrack as any).cid;
    if (typeof trackCid === 'number') {
      usePlayerStore.getState().setCurrentCid(trackCid);
    } else {
      usePlayerStore.getState().setCurrentCid(null);
    }

    usePlayerStore.getState().setResolving(false);
    void ensureCurrentVideoParts(bvid, queueRevision);
    naturalFadeOutTrackKey = null;
    if (playbackIntent) {
      void fadeInActiveTrack(audioTransitionRevision, activeTrack);
    }
    if (e.lastTrack?.id) {
      autoCache(e.lastTrack.id as string);
    }

    // 触发后台水合检查 (Fire-and-forget)
    maintainQueueBuffer().catch(err => {
      LoggerService.error(
        'TrackPlayer',
        'PlaybackActiveTrackChanged',
        'Hydration failed',
        err,
      );
    });
  });

  TrackPlayer.addEventListener(Event.PlaybackError, error => {
    handlePlaybackError(error).catch(recoveryError => {
      LoggerService.error(
        'TrackPlayer',
        'PlaybackError',
        '处理播放错误失败',
        recoveryError,
      );
      usePlayerStore.getState().setPlaybackError('播放失败，请检查网络后重试');
    });
  });

  // 保持后台任务活跃，防止 setTimeout 在后台被挂起导致预加载死锁
  return new Promise(() => {});
}

export async function playSpecificPart(
  bvid: string,
  cid: number,
  partTitle: string,
) {
  const revision = queueRevision;
  const pauseRevision = userPauseRevision;
  usePlayerStore.getState().setResolving(true);
  try {
    const expandMultiPart = useSettingsStore.getState().expandMultiPart;
    const currentQueue = await TrackPlayer.getQueue();

    const existingIndex = currentQueue.findIndex(
      t => t.id === bvid && (t as any).cid === cid,
    );

    if (existingIndex !== -1) {
      const switched = await withNativeQueueMutation(async () => {
        if (revision !== queueRevision) {
          return false;
        }
        const audioRevision = beginAudioTransition();
        const latestQueue = await TrackPlayer.getQueue();
        if (revision !== queueRevision) {
          return false;
        }
        const latestIndex = latestQueue.findIndex(
          track => track.id === bvid && (track as any).cid === cid,
        );
        if (latestIndex === -1) {
          return false;
        }
        await fadeOutForTransition(audioRevision);
        if (
          revision !== queueRevision ||
          audioRevision !== audioTransitionRevision
        ) {
          return false;
        }
        await TrackPlayer.skip(latestIndex);
        if (pauseRevision !== userPauseRevision && !playbackIntent) {
          return false;
        }
        if (!playbackIntent) {
          return playTrackWithFadeIn(audioRevision);
        }
        await TrackPlayer.play();
        void fadeInActiveTrack(audioRevision);
        return true;
      });
      if (switched && revision === queueRevision) {
        usePlayerStore.getState().setCurrentCid(cid);
      }
      return;
    }

    const logicalQueue = usePlayerStore.getState().queue;
    const video = logicalQueue.find(v => v.bvid === bvid);
    if (!video) {
      return;
    }

    const realTracks = await hydrateVideo(video, cid);
    if (revision !== queueRevision) {
      return;
    }
    if (realTracks.length === 0) {
      usePlayerStore.getState().setPlaybackError('加载分P失败');
      return;
    }
    const realTrack = realTracks[0];
    realTrack.title = `${video.title} - ${partTitle}`;

    const switched = await withNativeQueueMutation(async () => {
      if (revision !== queueRevision) {
        return false;
      }
      const audioRevision = beginAudioTransition();
      await fadeOutForTransition(audioRevision);
      if (
        revision !== queueRevision ||
        audioRevision !== audioTransitionRevision
      ) {
        return false;
      }
      const rawIdx = await TrackPlayer.getActiveTrackIndex();
      if (revision !== queueRevision) {
        return false;
      }
      const idx = typeof rawIdx === 'number' ? rawIdx : -1;

      if (expandMultiPart) {
        const insertPos = idx >= 0 ? idx + 1 : 0;
        await TrackPlayer.add(realTrack, insertPos);
        await TrackPlayer.skip(insertPos);
      } else {
        if (idx === -1) {
          await TrackPlayer.add(realTrack, 0);
          await TrackPlayer.skip(0);
        } else {
          // 保留原生历史轨道，插入分P后直接跳转。
          await TrackPlayer.add(realTrack, idx + 1);
          await TrackPlayer.skip(idx + 1);
        }
      }
      if (revision !== queueRevision) {
        return false;
      }
      if (pauseRevision !== userPauseRevision && !playbackIntent) {
        return false;
      }
      if (!playbackIntent) {
        return playTrackWithFadeIn(audioRevision);
      }
      await TrackPlayer.play();
      playbackIntent = true;
      void fadeInActiveTrack(audioRevision);
      return true;
    });
    if (switched && revision === queueRevision) {
      usePlayerStore.getState().setCurrentCid(cid);
      usePlayerStore.getState().setPlaybackError(null);
    }

    maintainQueueBuffer().catch(() => {});
  } finally {
    if (revision === queueRevision) {
      usePlayerStore.getState().setResolving(false);
    }
  }
}
