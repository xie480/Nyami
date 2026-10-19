import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {ScrollView, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {IconButton} from './IconButton';
import {useTheme} from '../theme';

export interface ToastConfig {
  type: 'warn' | 'error';
  message: string;
  duration?: number;
}

export interface ToastNotificationRef {
  show: (config: ToastConfig) => void;
}

/** A readable, dismissible status surface below the actual system safe area. */
const ToastNotification = forwardRef<ToastNotificationRef>((_props, ref) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [config, setConfig] = useState<ToastConfig | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const hide = useCallback(() => {
    clearTimer();
    setConfig(null);
  }, [clearTimer]);
  useImperativeHandle(
    ref,
    () => ({
      show(next) {
        clearTimer();
        setConfig(next);
        timer.current = setTimeout(hide, next.duration ?? 4000);
      },
    }),
    [clearTimer, hide],
  );
  useEffect(() => clearTimer, [clearTimer]);
  if (!config) {
    return null;
  }
  const error = config.type === 'error';
  const accent = error ? t.colors.error : t.colors.warning;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + 8,
        left: insets.left + 12,
        right: insets.right + 12,
        zIndex: 9999,
        elevation: 30,
        alignItems: 'center',
      }}>
      <View
        style={{
          width: '100%',
          maxWidth: 560,
          flexDirection: 'row',
          alignItems: 'flex-start',
          padding: 12,
          borderRadius: 18,
          backgroundColor: t.colors.surfaceRaised,
          borderWidth: 1,
          borderColor: accent,
        }}>
        <Icon
          accessible={false}
          name={error ? 'alert-circle-outline' : 'information-outline'}
          size={24}
          color={accent}
          style={{margin: 4}}
        />
        <ScrollView
          style={{flex: 1, maxHeight: 220, marginHorizontal: 8}}
          onTouchStart={clearTimer}>
          <Text
            accessibilityLiveRegion="polite"
            style={{
              fontSize: t.fontSize.base,
              fontWeight: '700',
              color: accent,
              marginBottom: 4,
            }}>
            {error ? '遇到问题' : '请留意'}
          </Text>
          <Text
            selectable
            style={{
              fontSize: t.fontSize.base,
              lineHeight: 22,
              color: t.colors.text,
            }}>
            {config.message}
          </Text>
        </ScrollView>
        <IconButton
          name="close"
          size={20}
          accessibilityLabel="关闭通知"
          onPress={hide}
        />
      </View>
    </View>
  );
});

ToastNotification.displayName = 'ToastNotification';
export default ToastNotification;
