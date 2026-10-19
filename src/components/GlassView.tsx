import React, {useEffect, useState} from 'react';
import {
  View,
  StyleSheet,
  ViewStyle,
  StyleProp,
  Platform,
  InteractionManager,
} from 'react-native';
import {BlurView} from '@react-native-community/blur';
import {useTheme} from '../theme';
import {useSettingsStore} from '../store/settingsStore';

interface GlassViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  blurRadius?: number;
  borderRadius?: number;
  backgroundColor?: string;
  borderColor?: string;
  noShadow?: boolean;
  noBlur?: boolean;
  minimal?: boolean;
  /** Preserve a bounded scroll area through every wrapper. */
  constrainContent?: boolean;
}

const constrainedContentStyle: ViewStyle = {flexShrink: 1, minHeight: 0};

/** One theme-aware surface: native blur is reserved for glass themes and overlays. */
export const GlassView: React.FC<GlassViewProps> = ({
  children,
  style,
  blurRadius,
  borderRadius,
  backgroundColor,
  borderColor,
  noShadow = false,
  noBlur = false,
  minimal = false,
  constrainContent = false,
}) => {
  const t = useTheme();
  const globalBlurAmount = useSettingsStore(s => s.glassBlurAmount);
  const shouldBlur = !!t.glass && !noBlur && !minimal;
  const [ready, setReady] = useState(false);
  const constraint = constrainContent ? constrainedContentStyle : undefined;
  const rounded = borderRadius ?? t.radius.xl;
  const background =
    backgroundColor ?? t.glass?.colors.glass.bg ?? t.colors.surface;
  const border =
    borderColor ?? t.glass?.colors.glass.border ?? t.colors.divider;
  const requestedBlur =
    blurRadius ?? globalBlurAmount ?? t.glass?.material.blurRadius ?? 16;

  useEffect(() => {
    setReady(false);
    if (!shouldBlur) {
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, [shouldBlur]);

  return (
    <View
      style={[
        {borderRadius: rounded},
        !noShadow &&
          !minimal && {
            shadowColor: '#000',
            shadowOffset: {width: 0, height: 4},
            shadowOpacity: t.isDark ? 0.18 : 0.05,
            shadowRadius: 16,
            elevation: 2,
          },
        constraint,
        style,
      ]}>
      <View style={[{overflow: 'hidden', borderRadius: rounded}, constraint]}>
        {shouldBlur && ready && (
          <BlurView
            style={StyleSheet.absoluteFill}
            blurType={t.isDark ? 'dark' : 'light'}
            blurAmount={
              Platform.OS === 'android'
                ? Math.min(requestedBlur, 25)
                : requestedBlur
            }
            reducedTransparencyFallbackColor={t.colors.surfaceRaised}
          />
        )}
        <View
          style={[
            {
              backgroundColor: background,
              borderColor: border,
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: rounded,
            },
            constraint,
          ]}>
          <View style={constraint}>{children}</View>
        </View>
      </View>
    </View>
  );
};
