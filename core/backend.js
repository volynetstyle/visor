(() => {
  "use strict";
  const contract = window.VisorContract;
  class BackendError extends Error {
    constructor(code, message = code, retryable = false) {
      super(message);
      this.name = "BackendError";
      this.code = code;
      this.retryable = retryable;
    }
  }
  function valid(type, value) {
    if (type.endsWith("?"))
      return value === null || valid(type.slice(0, -1), value);
    if (type === "number")
      return typeof value === "number" && Number.isFinite(value);
    if (type === "string" || type === "boolean") return typeof value === type;
    if (contract.enums[type]) return contract.enums[type].includes(value);
    const fields = contract.records[type];
    return (
      fields &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === Object.keys(fields).length &&
      Object.keys(fields).every((key) => valid(fields[key], value[key]))
    );
  }
  function createBackend(transport, options = {}) {
    const clock = options.clock || window;
    const pending = new Map();
    const subscribers = new Set();
    const captureSubscribers = new Set();
    const closedCaptures = new Set();
    const cancelledCaptures = new Set();
    const captureEvents = new Set();
    let session = null;
    let sequence = -1;
    let serial = 0;
    let current = null;
    let disposed = false;
    let closedOrdinal = 0;
    let terminalOrdinal = 0;
    const ranks = Object.fromEntries(contract.lifecycle.captureProgress.map((phase, index) => [phase, index]));
    const fail = (code, message) => new BackendError(code, message);
    function rememberCancelled(id) {
      cancelledCaptures.add(id);
      if (cancelledCaptures.size > 32) cancelledCaptures.delete(cancelledCaptures.values().next().value);
    }
    function rememberClosed(id) {
      if (!id) return;
      closedOrdinal = Math.max(closedOrdinal, Number(id.slice(1)) || 0);
      closedCaptures.add(id);
      if (closedCaptures.size > 32)
        closedCaptures.delete(closedCaptures.values().next().value);
    }
    function accept(message) {
      if (
        message.session !== session ||
        !Number.isSafeInteger(message.sequence) ||
        message.sequence <= sequence ||
        !valid("CameraState", message.state)
      )
        return;
      const next = message.state;
      if (next.captureId && (!/^r[1-9][0-9]*$/.test(next.captureId) ||
          Number(next.captureId.slice(1)) <= closedOrdinal)) return;
      if (
        next.zoomRatio <= 0 ||
        next.durationMs < 0 ||
        next.capabilities.minZoom <= 0 ||
        next.capabilities.maxZoom < next.capabilities.minZoom
      )
        return;
      if (
        next.phase in ranks !==
        (typeof next.captureId === "string" && next.captureId.length > 0)
      )
        return;
      if (current && current.captureId && next.captureId) {
        if (
          current.captureId !== next.captureId ||
          ranks[next.phase] < ranks[current.phase]
        )
          return;
      }
      if (
        next.captureId &&
        closedCaptures.has(next.captureId) &&
        ["capturing", "recording"].includes(next.phase)
      )
        return;
      if (current && current.captureId && current.captureId !== next.captureId)
        rememberClosed(current.captureId);
      sequence = message.sequence;
      Object.freeze(next.insets);
      Object.freeze(next.capabilities);
      current = Object.freeze(next);
      for (const callback of subscribers) callback(current);
    }
    function settle(id, error, value) {
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      clock.clearTimeout(item.timer);
      if (error) item.reject(error);
      else item.resolve(value);
    }
    function receive(message) {
      if (disposed || !message || message.version !== contract.version) {
        if (!disposed && message && message.version !== contract.version) {
          for (const id of pending.keys())
            settle(id, fail("PROTOCOL_MISMATCH"));
        }
        return;
      }
      const item = pending.get(message.id);
      if (message.kind === "result" && item && item.method === "system.connect" && !message.ok) {
        const error = message.error;
        settle(message.id, valid("BackendError", error) ?
          new BackendError(error.code, error.message, error.retryable) : fail("PROTOCOL_MISMATCH"));
        return;
      }
      if (
        message.kind === "result" &&
        item &&
        item.method === "system.connect" &&
        message.ok
      ) {
        if (typeof message.session !== "string" || !message.session) return;
        session = message.session;
        for (const entry of pending)
          if (entry[1] !== item) settle(entry[0], fail("STALE_SESSION"));
        sequence = -1;
        closedOrdinal = 0;
        terminalOrdinal = 0;
        current = null;
        closedCaptures.clear();
        cancelledCaptures.clear();
        captureEvents.clear();
      }
      if (message.session !== session || !session) return;
      if (message.state) accept(message);
      if (message.kind === "capture" && valid("CaptureEvent", message.event)) {
        const event = message.event;
        const ordinal = /^r[1-9][0-9]*$/.test(event.captureId) ? Number(event.captureId.slice(1)) : 0;
        if (!ordinal || ordinal <= terminalOrdinal) return;
        if (captureEvents.has(event.captureId)) return;
        if (
          event.result &&
          (cancelledCaptures.has(event.captureId) ||
            event.result.captureId !== event.captureId)
        )
          return;
        if (!!event.result === !!event.error) return;
        terminalOrdinal = ordinal;
        if (event.result) Object.freeze(event.result);
        if (event.error) Object.freeze(event.error);
        captureEvents.add(event.captureId);
        if (captureEvents.size > 32)
          captureEvents.delete(captureEvents.values().next().value);
        rememberClosed(event.captureId);
        for (const callback of captureSubscribers)
          callback(Object.freeze(event));
        return;
      }
      if (message.kind !== "result" || !item) return;
      if (!message.ok) {
        if (valid("BackendError", message.error)) {
          settle(
            message.id,
            new BackendError(
              message.error.code,
              message.error.message,
              message.error.retryable,
            ),
          );
        } else settle(message.id, fail("PROTOCOL_MISMATCH"));
        return;
      }
      if (!valid(contract.methods[item.method].result, message.value)) {
        settle(message.id, fail("PROTOCOL_MISMATCH"));
      } else if (
        item.method === "camera.start" &&
        (!current || current.phase !== "live")
      ) {
        settle(message.id, fail("PROTOCOL_MISMATCH"));
      } else if (
        item.method === "camera.startRecording" &&
        (message.value.captureId !== message.id ||
          !current ||
          current.phase !== "recording" ||
          current.captureId !== message.id)
      ) {
        settle(message.id, fail("PROTOCOL_MISMATCH"));
      } else if (
        message.value.uri &&
        message.value.captureId !==
          (item.method === "camera.stopRecording"
            ? item.params.captureId
            : message.id)
      ) {
        settle(message.id, fail("PROTOCOL_MISMATCH"));
      } else if (
        message.value.captureId &&
        message.value.uri &&
        cancelledCaptures.has(message.value.captureId)
      ) {
        settle(message.id, fail("CANCELLED"));
      } else {
        if (message.value.uri) rememberClosed(message.value.captureId);
        settle(message.id, null, message.value);
      }
    }
    const unsubscribe = transport.subscribe(receive);
    function send(method, params = {}, notification = false) {
      if (disposed) throw fail("DISPOSED");
      if (method !== "system.connect" && !session) throw fail("STALE_SESSION");
      const definition = contract.methods[method];
      if (!definition || !valid(definition.params, params))
        throw fail("INVALID_ARGUMENT");
      if (
        (method === "camera.focus" &&
          (params.x < 0 || params.x > 1 || params.y < 0 || params.y > 1)) ||
        (method === "camera.zoomBy" &&
          (params.factor < 0.01 || params.factor > 100))
      )
        throw fail("INVALID_ARGUMENT");
      if (pending.size >= contract.limits.maxPending && !notification)
        throw fail("OVERLOADED");
      const id = "r" + ++serial;
      const envelope = {
        version: contract.version,
        session,
        id,
        method,
        params,
        notification,
      };
      if (notification) {
        transport.send(envelope);
        return;
      }
      return new Promise((resolve, reject) => {
        const timer = clock.setTimeout(() => {
          if (
            method === "camera.takePhoto" ||
            method === "camera.startRecording"
          ) {
            rememberClosed(id);
            rememberCancelled(id);
            try {
              notify("camera.cancelCapture", { captureId: id });
            } catch (_) {
              /* Session may be gone. */
            }
          }
          settle(id, fail("TIMEOUT"));
        }, contract.limits.requestTimeoutMs);
        pending.set(id, { method, params, resolve, reject, timer });
        try {
          transport.send(envelope);
        } catch (_) {
          settle(id, fail("UNAVAILABLE"));
        }
      });
    }
    const request = (method, params) => {
      try {
        return send(method, params);
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const notify = (method, params) => send(method, params, true);
    const camera = {
      capabilities: () => request("camera.capabilities"),
      start: (config) => request("camera.start", config),
      stop: () => request("camera.stop"),
      takePhoto: () => request("camera.takePhoto"),
      startRecording: () => request("camera.startRecording"),
      stopRecording: (ref) => request("camera.stopRecording", ref),
      cancelCapture(ref) {
        if (!valid("CaptureRef", ref))
          return Promise.reject(fail("INVALID_ARGUMENT"));
        rememberClosed(ref.captureId);
        rememberCancelled(ref.captureId);
        return request("camera.cancelCapture", ref);
      },
      setFlash: (config) => request("camera.setFlash", config),
      focus: (point) => notify("camera.focus", point),
      zoomBy: (change) => notify("camera.zoomBy", change),
      onState(callback) {
        if (disposed) throw fail("DISPOSED");
        subscribers.add(callback);
        if (current) callback(current);
        return () => subscribers.delete(callback);
      },
      onCapture(callback) {
        if (disposed) throw fail("DISPOSED");
        captureSubscribers.add(callback);
        return () => captureSubscribers.delete(callback);
      },
    };
    return Object.freeze({
      camera: Object.freeze(camera),
      system: Object.freeze({
        connect: () => request("system.connect"),
        requestCameraAccess: () => request("system.requestCameraAccess"),
        openGallery: () => request("system.openGallery"),
      }),
      dispose() {
        if (disposed) return;
        if (session) {
          try {
            notify("camera.stop", {});
          } catch (_) {
            /* Best effort physical cleanup. */
          }
        }
        disposed = true;
        unsubscribe();
        subscribers.clear();
        captureSubscribers.clear();
        for (const id of pending.keys()) settle(id, fail("DISPOSED"));
        closedCaptures.clear();
      },
    });
  }
  window.Visor = Object.freeze({ createBackend, BackendError, valid });
})();
