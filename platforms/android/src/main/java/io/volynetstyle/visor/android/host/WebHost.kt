package io.volynetstyle.visor.android.host
import android.annotation.SuppressLint
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.webkit.WebViewAssetLoader
import io.volynetstyle.visor.android.R
import io.volynetstyle.visor.contract.Protocol
import org.json.JSONObject
import java.io.ByteArrayInputStream

internal class WebHost(private val activity: ComponentActivity, private val onMessage: (String)->Unit,
    private val onReady: ()->Unit, private val onRendererGone: ()->Unit) {
    private var interfaceView: WebView = activity.findViewById(R.id.interface_view)
    private var webReady = false
    private var webDestroyed = false
    private var rendererRestarts = 0
    val ready get() = webReady
    fun start() = configureWebView()
    fun resume() { if (!webDestroyed) interfaceView.onResume() }
    fun pause() { if (!webDestroyed) interfaceView.onPause() }
    fun destroy() { if (!webDestroyed) { interfaceView.removeJavascriptInterface("Native"); interfaceView.destroy(); webDestroyed=true } }
    fun postFrame(callback: Runnable) { interfaceView.postOnAnimation(callback) }
    fun cancelFrame(callback: Runnable) { interfaceView.removeCallbacks(callback) }
    fun deliver(message: JSONObject, complete: ()->Unit) {
        interfaceView.evaluateJavascript("window.VisorPlatform && window.VisorPlatform.receive(" + message + ")") { complete() }
    }
    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webDestroyed = false
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(activity))
            .build()
        interfaceView.setBackgroundColor(Color.TRANSPARENT)
        interfaceView.settings.javaScriptEnabled = true
        interfaceView.settings.allowFileAccess = false
        interfaceView.settings.allowContentAccess = false
        interfaceView.settings.domStorageEnabled = false
        interfaceView.settings.blockNetworkLoads = true
        interfaceView.addJavascriptInterface(InterfaceBridge(), "Native")
        interfaceView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                return loader.shouldInterceptRequest(request.url)
                    ?: WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
            }

            override fun onPageFinished(view: WebView, url: String) {
                webReady = true
                onReady()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                webReady = false
                onRendererGone()
                (view.parent as? ViewGroup)?.removeView(view)
                view.removeJavascriptInterface("Native")
                view.destroy()
                webDestroyed = true
                if (activity.isFinishing || activity.isDestroyed) return true
                if (++rendererRestarts > 2) {
                    Toast.makeText(activity, R.string.interface_failed, Toast.LENGTH_SHORT).show()
                    activity.finish()
                    return true
                }
                interfaceView = WebView(activity).apply {
                    id = R.id.interface_view
                    overScrollMode = View.OVER_SCROLL_NEVER
                }
                activity.findViewById<FrameLayout>(R.id.root).addView(interfaceView, FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
                ))
                configureWebView()
                return true
            }
        }
        interfaceView.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    inner class InterfaceBridge {
        @JavascriptInterface
        fun postMessage(message: String) {
            if (message.length > Protocol.MAX_MESSAGE_BYTES) return
            activity.runOnUiThread {
                if (!activity.isDestroyed) onMessage(message)
            }
        }
    }


}
