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
 * 纯 EQ 音色预设；不包含混响、声场拓宽、磁带噪声或降采样。
 * 通过主频段增强和掩蔽频段衰减区分风格，保留原音作为对比基准。
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
    description: '低频扎实，人声明亮',
    graphicBands: [4, 4, 2, -1, -2, 1, 3, 4, 2, 1],
  },

  {
    id: 'cat_bass',
    name: '低频',
    description: '柔弹下潜，不轰头',
    graphicBands: [6, 7, 4, -2, -3, -1, 0, 0, 1, 0],
  },

  {
    id: 'cyber_bass',
    name: '赛博震域',
    description: '超低频重击，鼓点突出',
    graphicBands: [9, 7, 3, -3, -4, -3, 0, 3, 4, 1],
  },

  // ===== Vocal =====
  {
    id: 'girl_band',
    name: '少女乐队',
    description: '女声前置，吉他明亮',
    graphicBands: [-4, -3, -2, -1, 1, 3, 6, 4, 1, 0],
  },

  {
    id: 'idol_stage',
    name: '偶像现场',
    description: '突出主唱与空气感',
    graphicBands: [-3, -2, -1, -2, -1, 2, 4, 3, 6, 5],
  },

  {
    id: 'whisper',
    name: '贴耳模式',
    description: '人声贴近，弱化两端',
    graphicBands: [-6, -5, -3, 0, 3, 6, 5, 1, -3, -5],
  },

  // ===== Atmosphere =====
  {
    id: 'midnight_radio',
    name: '深夜电台',
    description: '暖厚收敛，适合熄灯',
    graphicBands: [1, 3, 5, 4, 2, 0, -2, -4, -6, -7],
  },

  {
    id: 'tokyo_rain',
    name: '东京雨夜',
    description: '低频轻收，雨声清亮',
    graphicBands: [-3, -2, -1, -3, -2, -1, 0, 2, 5, 6],
  },

  {
    id: 'vaporwave',
    name: 'Vaporwave',
    description: '低频绵厚，高频朦胧',
    graphicBands: [5, 6, 3, 1, -2, -3, -4, -3, -5, -8],
  },

  {
    id: 'lofi_cafe',
    name: 'Lo-fi Café',
    description: '复古窄频，柔暗耐听',
    graphicBands: [-5, -3, 1, 4, 3, 1, -2, -5, -8, -10],
  },

  // ===== Electronic =====
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: '锐利未来电子',
    graphicBands: [-4, -2, 0, -2, -3, 0, 4, 7, 5, 2],
  },

  {
    id: 'neon_drive',
    name: '霓虹疾驰',
    description: '鼓点有力，合成器闪亮',
    graphicBands: [3, 6, 4, -2, -4, -2, 1, 4, 6, 3],
  },

  // ===== Live =====
  {
    id: 'live',
    name: 'Live现场',
    description: '鼓声有力，现场细节鲜明',
    graphicBands: [0, 3, 5, 1, -3, -1, 3, 5, 3, 1],
  },

  {
    id: 'hall',
    name: '星穹大厅',
    description: '弦乐舒展，高频开阔',
    graphicBands: [1, 0, -1, -3, -2, 0, 1, 1, 4, 6],
  },

  // ===== Fun =====
  {
    id: '8bit',
    name: '8-Bit猫机',
    description: '中频突出，复古掌机音色',
    graphicBands: [-10, -8, -5, -1, 4, 7, 5, 1, -5, -9],
  },

  {
    id: 'crystal',
    name: '水晶薄荷',
    description: '极致解析空气感',
    graphicBands: [-6, -5, -3, -2, -1, 0, 2, 5, 7, 7],
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
  /** 短期 RMS 响度匹配开关 */
  loudnessEnabled: boolean;
  /** 响度匹配目标 dBFS RMS */
  loudnessTargetDb: number;
  /** PEQ 编辑器中正在编辑的 filter id */
  editingFilterId: number | null;

  // Actions
  setMode: (mode: EQMode) => void;
  setEnabled: (enabled: boolean) => void;
  setLoudnessEnabled: (enabled: boolean) => void;
  setLoudnessTargetDb: (targetDb: number) => void;
  setGraphicBand: (index: number, value: number) => void;
  setGraphicBands: (bands: GraphicBands) => void;
  addFilter: () => void;
  removeFilter: (id: number) => void;
  updatePEQFilter: (id: number, params: Partial<PEQFilter>) => void;
  setEditingFilterId: (id: number | null) => void;
  applyPreset: (presetId: string) => void;
  resetToFlat: () => void;
}

const FILTER_TYPES: Record<FilterType, number> = {
  Peak: 0, LowShelf: 1, HighShelf: 2,
  LowPass: 3, HighPass: 4, Notch: 5, BandPass: 6,
};

