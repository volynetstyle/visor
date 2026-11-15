"use strict";
const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const esbuild: typeof import("esbuild") = require("esbuild");
const budget: { files: Record<string, number> } = require("../hud/performance-budget.json");
async function build() {
  const destination = path.join(__dirname, "../hud/build");
  fs.mkdirSync(destination, { recursive: true });
  for (const file of Object.keys(budget.files)) {
    const contents = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        (
          {
            "contract.js": "contract/generated/contract.ts",
            "backend.js": "core/backend.ts",
            "runtime.js": "core/runtime.ts",
            "platform.js": "platforms/android/web/platform.ts",
            "app.js": "hud/hud.ts",
            "index.html": "hud/index.html",
            "style.css": "hud/style.css",
          } as Record<string, string>
        )[file],
      ),
      "utf8",
    );
    const extension = path.extname(file).slice(1);
    const result = ["js", "css"].includes(extension)
      ? (
          await esbuild.transform(contents, {
            loader: extension === "js" ? "ts" : "css",
            minify: true,
            target: ["chrome80", "safari14"],
            charset: "utf8",
            legalComments: "none",
          })
        ).code
      : contents;
    fs.writeFileSync(path.join(destination, file), result);
  }
}
module.exports = build;
if (require.main === module)
  build().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
