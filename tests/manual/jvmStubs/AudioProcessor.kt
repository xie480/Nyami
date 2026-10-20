package com.google.android.exoplayer2.audio

import java.nio.ByteBuffer

/** Minimal ExoPlayer boundary for exercising the production adapter on a JVM. */
interface AudioProcessor {
    class AudioFormat(val sampleRate: Int, val channelCount: Int, val encoding: Int)

    fun isActive(): Boolean
    fun configure(inputFormat: AudioFormat): AudioFormat
    fun queueInput(inputBuffer: ByteBuffer)
    fun getOutput(): ByteBuffer
    fun queueEndOfStream()
    fun isEnded(): Boolean
    fun flush()
    fun reset()

    companion object {
        val EMPTY_BUFFER: ByteBuffer = ByteBuffer.allocateDirect(0)
    }
}
