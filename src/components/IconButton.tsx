import React from 'react';
import { TouchableOpacity, ViewStyle, StyleProp } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme';

const ICON_LABELS: Record<string, string> = {
  'chevron-left': '返回', close: '关闭', 'close-circle': '清除',
  play: '播放', pause: '暂停', 'skip-next': '下一首', 'skip-previous': '上一首',
  'playlist-music': '播放队列', 'playlist-music-outline': '播放队列',
  'dots-vertical': '更多选项', 'dots-horizontal': '更多选项',
  refresh: '刷新', magnify: '搜索', cog: '设置', 'cog-outline': '设置',
  plus: '添加', minus: '减少', delete: '删除', 'delete-outline': '删除',
  heart: '收藏', 'heart-outline': '收藏', 'share-variant': '分享',
  'sort-variant': '排序', 'filter-variant': '筛选', 'sync': '同步',
};

interface Props {
  name: string;
  size?: number;
  color?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export const IconButton: React.FC<Props> = ({
  name, size = 24, color, onPress, style, disabled, accessibilityLabel,
}) => {
  const t = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? ICON_LABELS[name] ?? '更多操作'}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      onPress={onPress}
      disabled={disabled}
      style={[
        { padding: 8, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.full, opacity: disabled ? 0.4 : 1 },
        style,
      ]}
    >
      <Icon accessible={false} name={name} size={size} color={color || t.colors.text} />
    </TouchableOpacity>
  );
};
