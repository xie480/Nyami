import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import FastImage from 'react-native-fast-image';
import {
  useActiveTrack,
  usePlaybackState,
  State,
} from 'react-native-track-player';
import {pausePlayback, resumePlayback, skipToNext} from '../services/trackPlayer';
import {IconButton} from './IconButton';
import {GlassView} from './GlassView';
import {useTheme} from '../theme';
import {useUIStore} from '../store/uiStore';
import {usePlayerStore} from '../store/playerStore';
import {useProgressStore} from '../store/progressStore';

interface MiniPlayerProps {
  /** 在统一的底部播放/导航面板中使用时，MiniPlayer 不绘制自己的玻璃背景。 */
  embedded?: boolean;
  onOpenPlayer: () => void;
}

// 底栏路由切换只改变选中项；播放状态仍由本组件自己的订阅驱动更新。
const MiniPlayerComponent: React.FC<MiniPlayerProps> = ({
  embedded = false,
  onOpenPlayer,
}) => {
  const t = useTheme();
  const track = useActiveTrack();
  const playback = usePlaybackState();
  // 【性能修复】选择性子订阅，避免每次进度轮询触发重渲染
  const progressPosition = useProgressStore(s => s.position);
  const progressDuration = useProgressStore(s => s.duration);
  const isGlass = !!t.glass;
  const isResolving = usePlayerStore(s => s.isResolving);

  if (!track) {
    return null;
  }
  const isPlaying = playback.state === State.Playing;
  // ======== 加载状态判定 ========
  // 【终极补丁】如果当前轨道的 URL 是占位符（placeholder://），说明播放器底层还没拿到真实地址，
  // 此时 ExoPlayer 可能因为尝试加载无效 URL 而卡在 Loading/Buffering 状态。
  // 这种情况不是"真的在加载"，不应显示转圈动画，而应展示可交互的播放按钮。
  const isPlaceholder =
    typeof track.url === 'string' && track.url.startsWith('placeholder://');
  const isBufferingOrResolving =
    !isPlaceholder &&
    (playback.state === State.Buffering ||
      playback.state === State.Loading ||
      isResolving);
  const p = progressDuration > 0 ? progressPosition / progressDuration : 0;

  const s = StyleSheet.create({
    wrap: {
      borderTopWidth: isGlass ? 0 : t.isDark ? 0 : 0.5,
      borderTopColor: t.colors.divider,
    },
    progress: {
      height: 2,
      backgroundColor: t.colors.divider,
    },
    progressFill: {
      height: 2,
      backgroundColor: t.colors.primary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: t.spacing.sm,
      paddingHorizontal: t.spacing.md,
      height: 56,
    },
    cover: {width: 40, height: 40, borderRadius: t.radius.sm},
    info: {flex: 1, marginHorizontal: t.spacing.md},
    title: {fontSize: t.fontSize.base, color: t.colors.text, fontWeight: '500'},
    artist: {fontSize: t.fontSize.xs, color: t.colors.textSub, marginTop: 2},
    actions: {flexDirection: 'row', alignItems: 'center'},
  });

  const progressBar = (
    <View
      style={[
        s.progress,
        embedded && {
          marginHorizontal: t.spacing.md,
          marginBottom: t.spacing.xs,
          borderRadius: 1,
        },
      ]}>
      {isGlass && t.glass && t.glass.colors.progress.fill ? (
        <LinearGradient
          colors={t.glass.colors.progress.fill}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 0}}
          style={[s.progressFill, {width: `${p * 100}%`}]}
        />
      ) : (
        <View style={[s.progressFill, {width: `${p * 100}%`}]} />
      )}
    </View>
  );

  const playerRow = (
    <View style={s.row}>
      <TouchableOpacity
        onPress={onOpenPlayer}
        activeOpacity={0.7}>
        <FastImage source={{uri: track.artwork as string}} style={s.cover} />
      </TouchableOpacity>
      <TouchableOpacity
        style={s.info}
        activeOpacity={0.7}
        onPress={onOpenPlayer}>
        <Text style={s.title} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={s.artist} numberOfLines={1}>
          {track.artist}
        </Text>
      </TouchableOpacity>
      <View style={s.actions}>
        {isBufferingOrResolving ? (
          <ActivityIndicator
            size="small"
            color={t.colors.primary}
            style={{marginRight: 12}}
          />
        ) : (
          <IconButton
            name={isPlaying ? 'pause' : 'play'}
            size={26}
            color={t.colors.text}
            onPress={() =>
              isPlaying ? pausePlayback() : resumePlayback()
            }
          />
        )}
        <IconButton
          name="skip-next"
          size={26}
          color={t.colors.text}
          onPress={skipToNext}
        />
        <IconButton
          name="playlist-music"
          size={24}
          color={t.colors.text}
          onPress={() => useUIStore.getState().setPlaylistVisible(true)}
        />
      </View>
    </View>
  );

  const innerContent = (
    <>
      {!embedded && progressBar}
      {playerRow}
      {embedded && progressBar}
    </>
  );

  if (embedded) {
    return <View>{innerContent}</View>;
  }

  if (isGlass) {
    return (
      <GlassView style={s.wrap} borderRadius={0}>
        {innerContent}
      </GlassView>
    );
  }

  return (
    <View style={[s.wrap, {backgroundColor: t.colors.surface}]}>
      {innerContent}
    </View>
  );
};

export const MiniPlayer = React.memo(MiniPlayerComponent);
