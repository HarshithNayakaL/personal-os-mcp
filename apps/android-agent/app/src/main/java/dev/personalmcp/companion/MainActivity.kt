package dev.personalmcp.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.*
import android.provider.Settings
import android.widget.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MainActivity : Activity() {
    private val http = OkHttpClient.Builder().pingInterval(10, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS).build()
    private val worker = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private var socket: WebSocket? = null
    private var foreground = false
    private var connecting = false
    private lateinit var status: TextView
    private lateinit var code: EditText
    private lateinit var endpoint: EditText
    private lateinit var tokenStore: SecureToken
    private lateinit var capabilities: Capabilities
    private val cancelled = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val deviceId by lazy { val p=getSharedPreferences("settings",MODE_PRIVATE); p.getString("id",null) ?: ("android-"+UUID.randomUUID()).also { p.edit().putString("id",it).apply() } }
    private fun show(message: String) { runOnUiThread { status.text = message } }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); tokenStore=SecureToken(this); capabilities=Capabilities(this)
        val layout=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(32,48,32,32) }
        layout.addView(TextView(this).apply { setText(R.string.title); textSize=26f })
        layout.addView(TextView(this).apply { setText(R.string.instructions) })
        endpoint=EditText(this).apply { setText(getSharedPreferences("settings",MODE_PRIVATE).getString("endpoint","http://127.0.0.1:4319")); hint="Core endpoint" }; layout.addView(endpoint)
        code=EditText(this).apply { hint="One-time pairing code"; inputType=129 }; layout.addView(code)
        fun button(label:String, action:()->Unit) { layout.addView(Button(this).apply { text=label; setOnClickListener { action() } }) }
        button("Pair") { pair() }
        button("Connect") { connect() }
        button("Choose allowed folder") { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), 10) }
        button("Notification access") { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        button("Grant image access") { requestPermissions(if(Build.VERSION.SDK_INT>=34) arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) else arrayOf(if(Build.VERSION.SDK_INT>=33)Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE),11) }
        button("Disconnect") { socket?.close(1000,"User disconnected");socket=null;foreground=false;show("Disconnected") }
        status=TextView(this);layout.addView(status);setContentView(ScrollView(this).apply { addView(layout) })
    }
    private fun base(): String { val value=endpoint.text.toString().trim().trimEnd('/'); val uri=android.net.Uri.parse(value); require(uri.host in listOf("127.0.0.1","localhost") && uri.scheme=="http") { "V1 uses USB loopback only" };return value }
    private fun pair() {
        val url: String; try { url=base() }catch(e:Exception){show(e.message?:"Invalid endpoint");return}
        val pairingCode=code.text.toString().trim();show("Pairing…")
        worker.execute { try {
            val body=JSONObject().put("code",pairingCode).put("deviceId",deviceId).toString().toRequestBody("application/json".toMediaType())
            http.newCall(Request.Builder().url("$url/pair").post(body).build()).execute().use { response -> require(response.isSuccessful) { "Pairing rejected; request a fresh code" };tokenStore.save(JSONObject(response.body!!.string()).getString("token")) }
            getSharedPreferences("settings",MODE_PRIVATE).edit().putString("endpoint",url).apply()
            runOnUiThread { code.setText(""); connect() }
        }catch(e:Exception){show("Pairing failed: ${e.javaClass.simpleName}")} }
    }
    private fun connect() {
        if(connecting || socket!=null)return
        val url:String;val token:String
        try {url=base();token=tokenStore.read()?:error("Pair first")}catch(e:Exception){show(e.message?:"Pair first");return}
        foreground=true;connecting=true;show("Connecting…")
        socket=http.newWebSocket(Request.Builder().url(url.replaceFirst("http:","ws:")+"/agent").header("Authorization","Bearer $token").build(),object:WebSocketListener(){
            override fun onOpen(ws:WebSocket,response:Response){connecting=false;ws.send(JSONObject().put("type","register").put("device",JSONObject().put("id",deviceId).put("type","android").put("capabilities",JSONArray(Capabilities.names))).toString())}
            override fun onMessage(ws:WebSocket,text:String){try {
                require(text.length<=1064960);val m=JSONObject(text)
                if(m.getString("type")=="registered"){show("Connected as $deviceId");return}
                if(m.getString("type")=="cancel"){cancelled.add(m.getString("id"));return}
                require(m.getString("type")=="execute");val id=m.getString("id");UUID.fromString(id)
                val deadline=SystemClock.elapsedRealtime()+m.getLong("timeoutMs").coerceIn(100,300000)
                runOnUiThread {
                    val result=JSONObject()
                    try { require(foreground && !cancelled.remove(id) && SystemClock.elapsedRealtime()<deadline) { "REQUEST_EXPIRED" };result.put("ok",true).put("data",capabilities.execute(m.getString("capability"),m.getJSONObject("args"))) }
                    catch(e:Exception){result.put("ok",false).put("error",JSONObject().put("code","ANDROID_ERROR").put("message",e.message?.take(300)?:e.javaClass.simpleName))}
                    ws.send(JSONObject().put("type","result").put("id",id).put("result",result).toString())
                }
            }catch(e:Exception){ws.close(1008,"Malformed request")} }
            override fun onFailure(ws:WebSocket,t:Throwable,response:Response?){disconnected(ws)}
            override fun onClosed(ws:WebSocket,code:Int,reason:String){disconnected(ws)}
            private fun disconnected(ws:WebSocket){runOnUiThread { if(socket===ws){socket=null;connecting=false;show("Disconnected; retrying while app is open");if(foreground)handler.postDelayed({connect()},3000)} }}
        })
    }
    override fun onResume(){super.onResume();foreground=true;try { if(tokenStore.read()!=null) connect() } catch(e:Exception) { show("Pair again to restore secure credentials") }}
    override fun onPause(){super.onPause();foreground=false;handler.removeCallbacksAndMessages(null);socket?.close(1000,"Companion backgrounded");socket=null;connecting=false}
    override fun onDestroy(){super.onDestroy();worker.shutdownNow();http.dispatcher.executorService.shutdown()}
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?){
        super.onActivityResult(requestCode,resultCode,data)
        if(requestCode==10&&resultCode==RESULT_OK){
            val uri=data?.data?:return
            if (data.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0) contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            else contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            getSharedPreferences("settings",MODE_PRIVATE).edit().putString("tree",uri.toString()).apply();show("Folder access granted")
        }
    }
}
