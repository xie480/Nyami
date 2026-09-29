import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {LayoutChangeEvent, StyleSheet, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useTheme} from '../theme';
import {GestureDetector, Gesture} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {formatDuration} from '../utils/format';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

interface Props {
  progress: number;
  position: number;
  duration: number;
  colors?: [string, string];
  trackColor?: string;
  thumbColor?: string;
  timeColor?: string;
  onSeekEnd?: (progress: number) => void;
}

const clampProgress = (value: number) => {
  'worklet';
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
};

export const ProgressBar: React.FC<Props> = ({
  progress,
  position,
  duration,
  colors,
  trackColor,
  thumbColor,
  timeColor,
  onSeekEnd,
}) => {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [previewPosition, setPreviewPosition] = useState<number | null>(null);
  const seekConfirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const awaitingSeekConfirmation = useRef(false);
  const onSeekEndRef = useRef(onSeekEnd);
  onSeekEndRef.current = onSeekEnd;

  // Playback and drag state stay on the UI thread; only the time label is sampled back to JS.
  const isDragging = useSharedValue(false);
  const pendingSeek = useSharedValue(false);
  const dragProgress = useSharedValue(clampProgress(progress));
  const playbackProgress = useSharedValue(clampProgress(progress));
  const playbackPosition = useSharedValue(position);
  const playbackDuration = useSharedValue(duration);
  const lastPreviewUpdateAt = useSharedValue(0);

  const beginSeekPreview = useCallback((seconds: number) => {
    if (seekConfirmationTimer.current) {
      clearTimeout(seekConfirmationTimer.current);
      seekConfirmationTimer.current = null;
    }
    awaitingSeekConfirmation.current = false;
    setPreviewPosition(seconds);
  }, []);

  const updateSeekPreview = useCallback((seconds: number) => {
    setPreviewPosition(seconds);
  }, []);

  const cancelSeekPreview = useCallback(() => {
    awaitingSeekConfirmation.current = false;
    setPreviewPosition(null);
  }, []);

  const finishSeek = useCallback(
    (targetProgress: number, targetSeconds: number) => {
      awaitingSeekConfirmation.current = true;
      setPreviewPosition(targetSeconds);
      onSeekEndRef.current?.(targetProgress);
      if (seekConfirmationTimer.current) {
        clearTimeout(seekConfirmationTimer.current);
      }
      seekConfirmationTimer.current = setTimeout(() => {
        awaitingSeekConfirmation.current = false;
        pendingSeek.value = false;
        setPreviewPosition(null);
        seekConfirmationTimer.current = null;
      }, 1800);
    },
    [pendingSeek],
  );

  useEffect(() => {
    const normalizedProgress = clampProgress(progress);
    playbackPosition.value = position;
    playbackDuration.value = duration;
    playbackProgress.value = withTiming(normalizedProgress, {duration: 220});
  }, [
    duration,
    position,
    progress,
    playbackDuration,
    playbackPosition,
    playbackProgress,
  ]);

  useEffect(() => {
    if (
      !awaitingSeekConfirmation.current ||
      previewPosition === null ||
      Math.abs(position - previewPosition) > 0.75
    ) {
      return;
    }

    awaitingSeekConfirmation.current = false;
    pendingSeek.value = false;
    playbackProgress.value = clampProgress(progress);
    if (seekConfirmationTimer.current) {
      clearTimeout(seekConfirmationTimer.current);
      seekConfirmationTimer.current = null;
    }
    setPreviewPosition(null);
  }, [position, previewPosition, progress, pendingSeek, playbackProgress]);

  useEffect(
    () => () => {
      if (seekConfirmationTimer.current) {
        clearTimeout(seekConfirmationTimer.current);
      }
    },
    [],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(event => {
          if (width <= 0) {
            return;
          }
          isDragging.value = true;
          pendingSeek.value = false;
          lastPreviewUpdateAt.value = 0;
          dragProgress.value = clampProgress(event.x / width);
          runOnJS(beginSeekPreview)(playbackPosition.value);
        })
        .onUpdate(event => {
          if (width <= 0) {
            return;
          }
          const nextProgress = clampProgress(event.x / width);
          dragProgress.value = nextProgress;
          const now = Date.now();
          if (now - lastPreviewUpdateAt.value >= 72) {
            lastPreviewUpdateAt.value = now;
            runOnJS(updateSeekPreview)(nextProgress * playbackDuration.value);
          }
        })
        .onEnd(() => {
          const targetProgress = dragProgress.value;
          isDragging.value = false;
          pendingSeek.value = true;
          runOnJS(finishSeek)(
            targetProgress,
            targetProgress * playbackDuration.value,
          );
        })
        .onFinalize(() => {
          if (isDragging.value) {
            isDragging.value = false;
            pendingSeek.value = false;
            runOnJS(cancelSeekPreview)();
          }
        }),
    [
      beginSeekPreview,
      cancelSeekPreview,
      finishSeek,
      dragProgress,
      isDragging,
      lastPreviewUpdateAt,
      pendingSeek,
      playbackDuration,
      playbackPosition,
      width,
      updateSeekPreview,
    ],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(350)
        .onEnd((event, success) => {
          if (!success || width <= 0) {
            return;
          }
          const targetProgress = clampProgress(event.x / width);
          dragProgress.value = targetProgress;
          pendingSeek.value = true;
          runOnJS(finishSeek)(
            targetProgress,
            targetProgress * playbackDuration.value,
          );
        }),
    [
      dragProgress,
      finishSeek,
      pendingSeek,
      playbackDuration,
      width,
    ],
  );

  const gesture = useMemo(
    () => Gesture.Exclusive(panGesture, tapGesture),
    [panGesture, tapGesture],
  );

  const fillStyle = useAnimatedStyle(() => {
    const p =
      isDragging.value || pendingSeek.value
        ? dragProgress.value
        : playbackProgress.value;
    return {width: `${clampProgress(p) * 100}%`};
  });

  const thumbStyle = useAnimatedStyle(() => {
    const p =
      isDragging.value || pendingSeek.value
        ? dragProgress.value
        : playbackProgress.value;
    return {left: `${clampProgress(p) * 100}%`, opacity: 1};
  });

  const gradientColors = colors ?? t.glass?.colors.progress.fill;
  const s = useMemo(
    () =>
      StyleSheet.create({
        container: {paddingVertical: 10},
        seekArea: {paddingVertical: 10},
        bar: {
          height: 3,
          backgroundColor: trackColor ?? 'rgba(255,255,255,0.32)',
          borderRadius: 2,
          overflow: 'visible',
        },
        fill: {
          height: '100%',
          backgroundColor: colors?.[0] ?? t.colors.primary,
          borderRadius: 2,
        },
        thumb: {
          position: 'absolute',
          top: -5,
          width: 13,
          height: 13,
          borderRadius: 7,
          backgroundColor: thumbColor ?? colors?.[0] ?? t.colors.primary,
          marginLeft: -6.5,
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.92)',
          shadowColor: thumbColor ?? colors?.[0] ?? t.colors.primary,
          shadowOpacity: 0.42,
          shadowRadius: 6,
          elevation: 4,
        },
        timeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: -3,
        },
        time: {fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums']},
      }),
    [colors, t.colors.primary, thumbColor, trackColor],
  );

  const accessibilityProgress = clampProgress(progress);

  return (
    <View style={s.container}>
      <GestureDetector gesture={gesture}>
        <View
          onLayout={(event: LayoutChangeEvent) =>
            setWidth(event.nativeEvent.layout.width)
          }
          style={s.seekArea}
          collapsable={false}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="播放进度"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.round(accessibilityProgress * 100),
          }}>
          <View style={s.bar}>
            {gradientColors ? (
              <AnimatedLinearGradient
                colors={gradientColors}
                start={{x: 0, y: 0}}
                end={{x: 1, y: 0}}
                style={[s.fill, fillStyle]}
              />
            ) : (
              <Animated.View style={[s.fill, fillStyle]} />
            )}
            <Animated.View style={[s.thumb, thumbStyle]} />
          </View>
        </View>
      </GestureDetector>
      <View style={s.timeRow}>
        <Text style={[s.time, timeColor ? {color: timeColor} : null]}>
          {formatDuration(previewPosition ?? position)}
        </Text>
        <Text style={[s.time, timeColor ? {color: timeColor} : null]}>
          {formatDuration(duration)}
        </Text>
      </View>
    </View>
  );
};
