package com.bilimusic.audio.filter

/**
 * IIR Biquad 滤波器 — 用于 Graphic EQ 的每个频段
 *
 * 基于标准 Direct Form I 的 Biquad 实现：
 * y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
 *
 * 通过 `setPeak()` 配置中心频率、增益和 Q 值，
 * 可用于构建完整的 10-band Graphic EQ 滤波器组。
 */
class BiquadFilter {

    // 滤波器系数
    private var b0 = 0.0
    private var b1 = 0.0
    private var b2 = 0.0
    private var a1 = 0.0
    private var a2 = 0.0

    // 历史状态
    private var x1 = 0.0
    private var x2 = 0.0
    private var y1 = 0.0
    private var y2 = 0.0

    // 采样率
    var sampleRate = 44100f

    /**
     * 配置为 Peaking 滤波器（Graphic EQ 使用的类型）
     *
     * @param frequency 中心频率 (Hz)
     * @param gainDB 增益 (dB), -12 ~ +12
     * @param q Q 值 (带宽)
     */
    fun setPeak(frequency: Float, gainDB: Float, q: Float = 1.0f) {
        val w0 = 2.0 * Math.PI * frequency / sampleRate
        val alpha = Math.sin(w0) / (2.0 * q)
        val A = Math.pow(10.0, (gainDB / 40.0)) // 振幅增益

        val cosW0 = Math.cos(w0)

        // RBJ Peaking Filter 系数
        b0 = 1.0 + alpha * A
        b1 = -2.0 * cosW0
        b2 = 1.0 - alpha * A
        a1 = -2.0 * cosW0
        a2 = 1.0 - alpha / A

        // 归一化
        val norm = 1.0 + alpha / A
        b0 /= norm
        b1 /= norm
        b2 /= norm
        a1 /= norm
        a2 /= norm
    }

    /**
     * 处理单个 PCM Float 样本
     */
    fun process(sample: Float): Float {
        val output = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2

        // 移位历史状态
        x2 = x1
        x1 = sample.toDouble()
        y2 = y1
        y1 = output

        return output.toFloat()
    }

    /**
     * 处理 PCM Float 缓冲区（原地修改）
     */
    fun process(buffer: FloatArray) {
        for (i in buffer.indices) {
            buffer[i] = process(buffer[i])
        }
    }

    /**
     * 重置滤波器状态
     */
    fun reset() {
        x1 = 0.0
        x2 = 0.0
        y1 = 0.0
        y2 = 0.0
    }
}
