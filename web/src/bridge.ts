export type NativeEvent = Record<string, unknown> & { type: string };

export class Bridge {
  onBinary?: (buffer: ArrayBuffer) => void;
  onEvent?: (event: NativeEvent) => void;

  constructor() {
    const attach = () => {
      if (!window.rawBridge) {
        setTimeout(attach, 20);
        return;
      }
      window.rawBridge.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) this.onBinary?.(event.data);
        else {
          try { this.onEvent?.(JSON.parse(String(event.data))); }
          catch { this.onEvent?.({ type: 'log', message: String(event.data) }); }
        }
      };
      this.send({ type: 'ready' });
    };
    attach();
  }

  send(message: object) {
    window.rawBridge?.postMessage(JSON.stringify(message));
  }

  ack() { this.send({ type: 'ack' }); }
  start(exposureNs: number, iso: number) { this.send({ type: 'start', exposureNs, iso }); }
  stop() { this.send({ type: 'stop' }); }
}
