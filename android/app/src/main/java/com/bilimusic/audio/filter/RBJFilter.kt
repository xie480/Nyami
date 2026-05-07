package com.bilimusic.audio.filter

/**
 * RBJ Audio EQ Cookbook 滤波器 — 用于 PEQ (Parametric EQ)
 *
 * 支持以下滤波器类型：
 * - Peak (Peaking)
 * - LowShelf
 * - HighShelf
 * - LowPass
 * - HighPass
 * - Notch
 * - BandPass
 *
 * 参考：https://www.w3.org/2011/audio/audio-eq-cookbook.html
 */
class RBJFilter {

    enum class Type {
        Peak,
        LowShelf,
        HighShelf,
        LowPass,
        HighPass,
        Notch,
        BandPass
    }

    // 滤波器系数
    private var b0 = 0.0
    private var b1 = 0.0
    private var b2 = 0.0
    private var a0 = 0.0
    private var a1 = 0.0
    private var a2 = 0.0

    // 历史状态
    private var x1 = 0.0
    private var x2 = 0.0
    private var y1 = 0.0
    private var y2 = 0.0

    var sampleRate = 44100f
    var type = Type.Peak
    var frequency = 1000f
    var gain = 0f
    var q = 1.0f

    /**
     * 根据当前参数重新计算滤波器系数
     */
    fun calculateCoefficients() {
        val w0 = 2.0 * Math.PI * frequency / sampleRate
        val alpha = Math.sin(w0) / (2.0 * q)
        val cosW0 = Math.cos(w0)
        val A = Math.pow(10.0, (gain / 40.0))

        when (type) {
            Type.Peak -> {
                b0 = 1.0 + alpha * A
                b1 = -2.0 * cosW0
                b2 = 1.0 - alpha * A
                a0 = 1.0 + alpha / A
                a1 = -2.0 * cosW0
                a2 = 1.0 - alpha / A
            }
            Type.LowShelf -> {
                val sqrtA = Math.sqrt(A)
                val twoSqrtAAlpha = 2.0 * sqrtA * alpha

                b0 = A * ((A + 1.0) - (A - 1.0) * cosW0 + twoSqrtAAlpha)
                b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * cosW0)
                b2 = A * ((A + 1.0) - (A - 1.0) * cosW0 - twoSqrtAAlpha)
                a0 = (A + 1.0) + (A - 1.0) * cosW0 + twoSqrtAAlpha
                a1 = -2.0 * ((A - 1.0) + (A + 1.0) * cosW0)
                a2 = (A + 1.0) + (A - 1.0) * cosW0 - twoSqrtAAlpha
            }
            Type.HighShelf -> {
                val sqrtA = Math.sqrt(A)
                val twoSqrtAAlpha = 2.0 * sqrtA * alpha

                b0 = A * ((A + 1.0) + (A - 1.0) * cosW0 + twoSqrtAAlpha)
                b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cosW0)
                b2 = A * ((A + 1.0) + (A - 1.0) * cosW0 - twoSqrtAAlpha)
                a0 = (A + 1.0) - (A - 1.0) * cosW0 + twoSqrtAAlpha
                a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cosW0)
                a2 = (A + 1.0) - (A - 1.0) * cosW0 - twoSqrtAAlpha
            }
            Type.LowPass -> {
                b0 = (1.0 - cosW0) / 2.0
                b1 = 1.0 - cosW0
                b2 = (1.0 - cosW0) / 2.0
                a0 = 1.0 + alpha
                a1 = -2.0 * cosW0
                a2 = 1.0 - alpha
            }
            Type.HighPass -> {
                b0 = (1.0 + cosW0) / 2.0
                b1 = -(1.0 + cosW0)
                b2 = (1.0 + cosW0) / 2.0
                a0 = 1.0 + alpha
                a1 = -2.0 * cosW0
                a2 = 1.0 - alpha
            }
            Type.Notch -> {
                b0 = 1.0
                b1 = -2.0 * cosW0
                b2 = 1.0
                a0 = 1.0 + alpha
                a1 = -2.0 * cosW0
                a2 = 1.0 - alpha
            }
            Type.BandPass -> {
                b0 = alpha
                b1 = 0.0
                b2 = -alpha
                a0 = 1.0 + alpha
                a1 = -2.0 * cosW0
                a2 = 1.0 - alpha
            }
        }

        // 归一化 (除以 a0)
        b0 /= a0
        b1 /= a0
        b2 /= a0
        a1 /= a0
        a2 /= a0
    }

    /**
     * 处理单个 PCM Float 样本
     */
    fun process(sample: Float): Float {
        val output = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2

        x2 = x1
        x1 = sample.toDouble()
        y2 = y1
        y1 = output

        return output.toFloat()
    }

    /**
     * 处理 PCM Float 缓冲区
     */
    fun process(buffer: FloatArray) {
        for (i in buffer.indices) {
            buffer[i] = process(buffer[i])
        }
    }

    fun reset() {
        x1 = 0.0
        x2 = 0.0
        y1 = 0.0
        y2 = 0.0
    }
}
