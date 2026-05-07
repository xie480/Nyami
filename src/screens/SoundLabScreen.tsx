import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../components/Header';
import { Switch } from '../components/Switch';
import { useTheme } from '../theme';
import { useEQStore, BAND_FREQUENCIES, EMOTION_PRESETS } from '../store/eqStore';
import { GraphicEQ } from '../components/eq/GraphicEQ';
import { ParametricEQ } from '../components/eq/ParametricEQ';
import { PEQFilterEditor } from '../components/eq/PEQFilterEditor';
import { PresetSelector } from '../components/eq/PresetSelector';
import { SpectrumView } from '../components/eq/SpectrumView';
import { useSpectrumPoller } from '../hooks/useSpectrumPoller';
import type { EQMode } from '../store/eqStore';

const MODE_OPTIONS: Array<{ key: EQMode; label: string }> = [
  { key: 'graphic', label: '图形 EQ' },
  { key: 'parametric', label: '参数 EQ' },
];

export const SoundLabScreen = () => {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  // EQ State
  const mode = useEQStore(s => s.mode);
  const setMode = useEQStore(s => s.setMode);
  const enabled = useEQStore(s => s.enabled);
  const setEnabled = useEQStore(s => s.setEnabled);
  const graphicBands = useEQStore(s => s.graphicBands);
  const peqFilters = useEQStore(s => s.peqFilters);
  const addFilter = useEQStore(s => s.addFilter);
  const activePresetId = useEQStore(s => s.activePresetId);
  const resetToFlat = useEQStore(s => s.resetToFlat);

  // PEQ 本地状态
  const [selectedFilterId, setSelectedFilterId] = useState<number | null>(null);

  // 当前预设名称
  const activePreset = EMOTION_PRESETS.find(p => p.id === activePresetId);

  // 计算当前 EQ 曲线的"能量"（用于视觉指示）
  const totalEnergy = graphicBands.reduce((sum, v) => sum + Math.abs(v), 0);
  const energyLevel = totalEnergy > 20 ? '高' : totalEnergy > 5 ? '中' : '低';

  // FFT 频谱数据轮询（仅页面可见时启用）
  const { spectrum, catEarLeft, catEarRight } = useSpectrumPoller(mode === 'graphic');

  // 当前选中的 PEQ 滤波器
  const selectedFilter = selectedFilterId
    ? peqFilters.find(f => f.id === selectedFilterId) ?? null
    : null;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: t.colors.background }]}>
      <StatusBar
        barStyle={t.isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <Header title="声音实验室" showBack noBorder />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== 磨砂玻璃控制台 ===== */}
        <View style={[styles.consoleCard, { backgroundColor: t.colors.surface }]}>
          {/* EQ 开关 + 模式切换 */}
          <View style={styles.controlBar}>
            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { color: t.colors.text }]}>
                EQ 均衡器
              </Text>
              <Switch value={enabled} onValueChange={setEnabled} />
            </View>
          </View>

          {/* 模式选择器 */}
          <View style={styles.modeRow}>
            {MODE_OPTIONS.map(opt => {
              const isActive = mode === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  activeOpacity={0.7}
                  onPress={() => setMode(opt.key)}
                  style={[
                    styles.modeBtn,
                    isActive
                      ? { backgroundColor: t.colors.primary + '25', borderColor: t.colors.primary, borderWidth: 1.5 }
                      : { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'transparent', borderWidth: 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      { color: isActive ? t.colors.primary : t.colors.textSub },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 当前预设标签 */}
          {activePreset && (
            <View style={styles.presetIndicator}>
              <Text style={[styles.presetLabel, { color: t.colors.textHint }]}>
                预设：<Text style={{ color: t.colors.primary }}>{activePreset.name}</Text>
                {'  ·  '}能量：{energyLevel}
              </Text>
            </View>
          )}

          {/* 分隔线 */}
          <View style={[styles.divider, { backgroundColor: t.colors.divider }]} />

          {/* ===== Graphic EQ 区域 ===== */}
          {mode === 'graphic' && (
            <View style={{ opacity: enabled ? 1 : 0.35 }}>
              <GraphicEQ />
            </View>
          )}

          {/* ===== PEQ 区域 ===== */}
          {mode === 'parametric' && (
            <View style={{ opacity: enabled ? 1 : 0.35 }}>
              {/* 频率响应曲线 + 可拖动节点 */}
              <ParametricEQ
                filters={peqFilters}
                onSelectFilter={setSelectedFilterId}
                selectedFilterId={selectedFilterId}
              />

              {/* 滤波器列表 + 添加按钮 */}
              <View style={styles.peqFilterList}>
                {peqFilters.map(filter => (
                  <TouchableOpacity
                    key={filter.id}
                    activeOpacity={0.7}
                    onPress={() => setSelectedFilterId(
                      selectedFilterId === filter.id ? null : filter.id,
                    )}
                    style={[
                      styles.peqFilterChip,
                      {
                        backgroundColor: filter.enabled
                          ? t.colors.primary + '18'
                          : 'rgba(255,255,255,0.05)',
                        borderColor: selectedFilterId === filter.id
                          ? t.colors.primary
                          : 'transparent',
                        borderWidth: selectedFilterId === filter.id ? 1.5 : 0,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.peqFilterChipText,
                        {
                          color: filter.enabled ? t.colors.primary : t.colors.textSub,
                          opacity: filter.enabled ? 1 : 0.5,
                        },
                      ]}
                    >
                      #{filter.id} {filter.type}
                    </Text>
                    <Text style={[styles.peqFilterChipSub, { color: t.colors.textHint }]}>
                      {filter.frequency >= 1000
                        ? `${(filter.frequency / 1000).toFixed(1)}k`
                        : `${filter.frequency}`}
                      Hz · {filter.gain > 0 ? '+' : ''}{filter.gain}dB
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 添加滤波器按钮 */}
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  addFilter();
                  // 自动选中新添加的滤波器（最后一个）
                  setSelectedFilterId(
                    peqFilters.length > 0 ? Math.max(...peqFilters.map(f => f.id)) + 1 : 1,
                  );
                }}
                style={[
                  styles.addFilterBtn,
                  { borderColor: t.colors.primary + '40', backgroundColor: t.colors.primary + '0A' },
                ]}
              >
                <Text style={[styles.addFilterBtnText, { color: t.colors.primary }]}>
                  + 添加滤波器
                </Text>
              </TouchableOpacity>

              {/* 选中滤波器的编辑面板 */}
              {selectedFilter && (
                <PEQFilterEditor
                  filter={selectedFilter}
                  onClose={() => setSelectedFilterId(null)}
                />
              )}
            </View>
          )}
        </View>

        {/* ===== 预设选择器 ===== */}
        <View style={styles.presetSection}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: t.colors.text }]}>
              情绪化预设
            </Text>
            {activePresetId !== 'flat' && (
              <TouchableOpacity onPress={resetToFlat}>
                <Text style={[styles.resetBtn, { color: t.colors.primary }]}>
                  重置
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <PresetSelector />
        </View>

        {/* ===== FFT 频谱区域（Native OpenGL SpectrumView） ===== */}
        <View style={[styles.spectrumCard, { backgroundColor: t.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: t.colors.text }]}>
            实时频谱
          </Text>
          <SpectrumView
            style={styles.spectrumView}
            spectrumData={spectrum}
            catEarLeft={catEarLeft}
            catEarRight={catEarRight}
          />
        </View>

        {/* ===== 频段详情（仅 Graphic EQ 模式） ===== */}
        {mode === 'graphic' && (
          <View style={[styles.detailCard, { backgroundColor: t.colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: t.colors.text }]}>
              频段详情
            </Text>
            <View style={styles.bandGrid}>
              {BAND_FREQUENCIES.map((freq, i) => (
                <View key={freq} style={styles.bandItem}>
                  <Text style={[styles.bandFreq, { color: t.colors.textSub }]}>
                    {freq}Hz
                  </Text>
                  <Text
                    style={[
                      styles.bandValue,
                      {
                        color:
                          graphicBands[i] > 0
                            ? t.colors.primary
                            : graphicBands[i] < 0
                            ? '#6C5CE7'
                            : t.colors.textHint,
                      },
                    ]}
                  >
                    {graphicBands[i] > 0 ? '+' : ''}{graphicBands[i]} dB
                  </Text>
                  {/* 迷你能量条 */}
                  <View
                    style={[
                      styles.miniBar,
                      {
                        width: 4,
                        height: Math.abs(graphicBands[i]) * 4 + 4,
                        backgroundColor:
                          graphicBands[i] > 0
                            ? t.colors.primary
                            : '#6C5CE7',
                      },
                    ]}
                  />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // 磨砂玻璃控制台
  consoleCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    padding: 16,
  },
  controlBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
  },

  // 模式切换
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  modeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // 预设指示
  presetIndicator: {
    marginBottom: 8,
  },
  presetLabel: {
    fontSize: 12,
    fontWeight: '500',
  },

  divider: {
    height: 1,
    marginVertical: 12,
  },

  // PEQ 滤波器列表
  peqFilterList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  peqFilterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 0,
    minWidth: 80,
  },
  peqFilterChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  peqFilterChipSub: {
    fontSize: 9,
    fontWeight: '400',
    marginTop: 2,
  },

  // 添加滤波器按钮
  addFilterBtn: {
    marginTop: 8,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFilterBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // 预设区域
  presetSection: {
    marginTop: 16,
    marginHorizontal: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  resetBtn: {
    fontSize: 13,
    fontWeight: '500',
  },

  // 频谱
  spectrumCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    padding: 16,
  },
  spectrumView: {
    width: '100%',
    height: 140,
    marginTop: 8,
    borderRadius: 12,
  },

  // 频段详情
  detailCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    padding: 16,
  },
  bandGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  bandItem: {
    alignItems: 'center',
    width: 32,
  },
  bandFreq: {
    fontSize: 8,
    fontWeight: '600',
    marginBottom: 4,
  },
  bandValue: {
    fontSize: 9,
    fontWeight: '700',
    marginBottom: 4,
  },
  miniBar: {
    borderRadius: 2,
  },
});
