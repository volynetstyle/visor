package io.volynetstyle.nightfield

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import org.json.JSONObject
import kotlin.math.*

/** Bounded, camera-independent IMU timeline. All timestamps use elapsedRealtimeNanos. */
class MotionTracker(context: Context) : SensorEventListener {
    private val manager = context.getSystemService(SensorManager::class.java)
    private val rotation = manager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
        ?: manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private val gyro = manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val thread = HandlerThread("nightfield-imu").apply { start() }
    private val handler = Handler(thread.looper)
    private data class Pose(val time: Long, val q: FloatArray, val accuracy: Int)
    private data class Rate(val time: Long, val magnitude: Double, val accuracy: Int)
    private val poses = ArrayDeque<Pose>()
    private val rates = ArrayDeque<Rate>()
    private var running = false
    data class Sample(val q: FloatArray, val gapNs: Long, val travel: Float, val accuracy: Int)

    fun capabilities() = JSONObject().put("rotationSensor", rotation?.name ?: JSONObject.NULL)
        .put("gyro", gyro?.name ?: JSONObject.NULL).put("timestampBase", "elapsedRealtimeNanos")
    @Synchronized fun latest(): Triple<Long, FloatArray, Int>? = poses.lastOrNull()?.let { Triple(it.time, it.q.copyOf(), it.accuracy) }

    @Synchronized fun start() {
        stop()
        running = true
        rotation?.let { manager.registerListener(this, it, 10_000, handler) }
        gyro?.let { manager.registerListener(this, it, 10_000, handler) }
    }
    @Synchronized fun stop() {
        running = false
        manager.unregisterListener(this)
        poses.clear()
        rates.clear()
    }
    fun close() { stop(); thread.quitSafely() }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    @Synchronized override fun onSensorChanged(event: SensorEvent) {
        if (!running) return
        if (event.sensor.type == Sensor.TYPE_GYROSCOPE) {
            val v = event.values
            rates.addLast(Rate(event.timestamp, sqrt((v[0]*v[0]+v[1]*v[1]+v[2]*v[2]).toDouble()), event.accuracy))
            while (rates.size > 1200 || (rates.firstOrNull()?.time ?: event.timestamp) < event.timestamp - 6_000_000_000L) rates.removeFirst()
        } else {
            val q = FloatArray(4)
            SensorManager.getQuaternionFromVector(q, event.values) // Android returns w,x,y,z.
            poses.addLast(Pose(event.timestamp, floatArrayOf(q[1], q[2], q[3], q[0]), event.accuracy))
            while (poses.size > 1200 || (poses.firstOrNull()?.time ?: event.timestamp) < event.timestamp - 6_000_000_000L) poses.removeFirst()
        }
    }
    @Synchronized fun sample(start: Long, midpoint: Long, end: Long): Sample? {
        if (!running || rotation == null || gyro == null || start > midpoint || midpoint > end) return null
        val a = poses.lastOrNull { it.time <= midpoint } ?: return null
        val b = poses.firstOrNull { it.time >= midpoint } ?: return null
        val gap = maxOf(midpoint-a.time, b.time-midpoint)
        if (gap > 30_000_000L || minOf(a.accuracy, b.accuracy) < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM) return null
        val first = rates.lastOrNull { it.time <= start } ?: return null
        val last = rates.firstOrNull { it.time >= end } ?: return null
        if (start-first.time > 30_000_000L || last.time-end > 30_000_000L) return null
        if (first.accuracy < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM) return null
        var previous = first
        var travel = 0.0
        for (rate in rates) {
            if (rate.time <= first.time) continue
            if (rate.accuracy < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM) return null
            if (rate.time-previous.time > 30_000_000L) return null
            val dt = minOf(rate.time, end) - maxOf(previous.time, start)
            if (dt > 0) travel += maxOf(previous.magnitude, rate.magnitude) * dt / 1e9
            previous = rate
            if (rate.time >= end) break
        }
        val f = if (a.time == b.time) 0.0 else (midpoint-a.time).toDouble()/(b.time-a.time)
        var dot = a.q.indices.sumOf { a.q[it].toDouble()*b.q[it] }
        val sign = if (dot < 0) -1.0 else 1.0
        dot = abs(dot).coerceIn(0.0,1.0)
        val theta = acos(dot)
        val u = if (theta < 1e-5) 1-f else sin((1-f)*theta)/sin(theta)
        val v = if (theta < 1e-5) f else sin(f*theta)/sin(theta)
        val q = FloatArray(4) { (a.q[it]*u+b.q[it]*sign*v).toFloat() }
        val norm = sqrt(q.sumOf { it.toDouble()*it }).toFloat()
        if (!norm.isFinite() || norm <= 0f || !travel.isFinite()) return null
        for (i in q.indices) q[i] /= norm
        return Sample(q, gap, travel.toFloat(), minOf(a.accuracy,b.accuracy))
    }
}
