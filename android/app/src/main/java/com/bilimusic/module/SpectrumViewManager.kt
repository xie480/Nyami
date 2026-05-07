package com.bilimusic.module

import com.bilimusic.visualizer.SpectrumGLSurfaceView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * React Native ViewManager — 频谱可视化 UI 组件
 *
 * 将 [SpectrumGLSurfaceView] 暴露给 React Native JS 层，
 * 使得在 TypeScript 中可以直接以 <SpectrumView /> 标签使用。
 */
class SpectrumViewManager : SimpleViewManager<SpectrumGLSurfaceView>() {

    override fun getName(): String = "SpectrumView"

    override fun createViewInstance(reactContext: ThemedReactContext): SpectrumGLSurfaceView {
        return SpectrumGLSurfaceView(reactContext)
    }

    @ReactProp(name = "spectrumData")
    fun setSpectrumData(view: SpectrumGLSurfaceView, data: com.facebook.react.bridge.ReadableArray?) {
        if (data == null) return
        val floatArray = FloatArray(data.size()) { i -> data.getDouble(i).toFloat() }
        view.updateSpectrum(floatArray)
    }
}
