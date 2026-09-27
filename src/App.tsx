import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useAuthStore } from './store/authStore';
import { useSettingsStore } from './store/settingsStore';
import { NavigationContainer, DefaultTheme, DarkTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, StyleSheet, useColorScheme, Alert, Platform, ToastAndroid, BackHandler, PermissionsAndroid, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from './theme';
import LoggerService from './services/LoggerService';
import ToastNotification, { ToastNotificationRef, ToastConfig } from './components/ToastNotification';
import { setupPlayer } from './services/trackPlayer';
import { netStatus } from './services/netStatus';
import { HomeScreen } from './screens/HomeScreen';
import { FoldersScreen } from './screens/FoldersScreen';
import { VideosScreen } from './screens/VideosScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SoundLabScreen } from './screens/SoundLabScreen';
import { VisibleFoldersScreen } from './screens/VisibleFoldersScreen';
import { NoCacheFoldersScreen } from './screens/NoCacheFoldersScreen';
import { SplashScreen } from './screens/SplashScreen';
import { SyncDetailsScreen } from './screens/SyncDetailsScreen';
import { TagRecommendationsScreen } from './screens/TagRecommendationsScreen';
import { favoriteService, loadGlobalIndexCache } from './services/favoriteService';
import { PlaylistPanel } from './components/PlaylistPanel';
import { useUIStore } from './store/uiStore';
import { LoginModal } from './components/LoginModal';
import { storage } from './core/storage';
import { useSyncStore } from './store/syncStore';
import { GlassBackground } from './components/GlassBackground';
import { BottomNavigationBar } from './components/BottomNavigationBar';
import { startProgressPolling, stopProgressPolling } from './store/progressStore';

const Stack = createStackNavigator();

const withBackground = (Component: React.ComponentType<any>) => {
  return function ScreenWithBackground(props: any) {
    const { colors, glass } = useTheme();
    const bgColor = glass ? 'transparent' : colors.background;
    return (
      <View style={{ flex: 1, backgroundColor: bgColor }}>
        <Component {...props} />
      </View>
    );
  };
};

const HomeScreenWithBg = withBackground(HomeScreen);
const FoldersScreenWithBg = withBackground(FoldersScreen);
const VideosScreenWithBg = withBackground(VideosScreen);
const PlayerScreenWithBg = withBackground(PlayerScreen);
const SettingsScreenWithBg = withBackground(SettingsScreen);
const SoundLabScreenWithBg = withBackground(SoundLabScreen);
const VisibleFoldersScreenWithBg = withBackground(VisibleFoldersScreen);
const NoCacheFoldersScreenWithBg = withBackground(NoCacheFoldersScreen);
const SplashScreenWithBg = withBackground(SplashScreen);
const SyncDetailsScreenWithBg = withBackground(SyncDetailsScreen);
const TagRecommendationsScreenWithBg = withBackground(TagRecommendationsScreen);

/**
 * 安全区域适配包装器
 */
const SafeAreaWrapper: React.FC<{ children: React.ReactNode; baseBgColor: string }> = ({
  children,
  baseBgColor,
}) => {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: baseBgColor,
      }}
    >
      {children}
    </View>
  );
};

