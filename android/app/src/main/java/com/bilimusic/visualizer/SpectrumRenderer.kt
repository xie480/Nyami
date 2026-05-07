package com.bilimusic.visualizer

import android.opengl.GLES20
import android.opengl.GLSurfaceView
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.*
import kotlin.concurrent.Volatile

/**
 * OpenGL ES 2.0 频谱渲染器
 *
 * 渲染内容：
 * 1. 第二层：细线波形（高频细节）— 点阵连接
 * 2. 猫耳动态频谱（左右声道高频映射）
 * 3. 呼吸流光和发光效果
 * 4. 双层柱状频谱 + Glow 发光
 *
 * 配色：蓝紫霓虹 (#6C5CE7 ~ #A855F7)
 */
class SpectrumRenderer : GLSurfaceView.Renderer {

    // ====== 频谱数据（由 FFT Analyzer 更新） ======
    @Volatile
    var spectrumData = FloatArray(512)

    @Volatile
    var catEarLeft = FloatArray(16)

    @Volatile
    var catEarRight = FloatArray(16)

    // ====== 动画状态 ======
    private var peakHold = FloatArray(512)      // 峰值保持
    private var smoothData = FloatArray(512)     // 平滑数据

    // 呼吸流光相位
    private var breathPhase = 0f

    // ====== OpenGL 资源 ======
    private var program = 0
    private var positionHandle = 0
    private var colorHandle = 0
    private var uResolution = 0

    // 视口尺寸
    private var viewWidth = 1080f
    private var viewHeight = 400f

