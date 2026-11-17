/**
 * Windows 端 FFT 常量和参考向量。
 * 这些向量与 Android FFTAnalyzer 使用 1024 点、48 kHz/44.1 kHz 的校验频点对应。
 */
export const DESKTOP_FFT_SIZE = 1024;
export const DESKTOP_FFT_DISPLAY_BIN_COUNT = 128;
export const DESKTOP_FFT_GROUP_SIZE = 4;

export const DESKTOP_FFT_TEST_VECTORS = [
  {
    sampleRate: 44100,
    frequency: 1000,
    expectedBin: 23,
    tolerance: 1,
  },
  {
    sampleRate: 48000,
    frequency: 8000,
    expectedBin: 171,
    tolerance: 1,
  },
] as const;

/**
 * 计算一帧单声道 PCM 的归一化频谱。
 * @param samples 输入 Float32 PCM，长度不足时自动补零
 * @param fftSize FFT 点数，必须是 2 的整数次幂
 * @returns 128 个 0 到 1 的显示频段
 */
export function calculateFftSpectrum(
  samples: Float32Array,
  fftSize = DESKTOP_FFT_SIZE,
): number[] {
  if (fftSize <= 0 || (fftSize & (fftSize - 1)) !== 0) {
    throw new Error('FFT 点数必须是 2 的整数次幂');
  }
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  let windowSum = 0;
  for (let index = 0; index < fftSize; index += 1) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (fftSize - 1)));
    real[index] = (samples[index] ?? 0) * window;
    windowSum += window;
  }
  fftInPlace(real, imaginary);
  const rawBinCount = Math.floor(fftSize / 2);
  const groupSize = DESKTOP_FFT_GROUP_SIZE;
  const output: number[] = [];
  const amplitudeScale = 2 / Math.max(windowSum, 1e-10);
  for (
    let group = 0;
    group < Math.ceil(rawBinCount / groupSize);
    group += 1
  ) {
    let energy = 0;
    let count = 0;
    for (
      let bin = group * groupSize;
      bin < Math.min(rawBinCount, (group + 1) * groupSize);
      bin += 1
    ) {
      if (bin === 0) {
        continue;
      }
      const magnitude =
        Math.hypot(real[bin], imaginary[bin]) * amplitudeScale;
      energy += magnitude * magnitude;
      count += 1;
    }
    const rms = Math.sqrt(energy / Math.max(count, 1));
    const decibels = rms > 1e-8 ? 20 * Math.log10(rms) : -84;
    const normalized = Math.min(1, Math.max(0, (decibels + 84) / 78));
    output.push(normalized ** 1.8);
  }
  return output;
}

/** 执行原地 Radix-2 FFT，和 Android FFTAnalyzer 的实现保持同一计算顺序。 */
function fftInPlace(real: Float64Array, imaginary: Float64Array): void {
  let reversed = 0;
  for (let index = 0; index < real.length; index += 1) {
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [
        imaginary[reversed],
        imaginary[index],
      ];
    }
    let bit = real.length >> 1;
    while (bit > 0 && reversed >= bit) {
      reversed -= bit;
      bit >>= 1;
    }
    reversed += bit;
  }
  for (let size = 2; size <= real.length; size <<= 1) {
    const halfSize = size >> 1;
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < real.length; start += size) {
      for (let offset = 0; offset < halfSize; offset += 1) {
        const phase = angle * offset;
        const cosine = Math.cos(phase);
        const sine = Math.sin(phase);
        const left = start + offset;
        const right = left + halfSize;
        const transformedReal =
          cosine * real[right] - sine * imaginary[right];
        const transformedImaginary =
          cosine * imaginary[right] + sine * real[right];
        real[right] = real[left] - transformedReal;
        imaginary[right] = imaginary[left] - transformedImaginary;
        real[left] += transformedReal;
        imaginary[left] += transformedImaginary;
      }
    }
  }
}
