import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Button } from './Button';
import { useTheme } from '../theme';

interface Props { message: string; onRetry?: () => void; }

export const ErrorView: React.FC<Props> = ({ message, onRetry }) => {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <Icon accessible={false} name="alert-circle-outline" size={40} color={t.colors.error} />
      <Text accessibilityRole="header" style={{marginTop: 16, fontSize: t.fontSize.lg, fontWeight: '600', color: t.colors.text}}>暂时无法加载</Text>
      <Text style={{
        marginTop: t.spacing.lg,
        color: t.colors.textSub,
        fontSize: t.fontSize.base,
        textAlign: 'center',
        lineHeight: 22,
        maxWidth: 320,
      }}>{message}</Text>
      {onRetry && (
        <Button
          title="重新加载"
          variant="secondary"
          onPress={onRetry}
          style={{ marginTop: t.spacing.lg, paddingHorizontal: 32 }}
        />
      )}
    </View>
  );
};
