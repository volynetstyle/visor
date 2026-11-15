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
    private var rebindAfterCapture = false
    private var bindingGeneration = 0
    private var mode = Mode.PHOTO
    private var lens = CameraSelector.LENS_FACING_BACK
    private var flashMode = ImageCapture.FLASH_MODE_AUTO
    private var torchOn = false
    private var targetRotation = Surface.ROTATION_0
    private var zoomLabel = "1×"
    private var durationLabel = "00:00"
    private var message = ""
    private var messageAction = ""
    private var webReady = false
    private var webDestroyed = false
    private var rendererRestarts = 0
    private var pendingStorageMode: Mode? = null
    private var insetsTop = 0
    private var insetsBottom = 0
    private var insetsLeft = 0
    private var insetsRight = 0
    private lateinit var orientationListener: OrientationEventListener

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCamera() else showCameraPermission()
    }
    private val storagePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val requestedMode = pendingStorageMode
        pendingStorageMode = null
        if (granted && requestedMode == mode) continueCapture()
        else if (!granted) toast(R.string.storage_permission_needed)
    }
    private val audioPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) toast(R.string.video_silent)
        if (mode == Mode.VIDEO && cameraReady && gate.isReady) startVideo(granted)
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
            if (!preferences.getBoolean("asked_camera", false)) requestCameraPermission()
        }
    }

    override fun onResume() {
        super.onResume()
        if (hasPermission(Manifest.permission.CAMERA)) {
            if (provider == null) startCamera()
            else if (!cameraReady && gate.isReady) bindCamera()
        } else {
            cameraReady = false
            showCameraPermission()
        }
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
                publishState()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                webReady = false
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
        fun action(command: String) {
            runOnUiThread {
                when (command) {
                    "permission" -> handleMessageAction()
                    "photo" -> selectMode(Mode.PHOTO)
                    "video" -> selectMode(Mode.VIDEO)
                    "shutter" -> onShutter()
                    "switch" -> switchCamera()
                    "flash" -> switchFlash()
                    "gallery" -> openGallery()
                }
            }
        }

        @JavascriptInterface
        fun focus(x: Double, y: Double) {
            if (!x.isFinite() || !y.isFinite() || x !in 0.0..1.0 || y !in 0.0..1.0) return
            runOnUiThread { focusAt(x.toFloat(), y.toFloat()) }
        }

        @JavascriptInterface
        fun zoom(factor: Double) {
            if (!factor.isFinite() || factor !in 0.5..2.0) return
            runOnUiThread { zoomBy(factor.toFloat()) }
        }
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun requestCameraPermission() {
        preferences.edit().putBoolean("asked_camera", true).apply()
        cameraPermission.launch(Manifest.permission.CAMERA)
    }

    private fun showCameraPermission() {
        val permanentlyDenied = preferences.getBoolean("asked_camera", false) &&
            !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)
        message = getString(if (permanentlyDenied) R.string.camera_settings else R.string.camera_permission)
        messageAction = if (permanentlyDenied) "settings" else "permission"
        publishState()
    }

    private fun handleMessageAction() {
        when (messageAction) {
            "permission" -> requestCameraPermission()
            "settings" -> startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            })
            "retry" -> if (provider == null) startCamera() else bindCamera()
        }
    }

    private fun startCamera() {
        if (!hasPermission(Manifest.permission.CAMERA) || providerStarting) return
        if (provider != null) {
            bindCamera()
            return
        }
        providerStarting = true
        message = getString(R.string.camera_loading)
        messageAction = ""
        publishState()
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            providerStarting = false
            if (isFinishing || isDestroyed) return@addListener
            try {
                provider = future.get()
                val selected = selector(lens)
                if (provider?.hasCamera(selected) != true) {
                    lens = if (lens == CameraSelector.LENS_FACING_BACK)
                        CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK
                }
                bindCamera()
            } catch (_: Exception) {
                cameraReady = false
                message = getString(R.string.camera_retry)
                messageAction = "retry"
                publishState()
            }
        }, executor)
    }

    private fun selector(facing: Int): CameraSelector =
        CameraSelector.Builder().requireLensFacing(facing).build()

    private fun bindCamera() {
        val currentProvider = provider ?: return
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
        message = getString(R.string.camera_loading)
        messageAction = ""
        publishState()
        previewView.post {
            if (generation != bindingGeneration || isFinishing || isDestroyed || !gate.isReady) return@post
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
                hasOtherCamera = currentProvider.hasCamera(selector(
                    if (lens == CameraSelector.LENS_FACING_BACK)
                        CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK
                ))
                imageCapture?.flashMode = if (camera?.cameraInfo?.hasFlashUnit() == true)
                    flashMode else ImageCapture.FLASH_MODE_OFF
                cameraReady = true
                zoomLabel = "1×"
                message = ""
                messageAction = ""
            } catch (_: Exception) {
                cameraReady = false
                message = getString(R.string.camera_retry)
                messageAction = "retry"
            }
            publishState()
        }
    }

    private fun selectMode(next: Mode) {
        if (!gate.isReady || mode == next || provider == null) return
        mode = next
        bindCamera()
    }

    private fun switchCamera() {
        if (!gate.isReady || !hasOtherCamera) return
        lens = if (lens == CameraSelector.LENS_FACING_BACK)
            CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK
        bindCamera()
    }

    private fun switchFlash() {
        val currentCamera = camera ?: return
        if (!cameraReady || !currentCamera.cameraInfo.hasFlashUnit()) return
        if (mode == Mode.VIDEO) {
            torchOn = !torchOn
            currentCamera.cameraControl.enableTorch(torchOn)
        } else {
            flashMode = when (flashMode) {
                ImageCapture.FLASH_MODE_AUTO -> ImageCapture.FLASH_MODE_ON
                ImageCapture.FLASH_MODE_ON -> ImageCapture.FLASH_MODE_OFF
                else -> ImageCapture.FLASH_MODE_AUTO
            }
            imageCapture?.flashMode = flashMode
        }
        publishState()
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
        if (!cameraReady || !gate.isReady) return
        if (mode == Mode.PHOTO) {
            takePhoto()
        } else if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
            startVideo(true)
        } else if (!preferences.getBoolean("asked_audio", false)) {
            preferences.edit().putBoolean("asked_audio", true).apply()
            audioPermission.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            toast(R.string.video_silent)
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
                    remember(result.savedUri, "image/jpeg")
                    toast(R.string.saved_photo)
                    gate.finishPhoto()
                    captureFinished()
                }

                override fun onError(exception: ImageCaptureException) {
                    toast(R.string.save_failed)
                    gate.finishPhoto()
                    captureFinished()
                }
            })
        } catch (_: Exception) {
            gate.finishPhoto()
            toast(R.string.save_failed)
            captureFinished()
        }
    }

    @SuppressLint("MissingPermission")
    private fun startVideo(withAudio: Boolean) {
        val capture = videoCapture ?: return
        if (!gate.beginVideo()) return
        durationLabel = "00:00"
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
                when (event) {
                    is VideoRecordEvent.Start -> {
                        gate.videoStarted()
                        publishState()
                    }
                    is VideoRecordEvent.Status -> {
                        val seconds = TimeUnit.NANOSECONDS.toSeconds(event.recordingStats.recordedDurationNanos)
                        durationLabel = String.format(Locale.US, "%02d:%02d", seconds / 60, seconds % 60)
                        publishState()
                    }
                    is VideoRecordEvent.Finalize -> {
                        recording = null
                        if (event.hasError()) {
                            toast(R.string.save_failed)
                        } else {
                            remember(event.outputResults.outputUri, "video/mp4")
                            toast(R.string.saved_video)
                        }
                        gate.finishVideo()
                        captureFinished()
                    }
                }
            }
        } catch (_: Exception) {
            gate.finishVideo()
            toast(R.string.save_failed)
            captureFinished()
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
        zoomLabel = String.format(Locale.US, "%.1f×", ratio).replace(".0×", "×")
        publishState()
    }

    private fun remember(uri: Uri?, mime: String) {
        if (uri == null || uri == Uri.EMPTY) return
        preferences.edit().putString("last_uri", uri.toString()).putString("last_mime", mime).apply()
    }

    private fun openGallery() {
        val uri = preferences.getString("last_uri", null)
        val mime = preferences.getString("last_mime", "image/jpeg")
        if (uri != null) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), mime).apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                })
                return
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
        } catch (_: Exception) {
            toast(R.string.gallery_unavailable)
        }
    }

    private fun toast(resource: Int) = Toast.makeText(this, resource, Toast.LENGTH_SHORT).show()

    private fun publishState() {
        if (!webReady || isDestroyed) return
        val isRecording = gate.state == CaptureGate.State.RECORDING
        val isStopping = gate.state == CaptureGate.State.STOPPING_VIDEO
        val selectionEnabled = gate.isReady && provider != null && hasPermission(Manifest.permission.CAMERA)
        val flashAvailable = cameraReady && camera?.cameraInfo?.hasFlashUnit() == true
        val flashText = if (mode == Mode.VIDEO) {
            getString(if (torchOn) R.string.torch_on else R.string.torch_off)
        } else {
            getString(when (flashMode) {
                ImageCapture.FLASH_MODE_ON -> R.string.flash_on
                ImageCapture.FLASH_MODE_OFF -> R.string.flash_off
                else -> R.string.flash_auto
            })
        }
        val state = JSONObject()
            .put("mode", if (mode == Mode.PHOTO) "photo" else "video")
            .put("ready", cameraReady)
            .put("selectionEnabled", selectionEnabled)
            .put("shutterEnabled", cameraReady && (gate.isReady || isRecording))
            .put("recording", isRecording || isStopping)
            .put("duration", durationLabel)
            .put("switchEnabled", selectionEnabled && hasOtherCamera)
            .put("flashEnabled", flashAvailable)
            .put("flash", flashText)
            .put("zoom", zoomLabel)
            .put("message", message)
            .put("messageEnabled", messageAction.isNotEmpty())
            .put("insets", JSONObject()
                .put("top", insetsTop).put("bottom", insetsBottom)
                .put("left", insetsLeft).put("right", insetsRight))
        interfaceView.evaluateJavascript("window.PureCamera && window.PureCamera.render(" + state + ")", null)
    }
}
