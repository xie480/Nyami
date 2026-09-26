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
import {audioService} from './audioService';
import {audioCache} from './audioCache';
import {netStatus} from './netStatus';
import {useSettingsStore} from '../store/settingsStore';
import {config} from '../config';
import {usePlayerStore} from '../store/playerStore';
import {performanceMonitor} from './performanceMonitor';
import type {FavoriteVideo} from '../types/domain';
import {storage} from '../core/storage';
import {useProgressStore} from '../store/progressStore';
import {getCachedUrl, setCachedUrl} from './urlCache';
import {persistVideoPartsToDb} from '../db/operations';

let _ready = false;

const MIN_NATIVE_BUFFER = 8;
const TARGET_NATIVE_BUFFER = 12;
let queueRevision = 0;
let queueMaintenanceRequested = false;
let queueMaintenancePromise: Promise<void> | null = null;
let queueEndRecoveryPromise: Promise<void> | null = null;
let nativeQueueMutation: Promise<void> = Promise.resolve();
let playbackIntent = false;
let userPauseRevision = 0;

function advanceQueueRevision(): number {
  queueRevision += 1;
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
      progressUpdateEventInterval: 1,
    });

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

async function hydrateVideo(
  v: FavoriteVideo,
  targetCid?: number,
): Promise<Track[]> {
  try {
    const quality = useSettingsStore.getState().quality;
    const cid =
      targetCid ?? (v.parts && v.parts.length > 0 ? v.parts[0].cid : undefined);

    const cacheKey = cid ? `${v.bvid}-${cid}` : v.bvid;
    const isNoCache =
      v.folderIds?.some(id =>
        useSettingsStore.getState().noCacheFolderIds?.includes(id),
      ) ?? false;

    let url = '';
    let headers: Record<string, string> | undefined;
    let effectiveCid = cid;
    let title = v.title;
    let partsToExpand: any[] = [];

    const cachedPath = !isNoCache
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

        if (!isNoCache) {
          audioCache.download(cacheKey, quality, url, headers).catch(() => {});
        }

        if (!cid && info.parts && info.parts.length > 1) {
          title = `${info.title} - ${info.parts[0].title}`;
          usePlayerStore.getState().updateVideoParts(v.bvid, info.parts);
          persistVideoPartsToDb(v.bvid, info.parts).catch(() => {});
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
  const logicalQueue = usePlayerStore.getState().queue;
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
    const loaded = await withNativeQueueMutation(async () => {
      if (revision !== queueRevision) {
        return false;
      }
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
      await TrackPlayer.play();
      playbackIntent = true;
      return true;
    });
    if (!loaded || revision !== queueRevision) {
      return 0;
    }

    if (targetTracks[0]) {
      autoCache(targetTracks[0].id as string);
    }

    usePlayerStore.getState().setQueue(videos, startBvid);

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
  await withNativeQueueMutation(async () => {
    await TrackPlayer.play();
    playbackIntent = true;
  });
}

export async function pausePlayback(): Promise<void> {
  userPauseRevision += 1;
  playbackIntent = false;
  await withNativeQueueMutation(async () => {
    await TrackPlayer.pause();
    playbackIntent = false;
  });
}

export async function playQueuedTrack(bvid: string): Promise<boolean> {
  const revision = queueRevision;
  const pauseRevision = userPauseRevision;
  return withNativeQueueMutation(async () => {
    if (revision !== queueRevision) {
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
  cur.setQueue(logicalQueue, cur.currentBvid ?? undefined);

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
  cur.setQueue(filtered, cur.currentBvid ?? undefined);

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
    await withNativeQueueMutation(async () => {
      await TrackPlayer.reset();
      playbackIntent = false;
    });
    return;
  }

  const cur = usePlayerStore.getState();
  cur.setQueue(videos, startBvid ?? cur.currentBvid ?? undefined);

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
  cur.setQueue(combined, startBvid ?? cur.currentBvid ?? undefined);

  maintainQueueBuffer().catch(() => {});
}

async function autoCache(bvid: string, cid?: number) {
  const s = useSettingsStore.getState();
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
  await withNativeQueueMutation(async () => {
    await TrackPlayer.play();
    playbackIntent = true;
  }).catch(() => {});
}

let lastSkipToastTime = 0;
let isSkipping = false;

function showQueueNotReadyToast() {
  const now = Date.now();
  if (now - lastSkipToastTime > 2000) {
    if (Platform.OS === 'android') {
      try {
        ToastAndroid.show('下一首暂时无法播放，请检查网络后重试', ToastAndroid.SHORT);
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
    if (typeof activeIndex === 'number' && activeIndex >= 0) {
      await TrackPlayer.skipToNext();
    } else {
      await TrackPlayer.skip(currentIndex + 1);
    }
    if (pauseRevision !== userPauseRevision && !playbackIntent) {
      return true;
    }
    await TrackPlayer.play();
    playbackIntent = true;
    return true;
  });
}

export async function skipToNext() {
  if (queueEndRecoveryPromise) {
    await queueEndRecoveryPromise.catch(() => {});
    return;
  }
  if (isSkipping) {
    return;
  }
  isSkipping = true;
  const pauseRevision = userPauseRevision;
  try {
    let skipped = await skipNativeQueueToNext(pauseRevision);
    const hasLogicalNext = !skipped && await hasLogicalNextTrack();
    if (hasLogicalNext) {
      await maintainQueueBuffer();
      skipped = await skipNativeQueueToNext(pauseRevision);
    }

    if (!skipped && hasLogicalNext) {
      usePlayerStore.getState().setPlaybackError('下一首暂时无法加载，请检查网络后重试');
      showQueueNotReadyToast();
    } else {
      if (skipped) {
        usePlayerStore.getState().setPlaybackError(null);
      }
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
  } finally {
    isSkipping = false;
  }
}

export async function skipToPrevious() {
  const revision = queueRevision;
  const pauseRevision = userPauseRevision;
  try {
    await withNativeQueueMutation(async () => {
      if (revision !== queueRevision) {
        return;
      }
      await TrackPlayer.skipToPrevious();
      if (revision !== queueRevision) {
        return;
      }
      if (pauseRevision !== userPauseRevision && !playbackIntent) {
        return;
      }
      await TrackPlayer.play();
      playbackIntent = true;
    });
  } catch (e) {
    LoggerService.error(
      'TrackPlayer',
      'skipToPrevious',
      'Error skipping to previous',
      e,
    );
  }
}

async function recoverQueueAfterEnd(endedTrackIndex: number): Promise<void> {
  if (isSkipping) {
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

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, resumePlayback);
  TrackPlayer.addEventListener(Event.RemotePause, pausePlayback);
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    userPauseRevision += 1;
    playbackIntent = false;
    return withNativeQueueMutation(async () => {
      await TrackPlayer.stop();
      playbackIntent = false;
    });
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

    const trackCid = (activeTrack as any).cid;
    if (typeof trackCid === 'number') {
      usePlayerStore.getState().setCurrentCid(trackCid);
    } else {
      usePlayerStore.getState().setCurrentCid(null);
    }

    usePlayerStore.getState().setResolving(false);
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

  TrackPlayer.addEventListener(Event.PlaybackError, async error => {
    LoggerService.error('TrackPlayer', 'PlaybackError', '播放错误:', error);
    usePlayerStore.getState().setPlaybackError('播放失败，请检查网络或重试');
    await TrackPlayer.pause();
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
        await TrackPlayer.skip(latestIndex);
        if (pauseRevision !== userPauseRevision && !playbackIntent) {
          return false;
        }
        await TrackPlayer.play();
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
      await TrackPlayer.play();
      playbackIntent = true;
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
