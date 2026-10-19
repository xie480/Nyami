import React, {useRef} from 'react';
import {
  View,
  PanResponder,
  StyleSheet,
  LayoutChangeEvent,
  DimensionValue,
  StyleProp,
  ViewStyle,
} from 'react-native';
import {useTheme} from '../theme';

interface SliderProps {
  value: number;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  onValueChange: (value: number) => void;
  minimumTrackColor?: string;
  maximumTrackColor?: string;
  thumbColor?: string;
  trackHeight?: number;
  thumbSize?: number;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityValueText?: string;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  minimumValue = 0,
  maximumValue = 100,
  step = 1,
  onValueChange,
  minimumTrackColor,
  maximumTrackColor,
  thumbColor,
  trackHeight = 4,
  thumbSize = 24,
  style,
  disabled = false,
  accessibilityLabel = '调整数值',
  accessibilityValueText,
}) => {
  const t = useTheme();
  const trackRef = useRef<View>(null);
  const trackWidth = useRef(0);
  const trackX = useRef(0);
  const latest = useRef({
    value,
    minimumValue,
    maximumValue,
    step,
    onValueChange,
    disabled,
  });
  latest.current = {
    value,
    minimumValue,
    maximumValue,
    step,
    onValueChange,
    disabled,
  };

  const update = (raw: number) => {
    const current = latest.current;
    if (
      current.disabled ||
      current.maximumValue <= current.minimumValue ||
      !Number.isFinite(raw)
    ) {
      return;
    }
    const rounded =
      current.step > 0
        ? current.minimumValue +
          Math.round((raw - current.minimumValue) / current.step) * current.step
        : raw;
    current.onValueChange(
      Math.max(current.minimumValue, Math.min(current.maximumValue, rounded)),
    );
  };
  const updateFromTouch = (pageX: number) => {
    if (trackWidth.current <= 0) {
      return;
    }
    const ratio = Math.max(
      0,
      Math.min(1, (pageX - trackX.current) / trackWidth.current),
    );
    const current = latest.current;
    update(
      current.minimumValue +
        ratio * (current.maximumValue - current.minimumValue),
    );
  };
  const handlers = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: () => !latest.current.disabled,
      onPanResponderGrant: event => {
        const pageX = event.nativeEvent.pageX;
        // Measure again after scrolling or opening a sheet.
        trackRef.current?.measureInWindow((x, _y, width) => {
          trackX.current = x;
          trackWidth.current = width;
          updateFromTouch(pageX);
        });
      },
      onPanResponderMove: event => updateFromTouch(event.nativeEvent.pageX),
    }),
  ).current;

  const fraction =
    maximumValue > minimumValue
      ? Math.max(
          0,
          Math.min(1, (value - minimumValue) / (maximumValue - minimumValue)),
        )
      : 0;
  const left: DimensionValue = `${fraction * 100}%`;
  const activeColor = minimumTrackColor ?? t.colors.primary;
  const onLayout = (_event: LayoutChangeEvent) => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      trackX.current = x;
      trackWidth.current = width;
    });
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled}}
      accessibilityValue={{
        min: minimumValue,
        max: maximumValue,
        now: Math.max(minimumValue, Math.min(maximumValue, value)),
        text: accessibilityValueText,
      }}
      accessibilityActions={[
        {name: 'increment', label: '增加'},
        {name: 'decrement', label: '减少'},
      ]}
      onAccessibilityAction={event => {
        const direction =
          event.nativeEvent.actionName === 'increment'
            ? 1
            : event.nativeEvent.actionName === 'decrement'
            ? -1
            : 0;
        if (direction) {
          update(
            latest.current.value +
              direction *
                (latest.current.step > 0
                  ? latest.current.step
                  : (maximumValue - minimumValue) / 100),
          );
        }
      }}
      style={[
        styles.container,
        {paddingHorizontal: thumbSize / 2, opacity: disabled ? 0.45 : 1},
        style,
      ]}
      {...handlers.panHandlers}>
      <View
        ref={trackRef}
        onLayout={onLayout}
        style={{
          height: trackHeight,
          borderRadius: trackHeight / 2,
          backgroundColor: maximumTrackColor ?? t.colors.divider,
        }}>
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: left,
            height: trackHeight,
            borderRadius: trackHeight / 2,
            backgroundColor: activeColor,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left,
            top: -(thumbSize - trackHeight) / 2,
            marginLeft: -thumbSize / 2,
            width: thumbSize,
            height: thumbSize,
            borderRadius: thumbSize / 2,
            backgroundColor: thumbColor ?? activeColor,
            borderWidth: 2,
            borderColor: t.colors.surfaceRaised,
            elevation: 2,
          }}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {minHeight: 48, justifyContent: 'center'},
});
