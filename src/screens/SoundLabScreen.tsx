import React, {memo, useState} from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {Header} from '../components/Header';
import {Switch} from '../components/Switch';
import {GraphicEQ} from '../components/eq/GraphicEQ';
import {ParametricEQ} from '../components/eq/ParametricEQ';
import {PEQFilterEditor} from '../components/eq/PEQFilterEditor';
import {PresetSelector} from '../components/eq/PresetSelector';
import {SpectrumView} from '../components/eq/SpectrumView';
import {useSpectrumPoller} from '../hooks/useSpectrumPoller';
import {BAND_FREQUENCIES, EMOTION_PRESETS, useEQStore} from '../store/eqStore';
import type {EQMode, GraphicBands} from '../store/eqStore';
import {useTheme} from '../theme';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 36,
  },
  heroCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    overflow: 'hidden',
  },
  heroOrb: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    right: -45,
    top: -70,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  heroTitle: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '800',
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
  },
  heroDivider: {
    height: 1,
    marginVertical: 16,
  },
  heroControl: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroControlCopy: {
    flex: 1,
    marginRight: 12,
  },
  heroControlTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  heroControlHint: {
    fontSize: 11,
    marginTop: 3,
  },
  sectionCard: {
    marginTop: 14,
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSubtitle: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
  },
  resetText: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
  },
  spectrumHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  liveText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  spectrumView: {
    width: '100%',
    height: 132,
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  editorCard: {
    marginTop: 14,
    borderRadius: 22,
    borderWidth: 1,
    paddingTop: 16,
    paddingBottom: 16,
    overflow: 'hidden',
  },
  editorHeader: {
    paddingHorizontal: 16,
    marginBottom: 13,
  },
  modeRow: {
    flexDirection: 'row',
    marginTop: 13,
    marginHorizontal: 16,
    padding: 4,
    borderRadius: 15,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 38,
    borderRadius: 12,
  },
  modeText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  editorBody: {
    marginTop: 12,
  },
  eqScrollArea: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  bandGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 13,
    alignItems: 'center',
  },
  bandItem: {
    alignItems: 'center',
    width: 28,
  },
  bandFreq: {
    fontSize: 8,
    fontWeight: '600',
    marginBottom: 5,
  },
  bandValue: {
    fontSize: 8,
    fontWeight: '700',
    marginBottom: 5,
  },
  miniBarTrack: {
    width: 18,
    height: 4,
    borderRadius: 2,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  miniBar: {
    height: 4,
    borderRadius: 2,
  },
  peqSection: {
    marginHorizontal: 16,
  },
  peqGraph: {
    minWidth: 320,
  },
  peqFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  peqFilterScroll: {
    flex: 1,
  },
  peqFilterChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 88,
    marginRight: 7,
  },
  peqFilterChipText: {
    fontSize: 10,
    fontWeight: '700',
  },
  peqFilterChipSub: {
    fontSize: 9,
    fontWeight: '500',
    marginTop: 3,
  },
  addFilterButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  addFilterText: {
    fontSize: 21,
    fontWeight: '500',
    lineHeight: 24,
  },
});

const MODE_OPTIONS: Array<{key: EQMode; label: string; icon: string}> = [
  {key: 'graphic', label: '图形均衡', icon: 'equalizer'},
  {key: 'parametric', label: '参数均衡', icon: 'chart-bell-curve-cumulative'},
];

interface BandDetailProps {
  graphicBands: GraphicBands;
}

