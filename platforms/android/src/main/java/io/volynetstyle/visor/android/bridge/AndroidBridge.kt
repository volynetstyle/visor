package io.volynetstyle.visor.android.bridge

import io.volynetstyle.visor.android.camera.AndroidCameraBackend
import org.json.JSONObject

internal class AndroidBridge(
    postFrame: (Runnable) -> Unit, cancelFrame: (Runnable) -> Unit,
    deliver: (JSONObject, () -> Unit) -> Unit, camera: AndroidCameraBackend,
) {
    private var active = false
    val channel = AndroidBackendChannel(BackendOutbox(
        postFrame = postFrame, cancelFrame = cancelFrame, deliver = deliver,
    ), onSessionReset = camera::resetBackendSession, execute = camera::executeBackend)
    fun receive(message: String) {
        channel.receive(message)
        channel.setActive(active)
    }
    fun setActive(value: Boolean) { active = value; channel.setActive(value) }
    fun resetDelivery() = channel.resetDelivery()
}
