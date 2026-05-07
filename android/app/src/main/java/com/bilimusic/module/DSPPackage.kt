package com.bilimusic.module

import com.bilimusic.module.AudioDSPModule
import com.bilimusic.module.SpectrumViewManager
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * DSP 原生模块包 — 注册 AudioDSPModule 和 SpectrumViewManager
 *
 * 需要在 MainApplication.getPackages() 中注册：
 * packages.add(DSPPackage())
 */
class DSPPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(AudioDSPModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return listOf(SpectrumViewManager())
    }
}
