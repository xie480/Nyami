import TrackPlayer, {
  AppKilledPlaybackBehavior, Capability, Event,
} from 'react-native-track-player';
import { audioService } from './audioService';
import { audioCache } from './audioCache';
import { netStatus } from './netStatus';
import { useSettingsStore } from '../store/settingsStore';
import { config } from '../config';
import { usePlayerStore } from '../store/playerStore';
import { performanceMonitor } from './performanceMonitor';
import { State } from 'react-native-track-player';
import type { FavoriteVideo } from '../types/domain';
// 用于防止同一索引的 lazyResolve 并发执行，避免重复替换
const resolving = new Set<number>();

let _ready = false;

export async function setupPlayer() {
  if (_ready) return;
  try {
    await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior:
          AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
        // 缓冲策略参数（秒）
        minBuffer: 1.5,      // 1500 ms
        maxBuffer: 30,      // 30000 ms
        playBuffer: 0.5,     // 500 ms
        backBuffer: 0,      // 0 ms（默认）
      },
      capabilities: [
        Capability.Play, Capability.Pause,
        Capability.SkipToNext, Capability.SkipToPrevious,
        Capability.SeekTo, Capability.Stop,
      ],
      compactCapabilities: [
        Capability.Play, Capability.Pause, Capability.SkipToNext,
      ],
      progressUpdateEventInterval: 1,
    });
  } catch {}
  _ready = true;
}

async function buildTrack(v: FavoriteVideo) {
  const quality = useSettingsStore.getState().quality;
  const cached = await audioCache.has(v.bvid, quality);
  if (cached) {
    return {
      id: v.bvid, url: `file://${cached}`,
      title: v.title, artist: v.upper.name,
      artwork: v.cover, duration: v.duration,
    };
  }
  const info = await audioService.getInfo(v.bvid, quality);
  return {
    id: v.bvid, url: info.audio.baseUrl,
    title: v.title, artist: v.upper.name,
    artwork: v.cover, duration: v.duration,
    userAgent: config.userAgent,
    headers: { Referer: config.referer },
  };
}

export async function loadQueue(videos: FavoriteVideo[], startBvid?: string) {
  if (!videos || videos.length === 0) return; // 新增边界保护
  await TrackPlayer.reset();
  const startIndex = Math.max(0, videos.findIndex((v) => v.bvid === startBvid));
  const current = await buildTrack(videos[startIndex]);

  const tracks = videos.map((v, i) =>
    i === startIndex ? current : {
      id: v.bvid, url: `placeholder://${v.bvid}`,
      title: v.title, artist: v.upper.name,
      artwork: v.cover, duration: v.duration,
    }
  );
  await TrackPlayer.add(tracks);
  await TrackPlayer.skip(startIndex);
  // 预加载下一首（若存在），减少切歌时网络延迟
  if (videos.length > startIndex + 1) {
    lazyResolve(startIndex + 1).catch(() => {});
  }
}

/**
 * Insert a video to be played next after the current track.
 */
export async function insertNext(video: FavoriteVideo): Promise<void> {
  const idx = await TrackPlayer.getActiveTrackIndex();
  const nativeQueue = await TrackPlayer.getQueue();
  const insertPos = idx >= 0 ? idx + 1 : nativeQueue.length;
  await TrackPlayer.add(
    {
      id: video.bvid,
      url: `placeholder://${video.bvid}`,
      title: video.title,
      artist: video.upper.name,
      artwork: video.cover,
      duration: video.duration,
    },
    insertPos
  );
  // Update Zustand store synchronized queue
  const cur = usePlayerStore.getState();
  const newQueue = [...cur.queue];
  newQueue.splice(insertPos, 0, video);
  cur.setQueue(newQueue, cur.currentBvid);
}

/**
 * Remove a specific video from the queue by its BVID.
 */
export async function removeFromQueue(bvid: string): Promise<void> {
  const nativeQueue = await TrackPlayer.getQueue();
  const idx = nativeQueue.findIndex((t) => t.id === bvid);
  if (idx !== -1) {
    await TrackPlayer.remove(idx);
    const cur = usePlayerStore.getState();
    const filtered = cur.queue.filter((v) => v.bvid !== bvid);
    cur.setQueue(filtered, cur.currentBvid);
  }
}

/**
 * Reorder the entire queue. Optionally start playing from a specific BVID.
 */
export async function reorderQueue(videos: FavoriteVideo[], startBvid?: string): Promise<void> {
  // Rebuild the queue using loadQueue to keep placeholder logic
  await loadQueue(videos, startBvid);
}

/**
 * Append a batch of videos to the end of the queue.
 */
export async function appendQueue(videos: FavoriteVideo[], startBvid?: string): Promise<void> {
  for (const v of videos) {
    await TrackPlayer.add({
      id: v.bvid,
      url: `placeholder://${v.bvid}`,
      title: v.title,
      artist: v.upper.name,
      artwork: v.cover,
      duration: v.duration,
    });
  }
  const cur = usePlayerStore.getState();
  const combined = [...cur.queue, ...videos];
  cur.setQueue(combined, startBvid ?? cur.currentBvid);
}

