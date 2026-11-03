package com.rog.mp3freer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var mediaSession: MediaSessionCompat? = null
  private var notificationManager: NotificationManager? = null
  private var audioManager: AudioManager? = null
  private var audioFocusRequest: Any? = null
  private var isCurrentlyPlaying: Boolean = false
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private val releaseLocksRunnable = Runnable { releaseLocksInternal() }
  private val stopServiceRunnable = Runnable {
    MediaPlaybackService.stop(this@MainActivity)
    releaseLocksInternal()
  }
  private val CHANNEL_ID = "mp3freer_playback_channel"
  private val NOTIFICATION_ID = 10086
  private val bgExecutor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var lastCoverUrl: String = ""
  private var lastCoverBitmap: Bitmap? = null

  private val mediaReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      when (intent?.action) {
        "com.rog.mp3freer.ACTION_PREV" -> dispatchMediaAction("prev")
        "com.rog.mp3freer.ACTION_TOGGLE" -> dispatchMediaAction("toggle")
        "com.rog.mp3freer.ACTION_NEXT" -> dispatchMediaAction("next")
        AudioManager.ACTION_AUDIO_BECOMING_NOISY -> {
          // 耳机拔出 / 蓝牙设备断开 -> 自动暂停，防外放社死保护
          if (isCurrentlyPlaying) {
            dispatchMediaAction("pause")
            notifyIsland("🎧 耳机已断开 · 已自动暂停", "⏸️")
          }
        }
        Intent.ACTION_HEADSET_PLUG -> {
          val state = intent.getIntExtra("state", -1)
          if (state == 1) {
            notifyIsland("🎧 耳机已连接 · 开启纯净音质", "🎧")
          }
        }
        BluetoothDevice.ACTION_ACL_CONNECTED -> {
          notifyIsland("🎧 蓝牙耳机已连接 · 开启纯净音质", "🎧")
        }
      }
    }
  }

  override fun onWebViewCreate(wv: WebView) {
    super.onWebViewCreate(wv)
    configureWebView(wv)
  }

  private fun configureWebView(wv: WebView) {
    webView = wv
    wv.setBackgroundColor(0xFF0F0A1A.toInt())
    wv.setLayerType(View.LAYER_TYPE_HARDWARE, null)
    try {
      wv.settings.mediaPlaybackRequiresUserGesture = false
      wv.settings.domStorageEnabled = true
      wv.settings.databaseEnabled = true
      wv.settings.javaScriptEnabled = true
      wv.settings.setNeedInitialFocus(false)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_BOUND, false)
      }
      wv.addJavascriptInterface(AndroidMediaBridge(), "AndroidMediaBridge")
    } catch (_: Throwable) {
      // ignore
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    try {
      WebView.setWebContentsDebuggingEnabled(true)
    } catch (_: Throwable) {
      // ignore
    }

    initMediaSession()
    createNotificationChannel()

    // 1. 注册内部通知栏控制广播
    val customFilter = IntentFilter().apply {
      addAction("com.rog.mp3freer.ACTION_PREV")
      addAction("com.rog.mp3freer.ACTION_TOGGLE")
      addAction("com.rog.mp3freer.ACTION_NEXT")
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(mediaReceiver, customFilter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(mediaReceiver, customFilter)
    }

    // 2. 注册系统级耳机插拔、蓝牙连接与防外放广播
    val systemFilter = IntentFilter().apply {
      addAction(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
      addAction(Intent.ACTION_HEADSET_PLUG)
      addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(mediaReceiver, systemFilter, Context.RECEIVER_EXPORTED)
    } else {
      registerReceiver(mediaReceiver, systemFilter)
    }

    // 兜底：若 onWebViewCreate 未被触发，延迟查找 DecorView
    mainHandler.postDelayed({
      val wv = findWebView(window.decorView)
      if (wv != null && webView == null) {
        configureWebView(wv)
      }
    }, 200)
  }

  override fun onPause() {
    super.onPause()
    // 关键：Tauri/Android 基类默认在 onPause 时挂起 WebView。
    // 为了支持锁屏与后台切歌连续播放，必须保持 WebView 与其 JS 定时器处于运行状态。
    try {
      webView?.onResume()
      webView?.resumeTimers()
    } catch (_: Throwable) {}
  }

  override fun onStop() {
    super.onStop()
    try {
      webView?.onResume()
      webView?.resumeTimers()
    } catch (_: Throwable) {}
  }

  override fun onResume() {
    super.onResume()
    try {
      webView?.onResume()
      webView?.resumeTimers()
    } catch (_: Throwable) {}
  }

  override fun onDestroy() {
    try {
      unregisterReceiver(mediaReceiver)
    } catch (_: Throwable) {}
    abandonAudioFocus()
    releaseLocksImmediately()
    mediaSession?.release()
    notificationManager?.cancel(NOTIFICATION_ID)
    super.onDestroy()
  }

  private fun initMediaSession() {
    mediaSession = MediaSessionCompat(this, "MP3FreerMediaSession").apply {
      setFlags(
        MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
        MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
      )
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = dispatchMediaAction("play")
        override fun onPause() = dispatchMediaAction("pause")
        override fun onSkipToNext() = dispatchMediaAction("next")
        override fun onSkipToPrevious() = dispatchMediaAction("prev")
        override fun onStop() = dispatchMediaAction("pause")
        override fun onSeekTo(pos: Long) {
          mainHandler.post {
            val secs = pos / 1000
            webView?.evaluateJavascript(
              "window.dispatchEvent(new CustomEvent('nativeMediaAction', { detail: { action: 'seek', position: $secs } }));",
              null
            )
          }
        }

        // 精准处理所有蓝牙/有线耳机按键事件（包含单按键切歌与播放暂停）
        override fun onMediaButtonEvent(mediaButtonEvent: Intent?): Boolean {
          val keyEvent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            mediaButtonEvent?.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
          } else {
            @Suppress("DEPRECATION")
            mediaButtonEvent?.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
          }
          if (keyEvent != null && keyEvent.action == KeyEvent.ACTION_DOWN) {
            when (keyEvent.keyCode) {
              KeyEvent.KEYCODE_HEADSETHOOK,
              KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                dispatchMediaAction("toggle")
                return true
              }
              KeyEvent.KEYCODE_MEDIA_PLAY -> {
                dispatchMediaAction("play")
                return true
              }
              KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                dispatchMediaAction("pause")
                return true
              }
              KeyEvent.KEYCODE_MEDIA_NEXT -> {
                dispatchMediaAction("next")
                return true
              }
              KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
                dispatchMediaAction("prev")
                return true
              }
            }
          }
          return super.onMediaButtonEvent(mediaButtonEvent)
        }
      })
      isActive = true
    }
    notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  }

  // Activity 前台媒体物理按键拦截兜底
  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    when (keyCode) {
      KeyEvent.KEYCODE_HEADSETHOOK,
      KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
        dispatchMediaAction("toggle")
        return true
      }
      KeyEvent.KEYCODE_MEDIA_PLAY -> {
        dispatchMediaAction("play")
        return true
      }
      KeyEvent.KEYCODE_MEDIA_PAUSE -> {
        dispatchMediaAction("pause")
        return true
      }
      KeyEvent.KEYCODE_MEDIA_NEXT -> {
        dispatchMediaAction("next")
        return true
      }
      KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
        dispatchMediaAction("prev")
        return true
      }
    }
    return super.onKeyDown(keyCode, event)
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "音乐播放控制",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "在锁屏和通知栏显示播放控制器"
        setShowBadge(false)
        setSound(null, null)
        enableVibration(false)
      }
      notificationManager?.createNotificationChannel(channel)
    }
  }

  private fun dispatchMediaAction(action: String) {
    mainHandler.post {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('nativeMediaAction', { detail: '$action' }));",
        null
      )
    }
  }

  private fun notifyIsland(text: String, icon: String = "🎧") {
    mainHandler.post {
      val escapedText = text.replace("'", "\\'")
      val escapedIcon = icon.replace("'", "\\'")
      webView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('islandAlert', { detail: { text: '$escapedText', icon: '$escapedIcon' } }));",
        null
      )
    }
  }

  private fun requestAudioFocus() {
    try {
      if (audioManager == null) {
        audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      }
      val am = audioManager ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        if (audioFocusRequest == null) {
          val playbackAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
          audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(playbackAttributes)
            .setAcceptsDelayedFocusGain(true)
            .setOnAudioFocusChangeListener { focusChange ->
              when (focusChange) {
                AudioManager.AUDIOFOCUS_LOSS,
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                  dispatchMediaAction("pause")
                }
              }
            }
            .build()
        }
        (audioFocusRequest as? AudioFocusRequest)?.let {
          am.requestAudioFocus(it)
        }
      } else {
        @Suppress("DEPRECATION")
        am.requestAudioFocus(
          { focusChange ->
            when (focusChange) {
              AudioManager.AUDIOFOCUS_LOSS,
              AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                dispatchMediaAction("pause")
              }
            }
          },
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN
        )
      }
    } catch (_: Throwable) {}
  }

  private fun abandonAudioFocus() {
    try {
      val am = audioManager ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        (audioFocusRequest as? AudioFocusRequest)?.let {
          am.abandonAudioFocusRequest(it)
        }
      } else {
        @Suppress("DEPRECATION")
        am.abandonAudioFocus(null)
      }
    } catch (_: Throwable) {}
  }

  private fun updateNotification(
    title: String,
    artist: String,
    coverUrl: String,
    isPlaying: Boolean,
    durationMs: Long,
    positionMs: Long
  ) {
    val session = mediaSession ?: return
    isCurrentlyPlaying = isPlaying

    // 更新系统 MediaSession 播放状态与元数据
    val state = if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
    val actions = PlaybackStateCompat.ACTION_PLAY or
      PlaybackStateCompat.ACTION_PAUSE or
      PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
      PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
      PlaybackStateCompat.ACTION_SEEK_TO or
      PlaybackStateCompat.ACTION_PLAY_PAUSE

    session.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(actions)
        .setState(state, positionMs, 1.0f)
        .build()
    )

    fun buildAndNotify(coverBitmap: Bitmap?) {
      val metadataBuilder = MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
      if (coverBitmap != null) {
        metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, coverBitmap)
      }
      session.setMetadata(metadataBuilder.build())

      val contentIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).apply {
          flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      val prevIntent = PendingIntent.getBroadcast(
        this,
        1,
        Intent("com.rog.mp3freer.ACTION_PREV"),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val toggleIntent = PendingIntent.getBroadcast(
        this,
        2,
        Intent("com.rog.mp3freer.ACTION_TOGGLE"),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val nextIntent = PendingIntent.getBroadcast(
        this,
        3,
        Intent("com.rog.mp3freer.ACTION_NEXT"),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      val notifBuilder = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(artist)
        .setContentIntent(contentIntent)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(isPlaying)
        .setOnlyAlertOnce(true)
        .addAction(android.R.drawable.ic_media_previous, "上一首", prevIntent)
        .addAction(
          if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
          if (isPlaying) "暂停" else "播放",
          toggleIntent
        )
        .addAction(android.R.drawable.ic_media_next, "下一首", nextIntent)
        .setStyle(
          MediaStyle()
            .setMediaSession(session.sessionToken)
            .setShowActionsInCompactView(0, 1, 2)
        )

      if (coverBitmap != null) {
        notifBuilder.setLargeIcon(coverBitmap)
      }

      val notif = notifBuilder.build()
      if (isPlaying) {
        requestAudioFocus()
        cancelStopService()
        acquireLocks()
        MediaPlaybackService.start(this, notif)
      } else {
        // 切歌缓冲或暂停期间：保持前台服务运行与通知栏更新，防抖延时 60 秒
        abandonAudioFocus()
        MediaPlaybackService.update(this, notif)
        scheduleStopService(60000L)
      }
      notificationManager?.notify(NOTIFICATION_ID, notif)
    }

    if (coverUrl.isNotEmpty() && coverUrl != lastCoverUrl) {
      bgExecutor.execute {
        try {
          val stream = URL(coverUrl).openStream()
          val bitmap = BitmapFactory.decodeStream(stream)
          lastCoverUrl = coverUrl
          lastCoverBitmap = bitmap
          mainHandler.post { buildAndNotify(bitmap) }
        } catch (_: Throwable) {
          mainHandler.post { buildAndNotify(lastCoverBitmap) }
        }
      }
    } else {
      buildAndNotify(lastCoverBitmap)
    }
  }

  private fun acquireLocks() {
    mainHandler.removeCallbacks(releaseLocksRunnable)
    try {
      if (wakeLock == null) {
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
        wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MP3Freer::PlaybackWakeLock")?.apply {
          setReferenceCounted(false)
        }
      }
      if (wakeLock?.isHeld == false) {
        wakeLock?.acquire(24 * 60 * 60 * 1000L)
      }

      if (wifiLock == null) {
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lockType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          WifiManager.WIFI_MODE_FULL_LOW_LATENCY
        } else {
          @Suppress("DEPRECATION")
          WifiManager.WIFI_MODE_FULL
        }
        wifiLock = wm?.createWifiLock(lockType, "MP3Freer::PlaybackWifiLock")?.apply {
          setReferenceCounted(false)
        }
      }
      if (wifiLock?.isHeld == false) {
        wifiLock?.acquire()
      }
    } catch (_: Throwable) {
      // ignore
    }
  }

  private fun releaseLocksDelayed(delayMs: Long = 60000L) {
    mainHandler.removeCallbacks(releaseLocksRunnable)
    mainHandler.postDelayed(releaseLocksRunnable, delayMs)
  }

  private fun scheduleStopService(delayMs: Long = 60000L) {
    mainHandler.removeCallbacks(stopServiceRunnable)
    mainHandler.postDelayed(stopServiceRunnable, delayMs)
  }

  private fun cancelStopService() {
    mainHandler.removeCallbacks(stopServiceRunnable)
  }

  private fun releaseLocksImmediately() {
    cancelStopService()
    mainHandler.removeCallbacks(releaseLocksRunnable)
    releaseLocksInternal()
  }

  private fun releaseLocksInternal() {
    try {
      if (wakeLock?.isHeld == true) {
        wakeLock?.release()
      }
      if (wifiLock?.isHeld == true) {
        wifiLock?.release()
      }
    } catch (_: Throwable) {
      // ignore
    }
  }

  inner class AndroidMediaBridge {
    @JavascriptInterface
    fun updateMedia(
      title: String?,
      artist: String?,
      coverUrl: String?,
      isPlaying: Boolean,
      durationSec: Double,
      currentSec: Double
    ) {
      val sTitle = title ?: "MP3Freer"
      val sArtist = artist ?: "自由听音乐"
      val sCover = coverUrl ?: ""
      val dMs = (durationSec * 1000).toLong()
      val pMs = (currentSec * 1000).toLong()

      mainHandler.post {
        if (isPlaying) {
          acquireLocks()
        } else {
          releaseLocksDelayed(60000L)
        }
        updateNotification(sTitle, sArtist, sCover, isPlaying, dMs, pMs)
      }
    }

    @JavascriptInterface
    fun clearMedia() {
      mainHandler.post {
        isCurrentlyPlaying = false
        abandonAudioFocus()
        MediaPlaybackService.stop(this@MainActivity)
        releaseLocksImmediately()
        notificationManager?.cancel(NOTIFICATION_ID)
        mediaSession?.isActive = false
      }
    }

    @JavascriptInterface
    fun getDeviceId(): String {
      return try {
        Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: ""
      } catch (_: Throwable) {
        ""
      }
    }
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val found = findWebView(view.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }
}
