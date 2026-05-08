/**
 * EQSlider - 高性能霓虹均衡器滑块组件
 *
 * 性能优化核心策略（v3）：
 * - 拖动中通过 Animated.Value (useNativeDriver: true) 驱动 thumb 位置的 translateY，
 *   完全绕过 React 渲染周期，保证 60fps 丝滑跟手。
 * - 拖动中以 throttle(50ms) 频率调用 onValueChange 实时更新 DSP 音频处理，
 *   避免高频状态更新阻塞 JS 线程。
 * - 释放时提交最终值并触发弹性回弹动画。
 * - 外部 value 变化（预设/重置）在非拖动态下通过 useEffect 同步到动画值。
 */

import React, { useRef, useEffect, useMemo, useCallback } from 'react';
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

// ========== 轻量级 throttle 实现 ==========
function throttle<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let lastTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    const now = Date.now();
    if (now - lastTime >= delay) {
      lastTime = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastTime = Date.now();
        timeoutId = null;
        fn(...args);
      }, delay - (now - lastTime));
    }
  }) as T;
}

interface EQSliderProps {
  /** 当前增益值 (-12 ~ +12) */
  value: number;
  /** 频段标签（如 "31", "1k"） */
  label: string;
  /** 值变更回调 - 拖动中 throttle 调用，释放时最终调用 */
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
  if (fraction < 0.5) {
    const t = fraction / 0.5;
    return `hsl(${240 - t * 120}, 100%, ${60 + t * 10}%)`;
  } else {
    const t = (fraction - 0.5) / 0.5;
    return `hsl(${120 - t * 120}, 100%, ${70 + t * 10}%)`;
  }
};

const GAIN_MIN = -12;
const GAIN_MAX = 12;
const THROTTLE_MS = 50; // DSP 更新节流间隔

export const EQSlider: React.FC<EQSliderProps> = ({
  value,
  label,
  onValueChange,
  width = 32,
  height = 180,
  disabled = false,
}) => {
  const t = useTheme();

  // ========== Refs ==========
  const trackLayoutRef = useRef({ y: 0, height: 0 });
  /** 拖动中的当前增益值 ref */
  const dragValueRef = useRef<number>(value);
  /** 是否正在拖动 */
  const isDraggingRef = useRef(false);
  /** 最后一次提交的值 */
  const lastCommittedValueRef = useRef<number>(value);
  /** 轨道的实际布局高度（用于计算 thumb 初始 bottom） */
  const trackHeightRef = useRef(height - 30); // 减去标签和数值区域

  // 存储 onValueChange 引用以避免闭包过期
  const onChangeRef = useRef(onValueChange);
  onChangeRef.current = onValueChange;

  // ========== 动画值 ==========
  // thumb 垂直偏移（单位 px），正值 = 向下移动
  const animTranslateY = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // throttle 包装的回调（稳定引用）
  const throttledOnChange = useRef(
    throttle((val: number) => {
      onChangeRef.current(val);
    }, THROTTLE_MS),
  ).current;

  // ========== 归一化值 ==========
  const fraction = useMemo(() => (value + 12) / 24, [value]);
  const neonColor = useMemo(() => getNeonColor(fraction), [fraction]);

  // 当前 thumb 应该位于的 bottom 位置（基于 prop value）
  const thumbBottomPx = fraction * trackHeightRef.current;

  // thumb 当前实际底部位置（初始 bottom + 动画偏移）
  // translateY 正值向下，所以 thumb 的净偏移 = thumbBottomPx - translateY
  // 简化处理：我们直接在样式中使用 bottom: thumbBottomPx，
  // translateY 在拖动时叠加偏移量（负值向上）

  // ========== 外部 value 变化时同步动画值 ==========
  useEffect(() => {
    if (!isDraggingRef.current) {
      // 非拖动态下，外部 value 变化 → 回弹动画到新位置
      Animated.spring(animTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 100,
      }).start();
      dragValueRef.current = value;
      lastCommittedValueRef.current = value;
    }
  }, [value, animTranslateY]);

  // ========== 触摸坐标 → 增益值 ==========
  const clampAndStep = (raw: number): number => {
    const clamped = Math.max(GAIN_MIN, Math.min(GAIN_MAX, raw));
    return Math.round(clamped);
  };

  const getValueFromTouch = (pageY: number): number => {
    if (!trackLayoutRef.current.height) return dragValueRef.current;
    const dy = pageY - trackLayoutRef.current.y;
    const ratio = 1 - Math.max(0, Math.min(1, dy / trackLayoutRef.current.height));
    const raw = GAIN_MIN + ratio * (GAIN_MAX - GAIN_MIN);
    return clampAndStep(raw);
  };

  const getTranslateYFromValue = (val: number): number => {
    const newFraction = (val + 12) / 24;
    const newBottom = newFraction * trackHeightRef.current;
    // translateY = 初始bottom - 新bottom（正值向下，负值向上）
    return thumbBottomPx - newBottom;
  };

  // ========== PanResponder ==========
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: () => false,

      onPanResponderGrant: () => {
        isDraggingRef.current = true;
        dragValueRef.current = value;

        // 启动拖动视觉反馈
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
      },

      onPanResponderMove: (evt) => {
        const newValue = getValueFromTouch(evt.nativeEvent.pageY);
        if (newValue !== dragValueRef.current) {
          dragValueRef.current = newValue;
          // 更新动画值（原生线程，不触发 JS 渲染）
          const ty = getTranslateYFromValue(newValue);
          animTranslateY.setValue(ty);
          // throttle 频率更新 DSP
          throttledOnChange(newValue);
        }
      },

      onPanResponderRelease: () => {
        isDraggingRef.current = false;
        const finalValue = dragValueRef.current;

        // 提交最终值到 store
        if (finalValue !== lastCommittedValueRef.current) {
          lastCommittedValueRef.current = finalValue;
          onChangeRef.current(finalValue);
        }

        // 回弹动画：translateY → 0（回到 prop value 对应的位置）
        Animated.parallel([
          Animated.spring(animTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 6,
            tension: 80,
          }),
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
        const finalValue = dragValueRef.current;
        if (finalValue !== lastCommittedValueRef.current) {
          lastCommittedValueRef.current = finalValue;
          onChangeRef.current(finalValue);
        }
        Animated.parallel([
          Animated.spring(animTranslateY, { toValue: 0, useNativeDriver: true, friction: 6 }),
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 6 }),
          Animated.timing(glowAnim, { toValue: 0, duration: 150, useNativeDriver: false }),
        ]).start();
      },
    }),
  ).current;

  // ========== 布局测量 ==========
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    e.target?.measureInWindow?.((_x: number, y: number, _w: number, h: number) => {
      trackLayoutRef.current = { y, height: h };
      trackHeightRef.current = h;
    });
  }, []);

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });

  const thumbSize = 24;

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
        {/* 填充轨道（从底部向上，基于 prop value） */}
        <View
          style={[
            styles.trackFill,
            {
              width: 4,
              height: `${fraction * 100}%` as any,
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
              bottom: `${fraction * 100}%` as any,
              marginBottom: -10,
            },
          ]}
        />

        {/* 滑块拇指 - GPU 硬件加速 + 原生动画线程 */}
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
              // 基础位置由 bottom 决定（基于 prop value）
              bottom: `${fraction * 100}%` as any,
              marginBottom: -thumbSize / 2,
              // 拖动偏移由 translateY 驱动（原生线程，60fps）
              transform: [
                { translateY: animTranslateY },
                { scale: scaleAnim },
              ],
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
