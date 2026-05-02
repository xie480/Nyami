import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { useUserStore } from './store/userStore';
import { NavigationContainer, DefaultTheme, DarkTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme, Alert, Platform, ToastAndroid, BackHandler } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler'; // [新增] 导入 GestureHandlerRootView
import { ThemeProvider } from './theme';
import { setupPlayer } from './services/trackPlayer';
import { netStatus } from './services/netStatus';
import { HomeScreen } from './screens/HomeScreen';
import { FoldersScreen } from './screens/FoldersScreen';
import { VideosScreen } from './screens/VideosScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { favoriteService } from './services/favoriteService';

const Stack = createNativeStackNavigator();

export default function App() {
  const isDark = useColorScheme() === 'dark';
  const [isOnline, setIsOnline] = useState(true);
  const navigationRef = useNavigationContainerRef();
  const uid = useUserStore((s) => s.uid);

  // Initialize player, network status listener, and back handler
  useEffect(() => {
    setupPlayer();
    netStatus.init();
    const unsubscribe = netStatus.onChange((type) => {
      const nowOnline = type !== 'none';
      setIsOnline(nowOnline);
      if (!nowOnline) {
        // Show a toast / alert when network goes offline
        const message = '网络已断开，当前仅可播放本地缓存音频';
        if (Platform.OS === 'android') {
          ToastAndroid.show(message, ToastAndroid.LONG);
        } else {
          Alert.alert('网络断开', message);
        }
      }
    });

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigationRef.isReady() && navigationRef.canGoBack()) {
        navigationRef.goBack();
        return true;
      }
      return false;
    });

    return () => {
      unsubscribe();
      backHandler.remove();
    };
  }, []);

  // Rebuild global index on startup or when uid changes
  useEffect(() => {
    if (uid) {
      favoriteService.clearGlobalIndex();
      favoriteService.syncGlobalIndex(uid).catch(console.warn);
    }
  }, [uid]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <NavigationContainer ref={navigationRef} theme={isDark ? DarkTheme : DefaultTheme}>
            <Stack.Navigator
              initialRouteName={uid ? 'Folders' : 'Home'}
              screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
            >
              <Stack.Screen name="Home" component={HomeScreen} />
              <Stack.Screen name="Folders" component={FoldersScreen} />
              <Stack.Screen name="Videos" component={VideosScreen} />
              <Stack.Screen
                name="Player"
                component={PlayerScreen}
                options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
              />
              <Stack.Screen name="Settings" component={SettingsScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
