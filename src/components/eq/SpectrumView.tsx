/**
 * SpectrumView - Native OpenGL 频谱可视化组件
 *
 * 通过 requireNativeComponent 桥接到 android/.../module/SpectrumViewManager.kt，
 * 使用 OpenGL ES 2.0 渲染实时 FFT 频谱、猫耳动态显示和霓虹发光效果。
 *
 * 数据流：useSpectrumPoller → spectrumData prop → SpectrumViewManager → SpectrumGLSurfaceView
 *
 * 增强功能：
 * - 空闲状态检测（无频谱数据时显示呼吸动画占位引导层）
 */
import React, { useEffect, useRef } from 'react';
import {
  requireNativeComponent,
  ViewStyle,
  Platform,
  View,
  Text,
  Animated,
} from 'react-native';

interface NativeSpectrumViewProps {
  spectrumData: number[];
  catEarLeft?: number[];
  catEarRight?: number[];
  style?: ViewStyle;
}

// 仅在 Android 上可用，通过 DSPPackage 注册的 "SpectrumView"
const NativeSpectrumView: React.ComponentType<NativeSpectrumViewProps> | null =
  Platform.OS === 'android'
    ? (requireNativeComponent('SpectrumView') as any)
    : null;

interface Props {
  style?: ViewStyle;
  /** 频谱数据 (0~1 归一化幅度)，推荐 128 bins */
  spectrumData?: number[];
  /** 猫耳左声道数据 (16 bins) */
  catEarLeft?: number[];
  /** 猫耳右声道数据 (16 bins) */
  catEarRight?: number[];
}

/**
 * 判断频谱数据是否为空闲状态（无有效数据）
 */
function isSpectrumIdle(data: number[]): boolean {
  if (!data || data.length === 0) return true;
  // 检查是否所有值均为 0 或极低（<-100dB 等效）
  return data.every(v => v < 0.001);
}

/**
 * 空闲状态呼吸动画占位组件
 */
const IdleOverlay: React.FC<{ style?: ViewStyle }> = ({ style }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <View
      style={[
        {
          ...StyleSheet.absoluteFillObject,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.25)',
          borderRadius: 12,
        },
        style,
      ]}
      pointerEvents="none"
    >
      <Animated.View style={{ opacity: pulseAnim, alignItems: 'center' }}>
        <Text style={{ color: '#888', fontSize: 28, marginBottom: 8 }}>🎵</Text>
        <Text style={{ color: '#aaa', fontSize: 13, fontWeight: '500' }}>
          启动播放以激活频谱动效
        </Text>
        <Text style={{ color: '#666', fontSize: 10, marginTop: 4 }}>
          实时 FFT 频谱 & 猫耳动态显示
        </Text>
      </Animated.View>
    </View>
  );
};

/**
 * OpenGL 频谱可视化组件
 *
 * 使用方式：
 * ```tsx
 * <SpectrumView style={{ width: '100%', height: 120 }} spectrumData={data} />
 * ```
 */
export const SpectrumView: React.FC<Props> = ({
  style,
  spectrumData = [],
  catEarLeft = [],
  catEarRight = [],
}) => {
  const idle = isSpectrumIdle(spectrumData);

  // Android: 渲染 Native OpenGL 组件
  if (NativeSpectrumView) {
    return (
      <View style={[{ position: 'relative' }, style]}>
        <NativeSpectrumView
          style={{ width: '100%', height: '100%' }}
          spectrumData={spectrumData}
          catEarLeft={catEarLeft}
          catEarRight={catEarRight}
        />
        {/* 空闲状态叠加占位层 */}
        {idle && <IdleOverlay />}
      </View>
    );
  }

  // iOS / Fallback: 显示降级占位
  return (
    <View
      style={[
        {
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.3)',
          borderRadius: 12,
        },
        style,
      ]}
    >
      <Text style={{ color: '#888', fontSize: 12 }}>
        频谱可视化需要 Android OpenGL 支持
      </Text>
    </View>
  );
};

// 内联 StyleSheet 用于 IdleOverlay
const StyleSheet = {
  absoluteFillObject: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
};
