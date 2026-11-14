# NightField 0.1

A deliberately small Android + TypeScript experiment for live low-light accumulation from **RAW Bayer**.

## What exists now

`Camera2 RAW_SENSOR -> even center crop -> AndroidX WebMessage ArrayBuffer -> WebGPU -> Bayer 2x2 RGB superpixels -> exposure-weighted temporal mean -> tone mapped canvas`

The native layer is intentionally thin. It owns camera permissions, Camera2 and byte transport. The image algorithm lives in TypeScript/WGSL.

### Why a crop?

A 12 MP `RAW_SENSOR` frame is ~24 MiB before bridge overhead; a 50 MP frame is absurd for a Java/WebView copying path. The MVP takes an even-aligned center crop up to 1920×1440, preserving Bayer phase, so each packet stays around 5.3 MiB or below. Once the algorithm is proven, the transport can move to NDK/AHardwareBuffer/Vulkan or tiled RAW.

## Requirements

- Android phone whose back camera advertises `REQUEST_AVAILABLE_CAPABILITIES_RAW`.
- Preferably `REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR` too.
- Android System WebView / Chrome 121+ on a WebGPU-capable Android 12+ device.
- Android SDK Platform 36 and SDK Build Tools 36.0.0 (or a project-local SDK that can install them).
- Windows x64 for the bootstrap below. Pixi supplies Node 22 and JDK 21 locally.

The app enumerates cameras at runtime and reports RAW/manual support. If the phone vendor hides RAW from Camera2, no JavaScript trick can restore it; use another device or add a YUV fallback.

## Setup and build on Windows

From the project root, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1
.\.pixi\bin\pixi.exe run build
```

The bootstrap downloads a pinned Pixi and Gradle, verifies their SHA-256 checksums, installs the locked Pixi environment, and runs `npm ci`. The build compiles the web bundle before building the debug APK at `app/build/outputs/apk/debug/app-debug.apk`. Pixi, Gradle, their build caches, and npm's bootstrap cache stay inside this project.

The Android SDK is separate from the Pixi environment. The build uses `.android-sdk/` when present; otherwise it uses `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or the usual `%LOCALAPPDATA%\Android\Sdk` location. It does not automatically install packages into a shared SDK. Install the required SDK packages and accept their licenses with Android Studio or `sdkmanager` first. If using a project-local `.android-sdk/`, Gradle can install missing packages there after their licenses have been accepted.

Connect a compatible phone with USB debugging enabled, then install and launch the APK using Android Studio. With a project-local SDK, the install command is:

```powershell
.\.android-sdk\platform-tools\adb.exe install -r .\app\build\outputs\apk\debug\app-debug.apk
```

When using a shared SDK, use its `platform-tools\adb.exe` instead.

To rebuild only the web bundle:

```bash
.\.pixi\bin\pixi.exe run web-build
```

Vite writes directly to:

`app/src/main/assets/www/`

The Android build uses AGP 9.4.1 and the local Gradle 9.6 installation. The source bundle does not contain a Gradle Wrapper executable or JAR.

## Fast web iteration

Build and install the APK once. Start Vite from the project root:

```bash
.\.pixi\bin\pixi.exe run web-dev
```

On Windows PowerShell, from the repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

That does `adb reverse tcp:5173 tcp:5173` and reopens the Activity with `http://127.0.0.1:5173`. The native RAW bridge is injected into that origin too, so TS/WGSL changes hot-reload without rebuilding the APK.

## First test

1. Put the phone on something genuinely static.
2. Start around 30–100 ms exposure and ISO 400–1600.
3. Tap **Start RAW**.
4. Watch the history accumulate.
5. Compare after 1, 5, 15, 30 seconds.
6. Tap **Reset history** to verify the quality jump is temporal, not display adaptation.

The current shader reduces each Bayer 2×2 cell to one linear RGB pixel before accumulation. This is intentional: it is cheap, preserves linear sensor information, and gives a clean physical baseline before implementing a better demosaic.

## Wire packet

Every native frame is one `ArrayBuffer`:

- bytes `0..127`: little-endian NRAW v1 header
- bytes `128..`: tightly packed RAW_SENSOR crop, 16 bits/sample

Important header offsets are mirrored in `web/src/raw.ts`.

Backpressure is explicit: native sends at most one frame until JS posts `{type:"ack"}`. If capture outruns processing, frames are dropped instead of building a stale multi-hundred-megabyte queue. Cameras have caused enough suffering without inventing a memory leak as a feature.

## Next commits, in order

1. **Static correctness**: dark-frame test, black levels, saturation rejection, stable exposure normalization.
2. **Better colour**: camera neutral / color matrices and a real demosaic after accumulation.
3. **Robust accumulation**: per-pixel variance, hot-pixel rejection, moving-object mismatch mask.
4. **Pure rotation**: Android gyro/rotation vector + camera intrinsics, `H = K R K^-1`, reproject history instead of resetting it.
5. **Visual correction**: refine IMU homography with image registration.
6. **Translation**: local flow/depth, then persistent world-space history.
7. **Transport upgrade**: replace WebMessage copies with native shared/GPU memory once RAW frame rate becomes the bottleneck.

## Files worth touching first

- `app/.../RawCamera.kt` — capture format, crop, manual exposure/ISO.
- `app/.../NativeBridge.kt` — binary backpressure bridge.
- `web/src/gpu.ts` — the actual temporal radiance machine.
- `web/src/raw.ts` — packet parser.
- `web/src/main.ts` — controls and diagnostics.
