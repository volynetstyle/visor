// Generated from packages/visor-contract/protocol.json. Do not edit.
package io.volynetstyle.visor.contract

enum class VisorMethod(val wire: String) { SYSTEM_CONNECT("system.connect"), SYSTEM_REQUESTCAMERAACCESS("system.requestCameraAccess"), SYSTEM_OPENGALLERY("system.openGallery"), CAMERA_CAPABILITIES("camera.capabilities"), CAMERA_START("camera.start"), CAMERA_STOP("camera.stop"), CAMERA_TAKEPHOTO("camera.takePhoto"), CAMERA_STARTRECORDING("camera.startRecording"), CAMERA_STOPRECORDING("camera.stopRecording"), CAMERA_CANCELCAPTURE("camera.cancelCapture"), CAMERA_SETFLASH("camera.setFlash"), CAMERA_FOCUS("camera.focus"), CAMERA_ZOOMBY("camera.zoomBy") }
enum class Support(val wire: String) { SUPPORTED("supported"), UNSUPPORTED("unsupported"), UNKNOWN("unknown") }
enum class CameraPhase(val wire: String) { IDLE("idle"), STARTING("starting"), LIVE("live"), CAPTURING("capturing"), RECORDING("recording"), STOPPING("stopping"), CANCELLING("cancelling"), FAILED("failed") }
enum class CameraMode(val wire: String) { PHOTO("photo"), VIDEO("video") }
enum class LensFacing(val wire: String) { BACK("back"), FRONT("front") }
enum class CameraAccess(val wire: String) { GRANTED("granted"), PROMPT("prompt"), SETTINGS("settings") }
enum class FlashMode(val wire: String) { AUTO("auto"), ON("on"), OFF("off") }
enum class ErrorCode(val wire: String) { UNSUPPORTED("UNSUPPORTED"), PERMISSION_DENIED("PERMISSION_DENIED"), BUSY("BUSY"), INVALID_ARGUMENT("INVALID_ARGUMENT"), UNAVAILABLE("UNAVAILABLE"), SAVE_FAILED("SAVE_FAILED"), CANCELLED("CANCELLED"), STALE_SESSION("STALE_SESSION"), STALE_CAPTURE("STALE_CAPTURE"), PROTOCOL_MISMATCH("PROTOCOL_MISMATCH"), TIMEOUT("TIMEOUT"), DISPOSED("DISPOSED"), OVERLOADED("OVERLOADED") }
data class Insets(
    val top: Double,
    val bottom: Double,
    val left: Double,
    val right: Double
)
data class Capabilities(
    val photo: Support,
    val video: Support,
    val rawStream: Support,
    val linearVideo: Support,
    val accumulation: Support,
    val motion: Support,
    val flash: Boolean,
    val switchLens: Boolean,
    val focus: Boolean,
    val minZoom: Double,
    val maxZoom: Double
)
data class CameraState(
    val phase: CameraPhase,
    val mode: CameraMode,
    val lens: LensFacing,
    val captureId: String?,
    val durationMs: Double,
    val zoomRatio: Double,
    val flash: FlashMode,
    val torch: Boolean,
    val active: Boolean,
    val access: CameraAccess,
    val errorCode: ErrorCode?,
    val capabilities: Capabilities,
    val insets: Insets
)
data class CaptureConfig(
    val mode: CameraMode,
    val lens: LensFacing
)
data class CaptureResult(
    val captureId: String,
    val uri: String,
    val mime: String
)
data class CaptureRef(
    val captureId: String
)
data class CaptureEvent(
    val captureId: String,
    val result: CaptureResult?,
    val error: BackendError?
)
data class FocusPoint(
    val x: Double,
    val y: Double
)
data class ZoomChange(
    val factor: Double
)
data class FlashConfig(
    val mode: FlashMode,
    val torch: Boolean
)
data class BackendError(
    val code: ErrorCode,
    val message: String,
    val retryable: Boolean
)
object Empty
object Protocol {
    const val VERSION = 1
    const val MAX_PENDING = 16
    const val MAX_MESSAGE_BYTES = 4096
    val METHODS = setOf("system.connect", "system.requestCameraAccess", "system.openGallery", "camera.capabilities", "camera.start", "camera.stop", "camera.takePhoto", "camera.startRecording", "camera.stopRecording", "camera.cancelCapture", "camera.setFlash", "camera.focus", "camera.zoomBy")
    val PARAM_FIELDS = mapOf(
        "system.connect" to setOf<String>(),
        "system.requestCameraAccess" to setOf<String>(),
        "system.openGallery" to setOf<String>(),
        "camera.capabilities" to setOf<String>(),
        "camera.start" to setOf<String>("mode", "lens"),
        "camera.stop" to setOf<String>(),
        "camera.takePhoto" to setOf<String>(),
        "camera.startRecording" to setOf<String>(),
        "camera.stopRecording" to setOf<String>("captureId"),
        "camera.cancelCapture" to setOf<String>("captureId"),
        "camera.setFlash" to setOf<String>("mode", "torch"),
        "camera.focus" to setOf<String>("x", "y"),
        "camera.zoomBy" to setOf<String>("factor")
    )
}
