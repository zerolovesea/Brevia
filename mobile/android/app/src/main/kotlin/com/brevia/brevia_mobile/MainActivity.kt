package com.brevia.brevia_mobile

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

import com.cloudwebrtc.webrtc.audio.AudioSwitchManager
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.brevia/app_update")
            .setMethodCallHandler { call, result ->
                try {
                    when (call.method) {
                        "build" -> {
                            val info = packageManager.getPackageInfo(packageName, 0)
                            result.success(if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong())
                        }
                        "install" -> {
                            val file = File(call.arguments as String).canonicalFile
                            require(file.parentFile == File(cacheDir, "updates").canonicalFile && file.extension == "apk" && file.isFile)
                            // 安装前限制为同包名、同签名的新版本，系统安装器仍需用户确认。
                            val archive = packageManager.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNATURES)
                            val installed = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
                            require(archive != null && archive.packageName == packageName && archive.versionCode > installed.versionCode)
                            require(!archive.signatures.isNullOrEmpty() && archive.signatures!!.toSet() == installed.signatures!!.toSet())
                            if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
                                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                            } else {
                                val uri = FileProvider.getUriForFile(this, "$packageName.updates", file)
                                startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                            }
                            result.success(null)
                        }
                        else -> result.notImplemented()
                    }
                } catch (error: Exception) {
                    result.error("update_failed", error.message, null)
                }
            }
    }

    init {
        // WebRTC 只传数据，音频焦点和路由仍由录音器管理。
        AudioSwitchManager.setAudioSessionManagementEnabled(false)
    }
}
