package com.bilimusic.audio

import kotlin.math.*
import kotlin.concurrent.Volatile

/**
 * FFT 实时频谱分析器
 *
 * 使用 Cooley-Tukey Radix-2 FFT 算法对 PCM Float 缓冲区的
 * 时域信号进行频域变换，输出频段的幅度谱用于可视化渲染。
 *
 * 说明：当前嵌入 Kotlin 纯实现以避免额外依赖。
 * 生产环境可替换为 JTransforms 或 KissFFT。
 */
class FFTAnalyzer(private val fftSize: Int = 1024) {

    private val window = hanningWindow(fftSize)
    private var real = FloatArray(fftSize)
    private var imag = FloatArray(fftSize)

    // 频谱输出 (频域幅度)
    @Volatile
    var spectrum = FloatArray(fftSize / 2)
        private set

    // 猫耳频谱 (左/右声道高频映射)
    @Volatile
    var catEarLeft = FloatArray(16)
        private set

    @Volatile
    var catEarRight = FloatArray(16)
        private set

    // 平滑后的频谱（用于视觉去抖）
    private var smoothedSpectrum = FloatArray(fftSize / 2)
    private var smoothingFactor = 0.35f

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

        // 计算幅度谱 (取前一半)
        val newSpectrum = FloatArray(fftSize / 2)
        for (i in 0 until fftSize / 2) {
            val magnitude = sqrt(real[i] * real[i] + imag[i] * imag[i].toDouble()).toFloat()
            // dB 标度，归一化
            newSpectrum[i] = if (magnitude > 0) {
                (20f * log10(magnitude + 1e-10f) + 80f) / 80f
            } else {
                0f
            }
        }

        // 平滑处理（指数移动平均）
        for (i in smoothedSpectrum.indices) {
            smoothedSpectrum[i] = smoothedSpectrum[i] * smoothingFactor +
                    newSpectrum[i] * (1f - smoothingFactor)
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
                // 左耳/右耳使用相同的频谱数据（单声道情况）
                // 立体声时可分别取左右声道
                val value = monoSpectrum[idx].coerceIn(0f, 1f)
                catEarLeft[i] = value
                catEarRight[i] = value
            }
        }
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
