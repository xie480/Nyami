import React, { useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../theme';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

interface Props {
  progress: number;        // 0~1
  onSeekStart?: () => void;
  onSeekEnd?: (p: number) => void;
}

export const ProgressBar: React.FC<Props> = ({ progress, onSeekStart, onSeekEnd }) => {
  const t = useTheme();
  const [width, setWidth] = useState(0);

  // 用手势线程的 shared value 替代 JS 线程的 useState，将拖拽 UI 状态与真实播放进度完全分离
  const isDragging = useSharedValue(false);
  const dragProgress = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onStart((e) => {
      if (width === 0) return;
      isDragging.value = true;
      dragProgress.value = Math.max(0, Math.min(1, e.x / width));
      if (onSeekStart) runOnJS(onSeekStart)();
    })
    .onUpdate((e) => {
      if (width === 0) return;
      dragProgress.value = Math.max(0, Math.min(1, e.x / width));
    })
    .onEnd(() => {
      isDragging.value = false;
      if (onSeekEnd) runOnJS(onSeekEnd)(dragProgress.value);
    });

  const fillStyle = useAnimatedStyle(() => {
    const p = isDragging.value ? dragProgress.value : progress;
    return {
      width: `${(Number.isNaN(p) ? 0 : p) * 100}%`,
    };
  });

  const thumbStyle = useAnimatedStyle(() => {
    const p = isDragging.value ? dragProgress.value : progress;
    return {
      left: `${(Number.isNaN(p) ? 0 : p) * 100}%`,
      opacity: isDragging.value ? 1 : 0,
    };
  });

  const s = StyleSheet.create({
    container: { paddingVertical: 10 },
    bar: {
      height: 3,
      backgroundColor: t.colors.divider,
      borderRadius: 2,
      overflow: 'visible',
    },
    fill: {
      height: '100%',
      backgroundColor: t.colors.primary,
      borderRadius: 2,
    },
    thumb: {
      position: 'absolute',
      top: -5,
      width: 13,
      height: 13,
      borderRadius: 7,
      backgroundColor: t.colors.primary,
      marginLeft: -6.5,
    },
  });

  return (
    <GestureDetector gesture={panGesture}>
      <View
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={s.container}
        collapsable={false}
      >
        <View style={s.bar}>
          {t.glass && t.glass.colors.progress.fill ? (
            <AnimatedLinearGradient
              colors={t.glass.colors.progress.fill}
              start={{x:0,y:0}} end={{x:1,y:0}}
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
