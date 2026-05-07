/**
 * ParametricEQ - PEQ 参数均衡器交互曲线组件
 *
 * 功能：
 * - 显示频率响应曲线（x 轴：对数频率 20Hz~20kHz，y 轴：-12~+12dB）
 * - 可拖动节点：纵向拖动调整增益，横向拖动调整频率
 * - 点击节点打开编辑器
 * - 多滤波器叠加显示总响应曲线
 *
 * 使用 react-native-gesture-handler 的 PanResponder 实现拖动，
 * 无需额外 native 依赖。
 */
import React, { useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../../theme';
import { useEQStore, PEQFilter, FilterType } from '../../store/eqStore';

/** 曲线绘图区域尺寸 */
const GRAPH_WIDTH = Dimensions.get('window').width - 64; // 32px padding each side
const GRAPH_HEIGHT = 180;
const GRAPH_PAD = { top: 16, bottom: 16, left: 32, right: 16 };

/** 频率范围（对数刻度） */
const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const GAIN_MIN = -12;
const GAIN_MAX = 12;

/** 滤波器颜色映射 */
const FILTER_COLORS: Record<FilterType, string> = {
  Peak: '#00D2FF',
  LowShelf: '#6C5CE7',
  HighShelf: '#FD79A8',
  LowPass: '#00B894',
  HighPass: '#E17055',
  Notch: '#FDCB6E',
  BandPass: '#00CEC9',
};

/**
 * 频率 → x 坐标（对数映射）
 */
const freqToX = (freq: number): number => {
  const logMin = Math.log10(FREQ_MIN);
  const logMax = Math.log10(FREQ_MAX);
  const logFreq = Math.log10(Math.max(FREQ_MIN, Math.min(FREQ_MAX, freq)));
  const fraction = (logFreq - logMin) / (logMax - logMin);
  return GRAPH_PAD.left + fraction * (GRAPH_WIDTH - GRAPH_PAD.left - GRAPH_PAD.right);
};

/**
 * x 坐标 → 频率
 */
const xToFreq = (x: number): number => {
  const logMin = Math.log10(FREQ_MIN);
  const logMax = Math.log10(FREQ_MAX);
  const availWidth = GRAPH_WIDTH - GRAPH_PAD.left - GRAPH_PAD.right;
  const fraction = (x - GRAPH_PAD.left) / availWidth;
  const logFreq = logMin + fraction * (logMax - logMin);
  return Math.round(Math.pow(10, logFreq));
};

/**
 * 增益 → y 坐标（顶部 = +12dB）
 */
const gainToY = (gain: number): number => {
  const fraction = (gain - GAIN_MIN) / (GAIN_MAX - GAIN_MIN);
  return GRAPH_PAD.top + (1 - fraction) * (GRAPH_HEIGHT - GRAPH_PAD.top - GRAPH_PAD.bottom);
};

/**
 * y 坐标 → 增益
 */
const yToGain = (y: number): number => {
  const availHeight = GRAPH_HEIGHT - GRAPH_PAD.top - GRAPH_PAD.bottom;
  const fraction = 1 - (y - GRAPH_PAD.top) / availHeight;
  return Math.round((GAIN_MIN + fraction * (GAIN_MAX - GAIN_MIN)) * 2) / 2;
};

// ========== Props ==========

interface ParametricEQProps {
  filters: PEQFilter[];
  onSelectFilter: (id: number) => void;
  selectedFilterId: number | null;
}

// ========== Component ==========

export const ParametricEQ: React.FC<ParametricEQProps> = ({
  filters,
  onSelectFilter,
  selectedFilterId,
}) => {
  const t = useTheme();
  const updatePEQFilter = useEQStore(s => s.updatePEQFilter);

  /** 计算该频点下所有滤波器的复合增益 */
  const computeCombinedResponse = useCallback(
    (freq: number): number => {
      let totalGain = 0;
      for (const filter of filters) {
        if (!filter.enabled) continue;
        totalGain += filterResponseAt(filter, freq);
      }
      return Math.max(GAIN_MIN, Math.min(GAIN_MAX, totalGain));
    },
    [filters],
  );

  /** 预计算曲线点（100 个采样点） */
  const curvePoints = useMemo(() => {
    const points: Array<{ freq: number; x: number; y: number; gain: number }> = [];
    const SAMPLE_COUNT = 100;
    const logMin = Math.log10(FREQ_MIN);
    const logMax = Math.log10(FREQ_MAX);
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const freq = Math.pow(10, logMin + (i / (SAMPLE_COUNT - 1)) * (logMax - logMin));
      const gain = computeCombinedResponse(freq);
      points.push({
        freq: Math.round(freq),
        x: freqToX(freq),
        y: gainToY(gain),
        gain,
      });
    }
    return points;
  }, [computeCombinedResponse]);

  return (
    <View style={styles.container}>
      {/* dB 刻度标签（左侧） */}
      <View style={styles.scaleLabels} pointerEvents="none">
        <Text style={[styles.scaleLabel, { color: t.colors.textHint }]}>+12</Text>
        <Text style={[styles.scaleLabel, { color: t.colors.textHint }]}>0</Text>
        <Text style={[styles.scaleLabel, { color: t.colors.textHint }]}>-12</Text>
      </View>

      {/* 曲线绘图区域 */}
      <View style={[styles.graphArea, { backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 8 }]}>
        {/* 网格线 */}
        {[-6, 0, 6].map(dB => (
          <View
            key={`grid-${dB}`}
            style={[
              styles.gridLine,
              {
                top: gainToY(dB),
                backgroundColor: t.colors.divider,
              },
            ]}
          />
        ))}

        {/* 中轴线 (0dB) */}
        <View
          style={[
            styles.centerLine,
            {
              top: gainToY(0),
              backgroundColor: t.colors.primary + '40',
            },
          ]}
        />

        {/* 响应曲线 */}
        <View style={styles.curveContainer}>
          {curvePoints.map((pt, i) => {
            if (i === 0) return null;
            const prev = curvePoints[i - 1];
            return (
              <View
                key={`curve-${i}`}
                style={[
                  styles.curveSegment,
                  {
                    left: prev.x,
                    top: Math.min(prev.y, pt.y),
                    width: Math.max(1, pt.x - prev.x),
                    height: Math.abs(pt.y - prev.y) + 1,
                    backgroundColor: t.colors.primary,
                    opacity: 0.7,
                  },
                ]}
              />
            );
          })}
        </View>

        {/* 空状态提示 */}
        {filters.filter(f => f.enabled).length === 0 && (
          <View style={styles.emptyHint}>
            <Text style={[styles.emptyText, { color: t.colors.textHint }]}>
              启用滤波器以显示曲线
            </Text>
          </View>
        )}

        {/* 滤波器拖动节点 */}
        {filters
          .filter(f => f.enabled)
          .map(filter => (
            <DraggableNode
              key={filter.id}
              filter={filter}
              color={FILTER_COLORS[filter.type] ?? t.colors.primary}
              isSelected={selectedFilterId === filter.id}
              onDrag={(freq, gain) => {
                updatePEQFilter(filter.id, { frequency: freq, gain });
              }}
              onPress={() => onSelectFilter(filter.id)}
            />
          ))}
      </View>

      {/* 频率刻度标签 */}
      <View style={styles.freqLabels}>
        {[20, 100, 1000, 10000, 20000].map(freq => (
          <Text
            key={freq}
            style={[
              styles.freqLabel,
              { color: t.colors.textHint },
              { position: 'absolute', left: freqToX(freq) - 16 },
            ]}
          >
            {freq >= 1000 ? `${freq / 1000}k` : `${freq}`}
          </Text>
        ))}
      </View>
    </View>
  );
};

