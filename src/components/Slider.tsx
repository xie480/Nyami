import React, { useRef } from 'react';
import {
  View,
  PanResponder,
  StyleSheet,
  LayoutChangeEvent,
  DimensionValue,
} from 'react-native';

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
  style?: any;
  disabled?: boolean;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  minimumValue = 0,
  maximumValue = 100,
  step = 1,
  onValueChange,
  minimumTrackColor = '#6C5CE7',
  maximumTrackColor = 'rgba(255,255,255,0.15)',
  thumbColor = '#6C5CE7',
  trackHeight = 4,
  thumbSize = 24,
  style,
  disabled = false,
}) => {
  const trackRef = useRef<View>(null);
  const trackWidthRef = useRef<number>(0);
  const trackXRef = useRef<number>(0);

  const clampAndStep = (raw: number): number => {
    const clamped = Math.max(minimumValue, Math.min(maximumValue, raw));
    if (step <= 0) return clamped;
    return Math.round(clamped / step) * step;
  };

  const fraction = maximumValue > minimumValue
    ? (value - minimumValue) / (maximumValue - minimumValue)
    : 0;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (evt) => {
        updateValueFromTouch(evt.nativeEvent.pageX);
      },
      onPanResponderMove: (evt) => {
        updateValueFromTouch(evt.nativeEvent.pageX);
      },
    })
  ).current;

  const updateValueFromTouch = (pageX: number) => {
    if (!trackWidthRef.current) return;
    const dx = pageX - trackXRef.current;
    const ratio = Math.max(0, Math.min(1, dx / trackWidthRef.current));
    const raw = minimumValue + ratio * (maximumValue - minimumValue);
    onValueChange(clampAndStep(raw));
  };

  const onLayout = (e: LayoutChangeEvent) => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      trackXRef.current = x;
      trackWidthRef.current = width;
    });
  };

  const thumbLeft: DimensionValue = `${fraction * 100}%`;

  const styles = StyleSheet.create({
    container: {
      height: Math.max(thumbSize, trackHeight),
      justifyContent: 'center',
      paddingHorizontal: thumbSize / 2,
    },
    track: {
      height: trackHeight,
      borderRadius: trackHeight / 2,
      backgroundColor: maximumTrackColor,
      overflow: 'visible',
    },
    trackFill: {
      position: 'absolute',
      left: 0,
      top: 0,
      height: trackHeight,
      width: thumbLeft,
      borderRadius: trackHeight / 2,
      backgroundColor: minimumTrackColor,
    },
    thumb: {
      position: 'absolute',
      top: -(thumbSize - trackHeight) / 2,
      left: thumbLeft,
      marginLeft: -thumbSize / 2,
      width: thumbSize,
      height: thumbSize,
      borderRadius: thumbSize / 2,
      backgroundColor: thumbColor,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
    },
  });

  return (
    <View
      style={[styles.container, style]}
      {...panResponder.panHandlers}
    >
      <View ref={trackRef} style={styles.track} onLayout={onLayout}>
        <View style={styles.trackFill} />
        <View style={styles.thumb} />
      </View>
    </View>
  );
};
