package com.bilimusic.audio

import com.bilimusic.audio.filter.BiquadFilter
import com.bilimusic.audio.filter.RBJFilter
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * 基于 ExoPlayer/Media3 BaseAudioProcessor 模式的 DSP 引擎
 *
 * 音频链：
 * ExoPlayer → PCM Float Buffer → DSPAudioProcessor → FFT Analyzer → AudioTrack
 *
 * 注意：由于 react-native-track-player 封装了 ExoPlayer，
 * 在集成阶段需要通过自定义 AudioProcessor 注册到 TrackPlayer 的 MediaSource 中。
 * 当前实现提供完整的 DSP 逻辑，可通过 AudioDSPModule 桥接调用。
 */
class DSPAudioProcessor {

    companion object {
        @Volatile
        var instance: DSPAudioProcessor? = null

        @Volatile
        var processorAttached = false
            private set

        @Volatile
        var attachmentFailure: String? = "not-attached"
            private set

        /** 由 TrackPlayer 注入补丁在 AudioProcessor 成功挂载后调用。 */
        @JvmStatic
        fun markProcessorAttached() {
            processorAttached = true
            attachmentFailure = null
        }

        /** 记录反射注入失败原因，供设置页和日志诊断。 */
        @JvmStatic
        fun markProcessorAttachmentFailed(reason: String) {
            processorAttached = false
            attachmentFailure = reason.take(200)
        }
    }

    // 每个声道独立保存 IIR 历史；不能把交错立体声当作一条采样流。
    private var sampleRate = 44100
    private var channelCount = 2
    private val graphicGains = FloatArray(10)
    private data class PEQParameters(
        val type: Int = 0,
        val frequency: Float = 1000f,
        val gain: Float = 0f,
        val q: Float = 1f
    )
    private val peqParameters = Array(8) { PEQParameters() }
    private var graphicFilters = Array(channelCount) { Array(10) { BiquadFilter() } }
    private var peqFilters = Array(channelCount) { Array(8) { RBJFilter() } }

    // FFT 频谱分析器
    val fftAnalyzer = FFTAnalyzer(1024)

    // 频谱只在有前台消费者时计算；PCM 转换缓冲由音频处理线程复用。
    @Volatile
    private var spectrumAnalysisEnabled = false
    private var pcmFloatBuffer: FloatArray? = null
    private var pcmFloatOutputBuffer: ByteBuffer? = null

    @Volatile
    private var processedBlockCount = 0L

    @Volatile
    private var processedSampleCount = 0L

    @Volatile
    private var lastProcessedAtMs = 0L

    @Volatile
    private var lastProcessedSampleRate = sampleRate

    @Volatile
    private var lastProcessedChannelCount = channelCount

    // 配置锁，保证线程安全
    private val lock = ReentrantReadWriteLock()

    // EQ 状态
    @Volatile var enabled = true
        private set
    var mode: EQMode = EQMode.GRAPHIC
        private set

    // Graphic EQ 频段频率
    private val bandFrequencies = floatArrayOf(
        31f, 62f, 125f, 250f, 500f,
        1000f, 2000f, 4000f, 8000f, 16000f
    )

    // Limiter 参数
    private var limiterThreshold = 0.95f
    private var limiterEnabled = true

    // 响度匹配只做缓慢增益跟随，不压缩瞬态；默认关闭以保持原音行为。
    private var loudnessEnabled = false
    private var loudnessTargetDb = -18f
    private var loudnessRms = 0f
    private var loudnessGain = 1f

    enum class EQMode { GRAPHIC, PARAMETRIC }

    init {
        // 注册全局实例（供 ExoPlayer AudioProcessor 注入使用）
        instance = this

        updateFilterCoefficients()
    }

    // ====== 配置方法（从 JS 通过 Bridge 调用） ======

    /** 输入格式改变时重建各声道历史，保留用户参数并按实际采样率重算系数。 */
    fun configure(sampleRate: Int, channels: Int) {
        require(sampleRate > 0 && channels > 0)
        lock.write {
            if (this.sampleRate == sampleRate && channelCount == channels) return
            this.sampleRate = sampleRate
            channelCount = channels
            graphicFilters = Array(channels) { Array(10) { BiquadFilter() } }
            peqFilters = Array(channels) { Array(8) { RBJFilter() } }
            updateFilterCoefficients()
        }
    }

    private fun updateFilterCoefficients() {
        updateGraphicCoefficients()
        for (index in peqParameters.indices) updatePEQCoefficients(index)
    }

    private fun updateGraphicCoefficients() {
        for (channel in graphicFilters.indices) {
            for (index in graphicGains.indices) {
                graphicFilters[channel][index].sampleRate = sampleRate.toFloat()
                graphicFilters[channel][index].setPeak(
                    bandFrequencies[index].coerceAtMost(sampleRate * 0.49f),
                    graphicGains[index], 1f
                )
            }
        }
    }

