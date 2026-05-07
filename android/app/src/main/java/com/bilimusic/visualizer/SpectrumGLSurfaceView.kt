package com.bilimusic.visualizer

import android.content.Context
import android.opengl.GLSurfaceView
import android.util.AttributeSet

/**
 * 频谱 GLSurfaceView
 *
 * 承载 OpenGL ES 渲染的 SurfaceView，用于绘制：
 * - 双层 FFT 频谱柱状图
 * - 细线高频波形
 * - 猫耳动态频谱
 * - 霓虹发光效果
 *
 * 通过 React Native 的 ViewManager 暴露给 JS 层作为 Native UI Component。
 */
class SpectrumGLSurfaceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : GLSurfaceView(context, attrs) {

    val renderer: SpectrumRenderer

    init {
        // 设置 OpenGL ES 2.0
        setEGLContextClientVersion(2)

        // 设置渲染器
        renderer = SpectrumRenderer()
        setRenderer(renderer)

        // 保持渲染持续更新（后续可切换为按需更新以省电）
        renderMode = RENDERMODE_CONTINUOUSLY

        // 在 UI 线程直接设置渲染模式
        queueEvent {
            // 后续可在此设置初始参数
        }
    }

    /**
     * 更新频谱数据（从 FFT Analyzer 接收）
     */
    fun updateSpectrum(data: FloatArray) {
        renderer.spectrumData = data
        // 请求重绘
        requestRender()
    }

    /**
     * 更新猫耳频谱数据
     */
    fun updateCatEars(left: FloatArray, right: FloatArray) {
        renderer.catEarLeft = left
        renderer.catEarRight = right
        requestRender()
    }
}
