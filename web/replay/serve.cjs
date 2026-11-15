"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const budget = require("../performance-budget.json");
const allowed = new Map(Object.keys(budget.files).map(file => ["/web/build/" + file, path.join(root, "web/build", file)]));
for (const file of ["boot.js", "replay.css"]) allowed.set("/web/replay/" + file, path.join(__dirname, file));
allowed.set("/replay.js", path.join(root, "packages/visor-contract/replay.js"));
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (request.method !== "GET") { response.writeHead(405); return response.end(); }
  if (url.pathname === "/") {
    let html = fs.readFileSync(path.join(root, "web/build/index.html"), "utf8");
    html = html.replace('<script src="platform.js" defer></script>',
      '<script src="/replay.js" defer></script><script src="/web/replay/scenario.js" defer></script><script src="/web/replay/boot.js" defer></script>');
    html = html.replace(/(src|href)="([a-z]+\.(?:js|css))"/g, '$1="/web/build/$2"');
    html = html.replace("</head>", '<link rel="stylesheet" href="/web/replay/replay.css"></head>');
    html = html.replace("<body>", '<body><nav class="replay-tools"><span>REPLAY · без камеры</span><button id="replay-step">+1 секунда</button><time id="replay-time">0 ms</time></nav>');
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return response.end(html);
  }
  if (url.pathname === "/web/replay/scenario.js") {
    response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    return response.end("window.VisorScenario=" + fs.readFileSync(path.join(__dirname, "scenario.json"), "utf8") + ";");
  }
  const file = allowed.get(url.pathname);
  if (!file) { response.writeHead(404); return response.end(); }
  response.writeHead(200, { "Content-Type": file.endsWith(".css") ? "text/css" : "text/javascript; charset=utf-8" });
  fs.createReadStream(file).pipe(response);
});
server.listen(4173, "127.0.0.1", () => console.log("VISOR replay: http://127.0.0.1:4173 (Ctrl+C to stop)"));