    private fun updatePEQCoefficients(index: Int) {
        val params = peqParameters[index]
        for (filters in peqFilters) {
            filters[index].apply {
                this.sampleRate = this@DSPAudioProcessor.sampleRate.toFloat()
                type = RBJFilter.Type.values()[params.type]
                frequency = params.frequency.coerceIn(1f, sampleRate * 0.49f)
                gain = params.gain
                q = params.q
                calculateCoefficients()
            }
        }
    }

    fun setEnabled(enabled: Boolean) {
        lock.write {
            this.enabled = enabled
            if (!enabled) resetLoudnessState()
        }
    }

    fun setSpectrumEnabled(enabled: Boolean) {
        spectrumAnalysisEnabled = enabled
    }

    fun setMode(mode: EQMode) {
        lock.write { this.mode = mode }
    }

    /** 开关短期 RMS 响度匹配，关闭时立即恢复单位增益。 */
    fun setLoudnessEnabled(enabled: Boolean) {
        lock.write {
            loudnessEnabled = enabled
            if (!enabled) resetLoudnessState()
        }
    }

    /** 设置响度匹配目标，限制在保守的 -24~-12 dBFS RMS 范围。 */
    fun setLoudnessTargetDb(targetDb: Float) {
        lock.write {
            loudnessTargetDb = if (targetDb.isFinite()) {
                targetDb.coerceIn(-24f, -12f)
            } else {
                -18f
            }
        }
    }

    /** 在切换音轨时清理响度跟踪，避免上一首歌的增益残留。 */
    fun resetLoudness() {
        lock.write { resetLoudnessState() }
    }

    /**
     * 更新 Graphic EQ 10 个频段的增益
     *
     * @param gains 长度为 10 的 float 数组，范围 -12 ~ +12 dB
     */
    fun updateGraphicEQ(gains: FloatArray) {
        if (gains.size != 10) return
        lock.write {
            for (i in graphicGains.indices) graphicGains[i] = gains[i].coerceIn(-12f, 12f)
            updateGraphicCoefficients()
        }
    }

    /**
     * 更新 PEQ 单个滤波器的参数
     *
     * @param index 滤波器索引 (0-7)
     * @param type 滤波器类型 (0=Peak, 1=LowShelf, 2=HighShelf, 3=LowPass, 4=HighPass, 5=Notch, 6=BandPass)
     * @param frequency 频率 (Hz)
     * @param gain 增益 (dB)
     * @param q Q 值
     */
    fun updatePEQFilter(index: Int, type: Int, frequency: Float, gain: Float, q: Float) {
        if (index < 0 || index >= 8) return
        lock.write {
            peqParameters[index] = PEQParameters(
                type.coerceIn(0, 6), frequency, gain.coerceIn(-12f, 12f), q.coerceIn(0.1f, 20f)
            )
            updatePEQCoefficients(index)
        }
    }

    /**
     * 应用预设（快捷设置所有频段）
     */
    fun applyPreset(gains: FloatArray) {
        if (gains.size != 10) return
        updateGraphicEQ(gains)
    }

    // ====== 音频处理 ======

    /**
     * 处理 PCM Float 缓冲区
     *
     * 这是整个 DSP 链路的入口，在音频渲染线程调用。
     *
     * @param buffer PCM Float32 数据
     * @param channels 声道数
     * @return 处理后的缓冲区
     */
    fun process(buffer: FloatArray, channels: Int = 2, sampleCount: Int = buffer.size): FloatArray {
        require(sampleCount in 0..buffer.size && channels > 0)
        if (sampleCount == 0) return buffer
        processedBlockCount += 1
        processedSampleCount += sampleCount.toLong()
        lastProcessedAtMs = System.currentTimeMillis()
        lastProcessedSampleRate = sampleRate
        lastProcessedChannelCount = channels
        if (channelCount != channels) configure(sampleRate, channels)
        if (!enabled) {
            // EQ 关闭时保持音频直通；仅在界面有频谱消费者时继续分析。
            if (spectrumAnalysisEnabled) fftAnalyzer.analyze(buffer, channels, sampleCount)
            return buffer
        }

        lock.read {
            when (mode) {
                EQMode.GRAPHIC -> {
                    // 串联 10 个 Biquad 滤波器
                    for (channel in 0 until channels) {
                        for (filter in graphicFilters[channel]) {
                            var index = channel
                            while (index < sampleCount) {
                                buffer[index] = filter.process(buffer[index])
                                index += channels
                            }
                        }
                    }
                }
                EQMode.PARAMETRIC -> {
                    // 串联 8 个 RBJ 滤波器
                    for (channel in 0 until channels) {
                        for (filter in peqFilters[channel]) {
                            var index = channel
                            while (index < sampleCount) {
                                buffer[index] = filter.process(buffer[index])
                                index += channels
                            }
                        }
                    }
                }
            }

            if (loudnessEnabled) applyLoudnessGain(buffer, sampleCount)

            // 简易 Limiter（防止削波失真），只扫描本块有效样本。
            if (limiterEnabled) applyLimiter(buffer, sampleCount)
        }

        // FFT 分析用于频谱可视化
        if (spectrumAnalysisEnabled) fftAnalyzer.analyze(buffer, channels, sampleCount)

        return buffer
    }

