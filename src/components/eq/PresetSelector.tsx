import React, {useRef} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import {useTheme} from '../../theme';
import {useEQStore, EMOTION_PRESETS} from '../../store/eqStore';
import type {Colors} from '../../theme/colors';

export const PresetSelector: React.FC = () => {
  const t = useTheme();
  const activePresetId = useEQStore(s => s.activePresetId);
  const applyPreset = useEQStore(s => s.applyPreset);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        {EMOTION_PRESETS.map(preset => {
          const isActive = activePresetId === preset.id;
          return (
            <PresetChip
              key={preset.id}
              preset={preset}
              isActive={isActive}
              onPress={() => applyPreset(preset.id)}
              colors={t.colors}
            />
          );
        })}
      </ScrollView>
    </View>
  );
};

// ===== 预设 Chip 子组件（包含按压动画） =====

interface PresetChipProps {
  preset: (typeof EMOTION_PRESETS)[0];
  isActive: boolean;
  onPress: () => void;
  colors: Colors;
}

const PresetChip: React.FC<PresetChipProps> = ({
  preset,
  isActive,
  onPress,
  colors,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.92,
      useNativeDriver: true,
      friction: 8,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 6,
    }).start();
  };

  return (
    <Animated.View style={{transform: [{scale: scaleAnim}]}}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.chip,
          isActive
            ? {
                backgroundColor: colors.primaryLight,
                borderColor: colors.primary,
              }
            : {
                backgroundColor: colors.surfaceHigh,
                borderColor: colors.divider,
              },
        ]}>
        <Text
          style={[
            styles.chipName,
            {color: isActive ? colors.primary : colors.text},
          ]}
          numberOfLines={1}>
          {preset.name}
        </Text>
        <Text
          style={[
            styles.chipDesc,
            {color: isActive ? colors.textSub : colors.textHint},
          ]}
          numberOfLines={1}>
          {preset.description}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 0,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 15,
    borderWidth: 1,
    minWidth: 124,
    minHeight: 64,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  chipName: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  chipDesc: {
    fontSize: 10,
    fontWeight: '400',
  },
});
