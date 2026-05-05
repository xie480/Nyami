import React from 'react';
import {
  View,
  Image,
  StyleSheet,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../theme';
import { useSettingsStore } from '../store/settingsStore';

/**
 * Premium background engine with global custom background support.
 *
 * - When a custom background image is set via Settings, it renders the
 *   image full-screen on ALL themes.
 * - In glass themes, a tinted optical diffusion mask is overlaid
 *   for frosted-glass effect, plus a semi-transparent optical mask.
 * - In non-glass themes, a stronger opacity mask is applied to ensure
 *   text readability while the custom image bleeds through softly.
 * - Without a custom image, the component renders only in glass themes
 *   with the default linear-gradient background.
 */
export const GlassBackground: React.FC = () => {
  const { glass, isDark } = useTheme();
  const customBackgroundImage = useSettingsStore((s) => s.customBackgroundImage);

  const hasCustomBg = !!customBackgroundImage;

  // 没有自定义背景且非玻璃主题 → 不渲染
  if (!hasCustomBg && !glass) return null;

  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: -1 }]} pointerEvents="none">
      {/* Layer 0 — custom image or default gradient */}
      {hasCustomBg ? (
        <Image
          source={{ uri: customBackgroundImage! }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      ) : (
        // glass 存在时才渲染默认渐变（非玻璃且无自定义图已在上面 return）
        <LinearGradient
          colors={Array.isArray(glass!.colors.pageBg) ? glass!.colors.pageBg : [glass!.colors.pageBg, glass!.colors.pageBg]}
          style={StyleSheet.absoluteFillObject}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      )}

      {/* Layer 1 — optical diffusion mask (replaces native BlurView to avoid zIndex bypass) */}
      {hasCustomBg && glass && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: isDark
                ? 'rgba(10, 10, 20, 0.45)'
                : 'rgba(240, 240, 248, 0.40)',
            },
          ]}
        />
      )}

      {/* Layer 2 — optical mask for readability */}
      {hasCustomBg && !glass ? (
        // 非玻璃主题：更强遮罩以保证文字可读性
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: isDark
                ? 'rgba(0, 0, 0, 0.55)'
                : 'rgba(255, 255, 255, 0.65)',
            },
          ]}
        />
      ) : (
        // 玻璃主题下的半透明光学遮罩（自定义背景或无自定义背景都适用）
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: isDark
                ? 'rgba(10, 10, 20, 0.32)'
                : 'rgba(255, 255, 255, 0.28)',
            },
          ]}
        />
      )}
    </View>
  );
};
