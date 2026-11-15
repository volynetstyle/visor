"use strict";
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const budget = require("../hud/performance-budget.json");
async function build() {
  const destination = path.join(__dirname, "../hud/build");
  fs.mkdirSync(destination, { recursive: true });
  for (const file of Object.keys(budget.files)) {
    const contents = fs.readFileSync(path.join(__dirname, "..", ({ "contract.js":"contract/generated/contract.js", "backend.js":"core/backend.js", "runtime.js":"core/runtime.js", "platform.js":"platforms/android/web/platform.js", "app.js":"hud/hud.js", "index.html":"hud/index.html", "style.css":"hud/style.css" })[file]), "utf8");
    const extension = path.extname(file).slice(1);
    const result = ["js", "css"].includes(extension) ?
      (await esbuild.transform(contents, {
        loader: extension, minify: true, target: ["chrome80", "safari14"], charset: "utf8", legalComments: "none"
      })).code : contents;
    fs.writeFileSync(path.join(destination, file), result);
  }
}
module.exports = build;
if (require.main === module) build().catch(error => { console.error(error); process.exitCode = 1; });
