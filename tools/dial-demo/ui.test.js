import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, createScope, signal, set, get, computed } from "@visor/framework/frame";
import { createDialModel } from "./dial-model.js";

function harness() {
  let next = 0;
  const frames = new Map(),
    listeners = new Map(),
    writes = [];
  const doc = {
    hidden: false,
    addEventListener: (n, f) => listeners.set(n, f),
    removeEventListener: (n) => listeners.delete(n),
  };
  const host = createHost(
    doc,
    (f) => {
      frames.set(++next, f);
      return next;
    },
    (id) => frames.delete(id),
  );
  const scope = createScope(host);
  const node = {
    setAttribute: (n, v) => writes.push([n, v]),
    removeAttribute: (n) => writes.push([n, null]),
  };
  return {
    scope,
    doc,
    listeners,
    frames,
    writes,
    node,
    flush() {
      const fs = [...frames.values()];
      frames.clear();
      fs.forEach((f) => f());
    },
  };
}
test("burst retains latest projection, unchanged committed value makes zero writes", () => {
  const h = harness(),
    value = signal(0);
  h.scope.attr(h.node, "x", () => get(value));
  h.flush();
  h.writes.length = 0;
  for (let i = 0; i < 10000; i++) set(value, i);
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.deepEqual(h.writes, [["x", "9999"]]);
  h.writes.length = 0;
  set(value, 1);
  set(value, 9999);
  h.flush();
  assert.deepEqual(h.writes, []);
  h.scope.dispose();
  assert.equal(h.listeners.size, 0);
});
test("hidden host defers writes and disposal cancels bindings and callbacks", () => {
  const h = harness(),
    value = signal(0);
  h.scope.attr(h.node, "x", () => get(value));
  h.doc.hidden = true;
  h.listeners.get("visibilitychange")();
  set(value, 4);
  assert.equal(h.frames.size, 0);
  assert.equal(h.writes.length, 0);
  h.doc.hidden = false;
  h.listeners.get("visibilitychange")();
  h.flush();
  assert.deepEqual(h.writes, [["x", "4"]]);
  h.scope.frame("notify", () => assert.fail("disposed callback"));
  set(value, 5);
  h.scope.dispose();
  assert.equal(h.frames.size, 0);
  set(value, 6);
  assert.equal(h.frames.size, 0);
});
test("computed projection isolates unchanged fields", () => {
  const h = harness(),
    value = signal(1),
    label = computed(() => Math.round(get(value)));
  h.scope.attr(h.node, "label", () => get(label));
  h.flush();
  h.writes.length = 0;
  set(value, 1.1);
  assert.equal(h.frames.size, 0);
  h.scope.dispose();
});
test("DOM-free dial clamps, quantizes and projects signed trail", () => {
  const d = createDialModel({ min: -100, max: 100, initial: 46 });
  assert.equal(get(d.value), 46);
  assert.equal(get(d.trailWidth), 78.2);
  d.update(-12);
  assert.equal(get(d.trailX), 149.6);
  d.update(999);
  assert.equal(get(d.value), 100);
  d.update(0);
  assert.equal(get(d.trailWidth), 0);
  d.update(NaN);
  assert.equal(get(d.value), 0);
});
