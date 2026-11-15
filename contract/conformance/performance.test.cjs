"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { harness, state, touch } = require("./harness.cjs");

test("10,000 identical snapshots cause zero DOM writes and only one pending frame", () => {
  const h = harness();
  h.render(state());
  h.frame();
  h.writes.length = 0;
  for (let i = 0; i < 10000; i++) h.render(state());
  assert.equal(h.frames.size, 1);
  h.frame();
  assert.deepEqual(h.writes, []);
  assert.equal(h.frames.size, 0);
});

test("burst commits only the latest state; the next timer tick writes only timer text", () => {
  const h = harness();
  h.render(state());
  h.frame();
  h.writes.length = 0;
  for (let i = 0; i < 1000; i++) h.render(state({ duration: String(i) }));
  h.frame();
  assert.deepEqual(h.writes, [["timer", "textContent", "999"]]);
});

test("reused state objects and inset objects cannot defeat the diff cache", () => {
  const h = harness();
  const s = state();
  h.render(s);
  h.frame();
  h.writes.length = 0;
  s.mode = "video";
  s.insets.top = 30;
  h.render(s);
  h.frame();
  assert.equal(h.nodes.shutter.attributes["aria-label"], "Начать запись видео");
  assert(h.writes.some(([id, property, value]) => id === "root" && property === "--top" && value === "30px"));
});

test("pinch burst makes one native call, preserves total scale and flushes after finger release", () => {
  const h = harness();
  h.render(state());
  h.frame();
  const reads = h.viewportReads;
  // Both fingers can arrive in the same initial event.
  h.touch("touchstart", [touch(0), touch(100)]);
  for (let i = 1; i <= 1000; i++) h.touch("touchmove", [touch(0), touch(100 + .3 * i)]);
  h.touch("touchend", [], [touch(0), touch(400)]);
  assert.equal(h.frames.size, 1);
  assert.equal(h.calls.length, 0);
  h.frame();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "zoom");
  assert(Math.abs(h.calls[0][1] - 4) < 1e-10);
  assert.equal(h.viewportReads, reads);
  assert.equal(h.frames.size, 0);
});

test("tap uses only transform/opacity animation and no timers or synchronous layout reads", () => {
  const h = harness();
  h.render(state());
  h.frame();
  const reads = h.viewportReads;
  h.touch("touchstart", [touch(200, 400)]);
  h.touch("touchend", [], [touch(200, 400)]);
  h.frame();
  assert.deepEqual(h.calls, [["focus", .5, .5]]);
  assert.equal(h.animations.length, 1);
  assert(h.animations[0].options.duration <= 1000);
  assert.notEqual(h.animations[0].options.iterations, Infinity);
  for (const keyframe of h.animations[0].keyframes) {
    assert(Object.keys(keyframe).every(key => ["offset", "opacity", "transform"].includes(key)));
  }
  assert.equal(h.viewportReads, reads);
  assert.equal(h.frames.size, 0);
});

test("hidden page cancels work, drops gestures and resumes with the latest state", () => {
  const h = harness();
  h.render(state());
  h.frame();
  h.writes.length = 0;
  h.touch("touchstart", [touch(100)]);
  h.touch("touchend", [], [touch(100)]);
  h.hidden(true);
  for (let i = 0; i < 10000; i++) h.render(state({ duration: String(i) }));
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.calls, []);
  h.hidden(false);
  assert.equal(h.frames.size, 1);
  h.frame();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.writes, [["timer", "textContent", "9999"]]);
});

test("cancelled and disabled gestures cannot leak a queued camera command", () => {
  for (const cancel of [h => h.touch("touchcancel", []), h => h.render(state({ ready: false }))]) {
    const h = harness();
    h.render(state());
    h.frame();
    h.touch("touchstart", [touch(0), touch(100)]);
    h.touch("touchmove", [touch(0), touch(200)]);
    cancel(h);
    h.frame();
    assert.deepEqual(h.calls, []);
  }
});

test("shutter command is immediate, even with a UI frame queued", () => {
  const h = harness();
  h.render(state());
  h.nodes.shutter.fire("click");
  assert.deepEqual(h.calls, [["action", "shutter"]]);
});

test("idle UI has no callbacks, and controls cannot initiate camera gestures", () => {
  const h = harness();
  h.render(state());
  h.frame();
  h.writes.length = 0;
  h.touch("touchstart", [touch(100)], undefined, h.nodes.shutter);
  h.touch("touchend", [], [touch(100)], h.nodes.shutter);
  for (let i = 0; i < 600; i++) h.frame();
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.calls, []);
});

test("runtime fits budgets and stays a local, fixed DOM interface", () => {
  const root = path.join(__dirname, "../..");
  const budget = JSON.parse(fs.readFileSync(path.join(root, "hud/performance-budget.json"), "utf8"));
  const www = path.join(root, "hud");
  const artifact = path.join(root, "hud/build");
  assert.deepEqual(fs.readdirSync(artifact).sort(), Object.keys(budget.files).sort());
  let total = 0;
  for (const [file, maximum] of Object.entries(budget.files)) {
    const size = fs.statSync(path.join(artifact, file)).size;
    assert(size <= maximum, file + " exceeds its byte budget");
    total += size;
  }
  assert(total <= budget.totalBytes, "UI exceeds total byte budget");
  const html = fs.readFileSync(path.join(www, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(www, "hud.js"), "utf8");
  const css = fs.readFileSync(path.join(www, "style.css"), "utf8");
  assert((html.match(/<[a-z][\w-]*(?=[\s>])/gi) || []).length <= budget.maxDomElements);
  assert(!/<(?:canvas|video|iframe)\b/i.test(html), "Camera buffers stay native");
  assert(!/<script\b(?![^>]*\bsrc\s*=)/i.test(html), "Scripts must be local files");
  assert(!/\son\w+\s*=/i.test(html), "No inline event handlers");
  assert(!/\b(?:import|require|fetch|WebSocket|XMLHttpRequest|setTimeout|setInterval|eval)\s*(?:\(|\{)/.test(js));
  assert(!/innerHTML|outerHTML|createElement|appendChild|replaceChildren|getBoundingClientRect|offset(?:Width|Height|Top|Left)|client(?:Width|Height)|getComputedStyle/.test(js));
  assert(!/backdrop-filter|\bfilter\s*:|will-change|@import|url\s*\(/i.test(css));
  for (const [, value] of css.matchAll(/transition\s*:\s*([^;}]+)/g)) {
    assert(value.split(",").every(item => /^(transform|opacity|none)\b/.test(item.trim())), "Only transform/opacity may transition");
  }
  for (const [, resource] of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    assert(Object.hasOwn(budget.files, resource), "Resource must be bundled: " + resource);
  }
});
