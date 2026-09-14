package dev.personalmcp.companion

import android.Manifest
import android.app.Activity
import android.content.*
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.provider.MediaStore
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject

class Capabilities(private val activity: Activity) {
    private val prefs = activity.getSharedPreferences("settings", Context.MODE_PRIVATE)
    companion object {
        val names = listOf("device.info", "device.battery", "device.network", "apps.list", "apps.launch", "intent.open", "intent.share", "clipboard.read", "clipboard.write", "files.list", "files.read", "files.write", "files.copy", "files.move", "files.share", "notifications.list", "browser.open", "media.list")
        fun segments(path: String): List<String> {
            require(!path.startsWith("/") && !path.contains('\\') && !path.contains('\u0000')) { "PATH_DENIED" }
            val parts = path.split('/').filter { it.isNotEmpty() }
            require(parts.none { it == "." || it == ".." || it.contains(':') }) { "PATH_DENIED" }
            return parts
        }
    }
    private fun root(): DocumentFile {
        val uri = prefs.getString("tree", null) ?: error("PERMISSION_REQUIRED: Choose a folder in the companion")
        return DocumentFile.fromTreeUri(activity, Uri.parse(uri)) ?: error("STORAGE_UNAVAILABLE")
    }
    private fun file(path: String): DocumentFile {
        var doc = root()
        for (part in segments(path)) doc = doc.findFile(part) ?: error("FILE_NOT_FOUND")
        return doc
    }
    private fun create(path: String): DocumentFile {
        val parts = segments(path); require(parts.isNotEmpty()) { "ROOT_PROTECTED" }
        var parent = root()
        for (part in parts.dropLast(1)) parent = parent.findFile(part) ?: error("PARENT_NOT_FOUND")
        return parent.findFile(parts.last()) ?: parent.createFile("application/octet-stream", parts.last()) ?: error("CREATE_FAILED")
    }
    private fun read(doc: DocumentFile): ByteArray {
        require(doc.length() <= 1048576) { "OUTPUT_LIMIT" }
        return activity.contentResolver.openInputStream(doc.uri)!!.use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) { val count = input.read(buffer); if (count < 0) break; require(output.size() + count <= 1048576) { "OUTPUT_LIMIT" }; output.write(buffer, 0, count) }
            output.toByteArray()
        }
    }
    private fun open(url: String) {
        val uri = Uri.parse(url); require(uri.scheme in listOf("https", "http", "mailto", "tel")) { "URL_DENIED" }
        activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
    }
    fun execute(name: String, a: JSONObject): Any {
        val resolver = activity.contentResolver
        return when (name) {
            "device.info" -> JSONObject().put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL).put("sdk", Build.VERSION.SDK_INT)
            "device.battery" -> JSONObject().put("percent", (activity.getSystemService(Context.BATTERY_SERVICE) as BatteryManager).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
            "device.network" -> { val cm = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager; JSONObject().put("connected", cm.activeNetwork != null) }
            "apps.list" -> JSONArray(activity.packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0).take(500).map { JSONObject().put("name", it.loadLabel(activity.packageManager)).put("packageName", it.activityInfo.packageName) })
            "apps.launch" -> { activity.startActivity(activity.packageManager.getLaunchIntentForPackage(a.getString("packageName")) ?: error("APP_UNAVAILABLE")); JSONObject().put("launched", true) }
            "intent.open", "browser.open" -> { open(a.getString("url")); JSONObject().put("opened", true) }
            "intent.share" -> { activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, a.getString("text")), "Share with")); JSONObject().put("chooserOpened", true) }
            "clipboard.read" -> { val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager; JSONObject().put("text", clipboard.primaryClip?.getItemAt(0)?.coerceToText(activity)?.toString() ?: "") }
            "clipboard.write" -> { (activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Personal MCP", a.getString("text"))); JSONObject().put("written", true) }
            "files.list" -> JSONArray(file(a.optString("path", "")).listFiles().take(1000).map { JSONObject().put("name", it.name).put("directory", it.isDirectory).put("size", it.length()) })
            "files.read" -> JSONObject().put("content", String(read(file(a.getString("path"))), Charsets.UTF_8)).put("encoding", "utf8")
            "files.write" -> { val bytes = a.getString("content").toByteArray(); require(bytes.size <= 1048576) { "INPUT_LIMIT" }; resolver.openOutputStream(create(a.getString("path")).uri, "wt")!!.use { it.write(bytes) }; JSONObject().put("bytes", bytes.size) }
            "files.copy", "files.move" -> {
                val source = file(a.getString("source")); require(segments(a.getString("source")).isNotEmpty()) { "ROOT_PROTECTED" }
                val destination = a.getString("destination"); val parts = segments(destination); require(parts.isNotEmpty())
                val parent = file(parts.dropLast(1).joinToString("/")); require(parent.findFile(parts.last()) == null) { "DESTINATION_EXISTS" }
                val bytes = read(source); resolver.openOutputStream(create(destination).uri, "wt")!!.use { it.write(bytes) }
                if (name == "files.move") require(source.delete()) { "SOURCE_DELETE_FAILED" }; JSONObject().put("copied", true)
            }
            "files.share" -> { val doc = file(a.getString("path")); activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(doc.type ?: "application/octet-stream").putExtra(Intent.EXTRA_STREAM, doc.uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Share file")); JSONObject().put("chooserOpened", true) }
            "notifications.list" -> NotificationAccess.metadata()
            "media.list" -> {
                val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE
                val partial = Build.VERSION.SDK_INT >= 34 && activity.checkSelfPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED
                require(partial || activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) { "PERMISSION_REQUIRED: Grant media access in companion" }
                val output = JSONArray(); resolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME), null, null, "${MediaStore.Images.Media.DATE_ADDED} DESC")?.use { cursor -> while (cursor.moveToNext() && output.length() < 100) output.put(JSONObject().put("id", cursor.getLong(0)).put("name", cursor.getString(1))) }; output
            }
            else -> error("UNKNOWN_CAPABILITY")
        }
    }
}
