"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const root = path.join(__dirname, "../..");
const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8");

test("semantic model and bridge protocol have separate responsibilities", () => {
  const model = JSON.parse(read("contract/model.json"));
  const wire = JSON.parse(read("contract/protocol.json"));
  assert.equal(model.maturity, "experimental/v0");
  assert.deepEqual(model.lifecycle.captureProgress, [
    "capturing",
    "recording",
    "stopping",
    "cancelling",
  ]);
  assert(
    model.lifecycle.captureProgress.every((phase: string) =>
      model.enums.CameraPhase.includes(phase),
    ),
  );
  assert(model.invariants.includes("cancel_ack_fences_success"));
  assert(model.invariants.includes("capture_progress_never_regresses"));
  for (const key of ["version", "limits", "envelope", "delivery", "notifications"])
    assert(!(key in model));
  for (const key of ["enums", "records", "operations"]) assert(!(key in wire));
  assert.equal(wire.version, 1);
  assert(wire.notifications.every((method: string) => Object.hasOwn(model.operations, method)));
});

test("core and HUD do not import a platform, and core has no DOM projection", () => {
  for (const file of ["core/backend.ts", "core/runtime.ts", "hud/hud.ts"]) {
    assert(
      !/\bNative\b|\bAndroid\b|\biOS\b|webkit|userAgent|navigator\.platform|platforms\//.test(
        read(file),
      ),
      file,
    );
  }
  for (const file of ["core/backend.ts", "core/runtime.ts"]) {
    assert(!/\bdocument\b|HTMLElement|getElementById|querySelector/.test(read(file)), file);
  }
});

test("Android host, bridge and camera keep their dependency boundaries", () => {
  const base = "platforms/android/src/main/java/io/volynetstyle/visor/android/";
  const camera =
    read(base + "camera/AndroidCameraBackend.kt") + read(base + "camera/CameraPort.kt");
  const bridge =
    read(base + "bridge/AndroidBridge.kt") + read(base + "bridge/AndroidBackendChannel.kt");
  const host = read(base + "host/MainActivity.kt") + read(base + "host/WebHost.kt");
  assert(
    !/android\.webkit|androidx\.webkit|org\.json|\.android\.bridge|\bwebReady\b|\bWebView\b/.test(
      camera,
    ),
  );
  assert(/code:\s*ErrorCode/.test(camera), "Camera errors must use model-defined values");
  assert(!/androidx\.camera|android\.hardware\.camera/.test(bridge));
  assert(!/android\.hardware\.camera|androidx\.camera\.core/.test(host));
  assert(
    read("platforms/android/src/main/AndroidManifest.xml").includes(
      "io.volynetstyle.visor.android.host.MainActivity",
    ),
  );
});
