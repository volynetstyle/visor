package io.volynetstyle.nightfield

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var camera: RawCamera
    private var bridge: NativeBridge? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)
        configureWebView()

        lateinit var cameraRef: RawCamera
        cameraRef = RawCamera(
            context = this,
            onPacket = { packet -> bridge?.sendFrame(packet) },
            onEvent = { event -> bridge?.sendJson(event) },
        )
        camera = cameraRef
        bridge = NativeBridge(webView, camera)

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), 10)
        }

        val override = intent.getStringExtra("url")
        webView.loadUrl(override ?: "https://appassets.androidplatform.net/assets/www/index.html")
    }

    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                loader.shouldInterceptRequest(request.url)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 10 && grantResults.firstOrNull() != PackageManager.PERMISSION_GRANTED) {
            bridge?.sendJson(org.json.JSONObject().put("type", "error").put("message", "Camera permission denied"))
        }
    }

    override fun onDestroy() {
        camera.close()
        webView.destroy()
        super.onDestroy()
    }
}
