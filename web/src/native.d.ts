export {};

declare global {
  interface Window {
    rawBridge?: {
      postMessage(data: string | ArrayBuffer): void;
      onmessage: ((event: MessageEvent<string | ArrayBuffer>) => void) | null;
    };
  }
  interface Navigator {
    gpu?: any;
  }
}
