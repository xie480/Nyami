package com.bilimusic.sync

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class BackgroundSyncModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "BackgroundSyncModule"

  @ReactMethod
  fun start(title: String, detail: String, completed: Int, total: Int, promise: Promise) {
    try {
      BackgroundSyncForegroundService.start(
        reactContext,
        title,
        detail,
        completed,
        total,
      )
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_BACKGROUND_SYNC_START", error)
    }
  }

  @ReactMethod
  fun update(title: String, detail: String, completed: Int, total: Int) {
    BackgroundSyncForegroundService.update(title, detail, completed, total)
  }

  @ReactMethod
  fun stop() {
    BackgroundSyncForegroundService.stop(reactContext)
  }
}

class BackgroundSyncPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext,
  ): List<NativeModule> = listOf(BackgroundSyncModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
