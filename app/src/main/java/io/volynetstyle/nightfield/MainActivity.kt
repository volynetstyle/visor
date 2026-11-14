package io.volynetstyle.nightfield

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.content.Intent
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var camera: RawCamera
    private var bridge: NativeBridge? = null
    private var pendingReport: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)
        configureWebView()

        lateinit var cameraRef: RawCamera
        cameraRef = RawCamera(
            context = this,
            onPacket = { frameId, encode -> bridge?.sendFrame(frameId, encode) ?: false },
            onEvent = { event -> bridge?.sendJson(event) },
        )
        camera = cameraRef
        bridge = NativeBridge(webView, camera, ::saveReport)

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

    private fun saveReport(json: String) {
        if (pendingReport != null) return
        pendingReport = json
        try {
            startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, "nightfield-${System.currentTimeMillis()}.json")
            }, 20)
        } catch (t: Exception) {
            pendingReport = null
            bridge?.sendJson(org.json.JSONObject().put("type", "error").put("message", "Cannot save report: ${t.message}"))
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 20) return
        val report = pendingReport
        pendingReport = null
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null || report == null) return
        try {
            val output = contentResolver.openOutputStream(uri) ?: error("No output stream")
            output.use { it.write(report.toByteArray(Charsets.UTF_8)) }
            bridge?.sendJson(org.json.JSONObject().put("type", "reportSaved"))
        } catch (t: Exception) {
            bridge?.sendJson(org.json.JSONObject().put("type", "error").put("message", "Report save failed: ${t.message}"))
        }
    }

    override fun onDestroy() {
        camera.close()
        webView.destroy()
        super.onDestroy()
    }
}
