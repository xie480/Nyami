import type {DesktopAudioSettings} from '../../shared/types';
import {DEFAULT_DESKTOP_AUDIO_SETTINGS} from './eqPresets';

const WORKLET_PROCESSOR_NAME = 'nyami-dsp-processor';
const WORKLET_FFT_SIZE = 1024;
const WORKLET_DISPLAY_BIN_COUNT = 128;
const WORKLET_GROUP_SIZE = 4;
const WORKLET_UPDATE_INTERVAL_MS = 1000 / 30;

type SpectrumListener = (values: number[]) => void;

/**
 * 浏览器 AudioWorklet 的桌面 DSP 控制器。
 * 主线程只发送完整参数快照，滤波器状态和 FFT 热循环始终运行在音频线程。
 */
export class AudioEffectsController {
  private context: AudioContext | null = null;

  private source: MediaElementAudioSourceNode | null = null;

  private worklet: AudioWorkletNode | null = null;

  private setupPromise: Promise<void> | null = null;

  private settings: DesktopAudioSettings = cloneSettings(
    DEFAULT_DESKTOP_AUDIO_SETTINGS,
  );

  private readonly spectrumListeners = new Set<SpectrumListener>();

  private available = false;

  constructor(private readonly audio: HTMLAudioElement) {}

  /** 初始化 AudioContext、AudioWorklet 和媒体元素连接。 */
  async setup(): Promise<void> {
    if (!this.setupPromise) {
      this.setupPromise = this.initialize();
    }
    await this.setupPromise;
  }

  /** 返回是否已启用 AudioWorklet 处理链。 */
  isAvailable(): boolean {
    return this.available;
  }

  /** 更新 EQ、Limiter 和频谱参数，并同步到音频线程。 */
  setSettings(settings: DesktopAudioSettings): void {
    this.settings = cloneSettings(settings);
    this.postSettings();
  }

  /** 在用户点击播放后恢复被浏览器挂起的 AudioContext。 */
  async resume(): Promise<void> {
    await this.setup();
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
  }

  /** 订阅经 FFT 映射后的 128 段频谱数据。 */
  subscribeSpectrum(listener: SpectrumListener): () => void {
    this.spectrumListeners.add(listener);
    return () => this.spectrumListeners.delete(listener);
  }

  /** 释放 AudioWorklet、AudioContext 和频谱订阅。 */
  dispose(): void {
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.worklet = null;
    this.source = null;
    this.available = false;
    const context = this.context;
    this.context = null;
    this.spectrumListeners.clear();
    if (context) {
      void context.close().catch(() => undefined);
    }
  }

  /** 创建 AudioWorklet 模块并建立媒体元素到扬声器的处理链。 */
  private async initialize(): Promise<void> {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & {webkitAudioContext?: typeof AudioContext})
        .webkitAudioContext;
    if (!AudioContextConstructor) {
      return;
    }
    const context = new AudioContextConstructor();
    try {
      const moduleUrl = URL.createObjectURL(
        new Blob([WORKLET_SOURCE], {type: 'application/javascript'}),
      );
      try {
        await context.audioWorklet.addModule(moduleUrl);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      const source = context.createMediaElementSource(this.audio);
      const worklet = new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      worklet.port.onmessage = event => this.handleWorkletMessage(event.data);
      source.connect(worklet);
      worklet.connect(context.destination);
      this.context = context;
      this.source = source;
      this.worklet = worklet;
      this.available = true;
      this.postSettings();
    } catch (error) {
      context.close().catch(() => undefined);
      // 处理链不可用时保留 HTMLAudioElement 的直通播放，避免 EQ 失败阻断听歌。
      console.warn('Nyami AudioWorklet 不可用，已回退直通播放', error);
    }
  }

  /** 将主线程参数快照发送给 AudioWorklet。 */
  private postSettings(): void {
    if (!this.worklet) {
      return;
    }
    this.worklet.port.postMessage({
      type: 'settings',
      settings: cloneSettings(this.settings),
    });
  }

  /** 处理 AudioWorklet 发来的频谱事件。 */
  private handleWorkletMessage(data: unknown): void {
    if (!isSpectrumMessage(data)) {
      return;
    }
    const values = Array.from(data.values).map(value =>
      Math.min(1, Math.max(0, Number(value) || 0)),
    );
    this.spectrumListeners.forEach(listener => listener(values));
  }
}

