"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const tests = path.join(__dirname, "../web/test");
const files = fs.readdirSync(tests).filter(file => file.endsWith(".test.cjs")).map(file => path.join(tests, file));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
