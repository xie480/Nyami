/**
 * PEQFilterEditor - 参数 EQ 单个滤波器编辑器
 *
 * 提供对单个 PEQ 滤波器的完整参数控制：
 * - 滤波器类型选择（Peak / LowShelf / HighShelf / LowPass / HighPass / Notch / BandPass）
 * - 频率滑块 (20Hz ~ 20kHz) - 可拖动
 * - 增益滑块 (-12 ~ +12 dB) - 可拖动
 * - Q 值滑块 (0.1 ~ 20) - 可拖动
 * - 启用/禁用切换
 * - 删除滤波器
 */
import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  LayoutChangeEvent,
} from 'react-native';
import { useTheme } from '../../theme';
import { useEQStore, PEQFilter, FilterType } from '../../store/eqStore';
import {Switch} from '../Switch';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/** 滤波器类型选项 */
const FILTER_TYPE_OPTIONS: Array<{ key: FilterType; label: string }> = [
  { key: 'Peak', label: '峰值 · Peak' },
  { key: 'LowShelf', label: '低频搁架' },
  { key: 'HighShelf', label: '高频搁架' },
  { key: 'LowPass', label: '低通' },
  { key: 'HighPass', label: '高通' },
  { key: 'Notch', label: '陷波' },
  { key: 'BandPass', label: '带通' },
];

/** 频率预设快速选择（音乐制作常用频率） */
const QUICK_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

interface PEQFilterEditorProps {
  filter: PEQFilter;
  onClose: () => void;
}

