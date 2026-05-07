import React, { useRef, useMemo } from 'react';
import {
  View,
  Text,
  PanResponder,
  StyleSheet,
  LayoutChangeEvent,
  Animated,
} from 'react-native';
import { useTheme } from '../../theme';

interface EQSliderProps {
  /** 当前增益值 (-12 ~ +12) */
  value: number;
  /** 频段标签（如 "31", "1k"） */
  label: string;
  /** 值变更回调 */
  onValueChange: (value: number) => void;
  /** 滑块宽度 */
  width?: number;
  /** 滑块高度 */
  height?: number;
  /** 是否禁用 */
  disabled?: boolean;
}

/** 霓虹发光色的 HSL 渐变 - 蓝紫霓虹风格 */
const getNeonColor = (fraction: number): string => {
  // -12dB → 蓝色系, 0dB → 青绿, +12dB → 紫红
  if (fraction < 0.5) {
    // 蓝 → 青绿
    const t = fraction / 0.5;
    return `hsl(${240 - t * 120}, 100%, ${60 + t * 10}%)`;
  } else {
    // 青绿 → 紫红
    const t = (fraction - 0.5) / 0.5;
    return `hsl(${120 - t * 120}, 100%, ${70 + t * 10}%)`;
  }
};

export const EQSlider: React.FC<EQSliderProps> = ({
  value,
  label,
  onValueChange,
  width = 32,
  height = 180,
  disabled = false,
}) => {
  const t = useTheme();
  const trackRef = useRef<View>(null);
  const trackLayoutRef = useRef({ y: 0, height: 0 });

  // 动画值：拖动时的缩放和发光
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // 归一化值：0 (bottom, -12dB) ~ 1 (top, +12dB)
  const fraction = (value + 12) / 24;

  // 当前霓虹色
  const neonColor = useMemo(() => getNeonColor(fraction), [fraction]);

  const clampAndStep = (raw: number): number => {
    const clamped = Math.max(-12, Math.min(12, raw));
    return Math.round(clamped);
  };

  const updateValueFromTouch = (pageY: number) => {
    if (!trackLayoutRef.current.height) return;
    const dy = pageY - trackLayoutRef.current.y;
    // 反转：上滑 → 增益增加
    const ratio = 1 - Math.max(0, Math.min(1, dy / trackLayoutRef.current.height));
    const raw = -12 + ratio * 24;
    onValueChange(clampAndStep(raw));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: () => {
        Animated.parallel([
          Animated.spring(scaleAnim, {
            toValue: 1.15,
            useNativeDriver: true,
            friction: 8,
          }),
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 100,
            useNativeDriver: false,
          }),
        ]).start();
      },
      onPanResponderRelease: () => {
        Animated.parallel([
          Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            friction: 6,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
          }),
        ]).start();
      },
      onPanResponderMove: (evt) => {
        updateValueFromTouch(evt.nativeEvent.pageY);
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    trackRef.current?.measureInWindow((_x, y, _w, h) => {
      trackLayoutRef.current = { y, height: h };
    });
  };

  // 发光强度
  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });

  const thumbSize = 24;
  // 滑块从底部向上填充
  const fillHeight = (fraction * 100) as `${number}%`;
  const thumbBottom = fillHeight;

  return (
    <View style={[styles.container, { width, height }]}>
      {/* 标签 */}
      <Text style={[styles.label, { color: t.colors.textSub }]}>{label}</Text>

      {/* 滑块轨道 */}
      <View
        ref={trackRef}
        style={[
          styles.track,
          {
            width: 4,
            flex: 1,
            backgroundColor: t.colors.divider,
            borderRadius: 2,
          },
        ]}
        onLayout={onLayout}
        {...panResponder.panHandlers}
      >
        {/* 填充轨道 */}
        <View
          style={[
            styles.trackFill,
            {
              width: 4,
              height: fillHeight as any,
              backgroundColor: neonColor,
              borderRadius: 2,
            },
          ]}
        />

        {/* 发光底部 */}
        <Animated.View
          style={[
            styles.glow,
            {
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: neonColor,
              opacity: glowOpacity,
              bottom: thumbBottom as any,
              marginBottom: -10,
            },
          ]}
        />

        {/* 滑块拇指 */}
        <Animated.View
          style={[
            styles.thumb,
            {
              width: thumbSize,
              height: thumbSize,
              borderRadius: thumbSize / 2,
              backgroundColor: neonColor,
              borderColor: neonColor,
              bottom: thumbBottom as any,
              marginBottom: -thumbSize / 2,
              transform: [{ scale: scaleAnim }],
              // 外发光阴影
              shadowColor: neonColor,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.6,
              shadowRadius: 8,
              elevation: 8,
            },
          ]}
        />
      </View>

      {/* 数值显示 */}
      <Text style={[styles.value, { color: t.colors.textHint }]}>
        {value > 0 ? `+${value}` : value}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 6,
    textAlign: 'center',
  },
  track: {
    position: 'relative',
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'visible',
  },
  trackFill: {
    position: 'absolute',
    bottom: 0,
  },
  glow: {
    position: 'absolute',
  },
  thumb: {
    position: 'absolute',
    borderWidth: 2,
  },
  value: {
    fontSize: 9,
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },
});
