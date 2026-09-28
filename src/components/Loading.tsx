import React, {useEffect, useRef} from 'react';
import {Animated, Easing, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme';

export const Loading: React.FC<{ text?: string }> = ({ text = '加载中...' }) => {
  const t = useTheme();
  const rotation = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinAnimation = Animated.loop(Animated.timing(rotation, {
      toValue: 1,
      duration: 1450,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    const pulseAnimation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, {toValue: 1, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true}),
      Animated.timing(pulse, {toValue: 0, duration: 650, easing: Easing.in(Easing.quad), useNativeDriver: true}),
    ]));
    spinAnimation.start();
    pulseAnimation.start();
    return () => {
      spinAnimation.stop();
      pulseAnimation.stop();
    };
  }, [pulse, rotation]);

  const spin = rotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const scale = pulse.interpolate({inputRange: [0, 1], outputRange: [0.94, 1.06]});

  return (
    <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
      <View style={{width: 72, height: 72, alignItems: 'center', justifyContent: 'center'}}>
        <Animated.View
          style={{
            position: 'absolute',
            width: 62,
            height: 62,
            borderRadius: 31,
            borderWidth: 2,
            borderColor: t.colors.surfaceHigh,
            borderTopColor: t.colors.primary,
            borderRightColor: t.colors.primary,
            transform: [{rotate: spin}],
          }}
        />
        <Animated.View style={{transform: [{scale}]}}>
          <Icon name="music-note" size={25} color={t.colors.primary} />
        </Animated.View>
      </View>
      <Text style={{marginTop: t.spacing.sm, color: t.colors.textSub, fontSize: t.fontSize.sm, fontWeight: '500'}}>
        {text}
      </Text>
    </View>
  );
};
