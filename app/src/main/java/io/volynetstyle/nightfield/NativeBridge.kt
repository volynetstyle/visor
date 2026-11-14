package io.volynetstyle.nightfield

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

class NativeBridge(
    webView: WebView,
    private val camera: RawCamera,
) {
    private val main = Handler(Looper.getMainLooper())
    private var reply: JavaScriptReplyProxy? = null
    private val frameInFlight = AtomicBoolean(false)

    init {
        require(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            "Android System WebView is too old: WEB_MESSAGE_LISTENER unsupported"
        }

        WebViewCompat.addWebMessageListener(
            webView,
            "rawBridge",
            setOf(
                "https://appassets.androidplatform.net",
                "http://127.0.0.1:5173",
                "http://localhost:5173",
            ),
        ) { _, message, _, _, replyProxy ->
            reply = replyProxy
            if (message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
            val text = message.data ?: return@addWebMessageListener
            try {
                val cmd = JSONObject(text)
                when (cmd.optString("type")) {
                    "ready" -> sendJson(camera.capabilities())
                    "start" -> camera.start(
                        cmd.optLong("exposureNs", 50_000_000L),
                        cmd.optInt("iso", 800),
                    )
                    "stop" -> camera.stop()
                    "ack" -> frameInFlight.set(false)
                    "caps" -> sendJson(camera.capabilities())
                }
            } catch (t: Throwable) {
                sendJson(JSONObject().put("type", "error").put("message", "Bridge command failed: ${t.message}"))
            }
        }
    }

    fun sendFrame(packet: ByteArray) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) return
        if (!frameInFlight.compareAndSet(false, true)) return // Drop, don't queue stale photons.
        val r = reply ?: run {
            frameInFlight.set(false)
            return
        }
        main.post {
            try {
                r.postMessage(packet)
            } catch (_: Throwable) {
                frameInFlight.set(false)
            }
        }
    }

    fun sendJson(json: JSONObject) {
        val r = reply ?: return
        main.post {
            try { r.postMessage(json.toString()) } catch (_: Throwable) {}
        }
    }
}
