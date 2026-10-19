import React, {useState} from 'react';
import {View, Text, StyleSheet, Platform, StatusBar} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {IconButton} from './IconButton';
import {useTheme} from '../theme';

interface Props {
  title: string;
  showBack?: boolean;
  left?: React.ReactNode;
  right?: React.ReactNode;
  noBorder?: boolean;
}

export const Header: React.FC<Props> = ({
  title,
  showBack,
  left,
  right,
  noBorder,
}) => {
  const t = useTheme();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const [leftWidth, setLeftWidth] = useState(48);
  const [rightWidth, setRightWidth] = useState(48);
  const sideWidth = Math.max(48, leftWidth, rightWidth);
  const top =
    Platform.OS === 'android'
      ? Math.max(insets.top, StatusBar.currentHeight ?? 0)
      : insets.top;

  return (
    <View
      style={{
        paddingTop: top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
        backgroundColor: t.glass
          ? t.glass.colors.glass.bg
          : t.colors.background,
        borderBottomWidth: noBorder ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: t.colors.divider,
      }}>
      <View
        style={{
          minHeight: 60,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: t.spacing.sm,
        }}>
        <View style={{width: sideWidth, alignItems: 'flex-start'}}>
          <View
            style={styles.actions}
            onLayout={e => setLeftWidth(e.nativeEvent.layout.width)}>
            {left ??
              (showBack ? (
                <IconButton
                  name="chevron-left"
                  size={28}
                  accessibilityLabel="返回上一页"
                  onPress={() => nav.goBack()}
                />
              ) : null)}
          </View>
        </View>
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: t.fontSize.lg,
            fontWeight: '600',
            color: t.colors.text,
            textAlign: 'center',
            paddingVertical: 12,
          }}
          numberOfLines={1}>
          {title}
        </Text>
        <View style={{width: sideWidth, alignItems: 'flex-end'}}>
          <View
            style={styles.actions}
            onLayout={e => setRightWidth(e.nativeEvent.layout.width)}>
            {right}
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  actions: {flexDirection: 'row', alignItems: 'center', flexShrink: 0},
});
