import React, {useEffect, useRef} from 'react';
import {Animated, Easing, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTheme} from '../theme';

const LOADER_SIZE = 128;
const EQUALIZER_BAR_COUNT = 4;
const STATUS_DOT_COUNT = 3;

export const Loading: React.FC<{ text?: string }> = ({ text = '加载中...' }) => {
  const t = useTheme();
  const outerRotation = useRef(new Animated.Value(0)).current;
  const middleRotation = useRef(new Animated.Value(0)).current;
  const innerRotation = useRef(new Animated.Value(0)).current;
  const orbitRotation = useRef(new Animated.Value(0)).current;
  const corePulse = useRef(new Animated.Value(0)).current;
  const haloPulse = useRef(new Animated.Value(0)).current;
  const equalizerLevels = useRef(
    Array.from({length: EQUALIZER_BAR_COUNT}, () => new Animated.Value(0.25)),
  ).current;
  const statusDots = useRef(
    Array.from({length: STATUS_DOT_COUNT}, () => new Animated.Value(0.25)),
  ).current;

  useEffect(() => {
    const spin = (value: Animated.Value, duration: number) =>
      Animated.loop(Animated.timing(value, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }));
    const pulse = (value: Animated.Value, duration: number, minScale = 0) =>
      Animated.loop(Animated.sequence([
        Animated.timing(value, {toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: true}),
        Animated.timing(value, {toValue: minScale, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
      ]));
    const rotations = [
      spin(outerRotation, 5600),
      spin(middleRotation, 3700),
      spin(innerRotation, 2400),
      spin(orbitRotation, 2900),
    ];
    const pulseAnimations = [
      pulse(corePulse, 720),
      pulse(haloPulse, 1050),
      ...equalizerLevels.map((level, index) => Animated.loop(Animated.sequence([
        Animated.timing(level, {toValue: 1, duration: 230, delay: index * 80, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
        Animated.timing(level, {toValue: 0.25, duration: 270, easing: Easing.inOut(Easing.cubic), useNativeDriver: true}),
        Animated.timing(level, {toValue: 0.25, duration: (EQUALIZER_BAR_COUNT - index) * 80, useNativeDriver: true}),
      ]))),
      ...statusDots.map((dot, index) => Animated.loop(Animated.sequence([
        Animated.timing(dot, {toValue: 1, duration: 220, delay: index * 150, easing: Easing.out(Easing.quad), useNativeDriver: true}),
        Animated.timing(dot, {toValue: 0.25, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
        Animated.timing(dot, {toValue: 0.25, duration: (STATUS_DOT_COUNT - index) * 150, useNativeDriver: true}),
      ]))),
    ];
    const animations = [...rotations, ...pulseAnimations];
    animations.forEach(animation => animation.start());
    return () => {
      animations.forEach(animation => animation.stop());
    };
  }, [corePulse, equalizerLevels, haloPulse, innerRotation, middleRotation, orbitRotation, outerRotation, statusDots]);

  const outerSpin = outerRotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const middleSpin = middleRotation.interpolate({inputRange: [0, 1], outputRange: ['360deg', '0deg']});
  const innerSpin = innerRotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const orbitSpin = orbitRotation.interpolate({inputRange: [0, 1], outputRange: ['360deg', '0deg']});
  const coreScale = corePulse.interpolate({inputRange: [0, 1], outputRange: [0.94, 1.06]});
  const haloScale = haloPulse.interpolate({inputRange: [0, 1], outputRange: [0.86, 1.12]});
  const haloOpacity = haloPulse.interpolate({inputRange: [0, 1], outputRange: [0.48, 0.04]});

  return (
    <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
      <View style={{width: LOADER_SIZE, height: LOADER_SIZE, alignItems: 'center', justifyContent: 'center'}}>
        <Animated.View
          style={{
            position: 'absolute',
            width: 82,
            height: 82,
            borderRadius: 41,
            borderWidth: 1,
            borderColor: t.colors.primaryLight,
            opacity: haloOpacity,
            transform: [{scale: haloScale}],
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            width: 118,
            height: 118,
            borderRadius: 59,
            borderWidth: 1.5,
            borderColor: 'transparent',
            borderTopColor: t.colors.primary,
            borderRightColor: t.colors.primary,
            borderBottomColor: t.colors.primaryLight,
            transform: [{rotate: outerSpin}],
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            width: 96,
            height: 96,
            borderRadius: 48,
            borderWidth: 2,
            borderColor: t.colors.surfaceHigh,
            borderLeftColor: t.colors.primary,
            borderBottomColor: t.colors.primaryLight,
            transform: [{rotate: middleSpin}],
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            width: 72,
            height: 72,
            borderRadius: 36,
            borderWidth: 1.5,
            borderColor: t.colors.primaryLight,
            borderTopColor: t.colors.success,
            transform: [{rotate: innerSpin}],
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            width: 108,
            height: 108,
            borderRadius: 54,
            transform: [{rotate: orbitSpin}],
          }}>
          <View style={{position: 'absolute', top: 4, left: 50, width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.success}} />
          <View style={{position: 'absolute', right: 3, bottom: 31, width: 5, height: 5, borderRadius: 3, backgroundColor: t.colors.primary}} />
        </Animated.View>
        <Animated.View style={{transform: [{scale: coreScale}]}}>
          <LinearGradient
            colors={[t.colors.primary, t.colors.primaryDark]}
            start={{x: 0, y: 0}}
            end={{x: 1, y: 1}}
            style={{width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center'}}>
            <Icon name="music-note-eighth" size={23} color={t.colors.onPrimary} style={{marginTop: -7}} />
            <View style={{position: 'absolute', bottom: 10, flexDirection: 'row', alignItems: 'center', height: 12}}>
              {equalizerLevels.map((level, index) => {
                const barScale = level.interpolate({inputRange: [0.25, 1], outputRange: [0.35, 1]});
                return (
                  <Animated.View
                    key={index}
                    style={{width: 3, height: 12, borderRadius: 2, marginHorizontal: 1.5, backgroundColor: t.colors.onPrimary, opacity: 0.9, transform: [{scaleY: barScale}]}}
                  />
                );
              })}
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
      <View style={{flexDirection: 'row', alignItems: 'center', marginTop: t.spacing.md}}>
        <Text style={{color: t.colors.textSub, fontSize: t.fontSize.sm, fontWeight: '500'}}>{text}</Text>
        <View style={{flexDirection: 'row', alignItems: 'center', marginLeft: 3}}>
          {statusDots.map((dot, index) => (
            <Animated.View
              key={index}
              style={{width: 3, height: 3, borderRadius: 2, marginHorizontal: 1.5, backgroundColor: t.colors.primary, opacity: dot, transform: [{scale: dot}]}}
            />
          ))}
        </View>
      </View>
    </View>
  );
};
