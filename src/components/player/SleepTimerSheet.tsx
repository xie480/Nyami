import React, {useEffect, useMemo, useState} from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../theme';
import {AlbumTheme} from '../../utils/albumTheme';
import {
  cancelSleepTimer,
  getSleepTimerEndAt,
  subscribeSleepTimer,
} from '../../services/sleepTimer';

const SLEEP_TIMER_PRESETS_MINUTES = [5, 10, 15, 30, 45, 60];

interface Props {
  visible: boolean;
  theme: AlbumTheme;
  onStart: (minutes: number) => void;
  onClose: () => void;
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(
    remainingSeconds,
  ).padStart(2, '0')}`;
}

export const SleepTimerSheet: React.FC<Props> = ({
  visible,
  theme,
  onStart,
  onClose,
}) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [endsAt, setEndsAt] = useState<number | null>(getSleepTimerEndAt);
  const [now, setNow] = useState(Date.now());
  const sheetStyle = useMemo(
    () => ({
      backgroundColor: t.isDark ? '#17191E' : '#F6F4EF',
      paddingBottom: Math.max(insets.bottom, 16) + 8,
    }),
    [insets.bottom, t.isDark],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    const refresh = () => {
      setEndsAt(getSleepTimerEndAt());
      setNow(Date.now());
    };
    refresh();
    const unsubscribe = subscribeSleepTimer(refresh);
    const interval = setInterval(refresh, 1000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [visible]);

  const remainingSeconds = endsAt
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : 0;
  const active = endsAt !== null && remainingSeconds > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheet, sheetStyle]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.titleBlock}>
              <Text style={[styles.title, {color: t.colors.text}]}>
                定时暂停
              </Text>
              <Text style={[styles.subtitle, {color: t.colors.textSub}]}>
                倒计时结束后暂停当前歌曲
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="关闭定时暂停设置"
              onPress={onClose}
              style={styles.closeButton}>
              <MaterialCommunityIcons
                name="close"
                size={23}
                color={t.colors.text}
              />
            </TouchableOpacity>
          </View>

          {active ? (
            <View
              accessibilityRole="timer"
              accessibilityLabel={`距离暂停还有 ${formatRemaining(
                remainingSeconds,
              )}`}
              style={[
                styles.countdownCard,
                {backgroundColor: `${theme.primaryAccent}18`},
              ]}>
              <View
                style={[
                  styles.timerIcon,
                  {backgroundColor: `${theme.primaryAccent}22`},
                ]}>
                <MaterialCommunityIcons
                  name="timer-sand"
                  size={22}
                  color={theme.primaryAccent}
                />
              </View>
              <View style={styles.countdownCopy}>
                <Text style={[styles.countdownTitle, {color: t.colors.text}]}>
                  正在倒计时
                </Text>
                <Text
                  style={[styles.countdownValue, {color: theme.primaryAccent}]}
                  numberOfLines={1}>
                  {formatRemaining(remainingSeconds)} 后暂停
                </Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="取消定时暂停"
                onPress={() => {
                  cancelSleepTimer();
                  setEndsAt(null);
                }}
                style={[styles.cancelButton, {borderColor: t.colors.divider}]}>
                <Text style={[styles.cancelLabel, {color: t.colors.textSub}]}>
                  取消
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.presetGrid}>
              {SLEEP_TIMER_PRESETS_MINUTES.map(minutes => (
                <TouchableOpacity
                  key={minutes}
                  accessibilityRole="button"
                  accessibilityLabel={`${minutes} 分钟后暂停`}
                  onPress={() => onStart(minutes)}
                  activeOpacity={0.72}
                  style={[
                    styles.preset,
                    {
                      backgroundColor: t.colors.surfaceHigh,
                      borderColor: t.colors.divider,
                    },
                  ]}>
                  <Text style={[styles.presetValue, {color: t.colors.text}]}>
                    {minutes}
                  </Text>
                  <Text style={[styles.presetUnit, {color: t.colors.textSub}]}>
                    分钟
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={[styles.footnote, {color: t.colors.textHint}]}>
            定时在后台播放时仍会生效
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {flex: 1, justifyContent: 'flex-end'},
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  sheet: {
    paddingTop: 8,
    paddingHorizontal: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.36)',
    marginBottom: 14,
  },
  header: {flexDirection: 'row', alignItems: 'center', minHeight: 54},
  titleBlock: {flex: 1},
  title: {fontSize: 18, fontWeight: '700'},
  subtitle: {fontSize: 12, marginTop: 4},
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
    marginTop: 18,
  },
  preset: {
    width: '31.5%',
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
  },
  presetValue: {fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums']},
  presetUnit: {fontSize: 12, marginLeft: 4},
  countdownCard: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginTop: 18,
    borderRadius: 18,
  },
  timerIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  countdownCopy: {flex: 1, marginHorizontal: 12},
  countdownTitle: {fontSize: 13, fontWeight: '600'},
  countdownValue: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  cancelButton: {
    minWidth: 56,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
  },
  cancelLabel: {fontSize: 12, fontWeight: '600'},
  footnote: {fontSize: 11, textAlign: 'center', marginTop: 16},
});
