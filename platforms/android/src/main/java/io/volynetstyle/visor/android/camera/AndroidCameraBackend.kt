package io.volynetstyle.visor.android.camera

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.view.OrientationEventListener
import android.view.Surface
import android.widget.Toast
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
import io.volynetstyle.visor.contract.*
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt



internal class AndroidCameraBackend(private val host: ComponentActivity) {
    private enum class Mode { PHOTO, VIDEO }

    private lateinit var previewView: PreviewView
    private val executor by lazy { ContextCompat.getMainExecutor(host) }
    private val preferences by lazy { host.getSharedPreferences("pure_camera", android.content.Context.MODE_PRIVATE) }
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

    private val cameraPermission = host.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && previewRequested) startCamera() else if (!granted) showCameraPermission()
        completeAccessRequest(granted)
    }
    private val storagePermission = host.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val requestedMode = pendingStorageMode
        pendingStorageMode = null
        if (granted && requestedMode == mode) continueCapture()
        else if (!granted) finishCapture(null, "", ErrorCode.PERMISSION_DENIED)
    }
    private val audioPermission = host.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        audioPermissionPending = false
        if (mode == Mode.VIDEO && cameraReady && gate.isReady && activeCapture != null && !captureCancelled) startVideo(granted)
        else if (activeCapture != null) finishCapture(null, "", ErrorCode.CANCELLED)
    }


    private var uiResumed = false
    private lateinit var backendChannel: CameraSink
    fun attach(preview: PreviewView, channel: CameraSink) {
        previewView = preview
        backendChannel = channel
        previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        previewView.scaleType = PreviewView.ScaleType.FILL_CENTER
    }
    fun setInsets(top: Int, bottom: Int, left: Int, right: Int) {
        insetsTop=top; insetsBottom=bottom; insetsLeft=left; insetsRight=right
        publishState()
    }
    fun onCreate(savedInstanceState: Bundle?) {
        if (savedInstanceState != null) {
            mode = if (savedInstanceState.getString("mode") == "video") Mode.VIDEO else Mode.PHOTO
            lens = savedInstanceState.getInt("lens", CameraSelector.LENS_FACING_BACK)
            flashMode = savedInstanceState.getInt("flash", ImageCapture.FLASH_MODE_AUTO)
        }
        orientationListener = object : OrientationEventListener(host) {
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

    fun onResume() {
        uiResumed = true
        if (pendingAccess != null) completeAccessRequest(hasPermission(Manifest.permission.CAMERA))
        if (hasPermission(Manifest.permission.CAMERA)) {
            if (previewRequested && provider == null) startCamera()
            else if (previewRequested && !cameraReady && gate.isReady) bindCamera()
        } else { cameraReady = false; showCameraPermission() }
        publishState()
    }
    fun onPause() { uiResumed = false }
    fun onSaveInstanceState(outState: Bundle) {
        outState.putString("mode", if (mode == Mode.PHOTO) "photo" else "video")
        outState.putInt("lens", lens); outState.putInt("flash", flashMode)
    }
    fun onConfigurationChanged() { if (gate.isReady) bindCamera() else rebindAfterCapture = true }
    fun onDestroy() { cancelCurrentCapture(); orientationListener.disable(); recording?.close() }
    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(host, permission) == PackageManager.PERMISSION_GRANTED

    fun executeBackend(request: BackendRequest) {
        val params = request.params
        if (!uiResumed && request.method !in setOf(VisorMethod.SYSTEM_CONNECT, VisorMethod.CAMERA_STOP, VisorMethod.CAMERA_CANCELCAPTURE)) {
            backendChannel.error(request, ErrorCode.BUSY)
            return
        }
        when (request.method) {
            VisorMethod.SYSTEM_CONNECT -> {
                publishState()
                backendChannel.result(request, backendSnapshot())
            }
            VisorMethod.CAMERA_CAPABILITIES -> backendChannel.result(request, backendSnapshot().capabilities)
            VisorMethod.SYSTEM_OPENGALLERY -> {
                if (openGallery()) backendChannel.result(request) else backendChannel.error(request, ErrorCode.UNAVAILABLE)
            }
            VisorMethod.SYSTEM_REQUESTCAMERAACCESS -> {
                if (hasPermission(Manifest.permission.CAMERA)) backendChannel.result(request)
                else if (pendingAccess != null) backendChannel.error(request, ErrorCode.BUSY)
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
                    backendChannel.error(request, ErrorCode.PERMISSION_DENIED)
                } else if (!gate.isReady || activeCapture != null || pendingStart != null) {
                    backendChannel.error(request, ErrorCode.BUSY)
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
                pendingStart?.let { backendChannel.error(it, ErrorCode.CANCELLED) }
                pendingStart = null
                provider?.unbindAll()
                publishState()
                backendChannel.result(request)
            }
            VisorMethod.CAMERA_TAKEPHOTO, VisorMethod.CAMERA_STARTRECORDING -> {
                val photo = request.method == VisorMethod.CAMERA_TAKEPHOTO
                if (!cameraReady || !previewRequested) backendChannel.error(request, ErrorCode.UNAVAILABLE)
                else if (!gate.isReady || activeCapture != null || pendingStorageMode != null || audioPermissionPending) backendChannel.error(request, ErrorCode.BUSY)
                else if (photo != (mode == Mode.PHOTO)) backendChannel.error(request, ErrorCode.INVALID_ARGUMENT)
                else {
                    activeCapture = request
                    captureCancelled = false
                    onShutter()
                    publishState()
                }
            }
            VisorMethod.CAMERA_STOPRECORDING -> {
                if (activeCapture?.id != params.getString("captureId")) backendChannel.error(request, ErrorCode.STALE_CAPTURE)
                else if (gate.state != CaptureGate.State.RECORDING || pendingStop != null) backendChannel.error(request, ErrorCode.BUSY)
                else { pendingStop = request; onShutter() }
            }
            VisorMethod.CAMERA_CANCELCAPTURE -> {
                if (activeCapture?.id != params.getString("captureId")) backendChannel.error(request, ErrorCode.STALE_CAPTURE)
                else { cancelCurrentCapture(); publishState(); backendChannel.result(request) }
            }
            VisorMethod.CAMERA_SETFLASH -> {
                val flash = FlashMode.entries.firstOrNull { it.wire == params.getString("mode") }
                    ?: throw IllegalArgumentException()
                val torch = params.get("torch") as? Boolean ?: throw IllegalArgumentException()
                if (!cameraReady) backendChannel.error(request, ErrorCode.UNAVAILABLE)
                else if (camera?.cameraInfo?.hasFlashUnit() != true) backendChannel.error(request, ErrorCode.UNSUPPORTED)
                else if (mode == Mode.PHOTO && !gate.isReady) backendChannel.error(request, ErrorCode.BUSY)
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
                            } catch (_: Exception) { backendChannel.error(request, ErrorCode.UNAVAILABLE) }
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
        if (granted) backendChannel.result(request) else backendChannel.error(request, ErrorCode.PERMISSION_DENIED)
    }

    fun resetBackendSession() {
        cancelCurrentCapture()
        pendingStart = null
        pendingAccess = null
    }

    fun cancelCurrentCapture() {
        val request = activeCapture ?: return
        captureCancelled = true
        backendChannel.error(request, ErrorCode.CANCELLED)
        backendChannel.capture(request, null, ErrorCode.CANCELLED)
        pendingStop?.let { backendChannel.error(it, ErrorCode.CANCELLED) }
        pendingStop = null
        if (gate.state == CaptureGate.State.RECORDING && gate.stopVideo()) recording?.stop()
        if (gate.isReady) finishCapture(null, "", ErrorCode.CANCELLED)
    }

    private fun finishCapture(uri: Uri?, mime: String, failure: ErrorCode? = null) {
        val request = activeCapture ?: return
        val stop = pendingStop
        val cancelled = captureCancelled
        activeCapture = null
        pendingStop = null
        captureCancelled = false
        val invalid = uri == null || uri == Uri.EMPTY
        if (cancelled || failure != null) {
            if (!invalid) try { host.contentResolver.delete(uri!!, null, null) } catch (_: Exception) { /* Best effort cleanup. */ }
        } else if (!invalid) remember(uri, mime)
        captureFinished()
        val error = if (cancelled) ErrorCode.CANCELLED else failure ?: if (invalid) ErrorCode.SAVE_FAILED else null
        if (error != null) {
            backendChannel.error(request, error)
            stop?.let { backendChannel.error(it, error) }
            backendChannel.capture(request, null, error)
        } else {
            val result = CaptureResult(request.id, uri.toString(), mime)
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
                    !host.shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) CameraAccess.SETTINGS else CameraAccess.PROMPT,
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
            !host.shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
            host.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", host.packageName, null)
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
        val future = ProcessCameraProvider.getInstance(host)
        future.addListener({
            providerStarting = false
            if (host.isFinishing || host.isDestroyed) return@addListener
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
            if (!previewRequested || generation != bindingGeneration || host.isFinishing || host.isDestroyed || !gate.isReady) return@post
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
                camera = currentProvider.bindToLifecycle(host, selector(lens), group.build())
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
            if (activeCapture != null) finishCapture(null, "", ErrorCode.CANCELLED)
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
            host.contentResolver,
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            values("image/jpeg", "jpg"),
        ).build()
        try {
            capture.takePicture(output, executor, object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                    if (activeCapture !== operation) {
                        result.savedUri?.let { try { host.contentResolver.delete(it, null, null) } catch (_: Exception) {} }
                        return
                    }
                    gate.finishPhoto()
                    finishCapture(result.savedUri, "image/jpeg")
                }

                override fun onError(exception: ImageCaptureException) {
                    if (activeCapture !== operation) return
                    gate.finishPhoto()
                    finishCapture(null, "", ErrorCode.SAVE_FAILED)
                }
            })
        } catch (_: Exception) {
            gate.finishPhoto()
            finishCapture(null, "", ErrorCode.SAVE_FAILED)
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
                host.contentResolver,
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            ).setContentValues(values("video/mp4", "mp4")).build()
            var pending = capture.output.prepareRecording(host, output)
            if (withAudio && hasPermission(Manifest.permission.RECORD_AUDIO)) {
                pending = pending.withAudioEnabled()
            }
            recording = pending.start(executor) { event ->
                if (activeCapture !== operation) {
                    if (event is VideoRecordEvent.Finalize && event.outputResults.outputUri != Uri.EMPTY) {
                        try { host.contentResolver.delete(event.outputResults.outputUri, null, null) } catch (_: Exception) {}
                    }
                    return@start
                }
                when (event) {
                    is VideoRecordEvent.Start -> {
                        gate.videoStarted()
                        publishState()
                        activeCapture?.let {
                            if (captureCancelled) backendChannel.error(it, ErrorCode.CANCELLED)
                            else backendChannel.result(it, CaptureRef(it.id))
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
                        finishCapture(event.outputResults.outputUri, "video/mp4", if (event.hasError()) ErrorCode.SAVE_FAILED else null)
                    }
                }
            }
        } catch (_: Exception) {
            gate.finishVideo()
            finishCapture(null, "", ErrorCode.SAVE_FAILED)
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
                host.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), mime).apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                })
                return true
            } catch (_: Exception) {
                // The file or viewer may have been removed; use the system media picker.
            }
        }
        try {
            host.startActivity(Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
                addCategory(Intent.CATEGORY_OPENABLE)
            })
            return true
        } catch (_: Exception) {
            return false
        }
    }


    fun publishState() {
        if (host.isDestroyed) return
        val state = backendSnapshot()
        backendChannel.observe(state)
        pendingStart?.let {
            if (state.phase == CameraPhase.LIVE) {
                pendingStart = null
                backendChannel.result(it)
            } else if (state.phase == CameraPhase.FAILED) {
                pendingStart = null
                backendChannel.error(it, ErrorCode.UNAVAILABLE)
            }
        }
    }
}
