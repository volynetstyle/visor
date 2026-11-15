import type {
  CameraMode,
  Insets,
  FocusPoint,
  ZoomChange,
  VisorBackend,
  CameraState,
  ErrorCode,
} from "./generated/types";

export interface WireRequest {
  version: number;
  session: string | null;
  id: string;
  method: string;
  params: any;
  notification: boolean;
}
export interface Transport {
  send(message: WireRequest): void;
  subscribe(callback: (message: any) => void): () => void;
}
export interface Clock {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
}
export interface ReplayScenario {
  initial: CameraState;
  timeline?: Array<{ at: number; patch: Partial<CameraState> }>;
  dropMethods?: string[];
}
export interface ContractSchema {
  version: number;
  limits: { maxPending: number; requestTimeoutMs: number };
  lifecycle: { captureProgress: string[] };
  enums: Record<string, string[]>;
  records: Record<string, Record<string, string>>;
  methods: Record<string, { params: string; result: string }>;
}

export interface HudState {
  ready: boolean;
  mode: CameraMode;
  selectionEnabled: boolean;
  shutterEnabled: boolean;
  recording: boolean;
  duration: string;
  switchEnabled: boolean;
  flashEnabled: boolean;
  flash: string;
  zoom: string;
  message: string;
  messageEnabled: boolean;
  insets: Insets;
}
export interface HudRuntime {
  intent(command: string): Promise<unknown> | void;
  ready: Promise<unknown>;
  focus(point: FocusPoint): void;
  zoomBy(change: ZoomChange): void;
  dispose(): void;
}

declare global {
  interface Window {
    VisorContract: ContractSchema;
    Visor: {
      createBackend(transport: Transport, options?: { clock: Clock }): VisorBackend;
      createRuntime(backend: VisorBackend, render: (state: HudState) => void): HudRuntime;
      BackendError: new (code: ErrorCode) => Error;
      valid(type: string, value: unknown): boolean;
    };
    VisorTransport: Transport;
    VisorPlatform: { receive(message: any): void };
    VisorBackendOptions?: { clock: Clock };
    Native?: { postMessage(message: string): void };
    PureCamera: { render(state: HudState): void };
    VisorReplay: {
      createReplay(
        scenario: ReplayScenario,
      ): Transport & { clock: Clock; advance(ms: number): void; inspect(): { now: number } };
    };
    VisorScenario: ReplayScenario;
  }
}
