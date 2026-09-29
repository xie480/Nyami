package com.bilimusic.audio

import kotlin.math.*
import kotlin.concurrent.Volatile

/**
 * FFT 实时频谱分析器。
 *
 * 将 PCM 变换为经 Hann 窗增益校正的一侧幅度谱，再对相邻 FFT bin 做 RMS 聚合。
 * 频谱使用固定 dBFS 区间和非线性曲线映射，避免参考电平随当前帧峰值变化。
 */
private object SpectrumVisualTuning {
    const val SENSITIVITY = 1.0f
    const val NOISE_FLOOR_DB = -78f
    const val MIN_DB = -84f
    const val MAX_DB = -6f
    const val GAMMA = 1.8f
    const val ATTACK = 0.55f
    const val RELEASE = 0.16f
    const val PEAK_LIMIT = 0.98f
}

private const val SPECTRUM_BIN_GROUP_SIZE = 4

class FFTAnalyzer(private val fftSize: Int = 1024) {

    private val window = hanningWindow(fftSize)
    private val oneSidedAmplitudeScale = 2f / window.sum().coerceAtLeast(1e-10f)
    private val rawBinCount = fftSize / 2
    private val displayBinCount =
        (rawBinCount + SPECTRUM_BIN_GROUP_SIZE - 1) / SPECTRUM_BIN_GROUP_SIZE
    private val noiseFloorAmplitude =
        10.0.pow(SpectrumVisualTuning.NOISE_FLOOR_DB.toDouble() / 20.0).toFloat()
    private var real = FloatArray(fftSize)
    private var imag = FloatArray(fftSize)

    // ====== 频谱输出 ======
    @Volatile
    var spectrum = FloatArray(displayBinCount)
        private set

    @Volatile
    var catEarLeft = FloatArray(16)
        private set

    @Volatile
    var catEarRight = FloatArray(16)
        private set

    // ====== 内部平滑状态 ======
    private var smoothedSpectrum = FloatArray(displayBinCount)

    // ====== 频段权重 ======
    // 轻微修正频段差异，避免原先对低频的强衰减掩盖鼓点和低音。
    private val bandWeights: FloatArray

    init {
        // 预计算频段权重（索引 0 ~ fftSize/2-1）。
        bandWeights = FloatArray(rawBinCount) { i ->
            val normIdx = i.toFloat() / (rawBinCount - 1f)
            when {
                normIdx < 0.06f -> 0.82f + normIdx / 0.06f * 0.10f
                normIdx < 0.15f -> 0.92f + (normIdx - 0.06f) / 0.09f * 0.06f
                normIdx < 0.25f -> 0.98f
                normIdx < 0.55f -> 0.96f
                normIdx < 0.75f -> 1.00f
                normIdx < 0.92f -> 1.02f
                else -> 1.02f - (normIdx - 0.92f) / 0.08f * 0.10f
            }
        }
    }

    /**
     * 处理 PCM Float 缓冲区并更新频谱
     *
     * @param pcmBuffer PCM Float32 音频数据
     * @param channels 声道数 (1=mono, 2=stereo)
     */
    fun analyze(pcmBuffer: FloatArray, channels: Int = 2) {
        // 将多声道混合为单声道，填充 FFT 缓冲区
        val step = if (channels >= 2) 2 else 1
        val len = min(pcmBuffer.size / step, fftSize)

        for (i in 0 until len) {
            real[i] = pcmBuffer[i * step] * window[i]
            imag[i] = 0f
        }

        // 剩余补零
        for (i in len until fftSize) {
            real[i] = 0f
            imag[i] = 0f
        }

        // 执行 FFT
        fft(real, imag)

        // Hann 窗会降低正弦幅度；除以窗函数幅度和可恢复一侧峰值幅度。
        // 然后在做 dB/曲线映射前，将相邻 bin 合成为 RMS 频段能量。
        val weightedMagnitudes = FloatArray(rawBinCount)
        for (i in 0 until rawBinCount) {
            val magnitude = hypot(real[i].toDouble(), imag[i].toDouble()).toFloat()
            weightedMagnitudes[i] = magnitude * oneSidedAmplitudeScale * bandWeights[i]
        }

        val newSpectrum = FloatArray(displayBinCount)
        for (band in 0 until displayBinCount) {
            val start = band * SPECTRUM_BIN_GROUP_SIZE
            val end = min(rawBinCount, start + SPECTRUM_BIN_GROUP_SIZE)
            var squaredEnergy = 0f
            var includedBinCount = 0
            for (bin in start until end) {
                // DC 不代表音乐频段，避免偏置或残余直流抬高第一根柱。
                if (bin > 0) {
                    val magnitude = weightedMagnitudes[bin]
                    squaredEnergy += magnitude * magnitude
                    includedBinCount += 1
                }
            }
            val rmsMagnitude = sqrt(squaredEnergy / includedBinCount.coerceAtLeast(1))
            newSpectrum[band] = mapMagnitudeToLevel(rmsMagnitude)
        }

        // 非对称 EMA：快速跟踪上升瞬态，下降时缓慢释放。
        for (i in smoothedSpectrum.indices) {
            val current = smoothedSpectrum[i]
            val target = newSpectrum[i]
            val factor = if (target > current) {
                SpectrumVisualTuning.ATTACK
            } else {
                SpectrumVisualTuning.RELEASE
            }
            smoothedSpectrum[i] = current + (target - current) * factor
        }

        spectrum = smoothedSpectrum.copyOf()

        // 生成猫耳频谱数据
        updateCatEarData(spectrum)
    }