    private val verticesPerBar = 12 // 每个柱状条的顶点数

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0f, 0f, 0f, 0f) // 透明背景

        // 创建着色器程序
        val vertexShader = loadShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER)
        val fragmentShader = loadShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)
        program = GLES20.glCreateProgram()
        GLES20.glAttachShader(program, vertexShader)
        GLES20.glAttachShader(program, fragmentShader)
        GLES20.glLinkProgram(program)

        positionHandle = GLES20.glGetAttribLocation(program, "aPosition")
        colorHandle = GLES20.glGetUniformLocation(program, "uColor")
        uResolution = GLES20.glGetUniformLocation(program, "uResolution")

        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES20.glViewport(0, 0, width, height)
        viewWidth = width.toFloat()
        viewHeight = height.toFloat()
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        GLES20.glUseProgram(program)

        // 传递分辨率
        GLES20.glUniform2f(uResolution, viewWidth, viewHeight)

        // 更新呼吸相位
        breathPhase = (breathPhase + 0.02f) % (2f * PI).toFloat()

        // 频谱柱状条
        drawSpectrumBars()

        // 细线波形（高频细节层）
        drawWaveform()

        // 猫耳频谱
        drawCatEars()
    }

    /**
     * 绘制频谱柱状条（第一层）
     *
     * 渲染为圆角矩形，带 Glow 发光
     */
    private fun drawSpectrumBars() {
        val barCount = min(spectrumData.size, 48)
        val barWidth = viewWidth / barCount.toFloat() * 0.7f
        val gap = viewWidth / barCount.toFloat() * 0.3f

        for (i in 0 until barCount) {
            // 更新峰值保持
            if (spectrumData[i] > peakHold[i]) {
                peakHold[i] = spectrumData[i]
            } else {
                peakHold[i] *= 0.92f // 衰减
            }

            // 平滑
            smoothData[i] = smoothData[i] * 0.7f + spectrumData[i] * 0.3f

            val height = smoothData[i].coerceIn(0f, 1f) * viewHeight * 0.8f
            val x = i * (barWidth + gap) + gap / 2f
            val y = viewHeight * 0.1f

            // 根据呼吸相位调整发光强度
            val glowIntensity = 0.6f + 0.4f * sin(breathPhase + i * 0.3f).coerceIn(0f, 1f)

            // 蓝紫霓虹渐变色
            val hue = 240f - smoothData[i] * 60f // 240(蓝) ~ 180(青)
            val color = floatArrayOf(
                (sin(hue * PI / 180f) * 0.7f + 0.3f).toFloat(),
                (sin((hue + 120f) * PI / 180f) * 0.5f + 0.3f).toFloat(),
                1f,
                glowIntensity
            )

            // 绘制柱状条
            drawBar(x, y, barWidth, height, color)
        }
    }

    /**
     * 绘制高频细节波形（第二层）
     */
    private fun drawWaveform() {
        val pointCount = min(spectrumData.size, 64)
        if (pointCount < 2) return

        val stepX = viewWidth / pointCount.toFloat()
        val baseY = viewHeight * 0.5f

        // 从频谱中段开始取高频部分
        val startIdx = spectrumData.size / 3

        val vertices = FloatArray(pointCount * 2)
        for (i in 0 until pointCount) {
            val idx = startIdx + i * (spectrumData.size - startIdx) / pointCount
            val value = if (idx < spectrumData.size) spectrumData[idx] else 0f
            vertices[i * 2] = i * stepX
            vertices[i * 2 + 1] = baseY + (value - 0.5f) * viewHeight * 0.3f
        }

        val vertexBuffer = ByteBuffer
            .allocateDirect(vertices.size * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer()
            .put(vertices)
        vertexBuffer.position(0)

        // 亮青色细线
        GLES20.glUniform4f(colorHandle, 0.3f, 0.8f, 1.0f, 0.6f)

        GLES20.glVertexAttribPointer(positionHandle, 2, GLES20.GL_FLOAT, false, 0, vertexBuffer)
        GLES20.glEnableVertexAttribArray(positionHandle)
        GLES20.glLineWidth(2f)
        GLES20.glDrawArrays(GLES20.GL_LINE_STRIP, 0, pointCount)
        GLES20.glDisableVertexAttribArray(positionHandle)
    }

    /**
     * 绘制猫耳动态频谱
     *
     * 左右各一只猫耳，由高频能量驱动
     */
    private fun drawCatEars() {
        val earCount = min(catEarLeft.size, 16)

        // 左耳
        drawSingleEar(catEarLeft, earCount, viewWidth * 0.3f, false)
        // 右耳
        drawSingleEar(catEarRight, earCount, viewWidth * 0.7f, true)
    }

    private fun drawSingleEar(data: FloatArray, count: Int, centerX: Float, flipped: Boolean) {
        val earWidth = 60f
        val earHeight = 80f
        val direction = if (flipped) -1f else 1f

        // 猫耳由多个三角形组成，使用高频数据驱动耳尖高度
        val segmentCount = count / 2
        val segmentWidth = earWidth / segmentCount

        for (i in 0 until segmentCount) {
            val leftIdx = i
            val rightIdx = count - 1 - i

            val leftVal = data[leftIdx].coerceIn(0f, 1f)
            val rightVal = data[rightIdx].coerceIn(0f, 1f)

            // 耳尖高度 = 平均值 * 最大高度
            val tipHeight = ((leftVal + rightVal) / 2f) * earHeight

            // 猫耳形状：底部宽，顶部尖
            val bottomY = viewHeight * 0.5f
            val tipX = centerX
            val tipY = bottomY - tipHeight
            val baseLeftX = centerX - segmentWidth * (segmentCount - i) * direction
            val baseRightX = centerX - segmentWidth * (segmentCount - 1 - i) * direction
            val baseY = bottomY

            // 三角形顶点
            val vertices = floatArrayOf(
                tipX, tipY,
                baseLeftX, baseY,
                baseRightX, baseY
            )

            val vertexBuffer = ByteBuffer
                .allocateDirect(vertices.size * 4)
                .order(ByteOrder.nativeOrder())
                .asFloatBuffer()
                .put(vertices)
            vertexBuffer.position(0)

            // 颜色：根据能量渐变，峰值时发光
            val energy = (leftVal + rightVal) / 2f
            val r = (0.4f + energy * 0.6f)
            val g = (0.3f + energy * 0.5f)
            val b = 0.8f + energy * 0.2f
            val alpha = 0.5f + energy * 0.5f

            GLES20.glUniform4f(colorHandle, r, g, b, alpha)
            GLES20.glVertexAttribPointer(positionHandle, 2, GLES20.GL_FLOAT, false, 0, vertexBuffer)
            GLES20.glEnableVertexAttribArray(positionHandle)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 3)
            GLES20.glDisableVertexAttribArray(positionHandle)
        }
    }

    /**
     * 绘制单个柱状条（圆角矩形）
     */
    private fun drawBar(x: Float, y: Float, width: Float, height: Float, color: FloatArray) {
        val radius = min(width / 2f, 4f)
        val topY = y + height

        // 使用 6 个三角形构建圆角矩形
        val vertices = floatArrayOf(
            // 主体矩形
            x + radius, y,  x + width - radius, y,  x + radius, topY,
            x + width - radius, y,  x + width - radius, topY,  x + radius, topY,
            // 顶部半圆（用两个三角形近似）
            x, topY - radius,  x + radius, topY,  x + radius, topY - radius,
            x, topY - radius,  x + radius, topY,  x, topY,
        )

        val vertexBuffer = ByteBuffer
            .allocateDirect(vertices.size * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer()
            .put(vertices)
        vertexBuffer.position(0)

        GLES20.glUniform4f(colorHandle, color[0], color[1], color[2], color[3])
        GLES20.glVertexAttribPointer(positionHandle, 2, GLES20.GL_FLOAT, false, 0, vertexBuffer)
        GLES20.glEnableVertexAttribArray(positionHandle)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, vertices.size / 2)
        GLES20.glDisableVertexAttribArray(positionHandle)
    }

    // ====== 着色器 ======

    companion object {
        private const val VERTEX_SHADER = """
            attribute vec4 aPosition;
            void main() {
                gl_Position = vec4(aPosition.xy / vec2(540.0, 200.0) - 1.0, 0.0, 1.0);
            }
        """

        private const val FRAGMENT_SHADER = """
            precision mediump float;
            uniform vec4 uColor;
            void main() {
                gl_FragColor = uColor;
            }
        """

        fun loadShader(type: Int, source: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, source)
            GLES20.glCompileShader(shader)
            return shader
        }
    }
}
