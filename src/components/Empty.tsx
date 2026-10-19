import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme';

interface Props { icon?: string; title?: string; hint?: string; }

export const Empty: React.FC<Props> = ({
  icon = 'inbox-outline', title = '没有数据', hint,
}) => {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <View style={{width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.primaryLight}}>
        <Icon accessible={false} name={icon} size={32} color={t.colors.primary} />
      </View>
      <Text style={{
        marginTop: t.spacing.lg,
        color: t.colors.text,
        fontSize: t.fontSize.lg,
        fontWeight: '600',
        textAlign: 'center',
      }}>{title}</Text>
      {hint && (
        <Text style={{
          marginTop: t.spacing.sm,
          color: t.colors.textSub,
          fontSize: t.fontSize.base,
          lineHeight: 22,
          maxWidth: 320,
          textAlign: 'center',
        }}>{hint}</Text>
      )}
    </View>
  );
};
