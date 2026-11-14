package io.volynetstyle.nightfield

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.os.Build
import android.hardware.camera2.params.StreamConfigurationMap
import android.util.Size
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.min

class RawCamera(
    context: Context,
    private val onPacket: (Int, () -> ByteArray) -> Boolean,
    private val onEvent: (JSONObject) -> Unit,
) {
    private val manager = context.getSystemService(CameraManager::class.java)
    private val thread = HandlerThread("nightfield-camera").apply { start() }
    private val handler = Handler(thread.looper)

    private var device: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var reader: ImageReader? = null
    @Volatile private var selected: CameraInfo? = null
    private var exposureNs: Long = 250_000_000L
    private var iso: Int = 800
    private val frameId = AtomicInteger(0)
    private var generation = 0
    private var active = false
    private val results = LinkedHashMap<Long, TotalCaptureResult>()
    private data class PendingImage(val image: Image, val id: Int, val intervalNs: Long)
    private var pending: PendingImage? = null
    private var pendingTimeout: Runnable? = null
    private var lastTimestamp = 0L
    private var received = 0
    private var droppedBusy = 0
    private var droppedMetadata = 0
    @Volatile private var lastResult: TotalCaptureResult? = null

    private fun jsonValue(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        is String, is Boolean, is Int, is Long -> value
        is android.util.Rational -> JSONObject().put("numerator", value.numerator).put("denominator", value.denominator)
        is Number -> if (value.toDouble().isFinite()) value else value.toString()
        is android.util.Range<*> -> JSONObject().put("lower", jsonValue(value.lower)).put("upper", jsonValue(value.upper))
        is android.util.Size -> JSONObject().put("width", value.width).put("height", value.height)
        is android.util.SizeF -> JSONObject().put("width", value.width).put("height", value.height)
        is android.graphics.Rect -> JSONObject().put("left", value.left).put("top", value.top).put("right", value.right).put("bottom", value.bottom)
        is android.util.Pair<*, *> -> JSONArray().put(jsonValue(value.first)).put(jsonValue(value.second))
        is android.hardware.camera2.params.BlackLevelPattern -> JSONArray().also { out ->
            for (y in 0..1) for (x in 0..1) out.put(value.getOffsetForIndex(x, y))
        }
        is android.hardware.camera2.params.ColorSpaceTransform -> JSONArray().also { rows ->
            for (y in 0..2) rows.put(JSONArray().also { row -> for (x in 0..2) row.put(jsonValue(value.getElement(x, y))) })
        }
        is android.hardware.camera2.params.RggbChannelVector -> JSONArray().put(value.red).put(value.greenEven).put(value.greenOdd).put(value.blue)
        is StreamConfigurationMap -> {
            val formats = JSONArray()
            for (format in value.outputFormats) {
                val sizes = JSONArray()
                for (size in value.getOutputSizes(format).orEmpty()) {
                    sizes.put(JSONObject().put("size", jsonValue(size))
                        .put("minFrameDurationNs", value.getOutputMinFrameDuration(format, size))
                        .put("stallDurationNs", value.getOutputStallDuration(format, size)))
                }
                formats.put(JSONObject().put("format", format).put("sizes", sizes))
            }
            JSONObject().put("outputFormats", formats).put("inputFormats", jsonValue(value.inputFormats))
                .put("highSpeedVideoSizes", jsonValue(value.highSpeedVideoSizes))
        }
        else -> if (value.javaClass.isArray) {
            JSONArray().also { array ->
                for (index in 0 until java.lang.reflect.Array.getLength(value)) array.put(jsonValue(java.lang.reflect.Array.get(value, index)))
            }
        } else value.toString()
    }

    fun requestDiagnostics() {
        handler.post {
            try {
                val cameras = JSONArray()
                val ids = manager.cameraIdList.toMutableList()
                var index = 0
                while (index < ids.size) {
                    val id = ids[index++]
                    val entry = JSONObject().put("id", id)
                    try {
                        val chars = manager.getCameraCharacteristics(id)
                        val values = JSONObject()
                        for (key in chars.keys) {
                            try {
                                @Suppress("UNCHECKED_CAST")
                                values.put(key.name, jsonValue(chars.get(key as CameraCharacteristics.Key<Any>)))
                            } catch (t: Exception) { values.put(key.name, JSONObject().put("error", t.message ?: t.javaClass.simpleName)) }
                        }
                        entry.put("characteristics", values)
                        entry.put("availableRequestKeys", JSONArray(chars.availableCaptureRequestKeys?.map { it.name }.orEmpty()))
                        entry.put("availableResultKeys", JSONArray(chars.availableCaptureResultKeys?.map { it.name }.orEmpty()))
                        if (Build.VERSION.SDK_INT >= 28) {
                            val physical = chars.physicalCameraIds.toList()
                            entry.put("physicalCameraIds", JSONArray(physical))
                            entry.put("availableSessionKeys", JSONArray(chars.availableSessionKeys?.map { it.name }.orEmpty()))
                            for (physicalId in physical) if (physicalId !in ids) ids.add(physicalId)
                        }
                    } catch (t: Exception) { entry.put("error", t.message ?: t.javaClass.simpleName) }
                    cameras.put(entry)
                }
                val capture = lastResult?.let { result ->
                    JSONObject().also { metadata ->
                        for (key in result.keys) {
                            try {
                                @Suppress("UNCHECKED_CAST")
                                metadata.put(key.name, jsonValue(result.get(key as CaptureResult.Key<Any>)))
                            } catch (t: Exception) { metadata.put(key.name, JSONObject().put("error", t.message ?: t.javaClass.simpleName)) }
                        }
                    }
                }
                onEvent(JSONObject().put("type", "cameraInfo").put("androidApi", Build.VERSION.SDK_INT)
                    .put("selectedCameraId", selected?.id ?: JSONObject.NULL).put("cameras", cameras)
                    .put("latestCaptureResult", capture ?: JSONObject.NULL))
            } catch (t: Exception) {
                onEvent(JSONObject().put("type", "cameraInfoError").put("message", t.message ?: t.javaClass.simpleName))
            }
        }
    }

    data class CameraInfo(
        val id: String,
        val chars: CameraCharacteristics,
        val rawSize: Size,
        val cropSize: Size,
        val cropX: Int,
        val cropY: Int,
        val manual: Boolean,
        val exposureMin: Long,
        val exposureMax: Long,
        val isoMin: Int,
        val isoMax: Int,
        val cfa: Int,
        val whiteLevel: Int,
        val black: FloatArray,
        val sensorOrientation: Int,
        val minFrameDuration: Long,
        val stallDuration: Long,
        val maxFrameDuration: Long,
    )

    fun capabilities(preferredId: String? = null): JSONObject {
        val cameras = JSONArray()
        var preferred: CameraInfo? = null

        for (id in manager.cameraIdList) {
            val chars = manager.getCameraCharacteristics(id)
            val facing = chars.get(CameraCharacteristics.LENS_FACING)
            val caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: intArrayOf()
            val hasRaw = caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW)
            val manual = caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR)
            val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val rawSizes = if (hasRaw) map?.getOutputSizes(ImageFormat.RAW_SENSOR)?.toList().orEmpty() else emptyList()

            val item = JSONObject()
                .put("id", id)
                .put("facing", facing)
                .put("raw", hasRaw)
                .put("manual", manual)
                .put("rawSizes", JSONArray(rawSizes.map { "${it.width}x${it.height}" }))
            cameras.put(item)

            if (!hasRaw || rawSizes.isEmpty()) continue
            if (preferredId != null && id != preferredId) continue
            if (preferredId == null && facing != CameraCharacteristics.LENS_FACING_BACK) continue
            val info = makeInfo(id, chars, rawSizes)
            if (preferred == null || (manual && !preferred.manual)) preferred = info
        }

        if (preferred?.id != selected?.id) lastResult = null
        selected = preferred
        val root = JSONObject().put("type", "capabilities").put("cameras", cameras)
        if (preferred != null) root.put("selected", infoJson(preferred))
        else root.put("error", "No back camera advertises REQUEST_AVAILABLE_CAPABILITIES_RAW")
        return root
    }

    private fun makeInfo(id: String, chars: CameraCharacteristics, rawSizes: List<Size>): CameraInfo {
        // Smallest advertised RAW is best for the bridge MVP. We still crop further.
        val rawSize = rawSizes.minBy { it.width.toLong() * it.height }
        val maxW = min(rawSize.width, 1920) and -2
        val maxH = min(rawSize.height, 1440) and -2
        val cropX = ((rawSize.width - maxW) / 2) and -2
        val cropY = ((rawSize.height - maxH) / 2) and -2

        val caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: intArrayOf()
        val manual = caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR)
        val exp = chars.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
        val sens = chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
        val blackPattern = chars.get(CameraCharacteristics.SENSOR_BLACK_LEVEL_PATTERN)
        val black = FloatArray(4)
        if (blackPattern != null) {
            black[0] = blackPattern.getOffsetForIndex(0, 0).toFloat()
            black[1] = blackPattern.getOffsetForIndex(1, 0).toFloat()
            black[2] = blackPattern.getOffsetForIndex(0, 1).toFloat()
            black[3] = blackPattern.getOffsetForIndex(1, 1).toFloat()
        }
        return CameraInfo(
            id = id,
            chars = chars,
            rawSize = rawSize,
            cropSize = Size(maxW, maxH),
            cropX = cropX,
            cropY = cropY,
            manual = manual,
            exposureMin = exp?.lower ?: 100_000L,
            exposureMax = exp?.upper ?: 1_000_000_000L,
            isoMin = sens?.lower ?: 100,
            isoMax = sens?.upper ?: 3200,
            cfa = chars.get(CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT) ?: 0,
            whiteLevel = chars.get(CameraCharacteristics.SENSOR_INFO_WHITE_LEVEL) ?: 4095,
            black = black,
            sensorOrientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0,
            minFrameDuration = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                ?.getOutputMinFrameDuration(ImageFormat.RAW_SENSOR, rawSize) ?: 0L,
            stallDuration = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                ?.getOutputStallDuration(ImageFormat.RAW_SENSOR, rawSize) ?: 0L,
            maxFrameDuration = chars.get(CameraCharacteristics.SENSOR_INFO_MAX_FRAME_DURATION) ?: Long.MAX_VALUE,
        )
    }

    private fun infoJson(i: CameraInfo) = JSONObject()
        .put("id", i.id)
        .put("rawSize", "${i.rawSize.width}x${i.rawSize.height}")
        .put("cropSize", "${i.cropSize.width}x${i.cropSize.height}")
        .put("cropX", i.cropX)
        .put("cropY", i.cropY)
        .put("manual", i.manual)
        .put("exposureMinNs", i.exposureMin)
        .put("exposureMaxNs", i.exposureMax)
        .put("isoMin", i.isoMin)
        .put("isoMax", i.isoMax)
        .put("cfa", i.cfa)
        .put("whiteLevel", i.whiteLevel)
        .put("black", JSONArray(i.black.toList()))
        .put("sensorOrientation", i.sensorOrientation)
        .put("minFrameDurationNs", i.minFrameDuration)
        .put("stallDurationNs", i.stallDuration)
        .put("timestampSource", i.chars.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE))

    @SuppressLint("MissingPermission")
    fun start(requestExposureNs: Long, requestIso: Int) {
        handler.post { startOnCameraThread(requestExposureNs, requestIso) }
    }

    @SuppressLint("MissingPermission")
    private fun startOnCameraThread(requestExposureNs: Long, requestIso: Int) {
        stopOnCameraThread()
        val info = selected ?: run {
            onEvent(JSONObject().put("type", "error").put("message", "No RAW camera selected"))
            return
        }
        if (!info.manual || info.cfa !in 0..3) {
            onEvent(JSONObject().put("type", "error").put("message", "Static experiment requires manual sensor controls and a Bayer CFA (RGGB/GRBG/GBRG/BGGR)"))
            return
        }
        exposureNs = requestExposureNs.coerceIn(info.exposureMin, minOf(info.exposureMax, info.maxFrameDuration))
        iso = requestIso.coerceIn(info.isoMin, info.isoMax)
        received = 0
        droppedBusy = 0
        droppedMetadata = 0
        lastTimestamp = 0L
        lastResult = null
        active = true
        val token = generation

        try { manager.openCamera(info.id, object : CameraDevice.StateCallback() {
            override fun onOpened(camera: CameraDevice) {
                if (token != generation) { camera.close(); return }
                device = camera
                createSession(camera, info, token)
            }
            override fun onDisconnected(camera: CameraDevice) {
                camera.close()
                if (token != generation) return
                stopOnCameraThread()
                onEvent(JSONObject().put("type", "error").put("message", "Camera disconnected"))
            }
            override fun onError(camera: CameraDevice, error: Int) {
                camera.close()
                if (token != generation) return
                stopOnCameraThread()
                onEvent(JSONObject().put("type", "error").put("message", "Camera error $error"))
            }
        }, handler) } catch (t: Exception) {
            stopOnCameraThread()
            onEvent(JSONObject().put("type", "error").put("message", "Camera open failed: ${t.message}"))
        }
    }

    private fun createSession(camera: CameraDevice, info: CameraInfo, token: Int) {
        val imageReader = ImageReader.newInstance(
            info.rawSize.width,
            info.rawSize.height,
            ImageFormat.RAW_SENSOR,
            3,
        )
        reader = imageReader
        imageReader.setOnImageAvailableListener({ r ->
            if (token != generation) return@setOnImageAvailableListener
            val image = r.acquireLatestImage() ?: return@setOnImageAvailableListener
            received++
            val interval = if (lastTimestamp == 0L) 0L else image.timestamp - lastTimestamp
            lastTimestamp = image.timestamp
            discardPending()
            pending = PendingImage(image, frameId.incrementAndGet(), interval)
            if (!deliverMatched(info)) {
                val waiting = pending
                val timeout = Runnable {
                    if (pending === waiting) discardPending()
                }
                pendingTimeout = timeout
                handler.postDelayed(timeout, 2000L)
            }
        }, handler)

        camera.createCaptureSession(
            listOf(imageReader.surface),
            object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(s: CameraCaptureSession) {
                    if (token != generation) { s.close(); return }
                    session = s
                    try {
                        val template = if (info.manual) CameraDevice.TEMPLATE_MANUAL else CameraDevice.TEMPLATE_PREVIEW
                        val b = camera.createCaptureRequest(template)
                        b.addTarget(imageReader.surface)
                        if (info.manual) {
                            b.set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_OFF)
                            b.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_OFF)
                            b.set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_OFF)
                            if (info.chars.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES)
                                    ?.contains(CameraMetadata.CONTROL_AWB_MODE_OFF) == true) {
                                b.set(CaptureRequest.CONTROL_AWB_MODE, CameraMetadata.CONTROL_AWB_MODE_OFF)
                            }
                            b.set(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNs)
                            b.set(CaptureRequest.SENSOR_SENSITIVITY, iso)
                            b.set(CaptureRequest.SENSOR_FRAME_DURATION, maxOf(exposureNs, info.minFrameDuration))
                            val minFocus = info.chars.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
                            if (minFocus > 0f) b.set(CaptureRequest.LENS_FOCUS_DISTANCE, 0f)
                        }
                        s.setRepeatingRequest(b.build(), object : CameraCaptureSession.CaptureCallback() {
                            override fun onCaptureCompleted(s: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
                                if (token != generation) return
                                lastResult = result
                                val timestamp = result.get(CaptureResult.SENSOR_TIMESTAMP) ?: return
                                results[timestamp] = result
                                while (results.size > 16) results.remove(results.keys.first())
                                deliverMatched(info)
                            }
                            override fun onCaptureFailed(s: CameraCaptureSession, request: CaptureRequest, failure: CaptureFailure) {
                                if (token == generation) onEvent(JSONObject().put("type", "captureFailed").put("reason", failure.reason))
                            }
                        }, handler)
                        onEvent(JSONObject()
                            .put("type", "started")
                            .put("exposureNs", exposureNs)
                            .put("iso", iso)
                            .put("rawSize", "${info.rawSize.width}x${info.rawSize.height}")
                            .put("cropSize", "${info.cropSize.width}x${info.cropSize.height}"))
                    } catch (t: Throwable) {
                        stopOnCameraThread()
                        onEvent(JSONObject().put("type", "error").put("message", "Session start failed: ${t.message}"))
                    }
                }
                override fun onConfigureFailed(s: CameraCaptureSession) {
                    if (token != generation) return
                    stopOnCameraThread()
                    onEvent(JSONObject().put("type", "error").put("message", "Capture session configuration failed"))
                }
            },
            handler,
        )
    }

    private fun discardPending() {
        pendingTimeout?.let { handler.removeCallbacks(it) }
        pendingTimeout = null
        pending?.let { it.image.close(); droppedMetadata++ }
        pending = null
    }

    private fun deliverMatched(info: CameraInfo): Boolean {
        val item = pending ?: return false
        val result = results.remove(item.image.timestamp) ?: return false
        pending = null
        pendingTimeout?.let { handler.removeCallbacks(it) }
        pendingTimeout = null
        try {
            val actualExposure = result.get(CaptureResult.SENSOR_EXPOSURE_TIME)
            val actualIso = result.get(CaptureResult.SENSOR_SENSITIVITY)
            if (actualExposure == null || actualExposure <= 0L || actualIso == null || actualIso <= 0) {
                droppedMetadata++
                if (droppedMetadata == 1) onEvent(JSONObject().put("type", "log").put("message", "Dropping RAW without actual exposure/ISO metadata"))
                return true
            }
            if (!onPacket(item.id) { copyCrop(item, info, result, actualExposure, actualIso) }) droppedBusy++
        } catch (t: Exception) {
            onEvent(JSONObject().put("type", "error").put("message", "RAW copy failed: ${t.message}"))
        } finally {
            item.image.close()
        }
        return true
    }

    private fun copyCrop(item: PendingImage, info: CameraInfo, result: TotalCaptureResult, actualExposure: Long, actualIso: Int): ByteArray {
        val copyStart = SystemClock.elapsedRealtimeNanos()
        val image = item.image
        val plane = image.planes[0]
        val src = plane.buffer.duplicate()
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        require(pixelStride >= 2) { "Unexpected RAW pixelStride=$pixelStride" }

        val w = info.cropSize.width
        val h = info.cropSize.height
        val payload = ByteArray(w * h * 2)
        var dst = 0

        if (pixelStride == 2) {
            val rowBytes = w * 2
            for (y in 0 until h) {
                val pos = (info.cropY + y) * rowStride + info.cropX * 2
                src.position(pos)
                src.get(payload, dst, rowBytes)
                dst += rowBytes
            }
        } else {
            for (y in 0 until h) {
                val row = (info.cropY + y) * rowStride + info.cropX * pixelStride
                for (x in 0 until w) {
                    val p = row + x * pixelStride
                    payload[dst++] = src.get(p)
                    payload[dst++] = src.get(p + 1)
                }
            }
        }

        val dynamicBlack = result.get(CaptureResult.SENSOR_DYNAMIC_BLACK_LEVEL)
            ?.takeIf { it.size == 4 && it.all { v -> v.isFinite() && v >= 0f } }
        val dynamicWhite = result.get(CaptureResult.SENSOR_DYNAMIC_WHITE_LEVEL)?.takeIf { it > 0 }
        val noise = result.get(CaptureResult.SENSOR_NOISE_PROFILE)
            ?.takeIf { it.size == 4 && it.all { p -> p.first.isFinite() && p.second.isFinite() && p.first >= 0 && p.second >= 0 } }
        var flags = FramePacket.MATCHED_RESULT or FramePacket.MANUAL_SENSOR
        if (dynamicBlack != null) flags = flags or FramePacket.DYNAMIC_BLACK
        if (dynamicWhite != null) flags = flags or FramePacket.DYNAMIC_WHITE
        if (noise != null) flags = flags or FramePacket.NOISE_PROFILE
        val packet = FramePacket.encodeRaw16(
            payload = payload,
            width = w,
            height = h,
            sensorWidth = info.rawSize.width,
            sensorHeight = info.rawSize.height,
            cropX = info.cropX,
            cropY = info.cropY,
            frameId = item.id,
            timestampNs = image.timestamp,
            exposureNs = actualExposure,
            iso = actualIso,
            cfa = info.cfa,
            whiteLevel = dynamicWhite ?: info.whiteLevel,
            black = dynamicBlack ?: info.black,
            sensorOrientation = info.sensorOrientation,
            flags = flags,
            requestedExposureNs = exposureNs,
            requestedIso = iso,
            frameDurationNs = result.get(CaptureResult.SENSOR_FRAME_DURATION) ?: 0L,
            noiseProfile = DoubleArray(8) { n -> if (n % 2 == 0) noise?.get(n / 2)?.first ?: 0.0 else noise?.get(n / 2)?.second ?: 0.0 },
            captureIntervalNs = item.intervalNs,
            received = received,
            droppedBusy = droppedBusy,
            droppedMetadata = droppedMetadata,
        )
        ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN).putLong(200, SystemClock.elapsedRealtimeNanos() - copyStart)
        return packet
    }

    fun stop() {
        handler.post { stopOnCameraThread() }
    }

    private fun stopOnCameraThread() {
        generation++
        val wasActive = active
        active = false
        discardPending()
        results.clear()
        try { session?.stopRepeating() } catch (_: Throwable) {}
        try { session?.close() } catch (_: Throwable) {}
        try { device?.close() } catch (_: Throwable) {}
        try { reader?.close() } catch (_: Throwable) {}
        session = null
        device = null
        reader = null
        if (wasActive) onEvent(JSONObject().put("type", "stopped")
            .put("received", received).put("droppedBusy", droppedBusy).put("droppedMetadata", droppedMetadata))
    }

    fun close() {
        handler.post {
            stopOnCameraThread()
            thread.quitSafely()
        }
    }
}
