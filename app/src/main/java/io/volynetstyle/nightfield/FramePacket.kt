package io.volynetstyle.nightfield

import android.graphics.ImageFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Binary wire format consumed by web/src/raw.ts. */
object FramePacket {
    const val HEADER_BYTES = 128

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
    ): ByteArray {
        val out = ByteArray(HEADER_BYTES + payload.size)
        val b = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN)
        b.put('N'.code.toByte())
        b.put('R'.code.toByte())
        b.put('A'.code.toByte())
        b.put('W'.code.toByte())
        b.putShort(1)
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
        b.putInt(0)
        for (i in 0 until 4) b.putFloat(black.getOrElse(i) { 0f })
        repeat(4) { b.putFloat(0f) }
        b.putInt(payload.size)
        b.putInt(sensorOrientation)
        b.putInt(0)
        b.putInt(0)
        b.position(HEADER_BYTES)
        b.put(payload)
        return out
    }
}
