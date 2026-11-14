package io.volynetstyle.nightfield

import android.graphics.ImageFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Binary wire format consumed by web/src/raw.ts. */
object FramePacket {
    const val HEADER_BYTES = 256
    const val MATCHED_RESULT = 1
    const val DYNAMIC_BLACK = 2
    const val DYNAMIC_WHITE = 4
    const val NOISE_PROFILE = 8
    const val MANUAL_SENSOR = 16

    fun encodeRaw16(
        payload: ByteArray,
        width: Int,
        height: Int,
        sensorWidth: Int,
        sensorHeight: Int,
        cropX: Int,
        cropY: Int,
        frameId: Int,
        timestampNs: Long,
        exposureNs: Long,
        iso: Int,
        cfa: Int,
        whiteLevel: Int,
        black: FloatArray,
        sensorOrientation: Int,
        flags: Int,
        requestedExposureNs: Long,
        requestedIso: Int,
        frameDurationNs: Long,
        noiseProfile: DoubleArray,
        captureIntervalNs: Long,
        received: Int,
        droppedBusy: Int,
        droppedMetadata: Int,
    ): ByteArray {
        val out = ByteArray(HEADER_BYTES + payload.size)
        val b = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN)
        b.put('N'.code.toByte())
        b.put('R'.code.toByte())
        b.put('A'.code.toByte())
        b.put('W'.code.toByte())
        b.putShort(2)
        b.putShort(HEADER_BYTES.toShort())
        b.putInt(ImageFormat.RAW_SENSOR)
        b.putInt(width)
        b.putInt(height)
        b.putInt(width * 2)
        b.putInt(2)
        b.putInt(sensorWidth)
        b.putInt(sensorHeight)
        b.putInt(cropX)
        b.putInt(cropY)
        b.putInt(frameId)
        b.putLong(timestampNs)
        b.putLong(exposureNs)
        b.putInt(iso)
        b.putInt(cfa)
        b.putInt(whiteLevel)
        b.putInt(flags)
        for (i in 0 until 4) b.putFloat(black.getOrElse(i) { 0f })
        b.putLong(requestedExposureNs)
        b.putLong(frameDurationNs)
        b.putInt(payload.size)
        b.putInt(sensorOrientation)
        b.putInt(requestedIso)
        b.putInt(0) // Reserved.
        // Four (S, O) pairs in row-major CFA order, unchanged from CaptureResult.
        repeat(8) { b.putDouble(noiseProfile.getOrElse(it) { 0.0 }) }
        b.putLong(captureIntervalNs)
        b.putLong(0) // Offset 200: crop + packet copy time, filled by the producer.
        b.putInt(received)
        b.putInt(droppedBusy)
        b.putInt(droppedMetadata)
        b.position(HEADER_BYTES)
        b.put(payload)
        return out
    }
}
