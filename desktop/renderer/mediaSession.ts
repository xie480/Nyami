import type {PlaybackSnapshot} from '../shared/types';

const DEFAULT_PLAYBACK_RATE = 1;
const DEFAULT_SEEK_OFFSET_SECONDS = 10;
const DEFAULT_TRACK_TITLE = '未知歌曲';
const DEFAULT_TRACK_ARTIST = '未知艺术家';
const MEDIA_SESSION_ALBUM = 'Nyami';

type MediaSessionActionHandler = (
  details: globalThis.MediaSessionActionDetails,
) => void;

/** 为 Windows Media Session 提供播放控制回调。 */
export type DesktopMediaSessionCommands = {
  getSnapshot: () => PlaybackSnapshot;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (position: number) => void;
};

/** 将播放状态映射为 Media Session 的标准状态。 */
export function getMediaSessionPlaybackState(
  snapshot: PlaybackSnapshot,
): MediaSessionPlaybackState {
  if (snapshot.state === 'playing') {
    return 'playing';
  }
  if (snapshot.state === 'paused') {
    return 'paused';
  }
  return 'none';
}

/** 构造系统媒体面板显示所需的歌曲元数据。 */
export function createMediaSessionMetadata(
  snapshot: PlaybackSnapshot,
): MediaMetadataInit | null {
  if (!snapshot.trackId) {
    return null;
  }

  const artwork = snapshot.artwork?.trim();
  const metadata: MediaMetadataInit = {
    title: snapshot.trackTitle?.trim() || DEFAULT_TRACK_TITLE,
    artist: snapshot.trackArtist?.trim() || DEFAULT_TRACK_ARTIST,
    album: MEDIA_SESSION_ALBUM,
  };
  if (artwork) {
    metadata.artwork = [
      {
        src: artwork,
      },
    ];
  }
  return metadata;
}

/** 将播放进度限制在 Media Session 接受的有效区间。 */
export function getMediaSessionPositionState(
  snapshot: PlaybackSnapshot,
): MediaPositionState | null {
  const duration = Number(snapshot.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  const position = Number(snapshot.position);
  return {
    duration,
    position: Math.min(
      duration,
      Math.max(0, Number.isFinite(position) ? position : 0),
    ),
    playbackRate: DEFAULT_PLAYBACK_RATE,
  };
}

/** 判断当前 Electron Chromium 是否提供 Media Session。 */
function getMediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return null;
  }
  return navigator.mediaSession ?? null;
}

/** 将播放快进或回退位置限制在当前歌曲范围内。 */
function getSeekTarget(
  snapshot: PlaybackSnapshot,
  delta: number,
): number {
  const duration = Number.isFinite(snapshot.duration)
    ? Math.max(0, snapshot.duration)
    : 0;
  const position = Number.isFinite(snapshot.position)
    ? Math.max(0, snapshot.position)
    : 0;
  if (duration <= 0) {
    return Math.max(0, position + delta);
  }
  return Math.min(duration, Math.max(0, position + delta));
}

/** 安全设置系统媒体动作，兼容不支持部分动作的 Chromium 版本。 */
function setMediaSessionActionHandler(
  mediaSession: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): boolean {
  try {
    mediaSession.setActionHandler(action, handler);
    return true;
  } catch {
    return false;
  }
}

/** 同步歌曲信息、播放状态和进度到系统媒体面板。 */
export function updateDesktopMediaSession(
  snapshot: PlaybackSnapshot,
): void {
  const mediaSession = getMediaSession();
  if (!mediaSession) {
    return;
  }

  const metadata = createMediaSessionMetadata(snapshot);
  const MediaMetadataConstructor = globalThis.MediaMetadata;
  mediaSession.metadata =
    metadata && typeof MediaMetadataConstructor === 'function'
      ? new MediaMetadataConstructor(metadata)
      : null;
  mediaSession.playbackState = getMediaSessionPlaybackState(snapshot);

  const positionState = getMediaSessionPositionState(snapshot);
  if (
    !positionState ||
    typeof mediaSession.setPositionState !== 'function'
  ) {
    return;
  }
  try {
    mediaSession.setPositionState(positionState);
  } catch {
    // 元数据切换瞬间可能出现短暂的 duration 不一致，忽略该次同步即可。
  }
}

/** 注册并清理 Windows 系统媒体控制动作。 */
export function bindDesktopMediaSession(
  commands: DesktopMediaSessionCommands,
): () => void {
  const mediaSession = getMediaSession();
  if (!mediaSession) {
    return () => undefined;
  }

  const handlers: Array<{
    action: MediaSessionAction;
    handler: MediaSessionActionHandler;
  }> = [
    {
      action: 'play',
      handler: () => commands.onPlay(),
    },
    {
      action: 'pause',
      handler: () => commands.onPause(),
    },
    {
      action: 'stop',
      handler: () => commands.onStop(),
    },
    {
      action: 'nexttrack',
      handler: () => commands.onNext(),
    },
    {
      action: 'previoustrack',
      handler: () => commands.onPrevious(),
    },
    {
      action: 'seekbackward',
      handler: details => {
        const snapshot = commands.getSnapshot();
        const requestedOffset = details.seekOffset;
        const offset =
          typeof requestedOffset === 'number' &&
          Number.isFinite(requestedOffset) &&
          requestedOffset > 0
            ? requestedOffset
            : DEFAULT_SEEK_OFFSET_SECONDS;
        commands.onSeek(getSeekTarget(snapshot, -offset));
      },
    },
    {
      action: 'seekforward',
      handler: details => {
        const snapshot = commands.getSnapshot();
        const requestedOffset = details.seekOffset;
        const offset =
          typeof requestedOffset === 'number' &&
          Number.isFinite(requestedOffset) &&
          requestedOffset > 0
            ? requestedOffset
            : DEFAULT_SEEK_OFFSET_SECONDS;
        commands.onSeek(getSeekTarget(snapshot, offset));
      },
    },
    {
      action: 'seekto',
      handler: details => {
        const seekTime = details.seekTime;
        if (typeof seekTime === 'number' && Number.isFinite(seekTime)) {
          const snapshot = commands.getSnapshot();
          commands.onSeek(
            getSeekTarget(
              snapshot,
              seekTime - snapshot.position,
            ),
          );
        }
      },
    },
  ];
  const registeredActions = handlers
    .filter(({action, handler}) =>
      setMediaSessionActionHandler(mediaSession, action, handler),
    )
    .map(({action}) => action);

  return () => {
    for (const action of registeredActions) {
      setMediaSessionActionHandler(mediaSession, action, null);
    }
    mediaSession.metadata = null;
    mediaSession.playbackState = 'none';
  };
}
