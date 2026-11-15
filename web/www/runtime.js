(() => {
  "use strict";
  const labels = {
    UNSUPPORTED: "Режим не поддерживается", PERMISSION_DENIED: "Нужен доступ к камере",
    UNAVAILABLE: "Камера недоступна. Нажмите, чтобы повторить", SAVE_FAILED: "Не удалось сохранить файл",
    TIMEOUT: "Камера не ответила. Нажмите, чтобы повторить"
  };
  function createRuntime(backend, render) {
    let state = null;
    let error = null;
    let disposed = false;
    let startOperation = null;
    function project() {
      if (!state) return;
      const live = state.phase === "live";
      const recording = state.phase === "recording" || state.phase === "stopping";
      const seconds = Math.floor(state.durationMs / 1000);
      const available = state.active && state.access === "granted";
      const selectable = available && ["live", "idle", "failed"].includes(state.phase);
      let message = "";
      if (state.access !== "granted") message = state.access === "settings" ?
        "Открыть настройки доступа к камере" : "Разрешить доступ к камере";
      else if (state.phase === "starting") message = "Подключение камеры…";
      else if (state.phase === "failed") message = labels.UNAVAILABLE;
      else if (error) message = labels[error.code] || "Не удалось выполнить действие. Нажмите, чтобы повторить";
      render({
        ready: available && (live || state.phase === "recording"),
        mode: state.mode, selectionEnabled: selectable,
        shutterEnabled: available && (live || state.phase === "recording"),
        recording, duration: String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0"),
        switchEnabled: selectable && state.capabilities.switchLens,
        flashEnabled: available && (live || state.phase === "recording") && state.capabilities.flash,
        flash: state.mode === "video" ? "ФОНАРЬ " + (state.torch ? "ВКЛ" : "ВЫКЛ") :
          "ВСПЫШКА " + ({ auto: "АВТО", on: "ВКЛ", off: "ВЫКЛ" })[state.flash],
        zoom: state.zoomRatio.toFixed(1).replace(/\.0$/, "") + "×",
        message, messageEnabled: !!message && state.phase !== "starting", insets: state.insets
      });
    }
    const unsubscribe = backend.camera.onState(next => {
      const gainedAccess = state && state.access !== "granted" && next.access === "granted";
      const resumed = state && !state.active && next.active;
      state = next; error = null; project();
      if ((gainedAccess || resumed) && next.active && next.phase === "idle") {
        Promise.resolve().then(() => start(next.mode, next.lens)).catch(handleError);
      }
    });
    function handleError(value) {
      if (disposed || ["CANCELLED", "DISPOSED", "BUSY"].includes(value.code)) return;
      error = value;
      if (state) project();
      else render({ ready: false, mode: "photo", selectionEnabled: false, shutterEnabled: false,
        recording: false, duration: "00:00", switchEnabled: false, flashEnabled: false, flash: "",
        zoom: "1×", message: "Камера недоступна", messageEnabled: false,
        insets: { top: 0, bottom: 0, left: 0, right: 0 } });
    }
    const offCapture = backend.camera.onCapture(event => { if (event.error) handleError(event.error); });
    const start = (mode, lens) => {
      if (state.capabilities[mode] === "unsupported") return Promise.reject(new window.Visor.BackendError("UNSUPPORTED"));
      if (startOperation) return startOperation;
      startOperation = backend.camera.start({ mode, lens }).finally(() => { startOperation = null; });
      return startOperation;
    };
    function intent(command) {
      if (disposed || !state) return;
      error = null;
      let operation;
      switch (command) {
        case "permission":
          operation = state.access === "granted" ? start(state.mode, state.lens) :
            backend.system.requestCameraAccess().then(() => start(state.mode, state.lens));
          break;
        case "photo": case "video": operation = start(command, state.lens); break;
        case "switch": operation = start(state.mode, state.lens === "back" ? "front" : "back"); break;
        case "gallery": operation = backend.system.openGallery(); break;
        case "flash": operation = backend.camera.setFlash({
          mode: state.mode === "photo" ? ({ auto: "on", on: "off", off: "auto" })[state.flash] : state.flash,
          torch: state.mode === "video" ? !state.torch : false
        }); break;
        case "shutter":
          operation = state.phase === "recording" ? backend.camera.stopRecording({ captureId: state.captureId }) :
            state.mode === "photo" ? backend.camera.takePhoto() : backend.camera.startRecording();
          break;
        default: return;
      }
      return operation.catch(handleError);
    }
    const ready = backend.system.connect().then(() => {
      if (state && state.active && state.access === "granted") return start(state.mode, state.lens);
    }).catch(handleError);
    return Object.freeze({
      intent, ready,
      focus(point) { if (state && state.active && state.capabilities.focus) backend.camera.focus(point); },
      zoomBy(change) { if (state && state.active && state.capabilities.maxZoom > state.capabilities.minZoom) backend.camera.zoomBy(change); },
      dispose() { if (!disposed) { disposed = true; unsubscribe(); offCapture(); backend.dispose(); } }
    });
  }
  window.Visor = Object.freeze({ ...window.Visor, createRuntime });
})();
