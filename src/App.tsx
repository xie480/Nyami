import React, { useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme, Alert, Platform, ToastAndroid } from 'react-native';
import { ThemeProvider } from './theme';
import { setupPlayer } from './services/trackPlayer';
import { netStatus } from './services/netStatus';
import { HomeScreen } from './screens/HomeScreen';
import { FoldersScreen } from './screens/FoldersScreen';
import { VideosScreen } from './screens/VideosScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  const isDark = useColorScheme() === 'dark';
  const [isOnline, setIsOnline] = useState(true);

  // Initialize player and network status listener
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
    return () => unsubscribe();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <NavigationContainer theme={isDark ? DarkTheme : DefaultTheme}>
          <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
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
  );
}