export const PEQFilterEditor: React.FC<PEQFilterEditorProps> = ({
  filter,
  onClose,
}) => {
  const t = useTheme();
  const updatePEQFilter = useEQStore(s => s.updatePEQFilter);
  const removeFilter = useEQStore(s => s.removeFilter);
  const slideAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
    }).start();
  }, [slideAnim]);

  /** 格式化频率显示 */
  const formatFreq = (hz: number): string => {
    if (hz >= 1000) return `${(hz / 1000).toFixed(1)}k`;
    return `${hz}`;
  };

  const update = (params: Partial<PEQFilter>) => {
    updatePEQFilter(filter.id, params);
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: t.colors.surfaceHigh,
          borderColor: t.colors.divider,
          transform: [{
            translateY: slideAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            }),
          }],
          opacity: slideAnim,
        },
      ]}
    >
      {/* 标题栏 */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.colors.text }]}>
          滤波器 #{filter.id}
        </Text>
        <View style={styles.headerActions}>
          {/* 删除按钮 */}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`删除滤波器 ${filter.id}`}
            onPress={() => { removeFilter(filter.id); onClose(); }}
            style={[styles.deleteBtn, { backgroundColor: t.colors.surface }]}
          >
            <Text style={[styles.deleteBtnText, { color: t.colors.error }]}>删除</Text>
          </TouchableOpacity>
          {/* 关闭按钮 */}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭滤波器编辑器" onPress={onClose} style={styles.closeBtn}>
            <Icon name="close" size={22} color={t.colors.textSub} />
          </TouchableOpacity>
        </View>
      </View>

      {/* 启用开关 */}
      <View style={styles.switchRow}>
        <Text style={[styles.label, { color: t.colors.text }]}>启用</Text>
        <Switch accessibilityLabel={`启用滤波器 ${filter.id}`} value={filter.enabled} onValueChange={enabled => update({enabled})} />
      </View>

      {/* 滤波器类型选择 */}
      <Text style={[styles.label, { color: t.colors.text, marginTop: 12 }]}>类型</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.typeScroll}
      >
        {FILTER_TYPE_OPTIONS.map(opt => {
          const isActive = filter.type === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              accessibilityRole="radio"
              accessibilityState={{checked: isActive}}
              activeOpacity={0.7}
              onPress={() => update({ type: opt.key })}
              style={[
                styles.typeChip,
                isActive
                  ? { backgroundColor: t.colors.primary + '25', borderColor: t.colors.primary }
                  : { backgroundColor: t.colors.surface, borderColor: t.colors.divider },
              ]}
            >
              <Text
                style={[
                  styles.typeChipText,
                  { color: isActive ? t.colors.primary : t.colors.textSub },
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* 频率控制 */}
      <Text style={[styles.label, { color: t.colors.text, marginTop: 12 }]}>
        频率: {formatFreq(filter.frequency)} Hz
      </Text>
      <DragSlider
        label="滤波器频率"
        value={Math.log10(filter.frequency)}
        min={Math.log10(20)}
        max={Math.log10(20000)}
        onChange={v => update({ frequency: Math.round(Math.pow(10, v)) })}
        color={t.colors.primary}
        formatValue={v => formatFreq(Math.round(Math.pow(10, v)))}
      />
      {/* 快速频率选择 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickFreqRow}>
        {QUICK_FREQS.map(freq => (
          <TouchableOpacity
            key={freq}
            accessibilityRole="button"
            accessibilityLabel={`将滤波器频率设置为 ${freq} 赫兹`}
            accessibilityState={{selected: filter.frequency === freq}}
            activeOpacity={0.7}
            onPress={() => update({ frequency: freq })}
            style={[
              styles.quickFreqChip,
              filter.frequency === freq && { backgroundColor: t.colors.primary + '20' },
            ]}
          >
            <Text
              style={[
                styles.quickFreqText,
                {
                  color: filter.frequency === freq ? t.colors.primary : t.colors.textHint,
                  fontWeight: filter.frequency === freq ? '700' : '400',
                },
              ]}
            >
              {formatFreq(freq)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 增益控制 */}
      <Text style={[styles.label, { color: t.colors.text, marginTop: 12 }]}>
        增益: {filter.gain > 0 ? '+' : ''}{filter.gain.toFixed(1)} dB
      </Text>
      <DragSlider
        label="滤波器增益，分贝"
        value={filter.gain}
        min={-12}
        max={12}
        step={0.5}
        onChange={v => update({ gain: Math.round(v * 2) / 2 })}
        color={t.colors.primary}
      />

      {/* Q 值控制 */}
      <Text style={[styles.label, { color: t.colors.text, marginTop: 12 }]}>
        带宽 Q: {filter.q.toFixed(2)}
      </Text>
      <Text style={{fontSize: 12, lineHeight: 18, color: t.colors.textSub}}>Q 值越大，调整的频率范围越窄。</Text>
      <DragSlider
        label="滤波器带宽 Q 值"
        value={filter.q}
        min={0.1}
        max={20}
        onChange={v => update({ q: Math.round(v * 100) / 100 })}
        color={t.colors.primary}
      />
    </Animated.View>
  );
};

// ========== 高性能可拖动滑块组件 ==========

interface DragSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  formatValue?: (v: number) => string;
  onChange: (value: number) => void;
  color?: string;
}

/**
 * 高性能 DragSlider - 释放时提交模式（v2）
 *
 * 性能优化策略：
 * 1. 拖动中仅更新本地 ref 值，绝不触发 React 状态更新或 onChange
 * 2. 释放时一次性提交最终值
 * 3. 所有热路径参数通过 ref 持有，避免闭包过期
 */
const DragSlider: React.FC<DragSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 0,
  formatValue,
  onChange,
  color = '#00D2FF',
}) => {
  const t = useTheme();

  // ========== Refs（不触发渲染的热路径） ==========
  const trackWidthRef = useRef(0);
  const startValueRef = useRef(value);
  const isDraggingRef = useRef(false);
  const dragValueRef = useRef(value);
  const lastCommittedValueRef = useRef(value);

  // 参数 ref
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const stepRef = useRef(step);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);

  // 同步外部 prop 到 ref
  minRef.current = min;
  maxRef.current = max;
  stepRef.current = step;
  onChangeRef.current = onChange;
  valueRef.current = value;

  React.useEffect(() => {
    if (!isDraggingRef.current) {
      lastCommittedValueRef.current = value;
    }
  }, [value]);

  /** 数值 → 百分比（0~1） */
  const valueToFraction = (v: number): number => {
    return (v - minRef.current) / (maxRef.current - minRef.current);
  };

  /** 百分比 → 数值（带 step 取整） */
  const fractionToValue = (frac: number): number => {
    const m = minRef.current;
    const M = maxRef.current;
    const s = stepRef.current;
    const raw = m + frac * (M - m);
    if (s > 0) {
      const steps = Math.round((raw - m) / s);
      return m + steps * s;
    }
    return raw;
  };

  const fraction = valueToFraction(value);

  // ========== PanResponder（释放时提交） ==========
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        isDraggingRef.current = true;
        startValueRef.current = valueRef.current;
        dragValueRef.current = valueRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        if (trackWidthRef.current <= 0) return;
        const dxFraction = gesture.dx / trackWidthRef.current;
        const startFrac = valueToFraction(startValueRef.current);
        const newFraction = Math.max(0, Math.min(1, startFrac + dxFraction));
        dragValueRef.current = fractionToValue(newFraction);
        // 绝不触发 onChange，释放时一次性提交
      },
      onPanResponderRelease: () => {
        isDraggingRef.current = false;
        const finalValue = dragValueRef.current;
        if (finalValue !== lastCommittedValueRef.current) {
          lastCommittedValueRef.current = finalValue;
          onChangeRef.current(finalValue);
        }
      },
      onPanResponderTerminate: () => {
        isDraggingRef.current = false;
        const finalValue = dragValueRef.current;
        if (finalValue !== lastCommittedValueRef.current) {
          lastCommittedValueRef.current = finalValue;
          onChangeRef.current(finalValue);
        }
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
  };

  return (
    <View style={styles.sliderRow}>
      <Text style={[styles.sliderBound, { color: t.colors.textHint }]}>
        {formatMinValue(min, max, formatValue)}
      </Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{min, max, now: value, text: formatValue ? formatValue(value) : `${value}`}}
        accessibilityActions={[{name: 'increment', label: '增加'}, {name: 'decrement', label: '减少'}]}
        onAccessibilityAction={event => {
          const increment = step || (max - min) / 100;
          const delta = event.nativeEvent.actionName === 'increment' ? increment : -increment;
          onChange(Math.max(min, Math.min(max, value + delta)));
        }}
        style={styles.sliderTrackContainer}
        onLayout={onLayout}
        {...panResponder.panHandlers}
      >
        {/* 轨道背景 */}
        <View style={[styles.sliderTrack, { backgroundColor: t.colors.divider }]}>
          {/* 填充条 */}
          <View
            style={[
              styles.sliderFill,
              {
                width: `${fraction * 100}%`,
                backgroundColor: color,
              },
            ]}
          />
        </View>
        {/* 拖动手柄 */}
        <View
          style={[
            styles.sliderThumb,
            {
              left: `${fraction * 100}%`,
              backgroundColor: color,
              borderColor: '#fff',
            },
          ]}
        />
      </View>
      <Text style={[styles.sliderBound, { color: t.colors.textHint }]}>
        {formatMaxValue(min, max, formatValue)}
      </Text>
    </View>
  );
};

function formatMinValue(min: number, max: number, formatValue?: (v: number) => string): string {
  if (formatValue) return formatValue(min);
  if (min >= 1000) return `${(min / 1000).toFixed(1)}k`;
  return `${min}`;
}

function formatMaxValue(min: number, max: number, formatValue?: (v: number) => string): string {
  if (formatValue) return formatValue(max);
  if (max >= 1000) return `${(max / 1000).toFixed(1)}k`;
  return `${max}`;
}

// ========== Styles ==========

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 15,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  closeBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 14,
  },
  deleteBtn: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  deleteBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggle: {
    width: 40,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  typeScroll: {
    marginBottom: 4,
  },
  typeChip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    marginRight: 6,
  },
  typeChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sliderTrackContainer: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  sliderFill: {
    height: 4,
    borderRadius: 2,
  },
  sliderThumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    marginLeft: -9,
    top: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  sliderBound: {
    fontSize: 12,
    fontWeight: '500',
    width: 36,
    textAlign: 'center',
  },
  quickFreqRow: {
    marginTop: 6,
    marginBottom: 4,
  },
  quickFreqChip: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 4,
  },
  quickFreqText: {
    fontSize: 12,
  },
});