/** 深拷贝传给音频线程的设置，避免 IPC/React 状态被异步修改。 */
function cloneSettings(settings: DesktopAudioSettings): DesktopAudioSettings {
  return {
    ...settings,
    graphicGains: [...settings.graphicGains],
    peqBands: settings.peqBands.map(band => ({...band})),
  };
}

/** 校验 Worklet 消息是否包含可转移的频谱数组。 */
function isSpectrumMessage(
  value: unknown,
): value is {type: 'spectrum'; values: Float32Array} {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as {type?: unknown; values?: unknown};
  return record.type === 'spectrum' && record.values instanceof Float32Array;
}

/**
 * AudioWorklet 模块源码。
 * 采用 RBJ Peaking 系数、双声道独立状态和 Android 端一致的 FFT 映射。
 */
const WORKLET_SOURCE = `
const GRAPHIC_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FFT_SIZE = ${WORKLET_FFT_SIZE};
const DISPLAY_BIN_COUNT = ${WORKLET_DISPLAY_BIN_COUNT};
const GROUP_SIZE = ${WORKLET_GROUP_SIZE};
const UPDATE_INTERVAL_MS = ${WORKLET_UPDATE_INTERVAL_MS};

class Biquad {
  constructor() {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }

  setFilter(type, frequency, gain, q, rate) {
    const safeFrequency = Math.min(Math.max(20, frequency), rate / 2 - 1);
    const angular = 2 * Math.PI * safeFrequency / rate;
    const quality = Math.max(0.1, q);
    const sine = Math.sin(angular);
    const cosine = Math.cos(angular);
    const alpha = sine / (2 * quality);
    const amplitude = Math.pow(10, gain / 40);
    const squareRootAmplitude = Math.sqrt(amplitude);
    const twoSquareRootAmplitudeAlpha = 2 * squareRootAmplitude * alpha;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;
    switch (type) {
      case 'LowShelf':
        b0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + twoSquareRootAmplitudeAlpha);
        b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine);
        b2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - twoSquareRootAmplitudeAlpha);
        a0 = (amplitude + 1) + (amplitude - 1) * cosine + twoSquareRootAmplitudeAlpha;
        a1 = -2 * ((amplitude - 1) + (amplitude + 1) * cosine);
        a2 = (amplitude + 1) + (amplitude - 1) * cosine - twoSquareRootAmplitudeAlpha;
        break;
      case 'HighShelf':
        b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + twoSquareRootAmplitudeAlpha);
        b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine);
        b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - twoSquareRootAmplitudeAlpha);
        a0 = (amplitude + 1) - (amplitude - 1) * cosine + twoSquareRootAmplitudeAlpha;
        a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cosine);
        a2 = (amplitude + 1) - (amplitude - 1) * cosine - twoSquareRootAmplitudeAlpha;
        break;
      case 'LowPass':
        b0 = (1 - cosine) / 2;
        b1 = 1 - cosine;
        b2 = (1 - cosine) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosine;
        a2 = 1 - alpha;
        break;
      case 'HighPass':
        b0 = (1 + cosine) / 2;
        b1 = -(1 + cosine);
        b2 = (1 + cosine) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosine;
        a2 = 1 - alpha;
        break;
      case 'Notch':
        b0 = 1;
        b1 = -2 * cosine;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cosine;
        a2 = 1 - alpha;
        break;
      case 'BandPass':
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cosine;
        a2 = 1 - alpha;
        break;
      case 'Peak':
      default:
        b0 = 1 + alpha * amplitude;
        b1 = -2 * cosine;
        b2 = 1 - alpha * amplitude;
        a0 = 1 + alpha / amplitude;
        a1 = -2 * cosine;
        a2 = 1 - alpha / amplitude;
        break;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  setPeaking(frequency, gain, q, rate) {
    this.setFilter('Peak', frequency, gain, q, rate);
  }

  process(sample) {
    const output = this.b0 * sample + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = sample;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }
}

function defaultSettings() {
  return {
    enabled: false,
    mode: 'graphic',
    graphicGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    peqBands: Array.from({length: 8}, () => ({enabled: false, type: 'Peak', frequency: 1000, gain: 0, q: 1})),
    limiterEnabled: true,
    limiterThreshold: 0.95,
    loudnessEnabled: false,
    loudnessTargetDb: -18,
    spectrumEnabled: true,
  };
}

class NyamiDspProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.settings = defaultSettings();
    this.graphicFilters = [];
    this.peqFilters = [];
    this.channelCount = 0;
    this.loudnessRms = 0;
    this.loudnessGain = 1;
    this.fftBuffer = new Float32Array(FFT_SIZE);
    this.fftOffset = 0;
    this.lastSpectrumAt = 0;
    this.fftReal = new Float64Array(FFT_SIZE);
    this.fftImaginary = new Float64Array(FFT_SIZE);
    this.port.onmessage = event => {
      if (event.data && event.data.type === 'settings') {
        this.settings = normalizeSettings(event.data.settings);
        this.configureFilters();
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output || output.length === 0) {
      return true;
    }
    this.ensureChannels(output.length);
    const frameCount = output[0].length;
    let blockEnergy = 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      let mono = 0;
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] || input[0];
        let sample = source && source[frame] ? source[frame] : 0;
        if (this.settings.enabled) {
          if (this.settings.mode === 'graphic') {
            for (const filter of this.graphicFilters[channel]) {
              sample = filter.process(sample);
            }
          } else {
            for (const filter of this.peqFilters[channel]) {
              sample = filter.process(sample);
            }
          }
        }
        output[channel][frame] = sample;
        blockEnergy += sample * sample;
        mono += sample;
      }
      if (this.settings.spectrumEnabled) {
        this.pushSpectrumSample(mono / output.length);
      }
    }

    if (this.settings.enabled && this.settings.loudnessEnabled) {
      this.updateLoudnessGain(
        Math.sqrt(blockEnergy / Math.max(1, frameCount * output.length)),
      );
      for (let channel = 0; channel < output.length; channel += 1) {
        for (let frame = 0; frame < frameCount; frame += 1) {
          output[channel][frame] *= this.loudnessGain;
        }
      }
    } else {
      this.resetLoudness();
    }

    // 先扫描整块峰值，再统一衰减，避免逐采样 tanh 改变低电平细节。
    if (this.settings.enabled && this.settings.limiterEnabled) {
      const threshold = Math.min(1, Math.max(0.5, this.settings.limiterThreshold));
      let peak = 0;
      for (let channel = 0; channel < output.length; channel += 1) {
        for (let frame = 0; frame < frameCount; frame += 1) {
          peak = Math.max(peak, Math.abs(output[channel][frame]));
        }
      }
      if (peak > threshold) {
        const gain = threshold / peak;
        for (let channel = 0; channel < output.length; channel += 1) {
          for (let frame = 0; frame < frameCount; frame += 1) {
            output[channel][frame] *= gain;
          }
        }
      }
    }

    // 输出端保留最后一道边界，避免禁用 Limiter 时向 AudioContext 写入非法幅度。
    for (let channel = 0; channel < output.length; channel += 1) {
      for (let frame = 0; frame < frameCount; frame += 1) {
        output[channel][frame] = Math.min(1, Math.max(-1, output[channel][frame]));
      }
    }
    return true;
  }

  ensureChannels(count) {
    if (this.channelCount === count) {
      return;
    }
    this.channelCount = count;
    this.configureFilters();
  }

  updateLoudnessGain(blockRms) {
    if (!Number.isFinite(blockRms) || blockRms < 1e-5) {
      return;
    }
    this.loudnessRms = this.loudnessRms > 0
      ? this.loudnessRms * 0.995 + blockRms * 0.005
      : blockRms;
    const target = Math.pow(10, this.settings.loudnessTargetDb / 20);
    const desired = Math.min(2, Math.max(0.5, target / Math.max(1e-5, this.loudnessRms)));
    const smoothing = desired > this.loudnessGain ? 0.01 : 0.002;
    this.loudnessGain += (desired - this.loudnessGain) * smoothing;
  }

  resetLoudness() {
    this.loudnessRms = 0;
    this.loudnessGain = 1;
  }

  configureFilters() {
    this.graphicFilters = Array.from({length: this.channelCount}, () =>
      GRAPHIC_FREQUENCIES.map((frequency, index) => {
        const filter = new Biquad();
        filter.setPeaking(frequency, Number(this.settings.graphicGains[index] || 0), 1, sampleRate);
        return filter;
      }),
    );
    this.peqFilters = Array.from({length: this.channelCount}, () =>
      this.settings.peqBands.map(band => {
        const filter = new Biquad();
        filter.setFilter(
          band.enabled ? band.type : 'Peak',
          Number(band.frequency || 1000),
          band.enabled ? Number(band.gain || 0) : 0,
          Number(band.q || 1),
          sampleRate,
        );
        return filter;
      }),
    );
  }

  pushSpectrumSample(sample) {
    if (this.fftOffset < FFT_SIZE) {
      const window = 0.5 * (1 - Math.cos(2 * Math.PI * this.fftOffset / (FFT_SIZE - 1)));
      this.fftBuffer[this.fftOffset] = sample * window;
      this.fftOffset += 1;
    }
    if (this.fftOffset < FFT_SIZE) {
      return;
    }
    this.fftOffset = 0;
    if (currentTime * 1000 - this.lastSpectrumAt < UPDATE_INTERVAL_MS) {
      return;
    }
    this.lastSpectrumAt = currentTime * 1000;
    const values = calculateSpectrum(this.fftBuffer, this.fftReal, this.fftImaginary);
    this.port.postMessage({type: 'spectrum', values}, [values.buffer]);
  }
}

function normalizeSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const gains = Array.isArray(source.graphicGains) ? source.graphicGains : [];
  const bands = Array.isArray(source.peqBands) ? source.peqBands : [];
  return {
    enabled: source.enabled === true,
    mode: source.mode === 'parametric' ? 'parametric' : 'graphic',
    graphicGains: Array.from({length: 10}, (_, index) => Number(gains[index] || 0)),
    peqBands: Array.from({length: 8}, (_, index) => {
      const band = bands[index] && typeof bands[index] === 'object' ? bands[index] : {};
      return {
        enabled: band.enabled === true,
        type: ['Peak', 'LowShelf', 'HighShelf', 'LowPass', 'HighPass', 'Notch', 'BandPass'].includes(band.type) ? band.type : 'Peak',
        frequency: Number(band.frequency || 1000),
        gain: Number(band.gain || 0),
        q: Number(band.q || 1),
      };
    }),
    limiterEnabled: source.limiterEnabled !== false,
    limiterThreshold: Number(source.limiterThreshold || 0.95),
    loudnessEnabled: source.loudnessEnabled === true,
    loudnessTargetDb: Math.min(-12, Math.max(-24, Number(source.loudnessTargetDb || -18))),
    spectrumEnabled: source.spectrumEnabled !== false,
  };
}

function calculateSpectrum(samples, real, imaginary) {
  real.fill(0);
  imaginary.fill(0);
  for (let index = 0; index < FFT_SIZE; index += 1) {
    real[index] = samples[index];
  }
  fftInPlace(real, imaginary);
  const output = new Float32Array(DISPLAY_BIN_COUNT);
  const windowSum = FFT_SIZE / 2;
  const rawBinCount = FFT_SIZE / 2;
  for (let group = 0; group < DISPLAY_BIN_COUNT; group += 1) {
    let energy = 0;
    let count = 0;
    for (let bin = group * GROUP_SIZE; bin < Math.min(rawBinCount, (group + 1) * GROUP_SIZE); bin += 1) {
      if (bin === 0) {
        continue;
      }
      const magnitude = Math.hypot(real[bin], imaginary[bin]) * 2 / windowSum;
      energy += magnitude * magnitude;
      count += 1;
    }
    const rms = Math.sqrt(energy / Math.max(1, count));
    const decibels = rms > 1e-8 ? 20 * Math.log10(rms) : -84;
    const normalized = Math.min(1, Math.max(0, (decibels + 84) / 78));
    output[group] = Math.pow(normalized, 1.8);
  }
  return output;
}

function fftInPlace(real, imaginary) {
  let reversed = 0;
  for (let index = 0; index < FFT_SIZE; index += 1) {
    if (index < reversed) {
      const realValue = real[index];
      real[index] = real[reversed];
      real[reversed] = realValue;
      const imaginaryValue = imaginary[index];
      imaginary[index] = imaginary[reversed];
      imaginary[reversed] = imaginaryValue;
    }
    let bit = FFT_SIZE >> 1;
    while (bit > 0 && reversed >= bit) {
      reversed -= bit;
      bit >>= 1;
    }
    reversed += bit;
  }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const halfSize = size >> 1;
    const angle = -2 * Math.PI / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let offset = 0; offset < halfSize; offset += 1) {
        const phase = angle * offset;
        const cosine = Math.cos(phase);
        const sine = Math.sin(phase);
        const left = start + offset;
        const right = left + halfSize;
        const transformedReal = cosine * real[right] - sine * imaginary[right];
        const transformedImaginary = cosine * imaginary[right] + sine * real[right];
        real[right] = real[left] - transformedReal;
        imaginary[right] = imaginary[left] - transformedImaginary;
        real[left] += transformedReal;
        imaginary[left] += transformedImaginary;
      }
    }
  }
}

registerProcessor('${WORKLET_PROCESSOR_NAME}', NyamiDspProcessor);
`;
