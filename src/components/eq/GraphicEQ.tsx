import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import { useEQStore, BAND_FREQUENCIES } from '../../store/eqStore';
import { EQSlider } from './EQSlider';

export const GraphicEQ: React.FC = () => {
  const t = useTheme();
  const graphicBands = useEQStore(s => s.graphicBands);
  const setGraphicBand = useEQStore(s => s.setGraphicBand);
  const enabled = useEQStore(s => s.enabled);

  return (
    <View style={styles.container}>
      {/* dB 标尺指示 */}
      <View style={styles.scaleRow}>
        <Text style={[styles.scaleLabel, { color: t.colors.textHint }]}>+12</Text>
        <View style={[styles.scaleLine, { backgroundColor: t.colors.divider }]} />
        <Text style={[styles.scaleLabel, { color: t.colors.textHint }]}>0</Text>
        <View style={[styles.scaleLine, { backgroundColor: t.colors.divider }]} />
        <Text style={[styles.scaleLabel, { color: t.colors.textHint }]}>-12</Text>
      </View>

      {/* 10 个频段的滑块 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sliderRow}
      >
        {BAND_FREQUENCIES.map((freq, index) => (
          <View key={freq} style={styles.sliderItem}>
            <EQSlider
              label={freq}
              value={graphicBands[index]}
              onValueChange={(val) => setGraphicBand(index, val)}
              disabled={!enabled}
              width={36}
              height={170}
            />
          </View>
        ))}
      </ScrollView>

      {/* 频率标签 */}
      <View style={styles.freqRow}>
        {BAND_FREQUENCIES.map(freq => (
          <Text key={freq} style={[styles.freqLabel, { color: t.colors.textHint }]}>
            {freq}
          </Text>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    paddingLeft: 28,
    paddingRight: 8,
  },
  scaleRow: {
    position: 'absolute',
    left: 0,
    top: 30,
    bottom: 24,
    width: 24,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  scaleLabel: {
    fontSize: 9,
    fontWeight: '500',
  },
  scaleLine: {
    width: 12,
    height: 1,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  sliderItem: {
    alignItems: 'center',
    marginHorizontal: 2,
  },
  freqRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  freqLabel: {
    fontSize: 8,
    fontWeight: '600',
    width: 36,
    textAlign: 'center',
  },
});