async function lazyResolve(index: number) {
  // 防止同一索引并发解析导致重复替换
  if (resolving.has(index)) return;
  resolving.add(index);
  let bvid = '';
  try {
    const queue = await TrackPlayer.getQueue();
    const t = queue[index];
    if (!t || !String(t.url).startsWith('placeholder://')) return;
    
    bvid = String(t.url).replace('placeholder://', '');
    // 记录轨道开始加载时间
    performanceMonitor.start(bvid);
    const quality = useSettingsStore.getState().quality;
    
    let url = '';
    let headers: Record<string, string> | undefined;
    
    const cached = await audioCache.has(bvid, quality);
    if (cached) {
      url = `file://${cached}`;
    } else {
      const info = await audioService.getInfo(bvid, quality);
      url = info.audio.baseUrl;
      headers = { Referer: config.referer };
    }

    // 动态查找当前 placeholder 的实际索引，防止队列变化导致 index 失效
    const freshQueue = await TrackPlayer.getQueue();
    const actualIndex = freshQueue.findIndex(tr => tr.id === bvid && String(tr.url).startsWith('placeholder://'));
    if (actualIndex === -1) {
      return; // 找不到对应的 placeholder，可能已被用户操作移出队列或已解析
    }

    const newTrack = { ...t, url, userAgent: config.userAgent, headers };
    // 平滑替换策略：先在 actualIndex 后面插入新 track，跳过去，再删掉原来的 placeholder
    await TrackPlayer.add(newTrack, actualIndex + 1);
    const postAddActiveTrackIndex = await TrackPlayer.getActiveTrackIndex();
    if (postAddActiveTrackIndex === actualIndex) {
      await TrackPlayer.skip(actualIndex + 1);
    }
    await TrackPlayer.remove(actualIndex);
  } catch (error) {
    console.error(`[TrackPlayer] 解析音频失败 (BVID: ${bvid}):`, error);
    
    // 检查网络状态，如果是无网导致的失败，停止播放并避免切歌风暴
    if (netStatus.type === 'none' || netStatus.type === 'unknown') {
      console.warn('[TrackPlayer] 无网络连接，停止解析队列');
      await TrackPlayer.pause();
      // 通过 Zustand store 触发全局 UI 错误提示
      usePlayerStore.getState().setPlaybackError('无网络连接，无法加载音频');
      return;
    }

    // 解析失败时自动跳到下一首（仅当当前播放的确实是解析失败的这首歌）
    const activeTrackIndex = await TrackPlayer.getActiveTrackIndex();
    const freshQueue = await TrackPlayer.getQueue();
    const activeTrack = freshQueue[activeTrackIndex];
    
    if (activeTrack && activeTrack.id === bvid) {
      await TrackPlayer.skipToNext().catch(() => {});
    }
  } finally {
    resolving.delete(index);
  }
}

async function autoCache(bvid: string) {
  const s = useSettingsStore.getState();
  if (!s.autoCacheOnWifi || !netStatus.isWifi()) return;
  if (await audioCache.has(bvid, s.quality)) return;
  try {
    const info = await audioService.getInfo(bvid, s.quality);
    await audioCache.download(bvid, s.quality, info.audio.baseUrl, {
      Referer: config.referer, 'User-Agent': config.userAgent,
    });
  } catch {}
}

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) =>
    TrackPlayer.seekTo(position)
  );

  // Performance monitoring: track playback state changes
  TrackPlayer.addEventListener(Event.PlaybackState, async (playbackState) => {
    // playbackState is of type PlaybackState, with .state property.
    const playerState = (playbackState as any).state;
    const activeTrack = await TrackPlayer.getActiveTrack();
    if (!activeTrack?.id) return;
    const bvid = activeTrack.id as string;
    if (playerState === State.Playing) {
      performanceMonitor.firstFrame(bvid);
      performanceMonitor.stallEnd(bvid);
    } else if (playerState === State.Buffering) {
      performanceMonitor.stallStart(bvid);
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (e) => {
    // Record start of track loading/playback
    const activeTrack = await TrackPlayer.getActiveTrack();
    if (activeTrack?.id) {
      performanceMonitor.start(activeTrack.id as string);
    }
    if (e.index !== undefined) {
      await lazyResolve(e.index);
      // prefetch next track if exists for seamless playback
      try {
        const queue = await TrackPlayer.getQueue();
        if (e.index + 1 < queue.length) {
          lazyResolve(e.index + 1).catch(() => {});
        }
      } catch {}
    }
    if (e.lastTrack?.id) autoCache(e.lastTrack.id as string);
  });
  // 【修复】增加错误监听，遇到播放错误自动跳过
  TrackPlayer.addEventListener(Event.PlaybackError, async (error) => {
    console.error('[TrackPlayer] 播放错误:', error);
    // Revised handling: determine if error originates from a placeholder track by inspecting the active track URL
    try {
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      const queue = await TrackPlayer.getQueue();
      const activeTrack = queue[activeIndex];
      if (activeTrack && typeof activeTrack.url === 'string' && activeTrack.url.startsWith('placeholder://')) {
        console.log('[TrackPlayer] Ignoring placeholder track playback error');
        // Let lazyResolve replace the placeholder later; do not skip or pause.
        return;
      }
    } catch (e) {
      // If inspection fails, proceed with generic error handling.
    }
    
    // 【修复】如果当前无网络，暂停播放而不是跳过
    if (netStatus.type === 'none') {
      // 通过 Zustand store 设置全局 UI 错误提示
      usePlayerStore.getState().setPlaybackError('网络已断开，播放暂停');
      await TrackPlayer.pause();
      return;
    }
    
    await TrackPlayer.skipToNext().catch(() => {});
  });
}
