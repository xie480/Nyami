import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {BlurView} from '@react-native-community/blur';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {AlbumTheme} from '../../utils/albumTheme';

interface Props {
  theme: AlbumTheme;
  onQueue: () => void;
  onEffects: () => void;
  onMore: () => void;
}

interface ActionProps {
  label: string;
  icon: string;
  color: string;
  disabled?: boolean;
  onPress?: () => void;
}

const Action: React.FC<ActionProps> = ({
  label,
  icon,
  color,
  disabled,
  onPress,
}) => (
  <TouchableOpacity
    accessibilityRole="button"
    accessibilityLabel={disabled ? `${label}，当前不可用` : label}
    disabled={disabled}
    onPress={onPress}
    activeOpacity={0.72}
    style={[styles.action, disabled && styles.disabled]}>
    <MaterialCommunityIcons name={icon} size={25} color={color} />
    <Text style={[styles.label, {color}]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

export const PlayerActionPanel: React.FC<Props> = ({
  theme,
  onQueue,
  onEffects,
  onMore,
}) => (
  <View style={styles.panel}>
    <BlurView
      style={StyleSheet.absoluteFill}
      blurType="light"
      blurAmount={12}
      reducedTransparencyFallbackColor="rgba(255,255,255,0.14)"
    />
    <View style={styles.tone} pointerEvents="none" />
    <Action
      label="列表"
      icon="playlist-music"
      color={theme.foreground}
      onPress={onQueue}
    />
    <Action
      label="音效"
      icon="tune-variant"
      color={theme.foreground}
      onPress={onEffects}
    />
    <Action
      label="定时"
      icon="timer-outline"
      color={theme.secondaryForeground}
      disabled
    />
    <Action
      label="更多"
      icon="dots-horizontal"
      color={theme.foreground}
      onPress={onMore}
    />
  </View>
);

const styles = StyleSheet.create({
  panel: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  tone: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  action: {
    minWidth: 64,
    minHeight: 76,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  label: {fontSize: 12, fontWeight: '500', marginTop: 5},
  disabled: {opacity: 0.52},
});
