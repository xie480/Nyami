import React, {useMemo} from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Slider} from '../Slider';
import {useTheme} from '../../theme';
import {PLAYER_ARTWORK_BLUR} from '../../store/settingsStore';
import {AlbumTheme} from '../../utils/albumTheme';
import type {VideoPart} from '../../types/domain';

interface Props {
  visible: boolean;
  blurAmount: number;
  parts: VideoPart[];
  currentCid: number | null;
  theme: AlbumTheme;
  onBlurAmountChange: (value: number) => void;
  onSelectPart: (part: VideoPart) => void;
  onClose: () => void;
}

export const PlayerMoreSheet: React.FC<Props> = ({
  visible,
  blurAmount,
  parts,
  currentCid,
  theme,
  onBlurAmountChange,
  onSelectPart,
  onClose,
}) => {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const sheetStyle = useMemo(
    () => ({
      backgroundColor: t.isDark ? '#17191E' : '#F6F4EF',
      paddingBottom: Math.max(insets.bottom, 16) + 8,
    }),
    [insets.bottom, t.isDark],
  );

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
          <View style={styles.header}>
            <Text style={[styles.title, {color: t.colors.text}]}>更多</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="关闭更多选项"
              onPress={onClose}
              style={styles.closeButton}>
              <MaterialCommunityIcons
                name="close"
                size={23}
                color={t.colors.text}
              />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionIcon}>
                <MaterialCommunityIcons
                  name="blur"
                  size={20}
                  color={theme.primaryAccent}
                />
              </View>
              <View style={styles.sectionCopy}>
                <Text style={[styles.sectionTitle, {color: t.colors.text}]}>
                  背景模糊度
                </Text>
                <Text style={[styles.caption, {color: t.colors.textSub}]}>
                  仅调整播放页封面背景
                </Text>
              </View>
              <Text style={[styles.value, {color: theme.primaryAccent}]}>
                {blurAmount}
              </Text>
            </View>

            <View
              accessibilityRole="adjustable"
              accessibilityLabel="播放页背景模糊度"
              accessibilityValue={{
                min: PLAYER_ARTWORK_BLUR.min,
                max: PLAYER_ARTWORK_BLUR.max,
                now: blurAmount,
              }}
              accessibilityActions={[
                {name: 'increment', label: '增加模糊度'},
                {name: 'decrement', label: '降低模糊度'},
              ]}
              onAccessibilityAction={event => {
                const delta =
                  event.nativeEvent.actionName === 'increment'
                    ? PLAYER_ARTWORK_BLUR.step
                    : -PLAYER_ARTWORK_BLUR.step;
                onBlurAmountChange(blurAmount + delta);
              }}>
              <Slider
                value={blurAmount}
                minimumValue={PLAYER_ARTWORK_BLUR.min}
                maximumValue={PLAYER_ARTWORK_BLUR.max}
                step={PLAYER_ARTWORK_BLUR.step}
                onValueChange={onBlurAmountChange}
                minimumTrackColor={theme.primaryAccent}
                maximumTrackColor={t.colors.divider}
                thumbColor={theme.primaryAccent}
                trackHeight={5}
                thumbSize={22}
                style={styles.slider}
              />
            </View>
            <View style={styles.rangeLabels}>
              <Text style={[styles.caption, {color: t.colors.textHint}]}>
                清晰
              </Text>
              <Text style={[styles.caption, {color: t.colors.textHint}]}>
                柔化
              </Text>
            </View>

            {parts.length > 1 ? (
              <View style={styles.partsSection}>
                <Text style={[styles.sectionTitle, {color: t.colors.text}]}>
                  选集 ({parts.length})
                </Text>
                <View style={styles.partsList}>
                  {parts.map(part => {
                    const selected = part.cid === currentCid;
                    return (
                      <TouchableOpacity
                        key={part.cid}
                        accessibilityRole="button"
                        accessibilityState={{selected}}
                        onPress={() => onSelectPart(part)}
                        activeOpacity={0.72}
                        style={[
                          styles.partRow,
                          {borderBottomColor: t.colors.divider},
                          selected && {
                            backgroundColor: `${theme.primaryAccent}18`,
                          },
                        ]}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.partTitle,
                            {
                              color: selected
                                ? theme.primaryAccent
                                : t.colors.text,
                            },
                          ]}>
                          {part.title}
                        </Text>
                        {selected ? (
                          <Text
                            style={[
                              styles.playingLabel,
                              {color: theme.primaryAccent},
                            ]}>
                            正在播放
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </ScrollView>
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
    maxHeight: '76%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
  },
  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.35)',
  },
  title: {fontSize: 17, fontWeight: '700'},
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {paddingHorizontal: 20, paddingBottom: 8},
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
  },
  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(128,128,128,0.12)',
  },
  sectionCopy: {flex: 1, marginLeft: 12},
  sectionTitle: {fontSize: 14, fontWeight: '600'},
  caption: {fontSize: 12, marginTop: 3},
  value: {fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums']},
  slider: {marginTop: 12},
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  partsSection: {marginTop: 22},
  partsList: {marginTop: 8},
  partRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  partTitle: {flex: 1, fontSize: 14, marginRight: 12},
  playingLabel: {fontSize: 11, fontWeight: '600'},
});
