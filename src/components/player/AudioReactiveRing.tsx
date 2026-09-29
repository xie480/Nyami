import React, {useEffect, useMemo, useState} from 'react';
import {Platform, StyleSheet} from 'react-native';
import Svg, {Circle, Defs, LinearGradient, Path, Stop} from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {useSpectrumPoller} from '../../hooks/useSpectrumPoller';
import {AlbumTheme} from '../../utils/albumTheme';

const BAR_COUNT = 64;
const MIN_BAR_LENGTH = 3;
const MAX_BAR_LENGTH = 48;
const AMPLITUDE_RESPONSE_EXPONENT = 1.25;
const AMPLITUDE_RESPONSE_GAIN = 1.2;
const RING_INNER_GAP = 2;
const LEGACY_RING_DIAMETER_GUTTER = 48;
export const AUDIO_REACTIVE_RING_OUTSET = 56;
export const AUDIO_REACTIVE_RING_LAYOUT_GROWTH =
  AUDIO_REACTIVE_RING_OUTSET * 2 - LEGACY_RING_DIAMETER_GUTTER;
const EMPTY_SPECTRUM: number[] = [];

interface Props {
  artworkSize: number;
  enabled: boolean;
  isPlaying: boolean;
  reduceMotion: boolean;
  theme: AlbumTheme;
}

function makeFallbackSpectrum(phase: number): number[] {
  return Array.from({length: BAR_COUNT}, (_, index) => {
    const low = Math.sin(index * 0.31 + phase) * 0.26;
    const high = Math.sin(index * 0.77 - phase * 0.62) * 0.16;
    return Math.max(0.08, Math.min(0.78, 0.34 + low + high));
  });
}

