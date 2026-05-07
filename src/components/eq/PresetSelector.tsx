import React, { useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { useTheme } from '../../theme';
import { useEQStore, EMOTION_PRESETS } from '../../store/eqStore';

export const PresetSelector: React.FC = () => {
  const t = useTheme();
  const activePresetId = useEQStore(s => s.activePresetId);
  const applyPreset = useEQStore(s => s.applyPreset);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {EMOTION_PRESETS.map(preset => {
          const isActive = activePresetId === preset.id;
          return (
            <PresetChip
              key={preset.id}
              preset={preset}
              isActive={isActive}
              onPress={() => applyPreset(preset.id)}
              accentColor={t.colors.primary}
            />
          );
        })}
      </ScrollView>
    </View>
  );
};

// ===== 预设 Chip 子组件（包含按压动画） =====

interface PresetChipProps {
  preset: typeof EMOTION_PRESETS[0];
  isActive: boolean;
  onPress: () => void;
  accentColor: string;
}

const PresetChip: React.FC<PresetChipProps> = ({
  preset,
  isActive,
  onPress,
  accentColor,
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
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.chip,
          isActive
            ? {
                backgroundColor: accentColor + '25',
                borderColor: accentColor,
                borderWidth: 1.5,
              }
            : {
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderColor: 'rgba(255,255,255,0.12)',
                borderWidth: 1,
              },
        ]}
      >
        <Text
          style={[
            styles.chipName,
            { color: isActive ? accentColor : '#E8E8EC' },
          ]}
          numberOfLines={1}
        >
          {preset.name}
        </Text>
        <Text
          style={[
            styles.chipDesc,
            { color: isActive ? '#AAAAB8' : '#777784' },
          ]}
          numberOfLines={1}
        >
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
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    minWidth: 80,
    alignItems: 'center',
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
