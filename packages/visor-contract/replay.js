(() => {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  function createReplay(scenario) {
    let now = 0, serial = 0, sequence = 0, session = "replay-0";
    let state = clone(scenario.initial);
    let receiver = () => {};
    let operation = null;
    const jobs = new Map();
    const clock = {
      setTimeout(callback, delay) { const id = ++serial; jobs.set(id, { at: now + delay, callback }); return id; },
      clearTimeout(id) { jobs.delete(id); }
    };
    const envelope = kind => ({ version: 1, session, sequence, kind, state: clone(state) });
    const emit = () => { sequence++; receiver(envelope("state")); };
    function reply(request, value = {}, code = null) {
      if (request.notification) return;
      receiver({ ...envelope("result"), id: request.id, ok: !code, value: clone(value),
        error: code ? { code, message: code, retryable: false } : undefined });
    }
    function capture(op, result = null, code = null) {
      receiver({ ...envelope("capture"), event: { captureId: op.id, result,
        error: code ? { code, message: code, retryable: false } : null } });
    }
    function end(op, request, mime) {
      if (operation !== op) return;
      operation = null;
      state.phase = state.active ? "live" : "idle";
      state.captureId = null;
      emit();
      if (op.cancelled) return;
      const result = { captureId: op.id, uri: "replay:///" + op.id, mime };
      reply(request, result);
      capture(op, result);
    }
    function cancel() {
      const op = operation;
      if (!op || op.cancelled) return;
      op.cancelled = true;
      state.phase = "cancelling";
      emit();
      reply(op.request, {}, "CANCELLED");
      capture(op, null, "CANCELLED");
      clock.setTimeout(() => end(op, op.request, ""), 50);
    }
    function send(request) {
      if (scenario.dropMethods && scenario.dropMethods.includes(request.method)) return;
      if (request.version !== 1) return reply(request, {}, "PROTOCOL_MISMATCH");
      if (request.method === "system.connect") {
        session = "replay-" + (++serial);
        sequence = 0;
        return reply(request, state);
      }
      if (request.session !== session) return reply(request, {}, "STALE_SESSION");
      const p = request.params;
      if (request.method === "camera.capabilities") return reply(request, state.capabilities);
      if (request.method === "system.requestCameraAccess") {
        state.access = "granted"; emit(); return reply(request);
      }
      if (request.method === "system.openGallery") return reply(request);
      if (request.method === "camera.stop") {
        cancel(); state.phase = "idle"; state.captureId = null; emit(); return reply(request);
      }
      if (request.method === "camera.cancelCapture") {
        if (!operation || operation.id !== p.captureId) return reply(request, {}, "STALE_CAPTURE");
        cancel(); return reply(request);
      }
      if (!state.active) return reply(request, {}, "BUSY");
      if (state.access !== "granted") return reply(request, {}, "PERMISSION_DENIED");
      if (request.method === "camera.start") {
        if (operation) return reply(request, {}, "BUSY");
        if (state.capabilities[p.mode] === "unsupported") return reply(request, {}, "UNSUPPORTED");
        state.mode = p.mode; state.lens = p.lens; state.phase = "starting"; emit();
        clock.setTimeout(() => { state.phase = "live"; emit(); reply(request); }, 80);
      } else if (request.method === "camera.takePhoto" || request.method === "camera.startRecording") {
        if (operation || state.phase !== "live") return reply(request, {}, "BUSY");
        const photo = request.method === "camera.takePhoto";
        if (photo !== (state.mode === "photo")) return reply(request, {}, "INVALID_ARGUMENT");
        const op = operation = { id: request.id, request, cancelled: false, started: now };
        state.captureId = op.id; state.phase = "capturing"; emit();
        clock.setTimeout(() => {
          if (operation !== op || op.cancelled) return;
          if (photo) end(op, request, "image/jpeg");
          else { state.phase = "recording"; state.durationMs = 0; op.started = now; emit(); reply(request, { captureId: op.id }); }
        }, photo ? 250 : 100);
      } else if (request.method === "camera.stopRecording") {
        if (!operation || operation.id !== p.captureId) return reply(request, {}, "STALE_CAPTURE");
        const op = operation;
        state.phase = "stopping"; emit();
        clock.setTimeout(() => end(op, request, "video/mp4"), 100);
      } else if (request.method === "camera.zoomBy") {
        state.zoomRatio = Math.max(state.capabilities.minZoom, Math.min(state.capabilities.maxZoom, state.zoomRatio * p.factor)); emit();
      } else if (request.method === "camera.setFlash") {
        if (!state.capabilities.flash) return reply(request, {}, "UNSUPPORTED");
        state.flash = p.mode; state.torch = p.torch; emit(); reply(request);
      } else if (request.method !== "camera.focus") reply(request, {}, "UNSUPPORTED");
    }
    for (const event of scenario.timeline || []) {
      clock.setTimeout(() => { Object.assign(state, clone(event.patch)); emit(); }, event.at);
    }
    function advance(milliseconds) {
      const until = now + milliseconds;
      let count = 0;
      while (true) {
        let earliest = null, key = null;
        for (const entry of jobs) if (entry[1].at <= until && (!earliest || entry[1].at < earliest.at)) {
          key = entry[0]; earliest = entry[1];
        }
        if (!earliest) break;
        if (++count > 10000) throw Error("Replay scheduler did not settle");
        now = earliest.at; jobs.delete(key); earliest.callback();
      }
      now = until;
      if (operation && state.phase === "recording") { state.durationMs = now - operation.started; emit(); }
    }
    return Object.freeze({
      send, subscribe(callback) { receiver = callback; return () => { receiver = () => {}; }; },
      clock, advance, inject: message => receiver(clone(message)),
      inspect: () => ({ now, session, sequence, state: clone(state), jobs: jobs.size })
    });
  }
  window.VisorReplay = Object.freeze({ createReplay });
})();
