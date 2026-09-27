import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useActiveTrack} from 'react-native-track-player';
import {GlassView} from './GlassView';
import {MiniPlayer} from './MiniPlayer';
import {useTheme} from '../theme';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

type ActiveTab = 'folders' | 'profile' | 'settings' | null;

interface BottomNavigationBarProps {
  navigation: any;
  activeTab: ActiveTab;
}

const NAV_ITEMS: Array<{
  key: ActiveTab | 'home';
  title: string;
  icon: string;
  route?: string;
}> = [
  {key: 'home', title: '首页', icon: 'home-variant-outline'},
  {key: 'folders', title: '收藏夹', icon: 'playlist-music-outline', route: 'Folders'},
  {key: 'profile', title: '用户画像', icon: 'account-circle-outline', route: 'TagRecommendations'},
  {key: 'settings', title: '设置', icon: 'cog-outline', route: 'Settings'},
];

/** 应用级固定磨砂播放导航面板；播放器与导航共用同一块玻璃背景。 */
export const BottomNavigationBar: React.FC<BottomNavigationBarProps> = ({
  navigation,
  activeTab,
}) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const activeTrack = useActiveTrack();
  const hasActiveTrack = !!activeTrack;
  const glassBackground = t.glass?.colors.glass.bg ??
    (t.isDark ? 'rgba(24,24,30,0.84)' : 'rgba(250,250,252,0.86)');
  const glassBorder = t.glass?.colors.glass.border ??
    (t.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.72)');

  return (
    <View
      pointerEvents="box-none"
      style={{
        paddingHorizontal: t.spacing.lg,
        paddingTop: t.spacing.sm,
        paddingBottom: Math.max(insets.bottom, t.spacing.sm),
      }}>
      <GlassView
        borderRadius={hasActiveTrack ? 26 : 32}
        backgroundColor={glassBackground}
        borderColor={glassBorder}
        noShadow
        style={{
          shadowColor: '#000',
          shadowOpacity: t.isDark ? 0.28 : 0.12,
          shadowRadius: 18,
          shadowOffset: {width: 0, height: 5},
          elevation: 8,
        }}>
        <View>
          {hasActiveTrack && (
            <>
              <MiniPlayer
                embedded
                onOpenPlayer={() => navigation.navigate('Player')}
              />
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  marginHorizontal: t.spacing.md,
                  backgroundColor: t.colors.divider,
                }}
              />
            </>
          )}
          <View
            style={{
              height: 62,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 4,
            }}>
            {NAV_ITEMS.map(item => {
              const selected = item.key === activeTab;
              const disabled = !item.route;
              const tintColor = disabled
                ? t.colors.textHint
                : selected
                  ? t.colors.primary
                  : t.colors.textSub;

              return (
                <TouchableOpacity
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={disabled ? `${item.title}（后续开放）` : item.title}
                  accessibilityState={{selected, disabled}}
                  disabled={disabled}
                  onPress={() => item.route && navigation.navigate(item.route)}
                  activeOpacity={0.75}
                  style={{
                    flex: 1,
                    height: 54,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 27,
                    backgroundColor: selected
                      ? t.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.055)'
                      : 'transparent',
                    opacity: disabled ? 0.58 : 1,
                  }}>
                  <Icon name={item.icon} size={22} color={tintColor} />
                  <Text
                    style={{
                      color: tintColor,
                      fontSize: t.fontSize.xs,
                      fontWeight: selected ? '600' : '500',
                      marginTop: 2,
                    }}>
                    {item.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </GlassView>
    </View>
  );
};
