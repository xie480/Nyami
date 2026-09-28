import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Animated as RNAnimated, StyleSheet, View} from 'react-native';
import FastImage from 'react-native-fast-image';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {AlbumTheme} from '../../utils/albumTheme';
import {AudioReactiveRing} from './AudioReactiveRing';

interface Props {
  artworkUri?: string;
  size: number;
  isPlaying: boolean;
  isVisible: boolean;
  reduceMotion: boolean;
  theme: AlbumTheme;
}

interface CoverLayers {
  current?: string;
  previous?: string;
  currentLoaded: boolean;
}

export const VinylRecord: React.FC<Props> = ({
  artworkUri,
  size,
  isPlaying,
  isVisible,
  reduceMotion,
  theme,
}) => {
  const rotation = useSharedValue(0);
  const rotationOffset = useSharedValue(0);
  const artworkFade = useRef(new RNAnimated.Value(1)).current;
  const currentArtwork = useRef(artworkUri);
  const [coverLayers, setCoverLayers] = useState<CoverLayers>({
    current: artworkUri,
    currentLoaded: Boolean(artworkUri),
  });
  const shouldSpin = isPlaying && isVisible && !reduceMotion;
  const previousCoverOpacity = useMemo(
    () => artworkFade.interpolate({inputRange: [0, 1], outputRange: [1, 0]}),
    [artworkFade],
  );

  useEffect(() => {
    cancelAnimation(rotation);
    if (shouldSpin) {
      rotation.value = withRepeat(
        withTiming(1, {duration: 22000, easing: Easing.linear}),
        -1,
        false,
      );
    } else {
      rotationOffset.value =
        (rotationOffset.value + rotation.value * 360) % 360;
      rotation.value = 0;
    }
    return () => cancelAnimation(rotation);
  }, [rotation, rotationOffset, shouldSpin]);

  const fadeToCurrentCover = useCallback(
    (uri?: string) => {
      if (currentArtwork.current !== uri) {
        return;
      }
      if (!isVisible) {
        artworkFade.stopAnimation();
        artworkFade.setValue(1);
        setCoverLayers({current: uri, currentLoaded: true});
        return;
      }
      RNAnimated.timing(artworkFade, {
        toValue: 1,
        duration: 480,
        useNativeDriver: true,
      }).start(({finished}) => {
        if (finished && currentArtwork.current === uri) {
          setCoverLayers(current => ({
            current: current.current,
            currentLoaded: true,
          }));
        }
      });
    },
    [artworkFade, isVisible],
  );

  useEffect(() => {
    if (!isVisible) {
      currentArtwork.current = artworkUri;
      artworkFade.stopAnimation();
      artworkFade.setValue(1);
      setCoverLayers({current: artworkUri, currentLoaded: true});
      return;
    }
    if (currentArtwork.current === artworkUri) {
      return;
    }
    currentArtwork.current = artworkUri;
    setCoverLayers(current => ({
      current: artworkUri,
      previous: current.currentLoaded
        ? current.current
        : current.previous || current.current,
      currentLoaded: false,
    }));
    artworkFade.stopAnimation();
    artworkFade.setValue(0);
    if (!artworkUri) {
      fadeToCurrentCover(undefined);
    }
  }, [artworkFade, artworkUri, fadeToCurrentCover, isVisible]);

  const spinningStyle = useAnimatedStyle(() => ({
    transform: [{rotateZ: `${rotationOffset.value + rotation.value * 360}deg`}],
  }));
  const recordSize = Math.max(154, size);

  return (
    <View
      style={[styles.stage, {width: recordSize + 48, height: recordSize + 48}]}>
      <AudioReactiveRing
        artworkSize={recordSize}
        enabled={isVisible}
        isPlaying={isPlaying}
        reduceMotion={reduceMotion}
        theme={theme}
      />
      <Animated.View
        style={[
          styles.record,
          {width: recordSize, height: recordSize, borderRadius: recordSize / 2},
          spinningStyle,
        ]}>
        <View style={[styles.artworkFrame, {borderRadius: recordSize / 2}]}>
          <RNAnimated.View
            style={[styles.artworkClip, {borderRadius: recordSize / 2}]}>
            {coverLayers.previous ? (
              <RNAnimated.View
                style={[
                  StyleSheet.absoluteFill,
                  {opacity: previousCoverOpacity},
                ]}>
                <FastImage
                  source={{uri: coverLayers.previous}}
                  style={StyleSheet.absoluteFill}
                  resizeMode={FastImage.resizeMode.cover}
                />
              </RNAnimated.View>
            ) : null}
            {coverLayers.current ? (
              <RNAnimated.View
                style={[StyleSheet.absoluteFill, {opacity: artworkFade}]}>
                <FastImage
                  key={coverLayers.current}
                  source={{uri: coverLayers.current}}
                  style={StyleSheet.absoluteFill}
                  resizeMode={FastImage.resizeMode.cover}
                  onLoad={() => fadeToCurrentCover(coverLayers.current)}
                  onError={() => {
                    if (currentArtwork.current === coverLayers.current) {
                      const fallbackArtwork = coverLayers.previous;
                      currentArtwork.current = fallbackArtwork;
                      setCoverLayers({
                        current: fallbackArtwork,
                        currentLoaded: true,
                      });
                      artworkFade.setValue(1);
                    }
                  }}
                />
              </RNAnimated.View>
            ) : null}
          </RNAnimated.View>
          <View style={styles.innerHighlight} pointerEvents="none" />
          <View style={styles.hub} pointerEvents="none" />
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  record: {
    padding: 7,
    backgroundColor: 'rgba(255,255,255,0.21)',
    borderColor: 'rgba(255,255,255,0.78)',
    borderWidth: 1.5,
    shadowColor: '#0A0D12',
    shadowOffset: {width: 0, height: 18},
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 14,
  },
  artworkFrame: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  artworkClip: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  innerHighlight: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999,
  },
  hub: {
    position: 'absolute',
    width: 25,
    height: 25,
    borderRadius: 13,
    left: '50%',
    top: '50%',
    marginLeft: -12.5,
    marginTop: -12.5,
    backgroundColor: 'rgba(246,244,236,0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.48,
    shadowRadius: 8,
    elevation: 4,
  },
});
