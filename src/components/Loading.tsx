import React, {useEffect, useRef} from 'react';
import {Animated, Easing, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {useTheme} from '../theme';

const CANVAS_SIZE = 160;
const WAVE_BAR_COUNT = 7;
const STATUS_DOT_COUNT = 3;

export const Loading: React.FC<{text?: string}> = ({text = '加载中...'}) => {
  const t = useTheme();
  const outerRotation = useRef(new Animated.Value(0)).current;
  const innerRotation = useRef(new Animated.Value(0)).current;
  const orbitRotation = useRef(new Animated.Value(0)).current;
  const corePulse = useRef(new Animated.Value(0)).current;
  const haloPulse = useRef(new Animated.Value(0)).current;
  const waveLevels = useRef(
    Array.from({length: WAVE_BAR_COUNT}, () => new Animated.Value(0.12)),
  ).current;
  const statusDots = useRef(
    Array.from({length: STATUS_DOT_COUNT}, () => new Animated.Value(0.18)),
  ).current;

  useEffect(() => {
    const spin = (value: Animated.Value, duration: number) =>
      Animated.loop(Animated.timing(value, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }));
    const pulse = (value: Animated.Value, duration: number, low: number, high: number) =>
      Animated.loop(Animated.sequence([
        Animated.timing(value, {toValue: high, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
        Animated.timing(value, {toValue: low, duration, easing: Easing.inOut(Easing.cubic), useNativeDriver: true}),
      ]));
    const waves = waveLevels.map((level, index) => Animated.loop(Animated.sequence([
      Animated.timing(level, {toValue: 1, duration: 230, delay: index * 55, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
      Animated.timing(level, {toValue: 0.12, duration: 300, easing: Easing.inOut(Easing.cubic), useNativeDriver: true}),
      Animated.delay((WAVE_BAR_COUNT - index) * 55),
    ])));
    const dots = statusDots.map((dot, index) => Animated.loop(Animated.sequence([
      Animated.timing(dot, {toValue: 1, duration: 240, delay: index * 140, easing: Easing.out(Easing.quad), useNativeDriver: true}),
      Animated.timing(dot, {toValue: 0.18, duration: 280, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
      Animated.delay((STATUS_DOT_COUNT - index) * 140),
    ])));
    const animations = [
      spin(outerRotation, 3200),
      spin(innerRotation, 5100),
      spin(orbitRotation, 2100),
      pulse(corePulse, 720, 0, 1),
      pulse(haloPulse, 1150, 0, 1),
      ...waves,
      ...dots,
    ];
    animations.forEach(animation => animation.start());
    return () => animations.forEach(animation => animation.stop());
  }, [corePulse, haloPulse, innerRotation, orbitRotation, outerRotation, statusDots, waveLevels]);

  const outerSpin = outerRotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const innerSpin = innerRotation.interpolate({inputRange: [0, 1], outputRange: ['360deg', '0deg']});
  const orbitSpin = orbitRotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const coreScale = corePulse.interpolate({inputRange: [0, 1], outputRange: [0.92, 1.08]});
  const haloScale = haloPulse.interpolate({inputRange: [0, 1], outputRange: [0.62, 1.2]});
  const haloOpacity = haloPulse.interpolate({inputRange: [0, 1], outputRange: [0.52, 0.04]});

  return (
    <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
      <View style={{width: CANVAS_SIZE, height: CANVAS_SIZE, alignItems: 'center', justifyContent: 'center'}}>
        <Animated.View
          style={{
            position: 'absolute',
            width: 116,
            height: 116,
            borderRadius: 58,
            borderWidth: 1.5,
            borderColor: t.colors.primaryLight,
            opacity: haloOpacity,
            transform: [{scale: haloScale}],
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            width: 148,
            height: 148,
            borderRadius: 74,
            borderWidth: 2,
            borderColor: 'transparent',
            borderTopColor: t.colors.primary,
            borderRightColor: t.colors.success,
            borderBottomColor: t.colors.primaryDark,
            transform: [{rotate: outerSpin}],
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            width: 112,
            height: 112,
            borderRadius: 56,
            borderWidth: 1.5,
            borderColor: t.colors.surfaceHigh,
            borderLeftColor: t.colors.primaryLight,
            borderBottomColor: t.colors.primary,
            transform: [{rotate: innerSpin}],
          }}
        />
        <Animated.View style={{position: 'absolute', width: 132, height: 132, transform: [{rotate: orbitSpin}]}}>
          <View style={{position: 'absolute', top: 0, left: 62, width: 9, height: 9, borderRadius: 5, backgroundColor: t.colors.success}} />
          <View style={{position: 'absolute', right: 3, bottom: 31, width: 5, height: 5, borderRadius: 3, backgroundColor: t.colors.primary}} />
        </Animated.View>
        <Animated.View style={{transform: [{scale: coreScale}]}}>
          <LinearGradient
            colors={[t.colors.primary, t.colors.primaryDark]}
            start={{x: 0, y: 0}}
            end={{x: 1, y: 1}}
            style={{width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center'}}>
            <View style={{height: 32, flexDirection: 'row', alignItems: 'center'}}>
              {waveLevels.map((level, index) => {
                const barScale = level.interpolate({inputRange: [0.12, 1], outputRange: [0.2, 1]});
                return (
                  <Animated.View
                    key={index}
                    style={{
                      width: 3,
                      height: 30,
                      borderRadius: 2,
                      marginHorizontal: 2,
                      backgroundColor: t.colors.onPrimary,
                      opacity: level,
                      transform: [{scaleY: barScale}],
                    }}
                  />
                );
              })}
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
      <View style={{flexDirection: 'row', alignItems: 'center', marginTop: t.spacing.md}}>
        <Text style={{color: t.colors.textSub, fontSize: t.fontSize.sm, fontWeight: '600', letterSpacing: 0.3}}>{text}</Text>
        <View style={{flexDirection: 'row', alignItems: 'center', marginLeft: 5}}>
          {statusDots.map((dot, index) => (
            <Animated.View
              key={index}
              style={{width: 4, height: 4, borderRadius: 2, marginHorizontal: 1.5, backgroundColor: t.colors.primary, opacity: dot, transform: [{scale: dot}]}}
            />
          ))}
        </View>
      </View>
    </View>
  );
};