// ========== Draggable Node ==========

interface DraggableNodeProps {
  filter: PEQFilter;
  color: string;
  isSelected: boolean;
  onDrag: (freq: number, gain: number) => void;
  onPress: () => void;
}

const NODE_SIZE = 24;

const DraggableNode: React.FC<DraggableNodeProps> = ({
  filter,
  color,
  isSelected,
  onDrag,
  onPress,
}) => {
  const startPos = useRef({ x: 0, y: 0 });
  const currentX = useRef(freqToX(filter.frequency));
  const currentY = useRef(gainToY(filter.gain));

  // 同步 prop 变化
  currentX.current = freqToX(filter.frequency);
  currentY.current = gainToY(filter.gain);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startPos.current = { x: currentX.current, y: currentY.current };
      },
      onPanResponderMove: (_, gesture) => {
        const newX = startPos.current.x + gesture.dx;
        const newY = startPos.current.y + gesture.dy;
        // 边界限制
        const clampedX = Math.max(
          freqToX(FREQ_MIN),
          Math.min(freqToX(FREQ_MAX), newX),
        );
        const clampedY = Math.max(
          gainToY(GAIN_MAX),
          Math.min(gainToY(GAIN_MIN), newY),
        );
        currentX.current = clampedX;
        currentY.current = clampedY;
        const freq = xToFreq(clampedX);
        const gain = yToGain(clampedY);
        onDrag(freq, gain);
      },
      onPanResponderRelease: () => {
        onPress();
      },
    }),
  ).current;

  return (
    <View
      style={[
        styles.nodeContainer,
        {
          left: currentX.current - NODE_SIZE / 2,
          top: currentY.current - NODE_SIZE / 2,
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* 发光光环 */}
      <View
        style={[
          styles.nodeGlow,
          {
            backgroundColor: color + '30',
            borderColor: color,
            borderWidth: isSelected ? 3 : 2,
            opacity: isSelected ? 1 : 0.7,
          },
        ]}
      />
      {/* 节点核心 */}
      <View
        style={[
          styles.nodeCore,
          { backgroundColor: color },
        ]}
      />
    </View>
  );
};

// ========== Helper: 计算单个滤波器在给定频率的响应 ==========

/**
 * 计算 PEQ 滤波器在目标频率的近似增益响应（dB）
 *
 * 使用简化模型：
 * - Peak: 钟形曲线
 * - LowShelf: 低频搁架
 * - HighShelf: 高频搁架
 * - LowPass/HighPass: 渐变截断（简化）
 * - Notch: 反向钟形
 * - BandPass: 通带
 */
function filterResponseAt(filter: PEQFilter, freq: number): number {
  const { type, frequency: f0, gain, q } = filter;
  if (!filter.enabled || gain === 0) return 0;

  // 归一化频率比
  const ratio = freq / f0;
  const invRatio = f0 / freq;

  switch (type) {
    case 'Peak': {
      // 钟形响应：G * (f0/Q)² / sqrt((f² - f0²)² + (f*f0/Q)²) — 近似
      const A = Math.pow(10, gain / 40);
      const absGain = Math.abs(gain);
      const numerator = ratio * q;
      const denominator = Math.sqrt((ratio * ratio - 1) * (ratio * ratio - 1) + (ratio / q) * (ratio / q));
      const response = numerator / (denominator + 0.001);
      return gain * response;
    }
    case 'LowShelf': {
      // 简化搁架响应
      const shelf = 1 / Math.sqrt(1 + (ratio * ratio) / (q * q));
      return gain * Math.max(0, shelf);
    }
    case 'HighShelf': {
      const shelf = 1 / Math.sqrt(1 + (invRatio * invRatio) / (q * q));
      return gain * Math.max(0, shelf);
    }
    case 'LowPass': {
      // 一阶低通简化
      const lp = 1 / Math.sqrt(1 + ratio * ratio);
      return gain * lp;
    }
    case 'HighPass': {
      const hp = 1 / Math.sqrt(1 + invRatio * invRatio);
      return gain * hp;
    }
    case 'Notch': {
      // 反向钟形
      const A2 = Math.pow(10, Math.abs(gain) / 40);
      const notch = 1 - 1 / (1 + (ratio - 1 / ratio) * (ratio - 1 / ratio) * q * q);
      return -Math.abs(gain) * notch;
    }
    case 'BandPass': {
      const bp = 1 / Math.sqrt(1 + (ratio - 1 / ratio) * (ratio - 1 / ratio) * q * q);
      return gain * bp;
    }
    default:
      return 0;
  }
}

// ========== Styles ==========

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    marginVertical: 8,
  },
  scaleLabels: {
    position: 'absolute',
    left: 0,
    top: GRAPH_PAD.top - 6,
    bottom: GRAPH_PAD.bottom,
    width: 28,
    justifyContent: 'space-between',
    zIndex: 10,
  },
  scaleLabel: {
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'right',
  },
  graphArea: {
    width: GRAPH_WIDTH,
    height: GRAPH_HEIGHT,
    marginLeft: 32,
    position: 'relative',
    overflow: 'hidden',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    opacity: 0.3,
  },
  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1.5,
  },
  curveContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  curveSegment: {
    position: 'absolute',
    borderRadius: 1,
  },
  emptyHint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    fontWeight: '500',
  },
  freqLabels: {
    flexDirection: 'row',
    marginLeft: 32,
    marginTop: 4,
    height: 16,
    position: 'relative',
  },
  freqLabel: {
    fontSize: 8,
    fontWeight: '500',
    width: 32,
    textAlign: 'center',
  },
  // 可拖动节点
  nodeContainer: {
    position: 'absolute',
    width: NODE_SIZE,
    height: NODE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  nodeGlow: {
    position: 'absolute',
    width: NODE_SIZE + 8,
    height: NODE_SIZE + 8,
    borderRadius: (NODE_SIZE + 8) / 2,
  },
  nodeCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
