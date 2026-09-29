package com.bilimusic.module

import android.util.Log
import com.bilimusic.audio.DSPAudioProcessor
import com.facebook.react.bridge.*
import kotlin.math.sqrt

/**
 * React Native Bridge 模块 — 音频 DSP 控制接口
 *
 * 暴露给 JavaScript 层的方法：
 * - updateGraphicEQ(bands: number[])
 * - updatePEQFilter(index: number, type: number, freq: number, gain: number, q: number)
 * - setEnabled(enabled: boolean)
 * - setMode(mode: number)
 * - applyPreset(gains: number[])
 * - reset()
 */
class AudioDSPModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "AudioDSPModule"
        private const val TAG = "AudioDSP"
    }

    // DSP 引擎单例
    private val dspProcessor = DSPAudioProcessor()

    override fun getName(): String = NAME

    @ReactMethod
    fun updateGraphicEQ(bands: ReadableArray) {
        if (bands.size() != 10) {
            Log.w(TAG, "updateGraphicEQ: expected 10 bands, got ${bands.size()}")
            return
        }
        val gains = FloatArray(10) { i -> bands.getDouble(i).toFloat() }
        dspProcessor.updateGraphicEQ(gains)
        Log.d(TAG, "Graphic EQ updated: ${gains.contentToString()}")
    }

    @ReactMethod
    fun updatePEQFilter(index: Int, type: Int, frequency: Double, gain: Double, q: Double) {
        dspProcessor.updatePEQFilter(index, type, frequency.toFloat(), gain.toFloat(), q.toFloat())
        Log.d(TAG, "PEQ Filter #$index updated: type=$type freq=$frequency gain=$gain q=$q")
    }

    @ReactMethod
    fun setEnabled(enabled: Boolean) {
        dspProcessor.setEnabled(enabled)
        Log.d(TAG, "EQ enabled: $enabled")
    }

    @ReactMethod
    fun setMode(mode: Int) {
        val eqMode = if (mode == 0) DSPAudioProcessor.EQMode.GRAPHIC else DSPAudioProcessor.EQMode.PARAMETRIC
        dspProcessor.setMode(eqMode)
        Log.d(TAG, "EQ mode: $eqMode")
    }

    @ReactMethod
    fun applyPreset(gains: ReadableArray) {
        if (gains.size() != 10) return
        val g = FloatArray(10) { i -> gains.getDouble(i).toFloat() }
        dspProcessor.applyPreset(g)
        Log.d(TAG, "Preset applied")
    }

    @ReactMethod
    fun reset() {
        dspProcessor.reset()
        Log.d(TAG, "DSP reset")
    }

    /**
     * 获取当前 FFT 频谱数据（供 SpectrumView 可视化使用）
     *
     * @param promise 返回包含频谱数据的 WritableMap
     *   - spectrum: normalized RMS frequency bands (maximum 128 values, 0..1)
     *   - catEarLeft: FloatArray (16)
     *   - catEarRight: FloatArray (16)
     */
    @ReactMethod
    fun getSpectrumData(promise: Promise) {
        try {
            val analyzer = dspProcessor.fftAnalyzer
            val map = Arguments.createMap()

            // 频谱数据最多保留 128 个 bin；高尺寸分析器按频段 RMS 聚合，避免单点峰值支配柱高。
            val spectrumArr = Arguments.createArray()
            val spec = analyzer.spectrum
            val downsampled = if (spec.size > 128) {
                FloatArray(128) { band ->
                    val start = band * spec.size / 128
                    val end = maxOf(start + 1, (band + 1) * spec.size / 128)
                    var squaredEnergy = 0f
                    for (bin in start until end) {
                        val level = spec[bin].coerceIn(0f, 1f)
                        squaredEnergy += level * level
                    }
                    sqrt(squaredEnergy / (end - start))
                }
            } else {
                spec
            }
            for (v in downsampled) {
                spectrumArr.pushDouble(v.toDouble())
            }
            map.putArray("spectrum", spectrumArr)

            // 猫耳左/右数据
            val catLeftArr = Arguments.createArray()
            for (v in analyzer.catEarLeft) {
                catLeftArr.pushDouble(v.toDouble())
            }
            map.putArray("catEarLeft", catLeftArr)

            val catRightArr = Arguments.createArray()
            for (v in analyzer.catEarRight) {
                catRightArr.pushDouble(v.toDouble())
            }
            map.putArray("catEarRight", catRightArr)

            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("SPECTRUM_ERROR", e.message, e)
        }
    }

    /**
     * 获取 DSP 处理器引用（供音频处理管线使用）
     */
    fun getDSPProcessor(): DSPAudioProcessor = dspProcessor
}
