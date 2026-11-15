package io.volynetstyle.visor.android.camera

import io.volynetstyle.visor.contract.CameraState
import io.volynetstyle.visor.contract.CaptureResult
import io.volynetstyle.visor.contract.VisorMethod
import io.volynetstyle.visor.contract.ErrorCode

/** Platform-neutral command data; transport identity remains opaque to the camera. */
internal class CameraParams(private val values: Map<String, Any>) {
    fun get(name: String): Any = values[name] ?: throw IllegalArgumentException(name)
    fun getString(name: String): String = get(name) as? String ?: throw IllegalArgumentException(name)
}
internal class BackendRequest(
    val id: String, val method: VisorMethod, val params: CameraParams, internal val token: Any,
)
internal interface CameraSink {
    fun observe(value: CameraState)
    fun result(request: BackendRequest, value: Any? = null)
    fun error(request: BackendRequest, code: ErrorCode, message: String = code.wire)
    fun capture(request: BackendRequest, result: CaptureResult?, error: ErrorCode?)
}
