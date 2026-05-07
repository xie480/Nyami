/**
 * SpectrumView - Native OpenGL 频谱可视化组件
 *
 * 通过 requireNativeComponent 桥接到 android/.../module/SpectrumViewManager.kt，
 * 使用 OpenGL ES 2.0 渲染实时 FFT 频谱、猫耳动态显示和霓虹发光效果。
 *
 * 数据流：useSpectrumPoller → spectrumData prop → SpectrumViewManager → SpectrumGLSurfaceView
 */
import React from 'react';
import { requireNativeComponent, ViewStyle, Platform, View, Text } from 'react-native';

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
  // Android: 渲染 Native OpenGL 组件
  if (NativeSpectrumView) {
    return (
      <NativeSpectrumView
        style={style}
        spectrumData={spectrumData}
        catEarLeft={catEarLeft}
        catEarRight={catEarRight}
      />
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
