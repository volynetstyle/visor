"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const files = new Map([
  ["/", ["index.html", "text/html"]],
  ["/dial.css", ["dial.css", "text/css"]],
  ["/dial.js", ["dial.js", "text/javascript"]],
  ["/demo.js", ["demo.js", "text/javascript"]],
  ["/dial-model.js", ["dial-model.js", "text/javascript"]],
  ["/framework.js", ["../@framework/dist/index.js", "text/javascript"]],
  ["/framework-frame.js", ["../@framework/dist/frame.js", "text/javascript"]],
  ["/quant.js", ["node_modules/reflex-quant/dist/index.js", "text/javascript"]],
  ["/compiled", ["compiled.html", "text/html"]],
  ["/compiled.js", ["../../build/quant-dom/compiled.js", "text/javascript"]],
]);
http.createServer((request, response) => {
  const entry = files.get(request.url);
  if (!entry) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": `${entry[1]}; charset=utf-8`, "Cache-Control": "no-store" });
  fs.createReadStream(path.join(__dirname, entry[0])).pipe(response);
}).listen(Number(process.env.PORT || 4173), "127.0.0.1", () => console.log("Dial demo server started"));
