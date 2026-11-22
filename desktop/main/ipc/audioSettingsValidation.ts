import type {DesktopAudioSettings, DesktopPeqBand} from '../../shared/types';

const MIN_LOUDNESS_TARGET_DB = -24;
const MAX_LOUDNESS_TARGET_DB = -12;

/**
 * 校验音频设置补丁，阻止异常数组和滤波器参数进入主进程存储。
 * @param value 未知 IPC 参数
 * @returns 类型收窄后的音频设置补丁
 */
export function assertAudioSettingsPatch(
  value: unknown,
): asserts value is Partial<DesktopAudioSettings> {
  if (!isRecord(value)) {
    throw new Error('音频设置格式无效');
  }
  const allowedKeys = new Set([
    'enabled',
    'mode',
    'graphicPreset',
    'graphicGains',
    'peqBands',
    'limiterEnabled',
    'limiterThreshold',
    'loudnessEnabled',
    'loudnessTargetDb',
    'spectrumEnabled',
  ]);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw new Error('音频设置包含不支持的字段');
  }
  for (const key of [
    'enabled',
    'limiterEnabled',
    'loudnessEnabled',
    'spectrumEnabled',
  ]) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      throw new Error('音频开关参数无效');
    }
  }
  if (
    value.mode !== undefined &&
    !['graphic', 'parametric'].includes(String(value.mode))
  ) {
    throw new Error('EQ 模式无效');
  }
  if (
    value.graphicPreset !== undefined &&
    ![
      'flat',
      'nyami',
      'cat_bass',
      'girl_band',
      'idol_stage',
      'midnight_radio',
      'vaporwave',
      'custom',
    ].includes(String(value.graphicPreset))
  ) {
    throw new Error('Graphic EQ 预设无效');
  }
  if (value.graphicGains !== undefined) {
    if (
      !Array.isArray(value.graphicGains) ||
      value.graphicGains.length !== 10 ||
      value.graphicGains.some(
        gain =>
          typeof gain !== 'number' ||
          !Number.isFinite(gain) ||
          gain < -12 ||
          gain > 12,
      )
    ) {
      throw new Error('Graphic EQ 参数无效');
    }
  }
  if (value.peqBands !== undefined) {
    if (!Array.isArray(value.peqBands) || value.peqBands.length !== 8) {
      throw new Error('PEQ 参数数量无效');
    }
    value.peqBands.forEach(assertPeqBand);
  }
  if (
    value.limiterThreshold !== undefined &&
    (typeof value.limiterThreshold !== 'number' ||
      !Number.isFinite(value.limiterThreshold) ||
      value.limiterThreshold < 0.5 ||
      value.limiterThreshold > 1)
  ) {
    throw new Error('Limiter 阈值无效');
  }
  if (
    value.loudnessTargetDb !== undefined &&
    (typeof value.loudnessTargetDb !== 'number' ||
      !Number.isFinite(value.loudnessTargetDb) ||
      value.loudnessTargetDb < MIN_LOUDNESS_TARGET_DB ||
      value.loudnessTargetDb > MAX_LOUDNESS_TARGET_DB)
  ) {
    throw new Error('响度目标无效');
  }
}

/** 校验单个 PEQ 滤波器参数。 */
function assertPeqBand(value: unknown): asserts value is DesktopPeqBand {
  if (!isRecord(value)) {
    throw new Error('PEQ 滤波器格式无效');
  }
  const allowedKeys = new Set(['enabled', 'type', 'frequency', 'gain', 'q']);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw new Error('PEQ 滤波器包含不支持的字段');
  }
  if (typeof value.enabled !== 'boolean') {
    throw new Error('PEQ 开关参数无效');
  }
  if (
    typeof value.type !== 'string' ||
    ![
      'Peak',
      'LowShelf',
      'HighShelf',
      'LowPass',
      'HighPass',
      'Notch',
      'BandPass',
    ].includes(value.type)
  ) {
    throw new Error('PEQ 滤波器类型无效');
  }
  if (
    typeof value.frequency !== 'number' ||
    !Number.isFinite(value.frequency) ||
    value.frequency < 20 ||
    value.frequency > 20000
  ) {
    throw new Error('PEQ 频率无效');
  }
  if (
    typeof value.gain !== 'number' ||
    !Number.isFinite(value.gain) ||
    value.gain < -18 ||
    value.gain > 18
  ) {
    throw new Error('PEQ 增益无效');
  }
  if (
    typeof value.q !== 'number' ||
    !Number.isFinite(value.q) ||
    value.q < 0.1 ||
    value.q > 20
  ) {
    throw new Error('PEQ Q 值无效');
  }
}

/** 判断未知值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