    /**
     * 处理 ByteBuffer 格式的 PCM 数据 (Media3 AudioProcessor 格式)
     */
    fun processByteBuffer(inputBuffer: ByteBuffer, channels: Int): ByteBuffer {
        inputBuffer.order(ByteOrder.LITTLE_ENDIAN)
        val floatCount = inputBuffer.remaining() / 4
        if (floatCount == 0) return ByteBuffer.allocateDirect(0)

        var floatBuffer = pcmFloatBuffer
        if (floatBuffer == null || floatBuffer.size < floatCount) {
            floatBuffer = FloatArray(floatCount)
            pcmFloatBuffer = floatBuffer
        }

        // ByteBuffer → FloatArray
        inputBuffer.asFloatBuffer().get(floatBuffer, 0, floatCount)

        // DSP 处理
        process(floatBuffer, channels, floatCount)

        // FloatArray → ByteBuffer
        val outputByteCount = floatCount * 4
        val output = pcmFloatOutputBuffer?.takeIf {
            it.capacity() >= outputByteCount && !it.hasRemaining()
        } ?: ByteBuffer.allocateDirect(outputByteCount).also {
            pcmFloatOutputBuffer = it
        }
        output.order(ByteOrder.LITTLE_ENDIAN)
        output.clear()
        output.limit(outputByteCount)
        val outFloat = output.asFloatBuffer()
        outFloat.put(floatBuffer, 0, floatCount)
        output.position(0)

        return output
    }

    // ====== Limiter ======

    /** 根据短期 RMS 缓慢调整增益，避免切歌时仅因响度差异产生错觉。 */
    private fun applyLoudnessGain(buffer: FloatArray, sampleCount: Int) {
        var energy = 0.0
        for (index in 0 until sampleCount) {
            val sample = buffer[index].toDouble()
            energy += sample * sample
        }
        val blockRms = sqrt(energy / sampleCount).toFloat()
        if (!blockRms.isFinite() || blockRms < 1e-5f) return

        loudnessRms = if (loudnessRms > 0f) {
            loudnessRms * 0.995f + blockRms * 0.005f
        } else {
            blockRms
        }
        val targetRms = 10.0.pow(loudnessTargetDb.toDouble() / 20.0).toFloat()
        val desiredGain = (targetRms / loudnessRms.coerceAtLeast(1e-5f))
            .coerceIn(0.5f, 2f)
        val smoothing = if (desiredGain > loudnessGain) 0.01f else 0.002f
        loudnessGain += (desiredGain - loudnessGain) * smoothing
        for (index in 0 until sampleCount) {
            buffer[index] *= loudnessGain
        }
    }

    /** 清理响度跟踪状态，避免上一首歌曲的增益带入下一首。 */
    private fun resetLoudnessState() {
        loudnessRms = 0f
        loudnessGain = 1f
    }

    private fun applyLimiter(buffer: FloatArray, sampleCount: Int) {
        var peak = 0f
        for (i in 0 until sampleCount) {
            val abs = kotlin.math.abs(buffer[i])
            if (abs > peak) peak = abs
        }

        if (peak > limiterThreshold) {
            val gain = limiterThreshold / peak
            for (i in 0 until sampleCount) {
                buffer[i] *= gain
            }
        }
    }

    /**
     * 重置所有滤波器和 FFT 状态
     */
    fun reset() {
        lock.write {
            graphicGains.fill(0f)
            for (i in peqParameters.indices) peqParameters[i] = PEQParameters()
            loudnessEnabled = false
            loudnessTargetDb = -18f
            updateFilterCoefficients()
            for (filters in graphicFilters) for (filter in filters) filter.reset()
            for (filters in peqFilters) for (filter in filters) filter.reset()
            resetLoudnessState()
            fftAnalyzer.reset()
        }
    }

    /** 返回 DSP 注入和实际 PCM 处理状态，供诊断日志使用。 */
    fun getDiagnostics(): Diagnostics {
        return Diagnostics(
            processorAttached = processorAttached,
            attachmentFailure = attachmentFailure,
            processedBlockCount = processedBlockCount,
            processedSampleCount = processedSampleCount,
            lastProcessedAtMs = lastProcessedAtMs,
            sampleRate = lastProcessedSampleRate,
            channelCount = lastProcessedChannelCount,
            enabled = enabled,
        )
    }

    /** DSP 诊断快照，不携带音频内容。 */
    data class Diagnostics(
        val processorAttached: Boolean,
        val attachmentFailure: String?,
        val processedBlockCount: Long,
        val processedSampleCount: Long,
        val lastProcessedAtMs: Long,
        val sampleRate: Int,
        val channelCount: Int,
        val enabled: Boolean,
    )
}
