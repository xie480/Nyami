import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableWithoutFeedback,
  Easing,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../theme';
import { GlassView } from './GlassView';

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
  actions = [{ text: '确定', onPress: onClose }],
}) => {
  const t = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 150,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.9,
          duration: 150,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, opacity, scale]);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[styles.overlay, { opacity }]}>
          <TouchableWithoutFeedback>
            <Animated.View
              style={[
                styles.dialog,
                {
                  transform: [{ scale }],
                },
              ]}
            >
              <GlassView borderRadius={15} style={{ padding: 20 }}>
                {title && (
                  <Text style={[styles.title, { color: t.colors.text, fontSize: t.fontSize.xl }]}>
                    {title}
                  </Text>
                )}
                {message && (
                  <Text style={[styles.message, { color: t.colors.textSub, fontSize: t.fontSize.base }]}>
                    {message}
                  </Text>
                )}
                <View style={styles.actions}>
                  {actions.map((action, index) => {
                    let color = t.colors.primary;
                    if (action.style === 'destructive') {
                      color = t.colors.error;
                    } else if (action.style === 'cancel') {
                      color = t.colors.textSub;
                    }

                    return (
                      <TouchableOpacity
                        key={index}
                        style={styles.button}
                        onPress={() => {
                          action.onPress?.();
                          onClose();
                        }}
                      >
                        <Text style={[styles.buttonText, { color, fontSize: t.fontSize.base }]}>
                          {action.text}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </GlassView>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialog: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 28, // MD3 standard
  },
  title: {
    padding: 8,
    fontWeight: '600',
    marginBottom: 16,
  },
  message: {
    padding: 8,
    lineHeight: 20,
    marginBottom: 24,
  },
  actions: {
    padding: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 100, // Pill shape for text buttons in MD3
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontWeight: '500',
  },
});
