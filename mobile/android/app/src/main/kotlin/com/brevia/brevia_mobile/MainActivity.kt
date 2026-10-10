package com.brevia.brevia_mobile

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

import com.cloudwebrtc.webrtc.audio.AudioSwitchManager
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val downloads = UpdateDownload(applicationContext)
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        MethodChannel(messenger, "com.brevia/app_update", io.flutter.plugin.common.StandardMethodCodec.INSTANCE, messenger.makeBackgroundTaskQueue())
            .setMethodCallHandler { call, result ->
                try {
                    when (call.method) {
                        "version" -> result.success(packageManager.getPackageInfo(packageName, 0).versionName)
                        "build" -> {
                            val info = packageManager.getPackageInfo(packageName, 0)
                            result.success(if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong())
                        }
                        "download" -> result.success(downloads.start(call.arguments as Map<*, *>))
                        "downloadStatus" -> result.success(downloads.status())
                        "install" -> {
                            val file = downloads.verifiedFile()
                            // 安装前限制为同包名、同签名的新版本，系统安装器仍需用户确认。
                            val archive = packageManager.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNATURES)
                            val installed = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
                            require(archive != null && archive.packageName == packageName && archive.versionCode > installed.versionCode)
                            require(!archive.signatures.isNullOrEmpty() && archive.signatures!!.toSet() == installed.signatures!!.toSet())
                            runOnUiThread {
                                try {
                                    if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
                                        startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                                    } else {
                                        val uri = FileProvider.getUriForFile(this, "$packageName.updates", file)
                                        startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                                    }
                                    result.success(null)
                                } catch (error: Exception) {
                                    result.error("update_failed", error.message, null)
                                }
                            }
                        }
                        else -> result.notImplemented()
                    }
                } catch (error: Exception) {
                    if (call.method == "install") downloads.discard()
                    result.error("update_failed", error.message, null)
                }
            }
    }

    init {
        // WebRTC 只传数据，音频焦点和路由仍由录音器管理。
        AudioSwitchManager.setAudioSessionManagementEnabled(false)
    }
}
