import React from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {useTheme} from '../theme';

export const Loading: React.FC<{text?: string}> = ({text = '加载中…'}) => {
  const t = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={text}
      accessibilityState={{busy: true}}
      style={{
        flex: 1,
        minHeight: 160,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
      }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 24,
          backgroundColor: t.colors.primaryLight,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
      <Text
        accessibilityLiveRegion="polite"
        style={{
          marginTop: 20,
          fontSize: t.fontSize.base,
          lineHeight: 22,
          color: t.colors.textSub,
          textAlign: 'center',
        }}>
        {text}
      </Text>
    </View>
  );
};
