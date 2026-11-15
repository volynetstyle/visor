"use strict";
const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const { spawnSync } = require("node:child_process");
const tests = path.join(__dirname, "../contract/conformance");
const files = fs
  .readdirSync(tests)
  .filter((file) => file.endsWith(".test.cts"))
  .map((file) => path.join(tests, file));
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
