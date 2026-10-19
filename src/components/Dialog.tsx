import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableWithoutFeedback,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {useReducedMotion} from '../hooks/useReducedMotion';

export interface DialogAction {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface DialogProps {
  visible: boolean;
  title?: string;
  message?: string;
  onClose: () => void;
  actions?: DialogAction[];
}

export const Dialog: React.FC<DialogProps> = ({
  visible,
  title,
  message,
  onClose,
  actions = [{text: '确定'}],
}) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const {width, fontScale} = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const stacked = width < 380 || fontScale > 1.2 || actions.length > 2;

  return (
    <Modal
      transparent
      visible={visible}
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
        }}>
        <TouchableWithoutFeedback onPress={onClose} accessible={false}>
          <View
            style={[
              StyleSheet.absoluteFill,
              {backgroundColor: t.colors.overlay},
            ]}
          />
        </TouchableWithoutFeedback>
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={{
            width: '100%',
            maxWidth: 440,
            maxHeight: '90%',
            borderRadius: 24,
            backgroundColor: t.colors.surfaceRaised,
            borderColor: t.colors.divider,
            borderWidth: StyleSheet.hairlineWidth,
            overflow: 'hidden',
          }}>
          <ScrollView bounces={false} contentContainerStyle={{padding: 24}}>
            {title ? (
              <Text
                accessibilityRole="header"
                style={{
                  fontSize: t.fontSize.xl,
                  fontWeight: '700',
                  color: t.colors.text,
                  marginBottom: 12,
                }}>
                {title}
              </Text>
            ) : null}
            {message ? (
              <Text
                selectable
                style={{
                  fontSize: t.fontSize.md,
                  lineHeight: 24,
                  color: t.colors.textSub,
                }}>
                {message}
              </Text>
            ) : null}
            <View
              style={{
                marginTop: 24,
                flexDirection: stacked ? 'column' : 'row',
                gap: 8,
              }}>
              {actions.map((action, index) => {
                const cancel = action.style === 'cancel';
                const background = cancel
                  ? t.colors.surfaceHigh
                  : action.style === 'destructive'
                  ? t.colors.error
                  : t.colors.primary;
                const foreground = cancel
                  ? t.colors.textSub
                  : action.style === 'destructive'
                  ? t.colors.onError
                  : t.colors.onPrimary;
                return (
                  <TouchableOpacity
                    key={index}
                    accessibilityRole="button"
                    activeOpacity={0.8}
                    style={{
                      flex: stacked ? undefined : 1,
                      minHeight: 48,
                      borderRadius: 14,
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: background,
                    }}
                    onPress={() => {
                      action.onPress?.();
                      onClose();
                    }}>
                    <Text
                      style={{
                        fontSize: t.fontSize.md,
                        fontWeight: '600',
                        color: foreground,
                        textAlign: 'center',
                      }}>
                      {action.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
