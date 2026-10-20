package com.bilimusic.audio

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import kotlin.math.*

/** 不依赖 Android/JUnit 的真实 PCM 回归；由 scripts/test-audio-dsp.ps1 编译运行。 */
object DSPAudioProcessorRegression {
    private fun close(actual: Double, expected: Double, tolerance: Double = 1e-5) {
        check(abs(actual - expected) <= tolerance) { "Expected $expected ± $tolerance, got $actual" }
    }

    private fun tone(rate: Int, frequency: Double, frames: Int = rate / 3): FloatArray =
        FloatArray(frames * 2) { index ->
            (0.02 * sin(2.0 * PI * frequency * (index / 2) / rate)).toFloat()
        }

    private fun gainDB(rate: Int, frequency: Double, gains: FloatArray, peq: Boolean = false): Double {
        val dsp = DSPAudioProcessor()
        dsp.configure(rate, 2)
        dsp.updateGraphicEQ(gains)
        if (peq) {
            dsp.updatePEQFilter(0, 0, frequency.toFloat(), 6f, 1f)
            dsp.setMode(DSPAudioProcessor.EQMode.PARAMETRIC)
        }
        val input = tone(rate, frequency)
        val output = dsp.process(input.copyOf())
        val start = (rate / 10) * 2 // 丢弃初始滤波器过渡。
        var inputEnergy = 0.0
        var outputEnergy = 0.0
        for (index in start until input.size) {
            inputEnergy += input[index].toDouble().pow(2)
            outputEnergy += output[index].toDouble().pow(2)
        }
        return 10 * log10(outputEnergy / inputEnergy)
    }

