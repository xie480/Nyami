import React from 'react';
import { TouchableOpacity, ViewStyle, StyleProp } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme';

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
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      onPress={onPress}
      disabled={disabled}
      style={[{ padding: 6, opacity: disabled ? 0.4 : 1 }, style]}
    >
      <Icon name={name} size={size} color={color || t.colors.text} />
    </TouchableOpacity>
  );
};
