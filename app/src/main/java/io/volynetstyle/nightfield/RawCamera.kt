package io.volynetstyle.nightfield

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.hardware.camera2.params.BlackLevelPattern
import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Size
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.min

class RawCamera(
    context: Context,
    private val onPacket: (ByteArray) -> Unit,
    private val onEvent: (JSONObject) -> Unit,
) {
    private val manager = context.getSystemService(CameraManager::class.java)
    private val thread = HandlerThread("nightfield-camera").apply { start() }
    private val handler = Handler(thread.looper)

    private var device: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var reader: ImageReader? = null
    private var selected: CameraInfo? = null
    private var exposureNs: Long = 50_000_000L
    private var iso: Int = 800
    private val frameId = AtomicInteger(0)

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
    )

    fun capabilities(): JSONObject {
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

            if (facing != CameraCharacteristics.LENS_FACING_BACK || !hasRaw || rawSizes.isEmpty()) continue
            val info = makeInfo(id, chars, rawSizes)
            if (preferred == null || (manual && !preferred.manual)) preferred = info
        }

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

    @SuppressLint("MissingPermission")
    fun start(requestExposureNs: Long, requestIso: Int) {
        val info = selected ?: run {
            onEvent(JSONObject().put("type", "error").put("message", "No RAW camera selected"))
            return
        }
        stop()
        exposureNs = requestExposureNs.coerceIn(info.exposureMin, info.exposureMax)
        iso = requestIso.coerceIn(info.isoMin, info.isoMax)

        manager.openCamera(info.id, object : CameraDevice.StateCallback() {
            override fun onOpened(camera: CameraDevice) {
                device = camera
                createSession(camera, info)
            }
            override fun onDisconnected(camera: CameraDevice) {
                camera.close()
                onEvent(JSONObject().put("type", "error").put("message", "Camera disconnected"))
            }
            override fun onError(camera: CameraDevice, error: Int) {
                camera.close()
                onEvent(JSONObject().put("type", "error").put("message", "Camera error $error"))
            }
        }, handler)
    }

    private fun createSession(camera: CameraDevice, info: CameraInfo) {
        val imageReader = ImageReader.newInstance(
            info.rawSize.width,
            info.rawSize.height,
            ImageFormat.RAW_SENSOR,
            3,
        )
        reader = imageReader
        imageReader.setOnImageAvailableListener({ r ->
            val image = r.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                onPacket(copyCrop(image, info))
            } catch (t: Throwable) {
                onEvent(JSONObject().put("type", "error").put("message", "RAW copy failed: ${t.message}"))
            } finally {
                image.close()
            }
        }, handler)

        camera.createCaptureSession(
            listOf(imageReader.surface),
            object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(s: CameraCaptureSession) {
                    session = s
                    try {
                        val template = if (info.manual) CameraDevice.TEMPLATE_MANUAL else CameraDevice.TEMPLATE_PREVIEW
                        val b = camera.createCaptureRequest(template)
                        b.addTarget(imageReader.surface)
                        if (info.manual) {
                            b.set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_OFF)
                            b.set(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNs)
                            b.set(CaptureRequest.SENSOR_SENSITIVITY, iso)
                            val minFrame = info.chars
                                .get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                                ?.getOutputMinFrameDuration(ImageFormat.RAW_SENSOR, info.rawSize)
                                ?: 0L
                            b.set(CaptureRequest.SENSOR_FRAME_DURATION, maxOf(exposureNs, minFrame))
                            val minFocus = info.chars.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
                            if (minFocus > 0f) b.set(CaptureRequest.LENS_FOCUS_DISTANCE, 0f)
                        }
                        s.setRepeatingRequest(b.build(), object : CameraCaptureSession.CaptureCallback() {}, handler)
                        onEvent(JSONObject()
                            .put("type", "started")
                            .put("exposureNs", exposureNs)
                            .put("iso", iso)
                            .put("rawSize", "${info.rawSize.width}x${info.rawSize.height}")
                            .put("cropSize", "${info.cropSize.width}x${info.cropSize.height}"))
                    } catch (t: Throwable) {
                        onEvent(JSONObject().put("type", "error").put("message", "Session start failed: ${t.message}"))
                    }
                }
                override fun onConfigureFailed(s: CameraCaptureSession) {
                    onEvent(JSONObject().put("type", "error").put("message", "Capture session configuration failed"))
                }
            },
            handler,
        )
    }

    private fun copyCrop(image: Image, info: CameraInfo): ByteArray {
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

        return FramePacket.encodeRaw16(
            payload = payload,
            width = w,
            height = h,
            sensorWidth = info.rawSize.width,
            sensorHeight = info.rawSize.height,
            cropX = info.cropX,
            cropY = info.cropY,
            frameId = frameId.incrementAndGet(),
            timestampNs = image.timestamp,
            exposureNs = exposureNs,
            iso = iso,
            cfa = info.cfa,
            whiteLevel = info.whiteLevel,
            black = info.black,
            sensorOrientation = info.sensorOrientation,
        )
    }

    fun stop() {
        try { session?.stopRepeating() } catch (_: Throwable) {}
        try { session?.close() } catch (_: Throwable) {}
        try { device?.close() } catch (_: Throwable) {}
        try { reader?.close() } catch (_: Throwable) {}
        session = null
        device = null
        reader = null
    }

    fun close() {
        stop()
        thread.quitSafely()
    }
}
