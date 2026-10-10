package com.brevia.brevia_mobile

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import java.io.File
import java.security.MessageDigest

// 系统持有下载任务；仅持久化任务编号和校验信息，Activity 重建不会丢失进度。
class UpdateDownload(private val context: Context) {
    private val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val prefs = context.getSharedPreferences("app_update_download", Context.MODE_PRIVATE)
    private val installDirectory get() = File(context.filesDir, "updates")
    private val directory get() = File(requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)), "updates")

    @Synchronized
    fun start(args: Map<*, *>): Map<String, Any> {
        val version = args["version"] as String
        val build = (args["build"] as Number).toLong()
        val size = (args["size"] as Number).toLong()
        val digest = args["sha256"] as String
        require(Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(version))
        require(build in 1..2100000000 && size in 1..500000000)
        require(Regex("[a-f0-9]{64}").matches(digest))
        val existing = status()
        if (existing["state"] in listOf("downloading", "paused", "ready")) return existing
        val oldId = prefs.getLong("id", -1)
        if (oldId >= 0) manager.remove(oldId)
        directory.deleteRecursively()
        directory.mkdirs()
        val filename = "Brevia-$version-$build.apk"
        val request = DownloadManager.Request(Uri.parse("https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/android/$filename"))
            .setTitle("Brevia $version")
            .setMimeType("application/octet-stream")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "updates/$filename")
        val id = manager.enqueue(request)
        if (!prefs.edit().putLong("id", id).putString("version", version).putLong("build", build)
                .putLong("size", size).putString("sha256", digest).putString("filename", filename).commit()) {
            manager.remove(id)
            error("Cannot persist download")
        }
        return status()
    }

    @Synchronized
    fun status(): Map<String, Any> {
        val id = prefs.getLong("id", -1)
        if (id < 0) return mapOf("state" to "none")
        val installed = context.packageManager.getPackageInfo(context.packageName, 0).versionCode.toLong()
        if (prefs.getLong("build", 0) <= installed) {
            manager.remove(id)
            prefs.edit().clear().commit()
            directory.deleteRecursively()
            installDirectory.deleteRecursively()
            return mapOf("state" to "none")
        }
        var state = "failed"
        var bytes = 0L
        manager.query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
            if (cursor.moveToFirst()) {
                bytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                state = when (cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                    DownloadManager.STATUS_PENDING, DownloadManager.STATUS_RUNNING -> "downloading"
                    DownloadManager.STATUS_PAUSED -> "paused"
                    DownloadManager.STATUS_SUCCESSFUL -> if (File(directory, prefs.getString("filename", "")!!).isFile) "ready" else "failed"
                    else -> "failed"
                }
            }
        }
        return mapOf("state" to state, "bytes" to bytes, "size" to prefs.getLong("size", 0),
            "version" to prefs.getString("version", "")!!, "build" to prefs.getLong("build", 0))
    }

    @Synchronized
    fun discard() {
        val id = prefs.getLong("id", -1)
        if (id >= 0) manager.remove(id)
        prefs.edit().clear().commit()
        directory.deleteRecursively()
        installDirectory.deleteRecursively()
    }

    @Synchronized
    fun verifiedFile(): File {
        require(status()["state"] == "ready")
        val source = File(directory, prefs.getString("filename", "")!!).canonicalFile
        val size = prefs.getLong("size", -1)
        require(source.parentFile == directory.canonicalFile && source.isFile && source.length() == size)
        // 老版 Android 的外部存储可能被其他应用修改，先复制到私有目录再校验及安装。
        installDirectory.mkdirs()
        val privateFile = File(installDirectory, "update.apk")
        source.copyTo(privateFile, overwrite = true)
        return verifyUpdateFile(privateFile, installDirectory, size, prefs.getString("sha256", "")!!)
    }
}

internal fun verifyUpdateFile(candidate: File, directory: File, size: Long, expectedDigest: String): File {
    val file = candidate.canonicalFile
    require(file.parentFile == directory.canonicalFile && file.isFile && file.length() == size)
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(65536)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
        }
    }
    require(digest.digest().joinToString("") { "%02x".format(it) } == expectedDigest)
    return file
}
