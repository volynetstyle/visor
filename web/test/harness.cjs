"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../www/app.js"), "utf8");

function harness() {
  const writes = [];
  const calls = [];
  const animations = [];
  const frames = new Map();
  const nodes = {};
  let sequence = 0;
  let viewportReads = 0;
  const buttonIds = new Set(["message", "flash", "photo", "video", "shutter", "switch", "gallery"]);
  function target(name) {
    const listeners = {};
    return {
      addEventListener(type, handler, options) {
        (listeners[type] ||= []).push({ handler, options });
      },
      fire(type, event = {}) {
        for (const { handler } of listeners[type] || []) handler({ target: this, ...event });
      },
      listeners,
      name
    };
  }
  function element(id) {
    const el = target(id);
    el.attributes = {};
    for (const key of ["textContent", "hidden", "disabled"]) {
      let value;
      Object.defineProperty(el, key, {
        get: () => value,
        set: next => { value = next; writes.push([id, key, next]); }
      });
    }
    el.setAttribute = (key, value) => { el.attributes[key] = value; writes.push([id, key, value]); };
    el.classList = { toggle: (key, value) => writes.push([id, "class:" + key, value]) };
    el.closest = () => buttonIds.has(id) ? el : null;
    el.animate = (keyframes, options) => {
      const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
      animations.push(animation);
      return animation;
    };
    for (const key of ["offsetWidth", "offsetHeight", "clientWidth", "clientHeight"]) {
      Object.defineProperty(el, key, { get() { throw Error("Forbidden layout read: " + key); } });
    }
    el.getBoundingClientRect = () => { throw Error("Forbidden geometry read"); };
    return el;
  }
  const document = target("document");
  document.hidden = false;
  document.getElementById = id => nodes[id] ||= element(id);
  document.documentElement = { style: { setProperty: (key, value) => writes.push(["root", key, value]) } };
  const window = target("window");
  Object.defineProperties(window, {
    innerWidth: { get: () => { viewportReads++; return 400; } },
    innerHeight: { get: () => { viewportReads++; return 800; } }
  });
  window.matchMedia = () => ({ matches: false });
  window.Native = {
    action: command => calls.push(["action", command]),
    zoom: factor => calls.push(["zoom", factor]),
    focus: (x, y) => calls.push(["focus", x, y])
  };
  window.VisorTransport = {};
  window.Visor = {
    createBackend: () => ({}),
    createRuntime: () => ({
      intent: command => calls.push(["action", command]),
      zoomBy: change => calls.push(["zoom", change.factor]),
      focus: point => calls.push(["focus", point.x, point.y]),
      dispose() {}
    })
  };
  const forbidden = () => { throw Error("Polling/timers/network are forbidden in the UI runtime"); };
  vm.runInNewContext(source, {
    window, document,
    requestAnimationFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: forbidden, setInterval: forbidden, fetch: forbidden, WebSocket: forbidden
  });
  return {
    window, document, nodes, writes, calls, animations, frames,
    get viewportReads() { return viewportReads; },
    render: state => window.PureCamera.render(state),
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(16));
    },
    hidden(value) { document.hidden = value; document.fire("visibilitychange"); },
    touch(type, touches, changedTouches = touches, target = nodes.viewfinder) {
      nodes.viewfinder.fire(type, { target, touches, changedTouches });
    }
  };
}

function state(overrides = {}) {
  return {
    ready: true, mode: "photo", selectionEnabled: true, shutterEnabled: true,
    recording: false, duration: "00:00", switchEnabled: true, flashEnabled: true,
    flash: "ВСПЫШКА АВТО", zoom: "1×", message: "", messageEnabled: false,
    insets: { top: 24, bottom: 24, left: 0, right: 0 }, ...overrides
  };
}
const touch = (x, y = 100) => ({ clientX: x, clientY: y });
module.exports = { harness, state, touch };
