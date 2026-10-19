import React, {useEffect} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  StatusBar,
  Image,
  TouchableOpacity,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {Button} from '../components/Button';
import {useAuthStore} from '../store/authStore';
import {useUIStore} from '../store/uiStore';
import {useTheme} from '../theme';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

export const HomeScreen = ({navigation}: any) => {
  const t = useTheme();
  const loggedIn = useAuthStore(s => s.loggedIn);
  const setLoginModalVisible = useUIStore(s => s.setLoginModalVisible);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (loggedIn) {
      navigation.replace('Discover');
    }
  }, [loggedIn, navigation]);

  const paddingTop =
    Platform.OS === 'android'
      ? Math.max(insets.top, StatusBar.currentHeight ?? 0)
      : insets.top;
  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.glass ? 'transparent' : t.colors.background,
    },
    scrollContent: {
      flexGrow: 1,
      paddingTop: paddingTop + t.spacing.lg,
      paddingBottom: insets.bottom + t.spacing.xl,
      paddingHorizontal: t.spacing.xl,
    },
    toolbar: {alignItems: 'flex-end'},
    settings: {
      minHeight: 48,
      minWidth: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.spacing.sm,
      paddingHorizontal: t.spacing.md,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.divider,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      width: '100%',
      maxWidth: 420,
      alignSelf: 'center',
      paddingVertical: 40,
    },
    brand: {alignItems: 'center', marginBottom: 40},
    iconWrap: {
      width: 112,
      height: 112,
      borderRadius: 32,
      backgroundColor: t.colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.spacing.xxl,
    },
    icon: {width: 104, height: 104},
    title: {
      fontSize: 36,
      lineHeight: 46,
      fontWeight: '700',
      color: t.colors.text,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: t.fontSize.lg,
      lineHeight: 26,
      color: t.colors.textSub,
      textAlign: 'center',
      marginTop: t.spacing.sm,
    },
    introduction: {
      marginTop: t.spacing.xxl,
      color: t.colors.textSub,
      fontSize: t.fontSize.base,
      lineHeight: 24,
      textAlign: 'center',
    },
    footer: {
      fontSize: t.fontSize.sm,
      lineHeight: 22,
      color: t.colors.textSub,
      textAlign: 'center',
      marginTop: t.spacing.lg,
    },
  });

  return (
    <View style={s.container}>
      <StatusBar
        barStyle={t.isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={s.toolbar}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="打开设置"
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Settings')}
            style={s.settings}>
            <Icon
              accessible={false}
              name="cog-outline"
              size={20}
              color={t.colors.textSub}
            />
            <Text style={{fontSize: t.fontSize.sm, color: t.colors.textSub}}>
              设置
            </Text>
          </TouchableOpacity>
        </View>
        <View style={s.content}>
          <View style={s.brand}>
            <View style={s.iconWrap}>
              <Image
                source={require('../../resource/icon.png')}
                style={s.icon}
                accessibilityIgnoresInvertColors
              />
            </View>
            <Text accessibilityRole="header" style={s.title}>
              Nyami
            </Text>
            <Text style={s.subtitle}>猫在听，你也在听</Text>
            <Text style={s.introduction}>
              让收藏里的好音乐，{'\n'}成为每天的陪伴。
            </Text>
          </View>
          <Button
            title="使用 B 站账号登录"
            onPress={() => setLoginModalVisible(true)}
          />
          <Text style={s.footer}>
            登录后，发现收藏、歌单和属于你的音乐推荐。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};
