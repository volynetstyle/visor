import { test } from "node:test";
import assert from "node:assert/strict";
import { transformSync } from "@babel/core";
import jsx from "babel-plugin-jsx-dom-expressions";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { jsxOptions } from "../dist/compiler.js";
const fixture = `
import { signal, get, set, render, onCleanup, batch } from '@visor/framework';
const value=signal(46), visible=signal(true);
export { batch };
export const stats={mounts:0,disposals:0};
function Child(){stats.mounts++;onCleanup(()=>stats.disposals++);return <section><output>{get(value)}</output><svg><rect width={get(value)*3.4}/></svg><button onClick={()=>set(value,get(value)+1)}>+</button></section>}
export const setValue=v=>set(value,v), show=v=>set(visible,v);
export const stop=render(()=> <main>{get(visible)?<Child/>:null}</main>,document.body);
`;
test("compiled JSX: native DOM, batch, identity, conditional ownership and disposal", async () => {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  const code = transformSync(fixture, {
    configFile: false,
    babelrc: false,
    plugins: [[jsx, jsxOptions()]],
  }).code;
  assert.match(code, /template/);
  const result = await build({
    stdin: { contents: code, resolveDir: process.cwd(), loader: "js" },
    bundle: true,
    format: "esm",
    write: false,
  });
  const app = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  const output = document.querySelector("output");
  assert.equal(output.textContent, "46");
  let mutations = 0;
  const observer = new window.MutationObserver((records) => (mutations += records.length));
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    characterData: true,
    childList: true,
  });
  for (let i = 0; i < 10000; i++) app.setValue(46);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(mutations, 0);
  app.batch(() => {
    for (let i = 0; i < 1000; i++) app.setValue(i);
  });
  assert.equal(output.textContent, "999");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(mutations, 2);
  assert.equal(document.querySelector("output"), output);
  assert.equal(app.stats.mounts, 1);
  document.querySelector("button").click();
  assert.equal(output.textContent, "1000");
  for (let i = 0; i < 20; i++) {
    const old = document.querySelector("output"),
      text = old.textContent;
    app.show(false);
    app.setValue(i);
    assert.equal(old.textContent, text);
    assert.equal(document.querySelector("output"), null);
    app.show(true);
    assert.equal(document.querySelector("output").textContent, String(i));
  }
  assert.equal(app.stats.mounts, 21);
  assert.equal(app.stats.disposals, 20);
  app.stop();
  app.stop();
  assert.equal(app.stats.disposals, 21);
  assert.equal(document.body.textContent, "");
  observer.disconnect();
  await window.happyDOM.close();
});