function buildRingPath(
  spectrum: number[],
  size: number,
  intensity: number,
): string {
  const center = size / 2;
  const innerRadius = center - MAX_BAR_LENGTH - MIN_BAR_LENGTH - RING_INNER_GAP;
  const lastBinIndex = Math.max(0, spectrum.length - 1);
  const pathParts: string[] = [];

  for (let index = 0; index < BAR_COUNT; index += 1) {
    const angle = (index / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
    const binPosition =
      spectrum.length > 1
        ? (index / (BAR_COUNT - 1)) ** 1.45 * (spectrum.length - 1)
        : 0;
    const lowerBin = Math.floor(binPosition);
    const upperBin = Math.min(lastBinIndex, lowerBin + 1);
    const lowerValue = Number(spectrum[lowerBin]) || 0;
    const upperValue = Number(spectrum[upperBin]) || 0;
    const binFraction = binPosition - lowerBin;
    const rawAmplitude = lowerValue + (upperValue - lowerValue) * binFraction;
    const normalizedAmplitude = Math.min(1, Math.max(0, rawAmplitude));
    const amplitude = Math.min(
      1,
      Math.pow(normalizedAmplitude, AMPLITUDE_RESPONSE_EXPONENT) *
        AMPLITUDE_RESPONSE_GAIN *
        intensity,
    );
    const length = MIN_BAR_LENGTH + amplitude * MAX_BAR_LENGTH;
    const innerX = center + Math.cos(angle) * innerRadius;
    const innerY = center + Math.sin(angle) * innerRadius;
    const outerX = center + Math.cos(angle) * (innerRadius + length);
    const outerY = center + Math.sin(angle) * (innerRadius + length);
    pathParts.push(
      `M${innerX.toFixed(1)},${innerY.toFixed(1)}L${outerX.toFixed(
        1,
      )},${outerY.toFixed(1)}`,
    );
  }

  return pathParts.join('');
}

export const AudioReactiveRing: React.FC<Props> = React.memo(
  ({artworkSize, enabled, isPlaying, reduceMotion, theme}) => {
    const shouldAnimate = enabled && isPlaying && !reduceMotion;
    const {spectrum} = useSpectrumPoller(shouldAnimate);
    const [fallbackPhase, setFallbackPhase] = useState(0);
    const [displayedSpectrum, setDisplayedSpectrum] = useState(EMPTY_SPECTRUM);
    const displayedSpectrumRef = React.useRef(EMPTY_SPECTRUM);
    const [intensity, setIntensity] = useState(shouldAnimate ? 1 : 0);
    const intensityRef = React.useRef(intensity);
    const opacity = useSharedValue(0.78);

    useEffect(() => {
      if (Platform.OS !== 'android') {
        return;
      }
      if (spectrum.length === 0) {
        displayedSpectrumRef.current = EMPTY_SPECTRUM;
        setDisplayedSpectrum(EMPTY_SPECTRUM);
        return;
      }

      const from =
        displayedSpectrumRef.current.length === spectrum.length
          ? displayedSpectrumRef.current
          : spectrum.map(() => 0);
      const startedAt = Date.now();
      let frame: number | undefined;
      const interpolateSample = () => {
        const progress = Math.min(1, (Date.now() - startedAt) / 80);
        const next = spectrum.map(
          (value, index) => from[index] + (value - from[index]) * progress,
        );
        displayedSpectrumRef.current = next;
        setDisplayedSpectrum(next);
        if (progress < 1) {
          frame = requestAnimationFrame(interpolateSample);
        }
      };

      frame = requestAnimationFrame(interpolateSample);
      return () => {
        if (frame !== undefined) {
          cancelAnimationFrame(frame);
        }
      };
    }, [spectrum]);

    useEffect(() => {
      const start = intensityRef.current;
      const target = shouldAnimate ? 1 : 0;
      if (start === target) {
        return;
      }

      const startedAt = Date.now();
      let frame: number | undefined;
      const animate = () => {
        const progress = Math.min(1, (Date.now() - startedAt) / 360);
        const eased = 1 - (1 - progress) * (1 - progress);
        const next = start + (target - start) * eased;
        intensityRef.current = next;
        setIntensity(next);
        if (progress < 1) {
          frame = requestAnimationFrame(animate);
        }
      };

      frame = requestAnimationFrame(animate);
      return () => {
        if (frame !== undefined) {
          cancelAnimationFrame(frame);
        }
      };
    }, [shouldAnimate]);

    useEffect(() => {
      if (Platform.OS === 'android' && spectrum.length > 0) {
        return;
      }
      if (!shouldAnimate) {
        return;
      }

      const timer = setInterval(() => {
        setFallbackPhase(phase => phase + 0.16);
      }, 80);
      return () => clearInterval(timer);
    }, [shouldAnimate, spectrum.length]);

    useEffect(() => {
      opacity.value = withTiming(shouldAnimate ? 1 : 0.56, {duration: 420});
    }, [opacity, shouldAnimate]);

    const fallback = useMemo(
      () => makeFallbackSpectrum(fallbackPhase),
      [fallbackPhase],
    );
    const displaySpectrum = useMemo(() => {
      if (Platform.OS === 'android') {
        return displayedSpectrum;
      }
      return shouldAnimate ? fallback : EMPTY_SPECTRUM;
    }, [displayedSpectrum, fallback, shouldAnimate]);
    const ringSize = artworkSize + AUDIO_REACTIVE_RING_OUTSET * 2;
    const ringPath = useMemo(
      () => buildRingPath(displaySpectrum, ringSize, intensity),
      [displaySpectrum, intensity, ringSize],
    );
    const animatedStyle = useAnimatedStyle(() => ({opacity: opacity.value}));

    return (
      <Animated.View
        style={[
          styles.ring,
          {width: ringSize, height: ringSize},
          animatedStyle,
        ]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Svg
          width={ringSize}
          height={ringSize}
          viewBox={`0 0 ${ringSize} ${ringSize}`}>
          <Defs>
            <LinearGradient
              id="album-spectrum-gradient"
              x1="0"
              y1="0"
              x2="1"
              y2="1">
              <Stop
                offset="0%"
                stopColor={theme.primaryAccent}
                stopOpacity={0.8}
              />
              <Stop
                offset="100%"
                stopColor={theme.secondaryAccent}
                stopOpacity={0.96}
              />
            </LinearGradient>
          </Defs>
          <Circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={ringSize / 2 - 3}
            fill="none"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={1}
          />
          <Path
            d={ringPath}
            fill="none"
            stroke="url(#album-spectrum-gradient)"
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 3,
  },
});
