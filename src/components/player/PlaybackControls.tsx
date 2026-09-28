import React from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {AlbumTheme} from '../../utils/albumTheme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  isPlaying: boolean;
  isBuffering: boolean;
  isResolving: boolean;
  playMode: 'sequential' | 'shuffle';
  theme: AlbumTheme;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSetMode: (mode: 'sequential' | 'shuffle') => void;
  modeDisabled?: boolean;
}

interface SmallControlProps {
  label: string;
  icon: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}

const SmallControl: React.FC<SmallControlProps> = ({
  label,
  icon,
  color,
  onPress,
  disabled,
}) => {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        scale.value = withTiming(0.93, {duration: 110});
      }}
      onPressOut={() => {
        scale.value = withTiming(1, {duration: 140});
      }}
      style={[styles.sideButton, animatedStyle, disabled && styles.disabled]}>
      <MaterialCommunityIcons name={icon} size={27} color={color} />
    </AnimatedPressable>
  );
};

export const PlaybackControls: React.FC<Props> = ({
  isPlaying,
  isBuffering,
  isResolving,
  playMode,
  theme,
  onPlayPause,
  onPrevious,
  onNext,
  onSetMode,
  modeDisabled = false,
}) => {
  const playScale = useSharedValue(1);
  const playStyle = useAnimatedStyle(() => ({
    transform: [{scale: playScale.value}],
  }));
  const isBusy = isBuffering || isResolving;

  return (
    <View style={styles.row}>
      <SmallControl
        label={playMode === 'shuffle' ? '随机播放模式' : '切换到随机播放'}
        icon="shuffle-variant"
        color={
          playMode === 'shuffle'
            ? theme.primaryAccent
            : theme.secondaryForeground
        }
        onPress={() => onSetMode('shuffle')}
        disabled={modeDisabled}
      />
      <SmallControl
        label="上一首"
        icon="skip-previous"
        color={theme.foreground}
        onPress={onPrevious}
      />
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? '暂停' : '播放'}
        onPress={onPlayPause}
        onPressIn={() => {
          playScale.value = withTiming(0.95, {duration: 120});
        }}
        onPressOut={() => {
          playScale.value = withTiming(1, {duration: 150});
        }}
        style={[styles.playOuter, playStyle]}>
        <LinearGradient
          colors={[theme.primaryAccent, theme.secondaryAccent]}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 1}}
          style={styles.playGradient}>
          <View style={styles.playGlass}>
            {isBusy ? (
              <ActivityIndicator size="large" color={theme.playForeground} />
            ) : (
              <MaterialCommunityIcons
                name={isPlaying ? 'pause' : 'play'}
                size={38}
                color={theme.playForeground}
                style={!isPlaying ? styles.playIcon : undefined}
              />
            )}
          </View>
        </LinearGradient>
      </AnimatedPressable>
      <SmallControl
        label="下一首"
        icon="skip-next"
        color={theme.foreground}
        onPress={onNext}
      />
      <SmallControl
        label={playMode === 'sequential' ? '顺序播放模式' : '切换到顺序播放'}
        icon="repeat"
        color={
          playMode === 'sequential'
            ? theme.primaryAccent
            : theme.secondaryForeground
        }
        onPress={() => onSetMode('sequential')}
        disabled={modeDisabled}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 13,
    marginBottom: 13,
  },
  sideButton: {
    width: 42,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {opacity: 0.48},
  playOuter: {
    width: 84,
    height: 84,
    padding: 3,
    borderRadius: 42,
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 0},
    elevation: 10,
  },
  playGradient: {
    flex: 1,
    borderRadius: 42,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.78)',
  },
  playGlass: {
    flex: 1,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  playIcon: {marginLeft: 4},
});