/** 原生有 8 个连续槽位；禁用、删除的槽位必须显式恢复平直。 */
function syncPEQFilters(filters: PEQFilter[]) {
  for (let index = 0; index < 8; index++) {
    const filter = filters[index];
    const enabled = filter?.enabled;
    audioDSP.updatePEQFilter(
      index,
      enabled ? FILTER_TYPES[filter.type] : 0,
      enabled ? filter.frequency : 1000,
      enabled ? filter.gain : 0,
      enabled ? filter.q : 1,
    );
  }
}

function syncNativeState(state: EQState) {
  try {
    const rawTargetDb = Number(state.loudnessTargetDb);
    const loudnessTargetDb = Number.isFinite(rawTargetDb)
      ? Math.max(-24, Math.min(-12, rawTargetDb))
      : -18;
    audioDSP.updateGraphicEQ(state.graphicBands);
    syncPEQFilters(state.peqFilters);
    audioDSP.setMode(state.mode === 'graphic' ? 0 : 1);
    audioDSP.setEnabled(state.enabled);
    audioDSP.setLoudnessEnabled(state.loudnessEnabled === true);
    audioDSP.setLoudnessTargetDb(loudnessTargetDb);
  } catch {}
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
      loudnessEnabled: false,
      loudnessTargetDb: -18,
      editingFilterId: null,

      setMode: (mode) => {
        set({ mode });
        try { audioDSP.setMode(mode === 'graphic' ? 0 : 1); } catch {}
      },

      setEnabled: (enabled) => {
        set({ enabled });
        try { audioDSP.setEnabled(enabled); } catch {}
      },

      setLoudnessEnabled: (loudnessEnabled) => {
        set({ loudnessEnabled });
        try { audioDSP.setLoudnessEnabled(loudnessEnabled); } catch {}
      },

      setLoudnessTargetDb: (loudnessTargetDb) => {
        const target = Number.isFinite(loudnessTargetDb)
          ? Math.max(-24, Math.min(-12, loudnessTargetDb))
          : -18;
        set({ loudnessTargetDb: target });
        try { audioDSP.setLoudnessTargetDb(target); } catch {}
      },

      setGraphicBand: (index, value) => {
        const bands = [...get().graphicBands] as GraphicBands;
        bands[index] = Math.max(-12, Math.min(12, value));
        set({ graphicBands: bands, activePresetId: null });
        try { audioDSP.updateGraphicEQ(bands); } catch {}
      },

      setGraphicBands: (bands) => {
        set({ graphicBands: bands, activePresetId: null });
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
        try { syncPEQFilters(get().peqFilters); } catch {}
      },

      removeFilter: (id) => {
        const filters = get().peqFilters.filter(f => f.id !== id);
        set({ peqFilters: filters, activePresetId: null });
        try { syncPEQFilters(filters); } catch {}
      },

      updatePEQFilter: (id, params) => {
        const filters = get().peqFilters.map(f =>
          f.id === id ? { ...f, ...params } : f,
        );
        set({ peqFilters: filters, activePresetId: null });
        try { syncPEQFilters(filters); } catch {}
      },

      setEditingFilterId: (id) => set({ editingFilterId: id }),

      applyPreset: (presetId) => {
        const preset = EMOTION_PRESETS.find(p => p.id === presetId);
        if (!preset) return;

        const updates: Partial<EQState> = {
          activePresetId: presetId,
        };

        if (preset.graphicBands) {
          updates.mode = 'graphic';
          updates.graphicBands = [...preset.graphicBands] as GraphicBands;
        }

        if (preset.peqFilters) {
          updates.peqFilters = preset.peqFilters.map(f => ({ ...f }));
        }

        set(updates);

        // 同步到原生 DSP
        if (preset.graphicBands) {
          try {
            audioDSP.applyPreset(preset.graphicBands);
            audioDSP.setMode(0);
          } catch {}
        }
      },

      resetToFlat: () => {
        set({
          mode: 'graphic',
          graphicBands: [...FLAT_BANDS] as GraphicBands,
          activePresetId: 'flat',
          peqFilters: DEFAULT_PEQ_FILTERS_PRESET.map(f => ({ ...f })),
          loudnessEnabled: false,
          loudnessTargetDb: -18,
        });
        try {
          audioDSP.reset();
          audioDSP.setMode(0);
          audioDSP.setLoudnessEnabled(false);
          audioDSP.setLoudnessTargetDb(-18);
        } catch {}
      },
    }),
    {
      name: 'eqStore',
      storage: createJSONStorage(() => mmkvStorage),
      onRehydrateStorage: () => state => {
        // 恢复实际保存的曲线，不能仅恢复预设名称或用新版预设覆盖用户调节。
        if (state) {
          syncNativeState(state);
        }
      },
    },
  ),
);
