import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Window } from "happy-dom";
import build from "./build-dom.cjs";
async function load(name) {
  const code = fs.readFileSync(
    new URL(`../../build/quant-dom/${name}.js`, import.meta.url),
    "utf8",
  );
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
function setup() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  document.body.innerHTML = '<main id="compiled"></main>';
  return window;
}
test("compiled JSX mounts once, updates native text/SVG and disposes", async () => {
  await build();
  const window = setup(),
    app = await load("compiled");
  const output = document.querySelector("output"),
    rect = document.querySelector("rect");
  assert.equal(output.textContent, "46");
  let mutations = 0;
  const observer = new window.MutationObserver((records) => (mutations += records.length));
  observer.observe(document.getElementById("compiled"), {
    subtree: true,
    attributes: true,
    characterData: true,
    childList: true,
  });
  for (let i = 0; i < 10000; i++) app.setValue(46);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(mutations, 0);
  app.batch(() => {
    for (let i = 0; i < 1000; i++) app.setValue(i);
  });
  assert.equal(output.textContent, "999");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(mutations, 2);
  assert.equal(document.querySelector("output"), output);
  app.setValue(50);
  assert.equal(output.textContent, "50");
  assert.equal(rect.getAttribute("width"), "170");
  document.querySelectorAll("button")[1].click();
  assert.equal(output.textContent, "51");
  assert.equal(app.stats.mounts, 1);
  app.stop();
  app.stop();
  assert.equal(app.stats.disposals, 1);
  app.setValue(99);
  assert.equal(output.textContent, "51");
  assert.equal(document.getElementById("compiled").childNodes.length, 0);
  observer.disconnect();
  await window.happyDOM.close();
});
test("conditional subtrees own nested effects across repeated mount/unmount", async () => {
  await build("dom-fixture.jsx", "fixture");
  const window = setup(),
    app = await load("fixture");
  for (let i = 0; i < 20; i++) {
    const old = document.querySelector("span");
    app.setVisible(false);
    app.setCount(i + 2);
    assert.equal(document.querySelector("span"), null);
    assert.notEqual(old.textContent, String(i + 2));
    app.setVisible(true);
    assert.equal(document.querySelector("span").textContent, String(i + 2));
  }
  assert.equal(app.stats.mounted, 21);
  assert.equal(app.stats.disposed, 20);
  app.stop();
  assert.equal(app.stats.disposed, 21);
  await window.happyDOM.close();
});
