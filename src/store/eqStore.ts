import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { storage } from '../core/storage';
import { audioDSP } from '../native/AudioDSPModule';

// 与 settingsStore 保持一致的 MMKV 同步存储适配器
const mmkvStorage: StateStorage = {
  getItem: (name: string) => storage.getString(name) ?? null,
  setItem: (name: string, value: string) => storage.setString(name, value),
  removeItem: (name: string) => storage.delete(name),
};

// ========== Types ==========

/** 10-band Graphic EQ 频段增益（dB） */
export type GraphicBands = [
  number, number, number, number, number,
  number, number, number, number, number,
];

/** 滤波器类型 */
export type FilterType =
  | 'Peak'
  | 'LowShelf'
  | 'HighShelf'
  | 'LowPass'
  | 'HighPass'
  | 'Notch'
  | 'BandPass';

/** PEQ 单个滤波器参数 */
export interface PEQFilter {
  id: number;
  type: FilterType;
  frequency: number;   // Hz
  gain: number;        // dB
  q: number;           // Q 值（带宽）
  enabled: boolean;
}

/** EQ 工作模式 */
export type EQMode = 'graphic' | 'parametric';

/** 情绪化预设 */
export interface EQPreset {
  id: string;
  name: string;
  description: string;
  /** Graphic EQ 模式下 10 个频段的增益值 */
  graphicBands?: GraphicBands;
  /** PEQ 模式下 8 个滤波器的参数 */
  peqFilters?: PEQFilter[];
}

// ========== Constants ==========

/** 10-band 标准频段标签 */
export const BAND_FREQUENCIES: string[] = [
  '31', '62', '125', '250', '500',
  '1k', '2k', '4k', '8k', '16k',
];

/** 默认 Graphic EQ 频段（平直曲线，所有频段 0dB） */
const FLAT_BANDS: GraphicBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** 8 个默认 PEQ Filter（平直） */
const DEFAULT_PEQ_FILTERS: PEQFilter[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  type: 'Peak' as FilterType,
  frequency: 1000,
  gain: 0,
  q: 1.0,
  enabled: false,
}));

/** 默认 PEQ：给每个滤波器一个不同的默认频率 */
const DEFAULT_PEQ_FILTERS_PRESET: PEQFilter[] = [
  { id: 1, type: 'Peak', frequency: 31,   gain: 0, q: 1.0, enabled: false },
  { id: 2, type: 'Peak', frequency: 62,   gain: 0, q: 1.0, enabled: false },
  { id: 3, type: 'Peak', frequency: 125,  gain: 0, q: 1.0, enabled: false },
  { id: 4, type: 'Peak', frequency: 250,  gain: 0, q: 1.0, enabled: false },
  { id: 5, type: 'Peak', frequency: 500,  gain: 0, q: 1.0, enabled: false },
  { id: 6, type: 'Peak', frequency: 1000, gain: 0, q: 1.0, enabled: false },
  { id: 7, type: 'Peak', frequency: 2000, gain: 0, q: 1.0, enabled: false },
  { id: 8, type: 'Peak', frequency: 4000, gain: 0, q: 1.0, enabled: false },
];

/**
 * 「情绪化预设」系统
 * 每个预设包含 Graphic EQ 的 10-band 增益和推荐 PEQ 参数
 */
export const EMOTION_PRESETS: EQPreset[] = [
  {
    id: 'flat',
    name: '原音',
    description: '忠实还原，不染色',
    graphicBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },

  // ===== Nyami Signature =====
  {
    id: 'nyami',
    name: 'Nyami',
    description: '哈基咪亲自调音，通吃',
    graphicBands: [2, 2, 1, 0, 0, 1, 2, 2, 1, 0],
  },

  {
    id: 'cat_bass',
    name: '低频',
    description: '柔弹下潜，不轰头',
    graphicBands: [5, 4, 3, 1, 0, -1, -1, 0, 1, 1],
  },

  {
    id: 'cyber_bass',
    name: '赛博震域',
    description: '电子/EDM/Sub Bass',
    graphicBands: [7, 5, 3, 1, -1, -2, 0, 2, 3, 2],
  },

  // ===== Vocal =====
  {
    id: 'girl_band',
    name: '少女乐队',
    description: '女声贴耳，明亮通透',
    graphicBands: [-1, 0, 0, 1, 2, 3, 4, 3, 2, 1],
  },

  {
    id: 'idol_stage',
    name: '偶像现场',
    description: '突出主唱与空气感',
    graphicBands: [-1, -1, 0, 1, 2, 3, 3, 4, 4, 2],
  },

  {
    id: 'whisper',
    name: '贴耳模式',
    description: '近距离',
    graphicBands: [-2, -2, -1, 0, 2, 4, 5, 4, 2, 1],
  },

  // ===== Atmosphere =====
  {
    id: 'midnight_radio',
    name: '深夜电台',
    description: '暖厚收敛，适合熄灯',
    graphicBands: [3, 2, 2, 1, 0, -1, -2, -3, -3, -4],
  },

  {
    id: 'tokyo_rain',
    name: '东京雨夜',
    description: '湿润空气感',
    graphicBands: [1, 1, 0, -1, -1, 0, 1, 2, 3, 2],
  },

  {
    id: 'vaporwave',
    name: 'Vaporwave',
    description: '朦胧复古磁带',
    graphicBands: [4, 3, 2, 1, 0, -1, -2, -1, 0, -1],
  },

  {
    id: 'lofi_cafe',
    name: 'Lo-fi Café',
    description: '旧磁带颗粒感',
    graphicBands: [2, 2, 1, 0, -1, -1, -2, -2, -3, -4],
  },

  // ===== Electronic =====
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: '锐利未来电子',
    graphicBands: [-2, -1, 0, 1, 1, 2, 3, 4, 5, 4],
  },

  {
    id: 'neon_drive',
    name: '霓虹疾驰',
    description: 'Synthwave 速度感',
    graphicBands: [3, 2, 1, 0, -1, 0, 2, 4, 5, 3],
  },

  // ===== Live =====
  {
    id: 'live',
    name: 'Live现场',
    description: '空间拓宽',
    graphicBands: [1, 1, 0, 0, 0, 1, 2, 3, 3, 2],
  },

  {
    id: 'hall',
    name: '星穹大厅',
    description: '古典厅堂空间感',
    graphicBands: [2, 1, 0, -1, -1, 0, 1, 2, 2, 3],
  },

  // ===== Fun =====
  {
    id: '8bit',
    name: '8-Bit猫机',
    description: '像素复古',
    graphicBands: [-5, -4, -2, 0, 2, 4, 5, 4, 2, -1],
  },

  {
    id: 'crystal',
    name: '水晶薄荷',
    description: '极致解析空气感',
    graphicBands: [-2, -2, -1, 0, 0, 1, 3, 5, 5, 4],
  },
];

