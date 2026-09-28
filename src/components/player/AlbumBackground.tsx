import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, StyleSheet, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {AlbumTheme} from '../../utils/albumTheme';

interface Props {
  artworkUri?: string;
  theme: AlbumTheme;
  isVisible: boolean;
  blurAmount: number;
}

interface ImageLayers {
  current: string | undefined;
  previous?: string;
}

export const AlbumBackground: React.FC<Props> = ({
  artworkUri,
  theme,
  isVisible,
  blurAmount,
}) => {
  const [layers, setLayers] = useState<ImageLayers>({current: artworkUri});
  const fade = useRef(new Animated.Value(1)).current;
  const lastArtwork = useRef(artworkUri);
  const previousOpacity = useMemo(
    () => fade.interpolate({inputRange: [0, 1], outputRange: [1, 0]}),
    [fade],
  );

  useEffect(() => {
    if (lastArtwork.current === artworkUri) {
      return;
    }
    lastArtwork.current = artworkUri;
    if (!isVisible) {
      fade.stopAnimation();
      fade.setValue(1);
      setLayers({current: artworkUri});
      return;
    }
    setLayers(current => ({current: artworkUri, previous: current.current}));
    fade.stopAnimation();
    fade.setValue(0);
  }, [artworkUri, fade, isVisible]);

  const fadeIncoming = (incomingUri?: string) => {
    if (incomingUri !== lastArtwork.current) {
      return;
    }
    if (!isVisible) {
      fade.setValue(1);
      setLayers({current: incomingUri});
      return;
    }
    Animated.timing(fade, {
      toValue: 1,
      duration: 520,
      useNativeDriver: true,
    }).start(({finished}) => {
      if (finished && incomingUri === lastArtwork.current) {
        setLayers(current => ({current: current.current}));
      }
    });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {layers.previous ? (
        <Animated.Image
          source={{uri: layers.previous}}
          style={[
            styles.artwork,
            styles.scaledArtwork,
            {opacity: previousOpacity},
          ]}
          resizeMode="cover"
          blurRadius={blurAmount}
        />
      ) : null}
      {layers.current ? (
        <Animated.Image
          key={layers.current}
          source={{uri: layers.current}}
          style={[styles.artwork, {opacity: fade, transform: [{scale: 1.16}]}]}
          resizeMode="cover"
          blurRadius={blurAmount}
          onLoad={() => fadeIncoming(layers.current)}
          onError={() => fadeIncoming(layers.current)}
        />
      ) : null}
      <View
        style={[
          styles.scrim,
          {backgroundColor: `rgba(5, 7, 12, ${theme.scrimOpacity})`},
        ]}
      />
      <LinearGradient
        colors={[
          'rgba(5, 7, 12, 0.40)',
          'rgba(5, 7, 12, 0.05)',
          'rgba(5, 7, 12, 0.08)',
          'rgba(5, 7, 12, 0.58)',
        ]}
        locations={[0, 0.28, 0.58, 1]}
        style={styles.vignette}
        start={{x: 0.5, y: 0}}
        end={{x: 0.5, y: 1}}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  artwork: {
    ...StyleSheet.absoluteFillObject,
  },
  scaledArtwork: {transform: [{scale: 1.16}]},
  scrim: {...StyleSheet.absoluteFillObject},
  vignette: {...StyleSheet.absoluteFillObject},
});
