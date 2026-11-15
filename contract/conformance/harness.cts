"use strict";
const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const vm: typeof import("node:vm") = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../hud/build/app.js"), "utf8");

function harness() {
  const writes: any[][] = [];
  const calls: any[][] = [];
  const animations: any[] = [];
  const frames = new Map<number, (time: number) => void>();
  const nodes: Record<string, any> = {};
  let sequence = 0;
  let viewportReads = 0;
  const buttonIds = new Set(["message", "flash", "photo", "video", "shutter", "switch", "gallery"]);
  function target(name: string): any {
    const listeners: Record<string, any[]> = {};
    return {
      addEventListener(type: string, handler: (event: any) => void, options: any) {
        (listeners[type] ||= []).push({ handler, options });
      },
      fire(type: string, event: object = {}) {
        for (const { handler } of listeners[type] || []) handler({ target: this, ...event });
      },
      listeners,
      name,
    };
  }
  function element(id: string) {
    const el = target(id);
    el.attributes = {};
    for (const key of ["textContent", "hidden", "disabled"]) {
      let value: any;
      Object.defineProperty(el, key, {
        get: () => value,
        set: (next) => {
          value = next;
          writes.push([id, key, next]);
        },
      });
    }
    el.setAttribute = (key: string, value: string) => {
      el.attributes[key] = value;
      writes.push([id, key, value]);
    };
    el.classList = {
      toggle: (key: string, value: boolean) => writes.push([id, "class:" + key, value]),
    };
    el.closest = () => (buttonIds.has(id) ? el : null);
    el.animate = (keyframes: any, options: any) => {
      const animation = {
        keyframes,
        options,
        cancelled: false,
        cancel() {
          this.cancelled = true;
        },
      };
      animations.push(animation);
      return animation;
    };
    for (const key of ["offsetWidth", "offsetHeight", "clientWidth", "clientHeight"]) {
      Object.defineProperty(el, key, {
        get() {
          throw Error("Forbidden layout read: " + key);
        },
      });
    }
    el.getBoundingClientRect = () => {
      throw Error("Forbidden geometry read");
    };
    return el;
  }
  const document = target("document");
  document.hidden = false;
  document.getElementById = (id: string) => (nodes[id] ||= element(id));
  document.documentElement = {
    style: { setProperty: (key: string, value: string) => writes.push(["root", key, value]) },
  };
  const window = target("window");
  Object.defineProperties(window, {
    innerWidth: {
      get: () => {
        viewportReads++;
        return 400;
      },
    },
    innerHeight: {
      get: () => {
        viewportReads++;
        return 800;
      },
    },
  });
  window.matchMedia = () => ({ matches: false });
  window.Native = {
    action: (command: string) => calls.push(["action", command]),
    zoom: (factor: number) => calls.push(["zoom", factor]),
    focus: (x: number, y: number) => calls.push(["focus", x, y]),
  };
  window.VisorTransport = {};
  window.Visor = {
    createBackend: () => ({}),
    createRuntime: () => ({
      intent: (command: string) => calls.push(["action", command]),
      zoomBy: (change: { factor: number }) => calls.push(["zoom", change.factor]),
      focus: (point: { x: number; y: number }) => calls.push(["focus", point.x, point.y]),
      dispose() {},
    }),
  };
  const forbidden = () => {
    throw Error("Polling/timers/network are forbidden in the UI runtime");
  };
  vm.runInNewContext(source, {
    window,
    document,
    requestAnimationFrame: (callback: (time: number) => void) => {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: forbidden,
    setInterval: forbidden,
    fetch: forbidden,
    WebSocket: forbidden,
  });
  return {
    window,
    document,
    nodes,
    writes,
    calls,
    animations,
    frames,
    get viewportReads() {
      return viewportReads;
    },
    render: (state: any) => window.PureCamera.render(state),
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(16));
    },
    hidden(value: boolean) {
      document.hidden = value;
      document.fire("visibilitychange");
    },
    touch(type: string, touches: any[], changedTouches = touches, target = nodes.viewfinder) {
      nodes.viewfinder.fire(type, { target, touches, changedTouches });
    },
  };
}

function state(overrides = {}) {
  return {
    ready: true,
    mode: "photo",
    selectionEnabled: true,
    shutterEnabled: true,
    recording: false,
    duration: "00:00",
    switchEnabled: true,
    flashEnabled: true,
    flash: "ВСПЫШКА АВТО",
    zoom: "1×",
    message: "",
    messageEnabled: false,
    insets: { top: 24, bottom: 24, left: 0, right: 0 },
    ...overrides,
  };
}
const touch = (x: number, y = 100) => ({ clientX: x, clientY: y });
module.exports = { harness, state, touch };
