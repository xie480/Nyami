import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useAuthStore } from './store/authStore';
import { useSettingsStore } from './store/settingsStore';
import { NavigationContainer, DefaultTheme, DarkTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, StyleSheet, useColorScheme, Alert, Platform, ToastAndroid, BackHandler, PermissionsAndroid, StatusBar } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
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
import { DiscoverScreen } from './screens/DiscoverScreen';
import { SearchScreen } from './screens/SearchScreen';
import { PlaylistRecommendationsScreen } from './screens/PlaylistRecommendationsScreen';

const Stack = createStackNavigator();
const MAIN_PAGE_ROUTES = ['Discover', 'Folders', 'TagRecommendations', 'Settings'] as const;
type MainPageRoute = typeof MAIN_PAGE_ROUTES[number];
const SWIPE_EDGE_WIDTH = 44;
const SWIPE_DISTANCE = 72;

const GlobalPlaylistPanel = React.memo(function GlobalPlaylistPanel() {
  const visible = useUIStore(state => state.playlistVisible);
  const setPlaylistVisible = useUIStore(state => state.setPlaylistVisible);
  const close = useCallback(() => setPlaylistVisible(false), [setPlaylistVisible]);
  return <PlaylistPanel visible={visible} onClose={close} />;
});

// 底栏目标页与导航方向保持一致，切换时从水平方向进入。
const BOTTOM_TAB_SCREEN_OPTIONS = {
  animation: 'slide_from_right' as const,
  gestureEnabled: false,
};

const withBackground = (
  Component: React.ComponentType<any>,
  mainPageRoute?: MainPageRoute,
) => {
  return function ScreenWithBackground(props: any) {
    const { colors, glass } = useTheme();
    const bgColor = glass ? 'transparent' : colors.background;
    const pageIndex = mainPageRoute
      ? MAIN_PAGE_ROUTES.indexOf(mainPageRoute)
      : -1;
    const navigateToMainPage = useCallback((index: number) => {
      const route = MAIN_PAGE_ROUTES[index];
      if (route) props.navigation.navigate(route);
    }, [props.navigation]);
    const swipeGesture = useMemo(() => {
      if (pageIndex < 0) return Gesture.Pan().enabled(false);

      const swipeFromLeft = Gesture.Pan()
        .enabled(pageIndex > 0)
        .hitSlop({width: SWIPE_EDGE_WIDTH, left: 0})
        .activeOffsetX(20)
        .failOffsetY([-18, 18])
        .onEnd((event, success) => {
          if (success && event.translationX >= SWIPE_DISTANCE) {
            runOnJS(navigateToMainPage)(pageIndex - 1);
          }
        });
      const swipeFromRight = Gesture.Pan()
        .enabled(pageIndex < MAIN_PAGE_ROUTES.length - 1)
        .hitSlop({width: SWIPE_EDGE_WIDTH, right: 0})
        .activeOffsetX(-20)
        .failOffsetY([-18, 18])
        .onEnd((event, success) => {
          if (success && event.translationX <= -SWIPE_DISTANCE) {
            runOnJS(navigateToMainPage)(pageIndex + 1);
          }
        });

      return Gesture.Simultaneous(swipeFromLeft, swipeFromRight);
    }, [navigateToMainPage, pageIndex]);
    const screen = (
      <View
        collapsable={pageIndex >= 0 ? false : undefined}
        style={{ flex: 1, backgroundColor: bgColor }}>
        <Component {...props} />
      </View>
    );
    return pageIndex < 0
      ? screen
      : <GestureDetector gesture={swipeGesture}>{screen}</GestureDetector>;
  };
};

