/**
 * EQSlider - 高性能霓虹均衡器滑块组件
 *
 * 重构要点：
 * - 使用 requestAnimationFrame 逐帧渲染调度
 * - 高效节流算法（值变化 > 0.5dB 时才触发更新）
 * - GPU 硬件加速（renderToHardwareTextureAndroid + nativeDriver）
 * - 被动事件声明（不阻塞主线程滚动）
 * - 真实物理阻尼感交互（spring 回弹 + 弹性缩放）
 */
import React, { useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  PanResponder,
  StyleSheet,
  LayoutChangeEvent,
  Animated,
  Platform,
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

/** 节流阈值：值变化超过此值才触发更新（避免微振动导致的频繁渲染） */
const THROTTLE_THRESHOLD = 0.5;

export const EQSlider: React.FC<EQSliderProps> = ({
  value,
  label,
  onValueChange,
  width = 32,
  height = 180,
  disabled = false,
}) => {
  const t = useTheme();

  // ========== Refs（不触发渲染的热路径） ==========
  const trackLayoutRef = useRef({ y: 0, height: 0 });
  const rafRef = useRef<number | null>(null);
  const pendingValueRef = useRef<number>(value);
  const lastCommittedValueRef = useRef<number>(value);
  const isDraggingRef = useRef(false);

  // ========== 动画值 ==========
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // ========== 归一化值 ==========
  const fraction = (value + 12) / 24;
  const neonColor = useMemo(() => getNeonColor(fraction), [fraction]);

  // ========== 值节流提交 ==========
  const commitValue = useCallback(() => {
    const pending = pendingValueRef.current;
    const lastCommitted = lastCommittedValueRef.current;

    // 节流：变化超过阈值才提交
    if (Math.abs(pending - lastCommitted) >= THROTTLE_THRESHOLD || isDraggingRef.current === false) {
      lastCommittedValueRef.current = pending;
      onValueChange(pending);
    }
  }, [onValueChange]);

  // ========== rAF 调度循环 ==========
  const scheduleFrame = useCallback(() => {
    if (rafRef.current !== null) return; // 已有调度中的帧
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      commitValue();
      // 如果仍在拖动中，继续调度下一帧
      if (isDraggingRef.current) {
        scheduleFrame();
      }
    });
  }, [commitValue]);

  // 清理 rAF
  const cancelFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // ========== 触摸坐标 → 增益值 ==========
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
    pendingValueRef.current = clampAndStep(raw);
  };

  // ========== PanResponder（被动事件，不阻塞滚动） ==========
  const panResponder = useRef(
    PanResponder.create({
      // 仅在非禁用状态下捕获触摸
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      // 不捕获事件以避免阻塞父级滚动（被动事件语义）
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: () => false,

      onPanResponderGrant: () => {
        isDraggingRef.current = true;

        // 启动回弹动画（GPU 加速）
        Animated.parallel([
          Animated.spring(scaleAnim, {
            toValue: 1.15,
            useNativeDriver: true,
            friction: 8,
            tension: 100,
          }),
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 80,
            useNativeDriver: false,
          }),
        ]).start();

        // 启动 rAF 调度
        scheduleFrame();
      },

      onPanResponderMove: (evt) => {
        // 仅更新 ref 值，不直接触发状态更新
        updateValueFromTouch(evt.nativeEvent.pageY);
      },

      onPanResponderRelease: () => {
        isDraggingRef.current = false;

        // 最终提交一次
        commitValue();

        // 停止 rAF
        cancelFrame();

        // 回弹动画（GPU 加速 + 弹簧阻尼感）
        Animated.parallel([
          Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            friction: 6,
            tension: 80,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
          }),
        ]).start();
      },

      onPanResponderTerminate: () => {
        isDraggingRef.current = false;
        commitValue();
        cancelFrame();
        Animated.parallel([
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 6 }),
          Animated.timing(glowAnim, { toValue: 0, duration: 150, useNativeDriver: false }),
        ]).start();
      },
    }),
  ).current;

  // ========== 布局测量 ==========
  const onLayout = (e: LayoutChangeEvent) => {
    // 使用 measureInWindow 获取全局坐标（ScrollView 内也能正确定位）
    e.target?.measureInWindow?.((_x: number, y: number, _w: number, h: number) => {
      trackLayoutRef.current = { y, height: h };
    });
  };

  // 发光强度
  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });

  const thumbSize = 24;
  const fillFraction = fraction;

  return (
    <View style={[styles.container, { width, height }]}>
      {/* 频段标签 */}
      <Text style={[styles.label, { color: t.colors.textSub }]}>{label}</Text>

      {/* 滑块轨道 */}
      <View
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
        {/* 填充轨道（从底部向上） */}
        <View
          style={[
            styles.trackFill,
            {
              width: 4,
              height: `${fillFraction * 100}%` as any,
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
              bottom: `${fillFraction * 100}%` as any,
              marginBottom: -10,
            },
          ]}
        />

        {/* 滑块拇指 - GPU 硬件加速 */}
        <Animated.View
          renderToHardwareTextureAndroid={Platform.OS === 'android'}
          style={[
            styles.thumb,
            {
              width: thumbSize,
              height: thumbSize,
              borderRadius: thumbSize / 2,
              backgroundColor: neonColor,
              borderColor: neonColor,
              bottom: `${fillFraction * 100}%` as any,
              marginBottom: -thumbSize / 2,
              transform: [{ scale: scaleAnim }],
              // GPU 复合层加速：阴影和 elevation 触发硬件层
              shadowColor: neonColor,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.6,
              shadowRadius: 8,
              elevation: 12,
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
