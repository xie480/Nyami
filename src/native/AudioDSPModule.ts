/**
 * AudioDSPModule TypeScript 桥接接口
 *
 * 通过 NativeModules 调用 Android 原生 DSP 引擎，
 * 通信协议与 android/app/.../module/AudioDSPModule.kt 一一对应。
 */
import { NativeModules } from 'react-native';

const { AudioDSPModule } = NativeModules;

export interface AudioDSPModuleInterface {
  /**
   * 更新 Graphic EQ 10 个频段的增益
   * @param bands 长度为 10 的数组，值范围 -12 ~ +12 dB
   */
  updateGraphicEQ(bands: number[]): void;

  /**
   * 更新 PEQ 单个滤波器参数
   * @param index 滤波器索引 (0-7)
   * @param type 滤波器类型 (0=Peak, 1=LowShelf, 2=HighShelf, 3=LowPass, 4=HighPass, 5=Notch, 6=BandPass)
   * @param frequency 频率 (Hz)
   * @param gain 增益 (dB)
   * @param q Q 值 (0.1-20)
   */
  updatePEQFilter(
    index: number,
    type: number,
    frequency: number,
    gain: number,
    q: number,
  ): void;

  /** EQ 总开关 */
  setEnabled(enabled: boolean): void;

  /** 切换 EQ 模式：0=Graphic, 1=PEQ */
  setMode(mode: number): void;

  /** 应用预设（快捷设置所有频段） */
  applyPreset(gains: number[]): void;
/** 重置所有 DSP 状态 */
reset(): void;

/**
 * 获取当前 FFT 频谱数据（供 SpectrumView 使用）
 * @returns Promise 包含 spectrum, catEarLeft, catEarRight
 */
getSpectrumData(): Promise<{
  spectrum: number[];
  catEarLeft: number[];
  catEarRight: number[];
}>;
}


/**
 * DSP 引擎实例
 *
 * 使用前需要确保原生模块已正确注册（通过 DSPPackage）。
 * 如果原生模块不可用（如 iOS 或未注册），则调用静默忽略。
 */
export const audioDSP: AudioDSPModuleInterface = AudioDSPModule ?? {
  updateGraphicEQ: () => {},
  updatePEQFilter: () => {},
  setEnabled: () => {},
  setMode: () => {},
  applyPreset: () => {},
  reset: () => {},
  getSpectrumData: async () => ({
    spectrum: [],
    catEarLeft: [],
    catEarRight: [],
  }),
};