const HomeScreenWithBg = withBackground(HomeScreen);
const DiscoverScreenWithBg = withBackground(DiscoverScreen, 'Discover');
const SearchScreenWithBg = withBackground(SearchScreen);
const PlaylistRecommendationsScreenWithBg = withBackground(PlaylistRecommendationsScreen);
const FoldersScreenWithBg = withBackground(FoldersScreen, 'Folders');
const VideosScreenWithBg = withBackground(VideosScreen);
const PlayerScreenWithBg = withBackground(PlayerScreen);
const SettingsScreenWithBg = withBackground(SettingsScreen, 'Settings');
const SoundLabScreenWithBg = withBackground(SoundLabScreen);
const VisibleFoldersScreenWithBg = withBackground(VisibleFoldersScreen);
const NoCacheFoldersScreenWithBg = withBackground(NoCacheFoldersScreen);
const SplashScreenWithBg = withBackground(SplashScreen);
const SyncDetailsScreenWithBg = withBackground(SyncDetailsScreen);
const TagRecommendationsScreenWithBg = withBackground(TagRecommendationsScreen, 'TagRecommendations');

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
  const updateCurrentRouteName = useCallback(() => {
    if (navigationRef.isReady()) {
      useUIStore.getState().setCurrentRouteName(navigationRef.getCurrentRoute()?.name ?? null);
    }
  }, [navigationRef]);
  const loggedIn = useAuthStore((s) => s.loggedIn);
  const uid = useAuthStore((s) => s.userId);
  const initAuth = useAuthStore((s) => s.initAuth);
  const authReady = useAuthStore((s) => s.authReady);
  const isGlassMode = themeMode === 'glass-light' || themeMode === 'glass-dark';
  const navTheme = useMemo(() => ({
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: 'transparent',
    },
  }), [isDark]);
  const stackScreenOptions = useMemo(() => ({
    headerShown: false,
    cardStyle: { backgroundColor: 'transparent' },
    animation: isGlassMode ? 'none' as const : 'default' as const,
    // 页面不可见时冻结，减少后台页面持续渲染。
    freezeOnBlur: true,
  }), [isGlassMode]);
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
                  screenOptions={stackScreenOptions}>
                  <Stack.Screen name="Splash" component={SplashScreenWithBg} />
                  <Stack.Screen name="Home" component={HomeScreenWithBg} />
                  <Stack.Screen
                    name="Discover"
                    component={DiscoverScreenWithBg}
                    options={BOTTOM_TAB_SCREEN_OPTIONS}
                  />
                  <Stack.Screen name="Search" component={SearchScreenWithBg} />
                  <Stack.Screen name="PlaylistRecommendations" component={PlaylistRecommendationsScreenWithBg} />
                  <Stack.Screen
                    name="Folders"
                    component={FoldersScreenWithBg}
                    options={BOTTOM_TAB_SCREEN_OPTIONS}
                  />
                  <Stack.Screen name="Videos" component={VideosScreenWithBg} />
                  <Stack.Screen
                    name="Player"
                    component={PlayerScreenWithBg}
                    options={{ presentation: 'modal' }}
                  />
                  <Stack.Screen
                    name="Settings"
                    component={SettingsScreenWithBg}
                    options={BOTTOM_TAB_SCREEN_OPTIONS}
                  />
                  <Stack.Screen name="SoundLab" component={SoundLabScreenWithBg} />
                  <Stack.Screen name="VisibleFolders" component={VisibleFoldersScreenWithBg} />
                  <Stack.Screen name="NoCacheFolders" component={NoCacheFoldersScreenWithBg} />
                  <Stack.Screen name="SyncDetails" component={SyncDetailsScreenWithBg} />
                  <Stack.Screen
                    name="TagRecommendations"
                    component={TagRecommendationsScreenWithBg}
                    options={BOTTOM_TAB_SCREEN_OPTIONS}
                  />
                </Stack.Navigator>
              </NavigationContainer>
              <BottomNavigationBar navigation={navigationRef} />
            </View>
          </SafeAreaWrapper>
          {/* 全局顶部通知组件 - 覆盖在所有页面之上 */}
          <ToastNotification ref={toastRef} />
          <GlobalPlaylistPanel />
          <LoginModal />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
