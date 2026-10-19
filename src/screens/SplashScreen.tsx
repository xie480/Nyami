import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View, Text, StyleSheet, StatusBar, Image, Platform } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const SplashScreen = ({ navigation }: any) => {
  const t = useTheme();
  const authReady = useAuthStore((s) => s.authReady);
  const loggedIn = useAuthStore((s) => s.loggedIn);
  const insets = useSafeAreaInsets();
  const launchTime = useRef(Date.now());

  useEffect(() => {
    if (authReady) {
      const elapsed = Date.now() - launchTime.current;
      const remaining = Math.max(0, 1000 - elapsed);
      const timer = setTimeout(() => {
        navigation.replace(loggedIn ? 'Discover' : 'Home');
      }, remaining);
      return () => clearTimeout(timer);
    }
  }, [authReady, loggedIn, navigation]);

  const statusBarHeight = Platform.OS === 'android' ? Math.max(insets.top, StatusBar.currentHeight ?? 0) : insets.top;

  const s = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: t.colors.background,
      paddingTop: statusBarHeight,
      paddingBottom: Math.max(insets.bottom, 24),
      paddingHorizontal: 28,
    },
    iconWrap: {
      width: 112, height: 112, borderRadius: 32, backgroundColor: t.colors.primaryLight,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: t.spacing.xl,
    },
    title: {
      fontSize: 34, fontWeight: '800', letterSpacing: 1,
      color: t.colors.text, textAlign: 'center',
    },
    subtitle: {
      fontSize: t.fontSize.sm, color: t.colors.textSub,
      textAlign: 'center', marginTop: t.spacing.sm,
      lineHeight: 22,
    },
    status: {position: 'absolute', bottom: Math.max(insets.bottom, 24) + 28, flexDirection: 'row', alignItems: 'center', gap: 10},
    statusText: {fontSize: 13, color: t.colors.textSub},
  });

  return (
    <View style={s.container}>
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <View style={s.iconWrap}>
        <Image accessible={false} source={require('../../resource/icon.png')} style={{ width: 88, height: 88 }} resizeMode="contain" />
      </View>
      <Text style={s.title}>Nyami</Text>
      <Text style={s.subtitle}>猫在听，你也在听</Text>
      <View style={s.status} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={t.colors.primary} />
        <Text style={s.statusText}>{authReady ? '准备好，开始听歌' : '正在准备你的音乐空间'}</Text>
      </View>
    </View>
  );
};
