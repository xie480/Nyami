package com.bilimusic.sync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.bilimusic.MainActivity
import com.bilimusic.R

class BackgroundSyncForegroundService : Service() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var isForeground = false

  override fun onCreate() {
    super.onCreate()
    synchronized(instanceLock) {
      instance = this
    }
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_START) {
      showProgressNotification(
        intent.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE,
        intent.getStringExtra(EXTRA_DETAIL) ?: DEFAULT_DETAIL,
        intent.getIntExtra(EXTRA_COMPLETED, 0),
        intent.getIntExtra(EXTRA_TOTAL, 0),
      )
    } else {
      stopServiceForeground(startId)
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onTimeout(startId: Int, fgsType: Int) {
    stopServiceForeground(startId)
  }

  override fun onDestroy() {
    synchronized(instanceLock) {
      if (instance === this) instance = null
    }
    super.onDestroy()
  }

  private fun showProgressNotification(
    title: String,
    detail: String,
    completed: Int,
    total: Int,
  ) {
    val safeTotal = total.coerceAtLeast(0)
    val safeCompleted = if (safeTotal == 0) 0 else completed.coerceIn(0, safeTotal)
    val launchIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val contentIntent = PendingIntent.getActivity(
      this,
      NOTIFICATION_ID,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
      .setSmallIcon(R.drawable.ic_stat_sync)
      .setContentTitle(title)
      .setContentText(detail)
      .setContentIntent(contentIntent)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setProgress(safeTotal, safeCompleted, safeTotal == 0)

    val notification = builder.build()
    if (!isForeground) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      isForeground = true
    } else {
      getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "后台同步",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "显示收藏索引与标签同步进度"
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun stopServiceForeground(startId: Int? = null) {
    if (isForeground) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
      isForeground = false
    }
    if (startId == null) stopSelf() else stopSelf(startId)
  }

  companion object {
    private const val CHANNEL_ID = "background_sync"
    private const val NOTIFICATION_ID = 4301
    private const val DEFAULT_TITLE = "正在后台同步"
    private const val DEFAULT_DETAIL = "准备同步"
    private const val ACTION_START = "com.bilimusic.sync.START"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_DETAIL = "detail"
    private const val EXTRA_COMPLETED = "completed"
    private const val EXTRA_TOTAL = "total"
    private val instanceLock = Any()

    @Volatile
    private var instance: BackgroundSyncForegroundService? = null

    fun start(
      context: Context,
      title: String,
      detail: String,
      completed: Int,
      total: Int,
    ) {
      val intent = createIntent(context, ACTION_START, title, detail, completed, total)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun update(title: String, detail: String, completed: Int, total: Int) {
      val service = synchronized(instanceLock) { instance } ?: return
      service.mainHandler.post {
        service.showProgressNotification(title, detail, completed, total)
      }
    }

    fun stop(context: Context) {
      val service = synchronized(instanceLock) { instance }
      if (service == null) {
        context.stopService(Intent(context, BackgroundSyncForegroundService::class.java))
        return
      }
      service.mainHandler.post { service.stopServiceForeground() }
    }

    private fun createIntent(
      context: Context,
      action: String,
      title: String,
      detail: String,
      completed: Int,
      total: Int,
    ) = Intent(context, BackgroundSyncForegroundService::class.java).apply {
      this.action = action
      putExtra(EXTRA_TITLE, title)
      putExtra(EXTRA_DETAIL, detail)
      putExtra(EXTRA_COMPLETED, completed)
      putExtra(EXTRA_TOTAL, total)
    }
  }
}
