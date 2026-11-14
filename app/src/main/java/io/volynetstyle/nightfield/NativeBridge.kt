package io.volynetstyle.nightfield

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

class NativeBridge(
    webView: WebView,
    private val camera: RawCamera,
    private val onSaveReport: (String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var reply: JavaScriptReplyProxy? = null
    private val frameInFlight = AtomicInteger(0)

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
                    "ready" -> {
                        camera.stop()
                        frameInFlight.set(0)
                        sendJson(camera.capabilities())
                    }
                    "start" -> {
                        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) {
                            "Android System WebView does not support binary RAW transport"
                        }
                        camera.start(cmd.optLong("exposureNs", 250_000_000L), cmd.optInt("iso", 800))
                    }
                    "stop" -> camera.stop()
                    "ack" -> frameInFlight.compareAndSet(cmd.optInt("frameId"), 0)
                    "caps" -> sendJson(camera.capabilities())
                    "saveReport" -> {
                        val json = cmd.getString("json")
                        require(json.length <= 4_000_000) { "Report is too large" }
                        onSaveReport(json)
                    }
                }
            } catch (t: Throwable) {
                sendJson(JSONObject().put("type", "error").put("message", "Bridge command failed: ${t.message}"))
            }
        }
    }

    fun sendFrame(frameId: Int, encode: () -> ByteArray): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) return false
        val r = reply ?: return false
        // Reserve before invoking the expensive RAW crop/copy supplier.
        if (!frameInFlight.compareAndSet(0, frameId)) return false
        val packet = try { encode() } catch (t: Throwable) {
            frameInFlight.compareAndSet(frameId, 0)
            throw t
        }
        main.post {
            try {
                r.postMessage(packet)
            } catch (_: Throwable) {
                frameInFlight.compareAndSet(frameId, 0)
            }
        }
        return true
    }

    fun sendJson(json: JSONObject) {
        val r = reply ?: return
        main.post {
            try { r.postMessage(json.toString()) } catch (_: Throwable) {}
        }
    }
}
