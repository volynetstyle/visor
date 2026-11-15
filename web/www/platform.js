// Android transport only. The shared backend and HUD never inspect the host OS.
(() => {
  "use strict";
  let receive = () => {};
  window.VisorPlatform = Object.freeze({ receive: message => receive(message) });
  window.VisorTransport = Object.freeze({
    send(message) {
      if (!window.Native || !window.Native.postMessage) throw Error("Native transport is unavailable");
      window.Native.postMessage(JSON.stringify(message));
    },
    subscribe(callback) { receive = callback; return () => { receive = () => {}; }; }
  });
})();
