import React, {useState} from 'react';
import {View, StyleSheet, LayoutChangeEvent} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useTheme} from '../theme';
import {GestureDetector, Gesture} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

interface Props {
  progress: number; // 0~1
  colors?: [string, string];
  trackColor?: string;
  thumbColor?: string;
  onSeekStart?: () => void;
  onSeekUpdate?: (p: number) => void;
  onSeekEnd?: (p: number) => void;
}

export const ProgressBar: React.FC<Props> = ({
  progress,
  colors,
  trackColor,
  thumbColor,
  onSeekStart,
  onSeekUpdate,
  onSeekEnd,
}) => {
  const t = useTheme();
  const [width, setWidth] = useState(0);

  // 用手势线程的 shared value 替代 JS 线程的 useState，将拖拽 UI 状态与真实播放进度完全分离
  const isDragging = useSharedValue(false);
  const dragProgress = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onStart(e => {
      if (width === 0) {
        return;
      }
      isDragging.value = true;
      dragProgress.value = Math.max(0, Math.min(1, e.x / width));
      if (onSeekStart) {
        runOnJS(onSeekStart)();
      }
    })
    .onUpdate(e => {
      if (width === 0) {
        return;
      }
      dragProgress.value = Math.max(0, Math.min(1, e.x / width));
      if (onSeekUpdate) {
        runOnJS(onSeekUpdate)(dragProgress.value);
      }
    })
    .onEnd(() => {
      isDragging.value = false;
      if (onSeekEnd) {
        runOnJS(onSeekEnd)(dragProgress.value);
      }
    });

  const fillStyle = useAnimatedStyle(() => {
    const p = isDragging.value ? dragProgress.value : progress;
    return {
      width: `${Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0)) * 100}%`,
    };
  });

  const thumbStyle = useAnimatedStyle(() => {
    const p = isDragging.value ? dragProgress.value : progress;
    return {
      left: `${Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0)) * 100}%`,
      opacity: 1,
    };
  });

  const gradientColors = colors ?? t.glass?.colors.progress.fill;

  const s = StyleSheet.create({
    container: {paddingVertical: 10},
    bar: {
      height: 3,
      backgroundColor: trackColor ?? 'rgba(255,255,255,0.32)',
      borderRadius: 2,
      overflow: 'visible',
    },
    fill: {
      height: '100%',
      backgroundColor: colors?.[0] ?? t.colors.primary,
      borderRadius: 2,
    },
    thumb: {
      position: 'absolute',
      top: -5,
      width: 13,
      height: 13,
      borderRadius: 7,
      backgroundColor: thumbColor ?? colors?.[0] ?? t.colors.primary,
      marginLeft: -6.5,
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.92)',
      shadowColor: thumbColor ?? colors?.[0] ?? t.colors.primary,
      shadowOpacity: 0.42,
      shadowRadius: 6,
      elevation: 4,
    },
  });

  return (
    <GestureDetector gesture={panGesture}>
      <View
        onLayout={(e: LayoutChangeEvent) =>
          setWidth(e.nativeEvent.layout.width)
        }
        style={s.container}
        collapsable={false}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="播放进度"
        accessibilityValue={{
          min: 0,
          max: 100,
          now: Math.round(
            Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0)) *
              100,
          ),
        }}>
        <View style={s.bar}>
          {gradientColors ? (
            <AnimatedLinearGradient
              colors={gradientColors}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={[s.fill, fillStyle]}
            />
          ) : (
            <Animated.View style={[s.fill, fillStyle]} />
          )}
          <Animated.View style={[s.thumb, thumbStyle]} />
        </View>
      </View>
    </GestureDetector>
  );
};