export default function App() {
  const systemScheme = useColorScheme();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const isDark = themeMode === 'system' ? systemScheme === 'dark' : (themeMode === 'dark' || themeMode === 'glass-dark');
  const baseBgColor = isDark ? '#0F0F11' : '#FFFFFF';
  
  const toastRef = useRef<ToastNotificationRef>(null);
  const [isOnline, setIsOnline] = useState(true);
  const navigationRef = useNavigationContainerRef();
  const [currentRouteName, setCurrentRouteName] = useState<string | null>(null);
  const updateCurrentRouteName = useCallback(() => {
    if (navigationRef.isReady()) {
      setCurrentRouteName(navigationRef.getCurrentRoute()?.name ?? null);
    }
  }, [navigationRef]);
  const isGlobalDockVisible =
    currentRouteName !== null &&
    !['Splash', 'Home', 'Player'].includes(currentRouteName);
  const activeDockTab =
    currentRouteName === 'Settings'
      ? 'settings'
      : currentRouteName === 'TagRecommendations'
        ? 'profile'
        : ['Folders', 'Videos', 'VisibleFolders', 'NoCacheFolders', 'SyncDetails'].includes(
              currentRouteName ?? '',
            )
          ? 'folders'
          : null;
  const loggedIn = useAuthStore((s) => s.loggedIn);
  const uid = useAuthStore((s) => s.userId);
  const initAuth = useAuthStore((s) => s.initAuth);
  const authReady = useAuthStore((s) => s.authReady);
  const playlistVisible = useUIStore(state => state.playlistVisible);
  const setPlaylistVisible = useUIStore(state => state.setPlaylistVisible);
  const isGlassMode = themeMode === 'glass-light' || themeMode === 'glass-dark';
  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: 'transparent',
    },
  };
  const startSync = useSyncStore(state => state.startSync);

  // Initialize player, network status listener, back handler, and Logger
  useEffect(() => {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }

    // 初始化全局日志服务，并绑定 Toast 通知回调
    LoggerService.init((level, message) => {
      toastRef.current?.show({
        type: level === 'ERROR' ? 'error' : 'warn',
        message,
      });
    });

    initAuth();
    setupPlayer();
    netStatus.init();
    const unsubscribe = netStatus.onChange((type) => {
      const nowOnline = type !== 'none';
      setIsOnline(nowOnline);
      if (!nowOnline) {
        const message = '网络已断开，当前仅可播放本地缓存音频';
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.LONG);
        } else {
          Alert.alert('网络断开', message);
        }
      }
    });

    let lastBackPressed = 0;
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigationRef.isReady() && navigationRef.canGoBack()) {
        navigationRef.goBack();
        return true;
      }
      
      // 如果在根页面（如 FoldersScreen），实现双击退出
      const now = Date.now();
      if (now - lastBackPressed < 2000) {
        return false; // 允许系统默认行为（退出应用）
      }
      
      lastBackPressed = now;
      if (Platform.OS === 'android') {
        ToastAndroid.show('再按一次退出应用', ToastAndroid.SHORT);
      }
      return true; // 拦截本次返回，不退出
    });

    startProgressPolling();

    return () => {
      unsubscribe();
      backHandler.remove();
      stopProgressPolling();
    };
  }, []);

  // Restore the same account's local index, or clear old account data before reuse.
  useEffect(() => {
    const init = async () => {
      if (!authReady) return;
      if (uid) {
        const lastUid = storage.getString('lastUid');
        if (lastUid !== uid) {
          // 账号切换时先清除旧索引与标签缓存，再等待用户手动同步。
          await favoriteService.clearGlobalIndex();
          if (useAuthStore.getState().userId === uid) {
            storage.setString('lastUid', uid);
          }
        } else {
          // 同一账号启动时恢复本地全局索引。
          await loadGlobalIndexCache();
        }
      } else {
        // 用户登出时清理数据
        await favoriteService.clearGlobalIndex();
        storage.delete('lastUid');
      }
    };
    init();
  }, [uid, authReady]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SafeAreaWrapper baseBgColor={baseBgColor}>
            <GlassBackground />
            <View style={{flex: 1}}>
              <NavigationContainer
                ref={navigationRef}
                theme={navTheme}
                onReady={updateCurrentRouteName}
                onStateChange={updateCurrentRouteName}>
                <Stack.Navigator
                  initialRouteName="Splash"
                  screenOptions={{
                    headerShown: false,
                    cardStyle: { backgroundColor: 'transparent' },
                    animation: isGlassMode ? 'none' : 'default',
                    // 【性能优化】启用 freezeOnBlur：页面不可见时停止渲染，
                    // 配合 react-native-screens 释放 GPU/CPU 资源
                    freezeOnBlur: true,
                  }}>
                  <Stack.Screen name="Splash" component={SplashScreenWithBg} />
                  <Stack.Screen name="Home" component={HomeScreenWithBg} />
                  <Stack.Screen name="Folders" component={FoldersScreenWithBg} />
                  <Stack.Screen name="Videos" component={VideosScreenWithBg} />
                  <Stack.Screen
                    name="Player"
                    component={PlayerScreenWithBg}
                    options={{ presentation: 'modal' }}
                  />
                  <Stack.Screen name="Settings" component={SettingsScreenWithBg} />
                  <Stack.Screen name="SoundLab" component={SoundLabScreenWithBg} />
                  <Stack.Screen name="VisibleFolders" component={VisibleFoldersScreenWithBg} />
                  <Stack.Screen name="NoCacheFolders" component={NoCacheFoldersScreenWithBg} />
                  <Stack.Screen name="SyncDetails" component={SyncDetailsScreenWithBg} />
                  <Stack.Screen name="TagRecommendations" component={TagRecommendationsScreenWithBg} />
                </Stack.Navigator>
              </NavigationContainer>
              {isGlobalDockVisible && (
                <BottomNavigationBar
                  navigation={navigationRef}
                  activeTab={activeDockTab}
                />
              )}
            </View>
          </SafeAreaWrapper>
          {/* 全局顶部通知组件 - 覆盖在所有页面之上 */}
          <ToastNotification ref={toastRef} />
          <PlaylistPanel visible={playlistVisible} onClose={() => setPlaylistVisible(false)} />
          <LoginModal />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
