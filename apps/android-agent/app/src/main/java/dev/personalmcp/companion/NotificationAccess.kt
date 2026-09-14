package dev.personalmcp.companion
import android.service.notification.NotificationListenerService
import org.json.JSONArray
import org.json.JSONObject
class NotificationAccess : NotificationListenerService() {
    override fun onListenerConnected() { instance = this }
    override fun onListenerDisconnected() { instance = null }
    companion object {
        @Volatile var instance: NotificationAccess? = null
        fun metadata(): JSONArray {
            val service = instance ?: error("PERMISSION_REQUIRED: Enable notification access in Android Settings")
            return JSONArray(service.activeNotifications.take(100).map {
                JSONObject().put("package", it.packageName).put("id", it.id).put("postedAt", it.postTime)
            })
        }
    }
}