    /**
     * 更新猫耳动态频谱数据
     *
     * 原理：
     * - 左耳 = 右声道高频 (频谱后半段)
     * - 右耳 = 左声道高频 (频谱后半段)
     * - 低频映射到底部，高频映射到耳尖
     */
    private fun updateCatEarData(monoSpectrum: FloatArray) {
        val earBins = 16
        val startBin = monoSpectrum.size / 3 // 从高频区开始
        val binStep = max(1, (monoSpectrum.size - startBin) / earBins)

        for (i in 0 until earBins) {
            val idx = startBin + i * binStep
            if (idx < monoSpectrum.size) {
                val value = monoSpectrum[idx].coerceIn(0f, 1f)
                catEarLeft[i] = value
                catEarRight[i] = value
            }
        }
    }

    private fun mapMagnitudeToLevel(magnitude: Float): Float {
        val adjustedMagnitude = magnitude * SpectrumVisualTuning.SENSITIVITY
        if (!adjustedMagnitude.isFinite() || adjustedMagnitude <= noiseFloorAmplitude) return 0f

        val signalMagnitude = adjustedMagnitude - noiseFloorAmplitude
        val signalDb = 20f * log10(signalMagnitude)
        val dbRange = (SpectrumVisualTuning.MAX_DB - SpectrumVisualTuning.MIN_DB).coerceAtLeast(1f)
        val normalized = ((signalDb - SpectrumVisualTuning.MIN_DB) / dbRange).coerceIn(0f, 1f)
        return normalized.pow(SpectrumVisualTuning.GAMMA).coerceAtMost(SpectrumVisualTuning.PEAK_LIMIT)
    }

    /**
     * 重置分析器状态
     */
    fun reset() {
        spectrum.fill(0f)
        smoothedSpectrum.fill(0f)
        catEarLeft.fill(0f)
        catEarRight.fill(0f)
    }

    // ======================
    // FFT Implementation
    // ======================

    /**
     * Cooley-Tukey Radix-2 蝶形 FFT (in-place)
     */
    private fun fft(real: FloatArray, imag: FloatArray) {
        val n = real.size
        require(n > 0 && (n and (n - 1)) == 0) { "FFT size must be power of 2" }

        // 位反转排序
        var j = 0
        for (i in 0 until n) {
            if (i < j) {
                val tr = real[j]; real[j] = real[i]; real[i] = tr
                val ti = imag[j]; imag[j] = imag[i]; imag[i] = ti
            }
            var m = n shr 1
            while (m > 0 && j >= m) {
                j -= m
                m = m shr 1
            }
            j += m
        }

        // 蝶形运算
        var step = 1
        while (step < n) {
            val halfStep = step
            step = step shl 1
            val wlen = (-2.0 * PI / step).toFloat()

            for (k in 0 until n step step) {
                var wr = 1f
                var wi = 0f

                for (m in 0 until halfStep) {
                    val j = k + m
                    val i2 = j + halfStep

                    val tr = wr * real[i2] - wi * imag[i2]
                    val ti = wr * imag[i2] + wi * real[i2]

                    real[i2] = real[j] - tr
                    imag[i2] = imag[j] - ti
                    real[j] += tr
                    imag[j] += ti

                    // 旋转因子更新
                    val angle = wlen * (m + 1)
                    wr = cos(angle)
                    wi = sin(angle)
                }
            }
        }
    }

    companion object {
        /**
         * Hanning 窗函数
         */
        fun hanningWindow(size: Int): FloatArray {
            val w = FloatArray(size)
            for (i in 0 until size) {
                w[i] = (0.5f * (1f - cos(2.0 * PI * i / (size - 1)))).toFloat()
            }
            return w
        }
    }
}