    @JvmStatic
    fun main(args: Array<String>) {
        var passed = 0
        fun test(name: String, body: () -> Unit) {
            body()
            passed++
            println("PASS $name")
        }

        for (rate in listOf(44100, 48000)) {
            test("graphic center gain at 16 kHz / $rate Hz") {
                val gains = FloatArray(10).also { it[9] = 6f }
                close(gainDB(rate, 16000.0, gains), 6.0, 0.03)
            }
            test("PEQ center gain at 8 kHz / $rate Hz") {
                close(gainDB(rate, 8000.0, FloatArray(10), peq = true), 6.0, 0.03)
            }
        }

        for (mode in DSPAudioProcessor.EQMode.values()) {
            test("$mode keeps a silent right channel silent") {
                val dsp = DSPAudioProcessor()
                dsp.updateGraphicEQ(FloatArray(10).also { it[6] = 6f })
                dsp.updatePEQFilter(0, 0, 2000f, 6f, 1f)
                dsp.setMode(mode)
                val pcm = FloatArray(4096).also { it[0] = 0.2f }
                dsp.process(pcm)
                check((1 until pcm.size step 2).all { abs(pcm[it]) < 1e-10 })
                check((2 until pcm.size step 2).any { abs(pcm[it]) > 1e-6 })
            }
            test("reset restores $mode to a flat signal") {
                val dsp = DSPAudioProcessor()
                dsp.updateGraphicEQ(FloatArray(10) { 6f })
                dsp.updatePEQFilter(0, 1, 200f, 8f, 1f)
                dsp.setMode(mode)
                dsp.process(tone(44100, 120.0))
                dsp.reset()
                val pcm = tone(44100, 1000.0)
                val original = pcm.copyOf()
                dsp.process(pcm)
                check(pcm.indices.all { abs(pcm[it] - original[it]) < 1e-6 })
            }
        }

        test("a short block ignores stale capacity in filtering and limiting") {
            val dsp = DSPAudioProcessor()
            val pcm = FloatArray(1024) { if (it < 100) 0.1f else 10f }
            dsp.process(pcm, channels = 2, sampleCount = 100)
            check((0 until 100).all { abs(pcm[it] - 0.1f) < 1e-6 })
            check((100 until pcm.size).all { pcm[it] == 10f })
        }

        test("reused float ByteBuffers match consecutive exact-sized PCM processing") {
            val reused = DSPAudioProcessor()
            val reference = DSPAudioProcessor()
            val gains = FloatArray(10).also { it[6] = 6f }
            reused.updateGraphicEQ(gains)
            reference.updateGraphicEQ(gains)
            for (frames in listOf(2048, 128, 256, 64)) {
                val pcm = tone(44100, 2000.0, frames)
                val expected = reference.process(pcm.copyOf())
                val input = ByteBuffer.allocateDirect(pcm.size * 4).order(ByteOrder.LITTLE_ENDIAN)
                input.asFloatBuffer().put(pcm)
                val output = reused.processByteBuffer(input, 2)
                val actual = FloatArray(pcm.size)
                output.asFloatBuffer().get(actual)
                output.position(output.limit())
                check(actual.indices.all { abs(actual[it] - expected[it]) < 1e-6 })
            }
        }

        test("format changes preserve user coefficients and isolate every channel") {
            val dsp = DSPAudioProcessor()
            dsp.updateGraphicEQ(FloatArray(10).also { it[6] = 6f })
            dsp.configure(48000, 1)
            val mono = FloatArray(16000) { (0.02 * sin(2.0 * PI * 2000 * it / 48000)).toFloat() }
            val original = mono.copyOf()
            dsp.process(mono, 1)
            val gain = sqrt(mono.drop(4800).sumOf { it.toDouble().pow(2) } /
                original.drop(4800).sumOf { it.toDouble().pow(2) })
            close(20 * log10(gain), 6.0, 0.03)
            dsp.configure(44100, 2)
            val silentRight = FloatArray(2048).also { it[0] = 0.1f }
            dsp.process(silentRight)
            check((1 until silentRight.size step 2).all { itIndex -> silentRight[itIndex] == 0f })
        }

        test("limiter bounds strong boosted PCM and power-off remains bypassed") {
            val dsp = DSPAudioProcessor()
            dsp.updateGraphicEQ(FloatArray(10) { 12f })
            val pcm = FloatArray(8192) { (0.9 * sin(2.0 * PI * 1000 * (it / 2) / 44100)).toFloat() }
            dsp.process(pcm)
            check(pcm.all { it.isFinite() && abs(it) <= 0.950001f })
            dsp.setEnabled(false)
            val original = floatArrayOf(1f, -1f, 0.2f, -0.2f)
            check(dsp.process(original.copyOf()).contentEquals(original))
        }

        test("adapter keeps the old format until flush, then activates the pending format") {
            val dsp = DSPAudioProcessor()
            val gains = FloatArray(10).also { it[8] = 6f }
            dsp.updateGraphicEQ(gains)
            val adapter = EqAudioProcessorAdapter(dsp)
            adapter.configure(AudioProcessor.AudioFormat(44100, 1, C.ENCODING_PCM_16BIT))
            adapter.flush()
            adapter.configure(AudioProcessor.AudioFormat(48000, 2, C.ENCODING_PCM_FLOAT))

            val oldSamples = ShortArray(1024) { (1000 * sin(2.0 * PI * 8000 * it / 44100)).toInt().toShort() }
            val oldReference = DSPAudioProcessor().also {
                it.configure(44100, 1)
                it.updateGraphicEQ(gains)
            }.process(FloatArray(oldSamples.size) { oldSamples[it] / 32768f }, 1)
            val oldInput = ByteBuffer.allocateDirect(oldSamples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
            for (value in oldSamples) oldInput.putShort(value)
            oldInput.flip()
            adapter.queueInput(oldInput)
            val oldOutput = adapter.getOutput()
            check(oldOutput.remaining() == oldSamples.size * 2)
            for (value in oldReference) {
                check(abs(oldOutput.short.toInt() - (value * 32768).toInt()) <= 1)
            }

            adapter.flush()
            val newSamples = tone(48000, 8000.0, 1024)
            val newReference = DSPAudioProcessor().also {
                it.configure(48000, 2)
                it.updateGraphicEQ(gains)
            }.process(newSamples.copyOf())
            val newInput = ByteBuffer.allocateDirect(newSamples.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            newInput.asFloatBuffer().put(newSamples)
            adapter.queueInput(newInput)
            val newOutput = adapter.getOutput().asFloatBuffer()
            for (value in newReference) close(newOutput.get().toDouble(), value.toDouble(), 1e-6)
        }

        val presets = File(args.single()).readLines().associate { line ->
            val parts = line.split(',')
            parts.first() to parts.drop(1).map { it.toFloat() }.toFloatArray()
        }
        val frequencies = listOf(31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)
        val responses = presets.mapValues { (_, gains) ->
            frequencies.map { frequency -> gainDB(48000, frequency, gains) }
        }
        fun contrast(id: String, band: Int, reference: Int, minimumDB: Double) {
            val response = responses.getValue(id)
            check(response[band] - response[reference] > minimumDB) {
                "$id contrast ${response[band] - response[reference]} dB is below $minimumDB dB"
            }
        }
        test("actual preset PCM responses distinguish bass, vocals, dark and airy signatures") {
            contrast("cat_bass", 1, 4, 8.0)
            contrast("cyber_bass", 0, 4, 12.0)
            contrast("girl_band", 6, 1, 8.0)
            contrast("idol_stage", 8, 4, 6.0)
            contrast("whisper", 5, 9, 10.0)
            contrast("midnight_radio", 2, 8, 10.0)
            contrast("vaporwave", 1, 9, 12.0)
            contrast("lofi_cafe", 3, 9, 12.0)
            contrast("8bit", 5, 0, 15.0)
            contrast("crystal", 8, 1, 12.0)
            contrast("tokyo_rain", 9, 3, 8.0)
            contrast("cyberpunk", 7, 4, 8.0)
            contrast("neon_drive", 1, 4, 8.0)
            contrast("live", 2, 4, 6.0)
            contrast("hall", 9, 3, 8.0)
            contrast("nyami", 1, 4, 4.0)
        }
        for ((id, response) in responses) {
            println("RESPONSE $id: ${response.joinToString(", ") { "%.2f".format(java.util.Locale.US, it) }} dB")
        }
        println("$passed PCM regression checks passed")
    }
}
