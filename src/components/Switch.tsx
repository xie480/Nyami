import React from 'react';
import { Switch as RNSwitch } from 'react-native';
import { useTheme } from '../theme';

interface Props {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}

export const Switch: React.FC<Props> = ({ value, onValueChange, accessibilityLabel, disabled }) => {
  const t = useTheme();
  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      trackColor={{ false: t.colors.divider, true: t.colors.primary }}
      thumbColor="#fff"
    />
  );
};
