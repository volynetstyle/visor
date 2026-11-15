"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "../..");
const scenario = require("../replay/scenario.json");
function setup(overrides = {}) {
  const window = {};
  const context = vm.createContext({ window });
  for (const file of ["web/www/contract.js", "web/www/backend.js", "web/www/runtime.js", "packages/visor-contract/replay.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  }
  const fixture = JSON.parse(JSON.stringify({ ...scenario, timeline: [], ...overrides }));
  const replay = window.VisorReplay.createReplay(fixture);
  const backend = window.Visor.createBackend(replay, { clock: replay.clock });
  return { window, replay, backend };
}
async function live(h, mode = "photo") {
  await h.backend.system.connect();
  const pending = h.backend.camera.start({ mode, lens: "back" });
  h.replay.advance(80);
  await pending;
}
const code = value => error => error.code === value;

test("portable backend reaches live before camera.start resolves", async () => {
  const h = setup();
  const states = [];
  h.backend.camera.onState(s => states.push(s.phase));
  await live(h);
  assert.deepEqual(states, ["idle", "starting", "live"]);
  const caps = await h.backend.camera.capabilities();
  assert.equal(caps.rawStream, "unsupported");
  assert.equal(caps.motion, "unsupported");
  assert.equal(h.replay.inspect().jobs, 0);
});

test("photo returns its own identity and one terminal capture event", async () => {
  const h = setup();
  await live(h);
  const events = [];
  h.backend.camera.onCapture(event => events.push(event));
  const photo = h.backend.camera.takePhoto();
  const id = h.replay.inspect().state.captureId;
  h.replay.advance(250);
  const result = await photo;
  assert.equal(result.captureId, id);
  assert.equal(result.mime, "image/jpeg");
  assert.equal(events.length, 1);
  assert.equal(events[0].result.captureId, id);
});

test("cancel rejects capture, fences late successes and remains terminal exactly once", async () => {
  const h = setup();
  await live(h);
  const events = [];
  h.backend.camera.onCapture(event => events.push(event));
  const photo = h.backend.camera.takePhoto();
  const rejected = assert.rejects(photo, code("CANCELLED"));
  const id = h.replay.inspect().state.captureId;
  await h.backend.camera.cancelCapture({ captureId: id });
  await rejected;
  h.replay.advance(1000);
  const current = h.replay.inspect();
  h.replay.inject({ version: 1, kind: "capture", session: current.session, sequence: current.sequence,
    event: { captureId: id, result: { captureId: id, uri: "late", mime: "image/jpeg" }, error: null } });
  assert.equal(events.length, 1);
  assert.equal(events[0].error.code, "CANCELLED");
});

test("recording phases cannot regress, reopen a terminal capture or cross session", async () => {
  const h = setup();
  await live(h, "video");
  const phases = [];
  h.backend.camera.onState(s => phases.push(s.phase));
  const starting = h.backend.camera.startRecording();
  h.replay.advance(100);
  const ref = await starting;
  let current = h.replay.inspect();
  const envelope = { version: 1, kind: "state", session: current.session, sequence: current.sequence + 1 };
  h.replay.inject({ ...envelope, state: { ...current.state, phase: "capturing" } });
  h.replay.inject({ ...envelope, session: "another-session", state: { ...current.state, phase: "failed", captureId: null } });
  assert.equal(phases.at(-1), "recording");
  const stopping = h.backend.camera.stopRecording(ref);
  h.replay.advance(100);
  await stopping;
  current = h.replay.inspect();
  h.replay.inject({ ...envelope, sequence: current.sequence + 10,
    state: { ...current.state, phase: "recording", captureId: ref.captureId } });
  assert.equal(phases.at(-1), "live");
});

test("bounded outstanding commands, finite deadlines and disposal release all resources", async () => {
  const h = setup({ dropMethods: ["system.openGallery"] });
  await live(h);
  const pending = Array.from({ length: 16 }, () => h.backend.system.openGallery().catch(error => error));
  await assert.rejects(h.backend.system.openGallery(), code("OVERLOADED"));
  h.backend.dispose();
  for (const result of await Promise.all(pending)) assert.equal(result.code, "DISPOSED");
  assert.equal(h.replay.inspect().jobs, 0);
});

test("lost replies time out without polling; invalid gesture arguments never cross the port", async () => {
  const h = setup({ dropMethods: ["system.openGallery"] });
  await live(h);
  assert.throws(() => h.backend.camera.focus({ x: 5, y: 0 }), code("INVALID_ARGUMENT"));
  assert.throws(() => h.backend.camera.zoomBy({ factor: Infinity }), code("INVALID_ARGUMENT"));
  const result = assert.rejects(h.backend.system.openGallery(), code("TIMEOUT"));
  h.replay.advance(30001);
  await result;
  assert.equal(h.replay.inspect().jobs, 0);
});

test("HUD goals and capability negotiation run without any Android or DOM APIs", async () => {
  const initial = structuredClone(scenario.initial);
  initial.capabilities.video = "unsupported";
  const h = setup({ initial });
  const views = [];
  const runtime = h.window.Visor.createRuntime(h.backend, view => views.push(view));
  await Promise.resolve();
  h.replay.advance(80);
  await runtime.ready;
  await runtime.intent("video");
  assert.equal(views.at(-1).mode, "photo");
  assert.match(views.at(-1).message, /не поддерживается/);
  runtime.dispose();
  assert.equal(h.replay.inspect().jobs, 0);
});

test("closed capture watermark survives bounded tombstone eviction", async () => {
  const h = setup();
  await live(h);
  let first;
  for (let i = 0; i < 40; i++) {
    const photo = h.backend.camera.takePhoto();
    first ||= h.replay.inspect().state.captureId;
    h.replay.advance(250);
    await photo;
  }
  const current = h.replay.inspect();
  let phase;
  h.backend.camera.onState(state => { phase = state.phase; });
  h.replay.inject({ version: 1, kind: "state", session: current.session, sequence: current.sequence + 1,
    state: { ...current.state, phase: "capturing", captureId: first } });
  assert.equal(phase, "live");
});

test("new sessions fence all old commands and a protocol mismatch is a structured failure", async () => {
  const h = setup({ dropMethods: ["system.openGallery"] });
  await live(h);
  const old = assert.rejects(h.backend.system.openGallery(), code("STALE_SESSION"));
  await h.backend.system.connect();
  await old;
  const mismatch = assert.rejects(h.backend.system.openGallery(), code("PROTOCOL_MISMATCH"));
  h.replay.inject({ version: 999, kind: "state" });
  await mismatch;
});

test("runtime reconciles an idle camera when the host resumes", async () => {
  const initial = structuredClone(scenario.initial);
  initial.active = false;
  const h = setup({ initial, timeline: [{ at: 1000, patch: { active: true } }] });
  const views = [];
  const runtime = h.window.Visor.createRuntime(h.backend, view => views.push(view));
  await runtime.ready;
  h.replay.advance(1000);
  await Promise.resolve();
  h.replay.advance(80);
  await Promise.resolve();
  assert.equal(views.at(-1).shutterEnabled, true);
  runtime.dispose();
});

test("contract consumers contain no host detection or native bridge access", () => {
  for (const file of ["backend.js", "runtime.js", "app.js"]) {
    const source = fs.readFileSync(path.join(root, "web/www", file), "utf8");
    assert(!/\bNative\b|\bAndroid\b|webkit|userAgent|navigator\.platform/.test(source), file);
  }
});
