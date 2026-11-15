import type { WireRequest } from "../../../contract/globals";
// Android transport only. The shared backend and HUD never inspect the host OS.
(() => {
  "use strict";
  let receive: (message: any) => void = () => {};
  window.VisorPlatform = Object.freeze({ receive: (message: any) => receive(message) });
  window.VisorTransport = Object.freeze({
    send(message: WireRequest) {
      if (!window.Native || !window.Native.postMessage)
        throw Error("Native transport is unavailable");
      window.Native.postMessage(JSON.stringify(message));
    },
    subscribe(callback: (message: any) => void) {
      receive = callback;
      return () => {
        receive = () => {};
      };
    },
  });
})();
