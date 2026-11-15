// Generated from packages/visor-contract/protocol.json. Do not edit.
export type Unsubscribe = () => void;
export type Support = "supported" | "unsupported" | "unknown";
export type CameraPhase = "idle" | "starting" | "live" | "capturing" | "recording" | "stopping" | "cancelling" | "failed";
export type CameraMode = "photo" | "video";
export type LensFacing = "back" | "front";
export type CameraAccess = "granted" | "prompt" | "settings";
export type FlashMode = "auto" | "on" | "off";
export type ErrorCode = "UNSUPPORTED" | "PERMISSION_DENIED" | "BUSY" | "INVALID_ARGUMENT" | "UNAVAILABLE" | "SAVE_FAILED" | "CANCELLED" | "STALE_SESSION" | "STALE_CAPTURE" | "PROTOCOL_MISMATCH" | "TIMEOUT" | "DISPOSED" | "OVERLOADED";
export interface Insets { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }
export interface Capabilities { readonly photo: Support; readonly video: Support; readonly rawStream: Support; readonly linearVideo: Support; readonly accumulation: Support; readonly motion: Support; readonly flash: boolean; readonly switchLens: boolean; readonly focus: boolean; readonly minZoom: number; readonly maxZoom: number }
export interface CameraState { readonly phase: CameraPhase; readonly mode: CameraMode; readonly lens: LensFacing; readonly captureId: string | null; readonly durationMs: number; readonly zoomRatio: number; readonly flash: FlashMode; readonly torch: boolean; readonly active: boolean; readonly access: CameraAccess; readonly errorCode: ErrorCode | null; readonly capabilities: Capabilities; readonly insets: Insets }
export interface CaptureConfig { readonly mode: CameraMode; readonly lens: LensFacing }
export interface CaptureResult { readonly captureId: string; readonly uri: string; readonly mime: string }
export interface CaptureRef { readonly captureId: string }
export interface CaptureEvent { readonly captureId: string; readonly result: CaptureResult | null; readonly error: BackendError | null }
export interface FocusPoint { readonly x: number; readonly y: number }
export interface ZoomChange { readonly factor: number }
export interface FlashConfig { readonly mode: FlashMode; readonly torch: boolean }
export interface BackendError { readonly code: ErrorCode; readonly message: string; readonly retryable: boolean }
export interface Empty {  }
export interface VisorBackend {
  readonly camera: {
    capabilities(params?: Empty): Promise<Capabilities>;
    start(params: CaptureConfig): Promise<Empty>;
    stop(params?: Empty): Promise<Empty>;
    takePhoto(params?: Empty): Promise<CaptureResult>;
    startRecording(params?: Empty): Promise<CaptureRef>;
    stopRecording(params: CaptureRef): Promise<CaptureResult>;
    cancelCapture(params: CaptureRef): Promise<Empty>;
    setFlash(params: FlashConfig): Promise<Empty>;
    focus(params: FocusPoint): void;
    zoomBy(params: ZoomChange): void;
    onState(callback: (state: CameraState) => void): Unsubscribe;
    onCapture(callback: (event: CaptureEvent) => void): Unsubscribe;
  };
  readonly system: {
    connect(params?: Empty): Promise<CameraState>;
    requestCameraAccess(params?: Empty): Promise<Empty>;
    openGallery(params?: Empty): Promise<Empty>;
  };
  dispose(): void;
}