// ========== Store Interface ==========

interface EQState {
  /** 当前 EQ 模式 */
  mode: EQMode;
  /** Graphic EQ 10 个频段的增益值 */
  graphicBands: GraphicBands;
  /** PEQ 8 个滤波器的参数 */
  peqFilters: PEQFilter[];
  /** 当前选中的预设 ID（null 表示手动调节） */
  activePresetId: string | null;
  /** EQ 总开关 */
  enabled: boolean;
  /** PEQ 编辑器中正在编辑的 filter id */
  editingFilterId: number | null;

  // Actions
  setMode: (mode: EQMode) => void;
  setEnabled: (enabled: boolean) => void;
  setGraphicBand: (index: number, value: number) => void;
  setGraphicBands: (bands: GraphicBands) => void;
  addFilter: () => void;
  removeFilter: (id: number) => void;
  updatePEQFilter: (id: number, params: Partial<PEQFilter>) => void;
  setEditingFilterId: (id: number | null) => void;
  applyPreset: (presetId: string) => void;
  resetToFlat: () => void;
}

// ========== Store ==========

export const useEQStore = create<EQState>()(
  persist(
    (set, get) => ({
      mode: 'graphic',
      graphicBands: [...FLAT_BANDS] as GraphicBands,
      peqFilters: DEFAULT_PEQ_FILTERS_PRESET.map(f => ({ ...f })),
      activePresetId: 'flat',
      enabled: true,
      editingFilterId: null,

      setMode: (mode) => {
        set({ mode });
        try { audioDSP.setMode(mode === 'graphic' ? 0 : 1); } catch {}
      },

      setEnabled: (enabled) => {
        set({ enabled });
        try { audioDSP.setEnabled(enabled); } catch {}
      },

      setGraphicBand: (index, value) => {
        const bands = [...get().graphicBands] as GraphicBands;
        bands[index] = Math.max(-12, Math.min(12, value));
        set({ graphicBands: bands, activePresetId: null });
        try { audioDSP.updateGraphicEQ(bands); } catch {}
      },

      setGraphicBands: (bands) => {
        set({ graphicBands: bands });
        try { audioDSP.updateGraphicEQ(bands); } catch {}
      },

      addFilter: () => {
        const filters = get().peqFilters;
        const maxId = filters.reduce((max, f) => Math.max(max, f.id), 0);
        const newFilter: PEQFilter = {
          id: maxId + 1,
          type: 'Peak',
          frequency: 1000,
          gain: 0,
          q: 1.0,
          enabled: true,
        };
        set({ peqFilters: [...filters, newFilter], activePresetId: null });
      },

      removeFilter: (id) => {
        const filters = get().peqFilters.filter(f => f.id !== id);
        set({ peqFilters: filters, activePresetId: null });
      },

      updatePEQFilter: (id, params) => {
        const filters = get().peqFilters.map(f =>
          f.id === id ? { ...f, ...params } : f,
        );
        set({ peqFilters: filters, activePresetId: null });
        // 同步到原生 DSP
        const filter = filters.find(f => f.id === id);
        if (filter && filter.enabled) {
          const typeMap: Record<string, number> = {
            Peak: 0, LowShelf: 1, HighShelf: 2,
            LowPass: 3, HighPass: 4, Notch: 5, BandPass: 6,
          };
          try {
            audioDSP.updatePEQFilter(
              filter.id - 1,
              typeMap[filter.type] ?? 0,
              filter.frequency,
              filter.gain,
              filter.q,
            );
          } catch {}
        }
      },

      setEditingFilterId: (id) => set({ editingFilterId: id }),

      applyPreset: (presetId) => {
        const preset = EMOTION_PRESETS.find(p => p.id === presetId);
        if (!preset) return;

        const updates: Partial<EQState> = {
          activePresetId: presetId,
        };

        if (preset.graphicBands) {
          updates.graphicBands = [...preset.graphicBands] as GraphicBands;
        }

        if (preset.peqFilters) {
          updates.peqFilters = preset.peqFilters.map(f => ({ ...f }));
        }

        set(updates);

        // 同步到原生 DSP
        if (preset.graphicBands) {
          try { audioDSP.applyPreset(preset.graphicBands); } catch {}
        }
      },

      resetToFlat: () => {
        set({
          graphicBands: [...FLAT_BANDS] as GraphicBands,
          activePresetId: 'flat',
          peqFilters: DEFAULT_PEQ_FILTERS_PRESET.map(f => ({ ...f })),
        });
        try { audioDSP.reset(); } catch {}
      },
    }),
    {
      name: 'eqStore',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