const BandDetail = memo<BandDetailProps>(({graphicBands}) => {
  const t = useTheme();

  return (
    <View style={{paddingHorizontal: 16, marginTop: 18}}>
      <View style={styles.sectionHeadingRow}>
        <Text style={[styles.sectionTitle, {color: t.colors.text}]}>
          频段概览
        </Text>
        <Text style={{fontSize: 10, color: t.colors.textHint}}>
          10 BAND · dB
        </Text>
      </View>
      <View style={styles.bandGrid}>
        {BAND_FREQUENCIES.map((freq, index) => {
          const value = graphicBands[index];
          const magnitude = Math.abs(value) / 12;
          const color =
            value > 0
              ? t.colors.primary
              : value < 0
              ? '#6C8CFF'
              : t.colors.textHint;
          return (
            <View key={freq} style={styles.bandItem}>
              <Text style={[styles.bandFreq, {color: t.colors.textSub}]}>
                {freq}
              </Text>
              <Text style={[styles.bandValue, {color}]}>
                {value > 0 ? '+' : ''}
                {value}
              </Text>
              <View
                style={[
                  styles.miniBarTrack,
                  {backgroundColor: t.colors.divider},
                ]}>
                <View
                  style={[
                    styles.miniBar,
                    {
                      width: `${Math.max(12, magnitude * 100)}%`,
                      backgroundColor: color,
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
});

export const SoundLabScreen = () => {
  const t = useTheme();
  const isFocused = useIsFocused();
  const mode = useEQStore(state => state.mode);
  const setMode = useEQStore(state => state.setMode);
  const enabled = useEQStore(state => state.enabled);
  const setEnabled = useEQStore(state => state.setEnabled);
  const activePresetId = useEQStore(state => state.activePresetId);
  const resetToFlat = useEQStore(state => state.resetToFlat);
  const [selectedFilterId, setSelectedFilterId] = useState<number | null>(null);
  const activePreset = EMOTION_PRESETS.find(
    preset => preset.id === activePresetId,
  );
  const {spectrum, catEarLeft, catEarRight} = useSpectrumPoller(
    enabled && isFocused,
  );

  return (
    <View style={[styles.safeArea, {backgroundColor: t.colors.background}]}>
      <StatusBar
        barStyle={t.isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <Header title="声音实验室" showBack noBorder />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.heroCard,
            {backgroundColor: t.colors.surface, borderColor: t.colors.divider},
          ]}>
          <View
            style={[styles.heroOrb, {backgroundColor: t.colors.primaryLight}]}
          />
          <View style={styles.eyebrowRow}>
            <Icon name="tune-vertical" size={14} color={t.colors.primary} />
            <Text
              style={[
                styles.eyebrow,
                {color: t.colors.primary, marginLeft: 6},
              ]}>
              EQ STUDIO
            </Text>
          </View>
          <Text style={[styles.heroTitle, {color: t.colors.text}]}>
            把声音调成喜欢的样子
          </Text>
          <Text style={[styles.heroSubtitle, {color: t.colors.textSub}]}>
            从一键预设开始，也可以细调每一段频率。
          </Text>
          <View
            style={[styles.heroDivider, {backgroundColor: t.colors.divider}]}
          />
          <View style={styles.heroControl}>
            <View style={styles.heroControlCopy}>
              <Text style={[styles.heroControlTitle, {color: t.colors.text}]}>
                均衡器总开关
              </Text>
              <Text
                style={[styles.heroControlHint, {color: t.colors.textHint}]}>
                {enabled ? '音效正在应用到当前播放' : '关闭后恢复原始声音'}
              </Text>
            </View>
            <Switch value={enabled} onValueChange={setEnabled} />
          </View>
        </View>

        <View
          style={[
            styles.sectionCard,
            {backgroundColor: t.colors.surface, borderColor: t.colors.divider},
          ]}>
          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={[styles.sectionTitle, {color: t.colors.text}]}>
                声音预设
              </Text>
              <Text
                style={[styles.sectionSubtitle, {color: t.colors.textHint}]}>
                {activePreset?.description ?? '选择一组适合当前聆听的声音曲线'}
              </Text>
            </View>
            {activePresetId !== 'flat' && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="恢复原音预设"
                onPress={resetToFlat}
                style={[
                  styles.resetButton,
                  {backgroundColor: t.colors.primaryLight},
                ]}>
                <Icon name="restore" size={14} color={t.colors.primary} />
                <Text style={[styles.resetText, {color: t.colors.primary}]}>
                  原音
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <PresetSelector />
        </View>

        <View
          style={[
            styles.sectionCard,
            {backgroundColor: t.colors.surface, borderColor: t.colors.divider},
          ]}>
          <View style={styles.spectrumHeader}>
            <View>
              <Text style={[styles.sectionTitle, {color: t.colors.text}]}>
                实时频谱
              </Text>
              <Text
                style={[styles.sectionSubtitle, {color: t.colors.textHint}]}>
                播放音乐时观察不同频段的能量变化
              </Text>
            </View>
            <View
              style={[
                styles.liveBadge,
                {
                  backgroundColor: enabled
                    ? t.colors.primaryLight
                    : t.colors.surfaceHigh,
                },
              ]}>
              <View
                style={[
                  styles.liveDot,
                  {
                    backgroundColor: enabled
                      ? t.colors.success
                      : t.colors.textHint,
                  },
                ]}
              />
              <Text
                style={[
                  styles.liveText,
                  {color: enabled ? t.colors.primary : t.colors.textHint},
                ]}>
                {enabled ? 'EQ ON' : 'EQ OFF'}
              </Text>
            </View>
          </View>
          <SpectrumView
            style={styles.spectrumView}
            spectrumData={spectrum}
            catEarLeft={catEarLeft}
            catEarRight={catEarRight}
          />
        </View>

        <View
          style={[
            styles.editorCard,
            {backgroundColor: t.colors.surface, borderColor: t.colors.divider},
          ]}>
          <View style={styles.editorHeader}>
            <View style={styles.sectionHeadingRow}>
              <Text style={[styles.sectionTitle, {color: t.colors.text}]}>
                均衡器调节
              </Text>
              <Text style={{fontSize: 10, color: t.colors.textHint}}>
                {enabled ? '已启用' : '已关闭'}
              </Text>
            </View>
            <Text style={[styles.sectionSubtitle, {color: t.colors.textHint}]}>
              拖动控制点调整曲线，变化会同步到播放器。
            </Text>
          </View>

          <View
            style={[styles.modeRow, {backgroundColor: t.colors.surfaceHigh}]}>
            {MODE_OPTIONS.map(option => {
              const active = mode === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  accessibilityRole="tab"
                  accessibilityState={{selected: active}}
                  activeOpacity={0.8}
                  onPress={() => setMode(option.key)}
                  style={[
                    styles.modeButton,
                    active && {backgroundColor: t.colors.surface},
                  ]}>
                  <Icon
                    name={option.icon}
                    size={15}
                    color={active ? t.colors.primary : t.colors.textHint}
                  />
                  <Text
                    style={[
                      styles.modeText,
                      {color: active ? t.colors.primary : t.colors.textSub},
                    ]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {mode === 'graphic' ? (
            <GraphicEQSection enabled={enabled} />
          ) : (
            <PEQSection
              enabled={enabled}
              selectedFilterId={selectedFilterId}
              onSelectFilter={setSelectedFilterId}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
};

interface GraphicEQSectionProps {
  enabled: boolean;
}

const GraphicEQSection = memo<GraphicEQSectionProps>(({enabled}) => {
  const graphicBands = useEQStore(state => state.graphicBands);
  return (
    <View style={styles.editorBody}>
      <View
        pointerEvents={enabled ? 'auto' : 'none'}
        style={{opacity: enabled ? 1 : 0.45}}>
        <View style={styles.eqScrollArea}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            nestedScrollEnabled>
            <GraphicEQ />
          </ScrollView>
        </View>
        <BandDetail graphicBands={graphicBands} />
      </View>
    </View>
  );
});

interface PEQSectionProps {
  enabled: boolean;
  selectedFilterId: number | null;
  onSelectFilter: (id: number | null) => void;
}

const PEQSection = memo<PEQSectionProps>(
  ({enabled, selectedFilterId, onSelectFilter}) => {
    const t = useTheme();
    const peqFilters = useEQStore(state => state.peqFilters);
    const addFilter = useEQStore(state => state.addFilter);
    const selectedFilter = selectedFilterId
      ? peqFilters.find(filter => filter.id === selectedFilterId) ?? null
      : null;

    const addAndSelectFilter = () => {
      const nextId =
        peqFilters.length > 0
          ? Math.max(...peqFilters.map(filter => filter.id)) + 1
          : 1;
      addFilter();
      onSelectFilter(nextId);
    };

    return (
      <View style={styles.editorBody}>
        <View style={[styles.peqSection, {opacity: enabled ? 1 : 0.45}]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            nestedScrollEnabled>
            <View style={styles.peqGraph}>
              <ParametricEQ
                filters={peqFilters}
                onSelectFilter={onSelectFilter}
                selectedFilterId={selectedFilterId}
              />
            </View>
          </ScrollView>

          <View style={styles.peqFilterRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.peqFilterScroll}>
              {peqFilters.map(filter => {
                const selected = selectedFilterId === filter.id;
                const frequency =
                  filter.frequency >= 1000
                    ? `${(filter.frequency / 1000).toFixed(1)}k`
                    : `${filter.frequency}`;
                return (
                  <TouchableOpacity
                    key={filter.id}
                    accessibilityRole="button"
                    accessibilityState={{selected}}
                    activeOpacity={0.75}
                    onPress={() => onSelectFilter(selected ? null : filter.id)}
                    style={[
                      styles.peqFilterChip,
                      {
                        backgroundColor: selected
                          ? t.colors.primaryLight
                          : t.colors.surfaceHigh,
                        borderColor: selected
                          ? t.colors.primary
                          : t.colors.divider,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.peqFilterChipText,
                        {
                          color: filter.enabled
                            ? t.colors.primary
                            : t.colors.textSub,
                        },
                      ]}>
                      #{filter.id} · {filter.type}
                    </Text>
                    <Text
                      style={[
                        styles.peqFilterChipSub,
                        {color: t.colors.textHint},
                      ]}>
                      {frequency} Hz · {filter.gain > 0 ? '+' : ''}
                      {filter.gain} dB
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="添加滤波器"
              activeOpacity={0.75}
              onPress={addAndSelectFilter}
              style={[
                styles.addFilterButton,
                {
                  borderColor: t.colors.primary,
                  backgroundColor: t.colors.primaryLight,
                },
              ]}>
              <Text style={[styles.addFilterText, {color: t.colors.primary}]}>
                +
              </Text>
            </TouchableOpacity>
          </View>

          {selectedFilter && (
            <PEQFilterEditor
              filter={selectedFilter}
              onClose={() => onSelectFilter(null)}
            />
          )}
        </View>
      </View>
    );
  },
);
