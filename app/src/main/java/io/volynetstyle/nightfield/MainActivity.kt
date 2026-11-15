package io.volynetstyle.nightfield

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.view.OrientationEventListener
import android.view.Surface
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.MediaStoreOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import io.volynetstyle.visor.contract.*
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {
    private enum class Mode { PHOTO, VIDEO }

    private lateinit var previewView: PreviewView
    private lateinit var interfaceView: WebView
    private val executor by lazy { ContextCompat.getMainExecutor(this) }
    private val preferences by lazy { getSharedPreferences("pure_camera", MODE_PRIVATE) }
    private val gate = CaptureGate()

    private var provider: ProcessCameraProvider? = null
    private var providerStarting = false
    private var camera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var videoCapture: VideoCapture<Recorder>? = null
    private var recording: Recording? = null
    private var cameraReady = false
    private var hasOtherCamera = false
    private var focusSupported = false
    private var rebindAfterCapture = false
    private var bindingGeneration = 0
    private var mode = Mode.PHOTO
    private var lens = CameraSelector.LENS_FACING_BACK
    private var flashMode = ImageCapture.FLASH_MODE_AUTO
    private var torchOn = false
    private var targetRotation = Surface.ROTATION_0
    private var zoomRatio = 1.0
    private var durationSeconds = 0L
    private var cameraFailure: ErrorCode? = null
    private var webReady = false
    private var webDestroyed = false
    private var rendererRestarts = 0
    private var uiResumed = false
    private val backendChannel by lazy {
        AndroidBackendChannel(BackendOutbox(
            postFrame = { interfaceView.postOnAnimation(it) },
            cancelFrame = { interfaceView.removeCallbacks(it) },
            deliver = { message: JSONObject, complete ->
                interfaceView.evaluateJavascript(
                    "window.VisorPlatform && window.VisorPlatform.receive(" + message + ")"
                ) { complete() }
            },
        ), onSessionReset = ::resetBackendSession, execute = ::executeBackend)
    }
    private var previewRequested = false
    private var pendingStart: BackendRequest? = null
    private var pendingAccess: BackendRequest? = null
    private var activeCapture: BackendRequest? = null
    private var captureCancelled = false
    private var pendingStop: BackendRequest? = null
    private var photoSupport = Support.UNKNOWN
    private var videoSupport = Support.UNKNOWN
    private var pendingStorageMode: Mode? = null
    private var audioPermissionPending = false
    private var insetsTop = 0
    private var insetsBottom = 0
    private var insetsLeft = 0
    private var insetsRight = 0
    private lateinit var orientationListener: OrientationEventListener

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && previewRequested) startCamera() else if (!granted) showCameraPermission()
        completeAccessRequest(granted)
    }
    private val storagePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val requestedMode = pendingStorageMode
        pendingStorageMode = null
        if (granted && requestedMode == mode) continueCapture()
        else if (!granted) finishCapture(null, "", "PERMISSION_DENIED")
    }
    private val audioPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        audioPermissionPending = false
        if (mode == Mode.VIDEO && cameraReady && gate.isReady && activeCapture != null && !captureCancelled) startVideo(granted)
        else if (activeCapture != null) finishCapture(null, "", "CANCELLED")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        previewView = findViewById(R.id.preview)
        interfaceView = findViewById(R.id.interface_view)
        // TextureView keeps the native camera preview below the transparent WebView.
        previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        previewView.scaleType = PreviewView.ScaleType.FILL_CENTER
        configureWebView()

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { _, windowInsets ->
            val bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val density = resources.displayMetrics.density
            insetsTop = (bars.top / density).roundToInt()
            insetsBottom = (bars.bottom / density).roundToInt()
            insetsLeft = (bars.left / density).roundToInt()
            insetsRight = (bars.right / density).roundToInt()
            publishState()
            windowInsets
        }

        if (savedInstanceState != null) {
            mode = if (savedInstanceState.getString("mode") == "video") Mode.VIDEO else Mode.PHOTO
            lens = savedInstanceState.getInt("lens", CameraSelector.LENS_FACING_BACK)
            flashMode = savedInstanceState.getInt("flash", ImageCapture.FLASH_MODE_AUTO)
        }
        orientationListener = object : OrientationEventListener(this) {
            override fun onOrientationChanged(orientation: Int) {
                if (orientation == ORIENTATION_UNKNOWN) return
                val rotation = when (orientation) {
                    in 45..134 -> Surface.ROTATION_270
                    in 135..224 -> Surface.ROTATION_180
                    in 225..314 -> Surface.ROTATION_90
                    else -> Surface.ROTATION_0
                }
                if (rotation != targetRotation) {
                    targetRotation = rotation
                    imageCapture?.targetRotation = rotation
                    if (gate.isReady) videoCapture?.targetRotation = rotation
                }
            }
        }
        orientationListener.enable()

        if (!hasPermission(Manifest.permission.CAMERA)) {
            showCameraPermission()
        }
    }

    override fun onResume() {
        super.onResume()
        interfaceView.onResume()
        uiResumed = true
        backendChannel.setActive(webReady)
        if (pendingAccess != null) completeAccessRequest(hasPermission(Manifest.permission.CAMERA))
        if (hasPermission(Manifest.permission.CAMERA)) {
            if (previewRequested && provider == null) startCamera()
            else if (previewRequested && !cameraReady && gate.isReady) bindCamera()
        } else {
            cameraReady = false
            showCameraPermission()
        }
        publishState()
    }

    override fun onPause() {
        uiResumed = false
        backendChannel.setActive(false)
        if (!webDestroyed) interfaceView.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("mode", if (mode == Mode.PHOTO) "photo" else "video")
        outState.putInt("lens", lens)
        outState.putInt("flash", flashMode)
        super.onSaveInstanceState(outState)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (gate.isReady) bindCamera() else rebindAfterCapture = true
    }

    override fun onDestroy() {
        backendChannel.resetDelivery()
        cancelCurrentCapture()
        orientationListener.disable()
        recording?.close()
        if (!webDestroyed) {
            interfaceView.removeJavascriptInterface("Native")
            interfaceView.destroy()
            webDestroyed = true
        }
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webDestroyed = false
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
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
                backendChannel.setActive(uiResumed)
                publishState()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                webReady = false
                backendChannel.resetDelivery()
                (view.parent as? ViewGroup)?.removeView(view)
                view.removeJavascriptInterface("Native")
                view.destroy()
                webDestroyed = true
                if (isFinishing || isDestroyed) return true
                if (++rendererRestarts > 2) {
                    toast(R.string.interface_failed)
                    finish()
                    return true
                }
                interfaceView = WebView(this@MainActivity).apply {
                    id = R.id.interface_view
                    overScrollMode = View.OVER_SCROLL_NEVER
                }
                findViewById<FrameLayout>(R.id.root).addView(interfaceView, FrameLayout.LayoutParams(
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
            runOnUiThread {
                if (!isDestroyed) backendChannel.receive(message)
            }
        }
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun executeBackend(request: BackendRequest) {
        val params = request.params
        if (!uiResumed && request.method !in setOf(VisorMethod.SYSTEM_CONNECT, VisorMethod.CAMERA_STOP, VisorMethod.CAMERA_CANCELCAPTURE)) {
            backendChannel.error(request, "BUSY")
            return
        }
        when (request.method) {
            VisorMethod.SYSTEM_CONNECT -> {
                publishState()
                backendChannel.result(request, backendSnapshot().toWire())
                backendChannel.setActive(webReady && uiResumed)
            }
            VisorMethod.CAMERA_CAPABILITIES -> backendChannel.result(request, backendSnapshot().toWire().getJSONObject("capabilities"))
            VisorMethod.SYSTEM_OPENGALLERY -> {
                if (openGallery()) backendChannel.result(request) else backendChannel.error(request, "UNAVAILABLE")
            }
            VisorMethod.SYSTEM_REQUESTCAMERAACCESS -> {
                if (hasPermission(Manifest.permission.CAMERA)) backendChannel.result(request)
                else if (pendingAccess != null) backendChannel.error(request, "BUSY")
                else {
                    pendingAccess = request
                    showCameraPermission()
                    handleMessageAction()
                }
            }
            VisorMethod.CAMERA_START -> {
                val requestedMode = CameraMode.entries.firstOrNull { it.wire == params.getString("mode") }
                    ?: throw IllegalArgumentException()
                val requestedLens = LensFacing.entries.firstOrNull { it.wire == params.getString("lens") }
                    ?: throw IllegalArgumentException()
                if (!hasPermission(Manifest.permission.CAMERA)) {
                    showCameraPermission()
                    backendChannel.error(request, "PERMISSION_DENIED")
                } else if (!gate.isReady || activeCapture != null || pendingStart != null) {
                    backendChannel.error(request, "BUSY")
                } else {
                    val nextMode = if (requestedMode == CameraMode.PHOTO) Mode.PHOTO else Mode.VIDEO
                    val nextLens = if (requestedLens == LensFacing.BACK) CameraSelector.LENS_FACING_BACK else CameraSelector.LENS_FACING_FRONT
                    previewRequested = true
                    if (cameraReady && mode == nextMode && lens == nextLens) {
                        publishState()
                        backendChannel.result(request)
                    } else {
                        if (lens != nextLens) { photoSupport = Support.UNKNOWN; videoSupport = Support.UNKNOWN }
                        mode = nextMode
                        lens = nextLens
                        pendingStart = request
                        startCamera()
                    }
                }
            }
            VisorMethod.CAMERA_STOP -> {
                previewRequested = false
                bindingGeneration++
                cameraReady = false
                cancelCurrentCapture()
                pendingStart?.let { backendChannel.error(it, "CANCELLED") }
                pendingStart = null
                provider?.unbindAll()
                publishState()
                backendChannel.result(request)
            }
            VisorMethod.CAMERA_TAKEPHOTO, VisorMethod.CAMERA_STARTRECORDING -> {
                val photo = request.method == VisorMethod.CAMERA_TAKEPHOTO
                if (!cameraReady || !previewRequested) backendChannel.error(request, "UNAVAILABLE")
                else if (!gate.isReady || activeCapture != null || pendingStorageMode != null || audioPermissionPending) backendChannel.error(request, "BUSY")
                else if (photo != (mode == Mode.PHOTO)) backendChannel.error(request, "INVALID_ARGUMENT")
                else {
                    activeCapture = request
                    captureCancelled = false
                    onShutter()
                    publishState()
                }
            }
            VisorMethod.CAMERA_STOPRECORDING -> {
                if (activeCapture?.id != params.getString("captureId")) backendChannel.error(request, "STALE_CAPTURE")
                else if (gate.state != CaptureGate.State.RECORDING || pendingStop != null) backendChannel.error(request, "BUSY")
                else { pendingStop = request; onShutter() }
            }
            VisorMethod.CAMERA_CANCELCAPTURE -> {
                if (activeCapture?.id != params.getString("captureId")) backendChannel.error(request, "STALE_CAPTURE")
                else { cancelCurrentCapture(); publishState(); backendChannel.result(request) }
            }
            VisorMethod.CAMERA_SETFLASH -> {
                val flash = FlashMode.entries.firstOrNull { it.wire == params.getString("mode") }
                    ?: throw IllegalArgumentException()
                val torch = params.get("torch") as? Boolean ?: throw IllegalArgumentException()
                if (!cameraReady) backendChannel.error(request, "UNAVAILABLE")
                else if (camera?.cameraInfo?.hasFlashUnit() != true) backendChannel.error(request, "UNSUPPORTED")
                else if (mode == Mode.PHOTO && !gate.isReady) backendChannel.error(request, "BUSY")
                else {
                    flashMode = when (flash) {
                        FlashMode.AUTO -> ImageCapture.FLASH_MODE_AUTO
                        FlashMode.ON -> ImageCapture.FLASH_MODE_ON
                        FlashMode.OFF -> ImageCapture.FLASH_MODE_OFF
                    }
                    imageCapture?.flashMode = flashMode
                    if (mode == Mode.VIDEO) {
                        val operation = camera!!.cameraControl.enableTorch(torch)
                        operation.addListener({
                            try {
                                operation.get()
                                torchOn = torch
                                publishState()
                                backendChannel.result(request)
                            } catch (_: Exception) { backendChannel.error(request, "UNAVAILABLE") }
                        }, executor)
                    } else { publishState(); backendChannel.result(request) }
                }
            }
            VisorMethod.CAMERA_FOCUS -> {
                val x = (params.get("x") as? Number)?.toDouble() ?: throw IllegalArgumentException()
                val y = (params.get("y") as? Number)?.toDouble() ?: throw IllegalArgumentException()
                require(x.isFinite() && y.isFinite() && x in 0.0..1.0 && y in 0.0..1.0)
                if (focusSupported) focusAt(x.toFloat(), y.toFloat())
            }
            VisorMethod.CAMERA_ZOOMBY -> {
                val factor = (params.get("factor") as? Number)?.toDouble() ?: throw IllegalArgumentException()
                require(factor.isFinite() && factor in 0.01..100.0)
                zoomBy(factor.toFloat())
            }
        }
    }

    private fun completeAccessRequest(granted: Boolean) {
        val request = pendingAccess ?: return
        pendingAccess = null
        publishState()
        if (granted) backendChannel.result(request) else backendChannel.error(request, "PERMISSION_DENIED")
    }

    private fun resetBackendSession() {
        cancelCurrentCapture()
        pendingStart = null
        pendingAccess = null
    }

    private fun cancelCurrentCapture() {
        val request = activeCapture ?: return
        captureCancelled = true
        backendChannel.error(request, "CANCELLED")
        backendChannel.capture(request, null, "CANCELLED")
        pendingStop?.let { backendChannel.error(it, "CANCELLED") }
        pendingStop = null
        if (gate.state == CaptureGate.State.RECORDING && gate.stopVideo()) recording?.stop()
        if (gate.isReady) finishCapture(null, "", "CANCELLED")
    }

    private fun finishCapture(uri: Uri?, mime: String, failure: String? = null) {
        val request = activeCapture ?: return
        val stop = pendingStop
        val cancelled = captureCancelled
        activeCapture = null
        pendingStop = null
        captureCancelled = false
        val invalid = uri == null || uri == Uri.EMPTY
        if (cancelled || failure != null) {
            if (!invalid) try { contentResolver.delete(uri!!, null, null) } catch (_: Exception) { /* Best effort cleanup. */ }
        } else if (!invalid) remember(uri, mime)
        captureFinished()
        val error = if (cancelled) "CANCELLED" else failure ?: if (invalid) "SAVE_FAILED" else null
        if (error != null) {
            backendChannel.error(request, error)
            stop?.let { backendChannel.error(it, error) }
            backendChannel.capture(request, null, error)
        } else {
            val result = JSONObject().put("captureId", request.id).put("uri", uri.toString()).put("mime", mime)
            backendChannel.result(request, result)
            stop?.let { backendChannel.result(it, result) }
            backendChannel.capture(request, result, null)
        }
    }

    private fun backendSnapshot(): CameraState {
        val zoom = camera?.cameraInfo?.zoomState?.value
        val phase = when {
            !previewRequested -> CameraPhase.IDLE
            captureCancelled -> CameraPhase.CANCELLING
            gate.state == CaptureGate.State.STOPPING_VIDEO -> CameraPhase.STOPPING
            gate.state == CaptureGate.State.RECORDING -> CameraPhase.RECORDING
            activeCapture != null -> CameraPhase.CAPTURING
            cameraFailure != null -> CameraPhase.FAILED
            cameraReady -> CameraPhase.LIVE
            else -> CameraPhase.STARTING
        }
        return CameraState(
            phase, if (mode == Mode.PHOTO) CameraMode.PHOTO else CameraMode.VIDEO,
            if (lens == CameraSelector.LENS_FACING_BACK) LensFacing.BACK else LensFacing.FRONT,
            if (previewRequested) activeCapture?.id else null, durationSeconds * 1000.0, zoomRatio,
            when (flashMode) {
                ImageCapture.FLASH_MODE_AUTO -> FlashMode.AUTO
                ImageCapture.FLASH_MODE_ON -> FlashMode.ON
                else -> FlashMode.OFF
            }, torchOn, uiResumed,
            if (hasPermission(Manifest.permission.CAMERA)) CameraAccess.GRANTED
                else if (preferences.getBoolean("asked_camera", false) &&
                    !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) CameraAccess.SETTINGS else CameraAccess.PROMPT,
            if (phase == CameraPhase.FAILED) cameraFailure else null,
            Capabilities(photoSupport, videoSupport, Support.UNSUPPORTED, Support.UNSUPPORTED,
                Support.UNSUPPORTED, Support.UNSUPPORTED, camera?.cameraInfo?.hasFlashUnit() == true,
                hasOtherCamera, focusSupported, zoom?.minZoomRatio?.toDouble() ?: 1.0,
                zoom?.maxZoomRatio?.toDouble() ?: 1.0),
            Insets(insetsTop.toDouble(), insetsBottom.toDouble(), insetsLeft.toDouble(), insetsRight.toDouble()),
        )
    }

    private fun requestCameraPermission() {
        preferences.edit().putBoolean("asked_camera", true).apply()
        cameraPermission.launch(Manifest.permission.CAMERA)
    }

    private fun showCameraPermission() {
        publishState()
    }

    private fun handleMessageAction() {
        if (preferences.getBoolean("asked_camera", false) &&
            !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            })
        } else requestCameraPermission()
    }

    private fun startCamera() {
        if (!previewRequested || !hasPermission(Manifest.permission.CAMERA) || providerStarting) return
        if (provider != null) {
            bindCamera()
            return
        }
        providerStarting = true
        cameraFailure = null
        publishState()
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            providerStarting = false
            if (isFinishing || isDestroyed) return@addListener
            try {
                provider = future.get()
                val selected = selector(lens)
                if (provider?.hasCamera(selected) != true) {
                    throw IllegalArgumentException("Requested lens is unavailable")
                }
                bindCamera()
            } catch (_: Exception) {
                cameraReady = false
                cameraFailure = ErrorCode.UNAVAILABLE
                publishState()
            }
        }, executor)
    }

    private fun selector(facing: Int): CameraSelector =
        CameraSelector.Builder().requireLensFacing(facing).build()

    private fun bindCamera() {
        val currentProvider = provider ?: return
        if (!previewRequested) return
        if (!hasPermission(Manifest.permission.CAMERA)) {
            showCameraPermission()
            return
        }
        if (!gate.isReady) {
            rebindAfterCapture = true
            return
        }
        val generation = ++bindingGeneration
        cameraReady = false
        cameraFailure = null
        publishState()
        previewView.post {
            if (!previewRequested || generation != bindingGeneration || isFinishing || isDestroyed || !gate.isReady) return@post
            try {
                currentProvider.unbindAll()
                camera = null
                imageCapture = null
                videoCapture = null
                torchOn = false
                val preview = Preview.Builder().build().also {
                    it.surfaceProvider = previewView.surfaceProvider
                }
                val group = UseCaseGroup.Builder().addUseCase(preview)
                previewView.viewPort?.let { group.setViewPort(it) }
                if (mode == Mode.PHOTO) {
                    imageCapture = ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                        .setTargetRotation(targetRotation)
                        .build()
                    group.addUseCase(imageCapture!!)
                } else {
                    val quality = QualitySelector.fromOrderedList(
                        listOf(Quality.FHD, Quality.HD, Quality.SD),
                        FallbackStrategy.lowerQualityOrHigherThan(Quality.HD),
                    )
                    val recorder = Recorder.Builder().setQualitySelector(quality).build()
                    videoCapture = VideoCapture.withOutput(recorder).also { it.targetRotation = targetRotation }
                    group.addUseCase(videoCapture!!)
                }
                camera = currentProvider.bindToLifecycle(this, selector(lens), group.build())
                val focusPoint = previewView.meteringPointFactory.createPoint(previewView.width / 2f, previewView.height / 2f)
                focusSupported = camera!!.cameraInfo.isFocusMeteringSupported(FocusMeteringAction.Builder(focusPoint).build())
                hasOtherCamera = currentProvider.hasCamera(selector(
                    if (lens == CameraSelector.LENS_FACING_BACK)
                        CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK
                ))
                imageCapture?.flashMode = if (camera?.cameraInfo?.hasFlashUnit() == true)
                    flashMode else ImageCapture.FLASH_MODE_OFF
                cameraReady = true
                zoomRatio = 1.0
                if (mode == Mode.PHOTO) photoSupport = Support.SUPPORTED else videoSupport = Support.SUPPORTED
                cameraFailure = null
            } catch (_: Exception) {
                cameraReady = false
                cameraFailure = ErrorCode.UNAVAILABLE
            }
            publishState()
        }
    }

    private fun onShutter() {
        if (gate.state == CaptureGate.State.RECORDING) {
            if (gate.stopVideo()) recording?.stop()
            publishState()
            return
        }
        if (!cameraReady || !gate.isReady) return
        if (Build.VERSION.SDK_INT <= 28 && !hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            pendingStorageMode = mode
            storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        continueCapture()
    }

    private fun continueCapture() {
        if (!cameraReady || !gate.isReady || activeCapture == null || captureCancelled) {
            if (activeCapture != null) finishCapture(null, "", "CANCELLED")
            return
        }
        if (mode == Mode.PHOTO) {
            takePhoto()
        } else if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
            startVideo(true)
        } else if (!preferences.getBoolean("asked_audio", false)) {
            preferences.edit().putBoolean("asked_audio", true).apply()
            audioPermissionPending = true
            audioPermission.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            startVideo(false)
        }
    }

    private fun values(mime: String, extension: String): ContentValues {
        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
        return ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, "PureCamera_" + timestamp + "." + extension)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DCIM + "/Pure Camera")
            }
        }
    }

    private fun takePhoto() {
        val operation = activeCapture ?: return
        val capture = imageCapture ?: return
        if (!gate.beginPhoto()) return
        publishState()
        val output = ImageCapture.OutputFileOptions.Builder(
            contentResolver,
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            values("image/jpeg", "jpg"),
        ).build()
        try {
            capture.takePicture(output, executor, object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                    if (activeCapture !== operation) {
                        result.savedUri?.let { try { contentResolver.delete(it, null, null) } catch (_: Exception) {} }
                        return
                    }
                    gate.finishPhoto()
                    finishCapture(result.savedUri, "image/jpeg")
                }

                override fun onError(exception: ImageCaptureException) {
                    if (activeCapture !== operation) return
                    gate.finishPhoto()
                    finishCapture(null, "", "SAVE_FAILED")
                }
            })
        } catch (_: Exception) {
            gate.finishPhoto()
            finishCapture(null, "", "SAVE_FAILED")
        }
    }

    @SuppressLint("MissingPermission")
    private fun startVideo(withAudio: Boolean) {
        val operation = activeCapture ?: return
        val capture = videoCapture ?: return
        if (!gate.beginVideo()) return
        durationSeconds = 0L
        publishState()
        try {
            val output = MediaStoreOutputOptions.Builder(
                contentResolver,
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            ).setContentValues(values("video/mp4", "mp4")).build()
            var pending = capture.output.prepareRecording(this, output)
            if (withAudio && hasPermission(Manifest.permission.RECORD_AUDIO)) {
                pending = pending.withAudioEnabled()
            }
            recording = pending.start(executor) { event ->
                if (activeCapture !== operation) {
                    if (event is VideoRecordEvent.Finalize && event.outputResults.outputUri != Uri.EMPTY) {
                        try { contentResolver.delete(event.outputResults.outputUri, null, null) } catch (_: Exception) {}
                    }
                    return@start
                }
                when (event) {
                    is VideoRecordEvent.Start -> {
                        gate.videoStarted()
                        publishState()
                        activeCapture?.let {
                            if (captureCancelled) backendChannel.error(it, "CANCELLED")
                            else backendChannel.result(it, JSONObject().put("captureId", it.id))
                        }
                        if (captureCancelled && gate.stopVideo()) recording?.stop()
                    }
                    is VideoRecordEvent.Status -> {
                        val seconds = TimeUnit.NANOSECONDS.toSeconds(event.recordingStats.recordedDurationNanos)
                        if (seconds != durationSeconds) {
                            durationSeconds = seconds
                            publishState()
                        }
                    }
                    is VideoRecordEvent.Finalize -> {
                        recording = null
                        gate.finishVideo()
                        finishCapture(event.outputResults.outputUri, "video/mp4", if (event.hasError()) "SAVE_FAILED" else null)
                    }
                }
            }
        } catch (_: Exception) {
            gate.finishVideo()
            finishCapture(null, "", "SAVE_FAILED")
        }
    }

    private fun captureFinished() {
        if (rebindAfterCapture) {
            rebindAfterCapture = false
            bindCamera()
        } else {
            publishState()
        }
    }

    private fun focusAt(x: Float, y: Float) {
        val activeCamera = camera ?: return
        if (!cameraReady) return
        val point = previewView.meteringPointFactory.createPoint(
            x * previewView.width, y * previewView.height,
        )
        val action = FocusMeteringAction.Builder(point)
            .setAutoCancelDuration(3, TimeUnit.SECONDS)
            .build()
        activeCamera.cameraControl.startFocusAndMetering(action)
    }

    private fun zoomBy(factor: Float) {
        val activeCamera = camera ?: return
        if (!cameraReady) return
        val zoom = activeCamera.cameraInfo.zoomState.value ?: return
        val ratio = (zoom.zoomRatio * factor).coerceIn(zoom.minZoomRatio, zoom.maxZoomRatio)
        activeCamera.cameraControl.setZoomRatio(ratio)
        zoomRatio = ratio.toDouble()
        publishState()
    }

    private fun remember(uri: Uri?, mime: String) {
        if (uri == null || uri == Uri.EMPTY) return
        preferences.edit().putString("last_uri", uri.toString()).putString("last_mime", mime).apply()
    }

    private fun openGallery(): Boolean {
        val uri = preferences.getString("last_uri", null)
        val mime = preferences.getString("last_mime", "image/jpeg")
        if (uri != null) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), mime).apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                })
                return true
            } catch (_: Exception) {
                // The file or viewer may have been removed; use the system media picker.
            }
        }
        try {
            startActivity(Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
                addCategory(Intent.CATEGORY_OPENABLE)
            })
            return true
        } catch (_: Exception) {
            return false
        }
    }

    private fun toast(resource: Int) = Toast.makeText(this, resource, Toast.LENGTH_SHORT).show()

    private fun publishState() {
        if (isDestroyed) return
        val state = backendSnapshot()
        backendChannel.observe(state)
        pendingStart?.let {
            if (state.phase == CameraPhase.LIVE) {
                pendingStart = null
                backendChannel.result(it)
            } else if (state.phase == CameraPhase.FAILED) {
                pendingStart = null
                backendChannel.error(it, "UNAVAILABLE")
            }
        }
    }
}
