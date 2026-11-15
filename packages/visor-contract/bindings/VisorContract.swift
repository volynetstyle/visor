// Generated from packages/visor-contract/protocol.json. Do not edit.
import Foundation

public enum VisorProtocol { public static let version = 1; public static let maxPending = 16 }
public enum VisorMethod: String, Codable {
    case system_connect = "system.connect"
    case system_requestCameraAccess = "system.requestCameraAccess"
    case system_openGallery = "system.openGallery"
    case camera_capabilities = "camera.capabilities"
    case camera_start = "camera.start"
    case camera_stop = "camera.stop"
    case camera_takePhoto = "camera.takePhoto"
    case camera_startRecording = "camera.startRecording"
    case camera_stopRecording = "camera.stopRecording"
    case camera_cancelCapture = "camera.cancelCapture"
    case camera_setFlash = "camera.setFlash"
    case camera_focus = "camera.focus"
    case camera_zoomBy = "camera.zoomBy"
}
public enum Support: String, Codable {
    case supported = "supported"
    case unsupported = "unsupported"
    case unknown = "unknown"
}
public enum CameraPhase: String, Codable {
    case idle = "idle"
    case starting = "starting"
    case live = "live"
    case capturing = "capturing"
    case recording = "recording"
    case stopping = "stopping"
    case cancelling = "cancelling"
    case failed = "failed"
}
public enum CameraMode: String, Codable {
    case photo = "photo"
    case video = "video"
}
public enum LensFacing: String, Codable {
    case back = "back"
    case front = "front"
}
public enum CameraAccess: String, Codable {
    case granted = "granted"
    case prompt = "prompt"
    case settings = "settings"
}
public enum FlashMode: String, Codable {
    case auto = "auto"
    case on = "on"
    case off = "off"
}
public enum ErrorCode: String, Codable {
    case unsupported = "UNSUPPORTED"
    case permission_denied = "PERMISSION_DENIED"
    case busy = "BUSY"
    case invalid_argument = "INVALID_ARGUMENT"
    case unavailable = "UNAVAILABLE"
    case save_failed = "SAVE_FAILED"
    case cancelled = "CANCELLED"
    case stale_session = "STALE_SESSION"
    case stale_capture = "STALE_CAPTURE"
    case protocol_mismatch = "PROTOCOL_MISMATCH"
    case timeout = "TIMEOUT"
    case disposed = "DISPOSED"
    case overloaded = "OVERLOADED"
}
public struct Insets: Codable {
    public let top: Double
    public let bottom: Double
    public let left: Double
    public let right: Double
}
public struct Capabilities: Codable {
    public let photo: Support
    public let video: Support
    public let rawStream: Support
    public let linearVideo: Support
    public let accumulation: Support
    public let motion: Support
    public let flash: Bool
    public let switchLens: Bool
    public let focus: Bool
    public let minZoom: Double
    public let maxZoom: Double
}
public struct CameraState: Codable {
    public let phase: CameraPhase
    public let mode: CameraMode
    public let lens: LensFacing
    public let captureId: String?
    public let durationMs: Double
    public let zoomRatio: Double
    public let flash: FlashMode
    public let torch: Bool
    public let active: Bool
    public let access: CameraAccess
    public let errorCode: ErrorCode?
    public let capabilities: Capabilities
    public let insets: Insets
}
public struct CaptureConfig: Codable {
    public let mode: CameraMode
    public let lens: LensFacing
}
public struct CaptureResult: Codable {
    public let captureId: String
    public let uri: String
    public let mime: String
}
public struct CaptureRef: Codable {
    public let captureId: String
}
public struct CaptureEvent: Codable {
    public let captureId: String
    public let result: CaptureResult?
    public let error: BackendError?
}
public struct FocusPoint: Codable {
    public let x: Double
    public let y: Double
}
public struct ZoomChange: Codable {
    public let factor: Double
}
public struct FlashConfig: Codable {
    public let mode: FlashMode
    public let torch: Bool
}
public struct BackendError: Codable {
    public let code: ErrorCode
    public let message: String
    public let retryable: Bool
}
public struct Empty: Codable {

}
