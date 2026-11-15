# NightField 0.1

A deliberately small Android + TypeScript experiment for live low-light accumulation from **RAW Bayer**.

## What exists now

`Camera2 RAW_SENSOR + matched CaptureResult -> even center crop -> AndroidX WebMessage ArrayBuffer -> WebGPU -> signed CFA (R,G1,G2,B) mean + M2 + count -> display-only RGB superpixels -> tone mapped canvas`

The native layer is intentionally thin. It owns camera permissions, Camera2 and byte transport. The image algorithm lives in TypeScript/WGSL.

The first controlled experiment follows [MATH_MODEL.md](MATH_MODEL.md): fixed actual exposure/ISO, 250 ms requested exposure and a 32-second observation window by default. Sensor black is subtracted per frame; signed values stay in f32. Persistent means and M2 use black-corrected sensor DN, without an assumed conversion to electrons or ISO-proportional gain. An entire Bayer quad is rejected when any of its samples reaches that frame's white level. Green channels are combined only for display.

### Why a crop?

A 12 MP `RAW_SENSOR` frame is ~24 MiB before bridge overhead; a 50 MP frame is absurd for a Java/WebView copying path. The MVP takes an even-aligned center crop up to 1920×1440, preserving Bayer phase, so each packet stays around 5.3 MiB or below. Once the algorithm is proven, the transport can move to NDK/AHardwareBuffer/Vulkan or tiled RAW.

## Requirements

- Android phone whose back camera advertises `REQUEST_AVAILABLE_CAPABILITIES_RAW`.
- `REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR` and a supported Bayer CFA (RGGB, GRBG, GBRG or BGGR).
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

The RAW ISP and calibration workflow is described in [ISP_CALIBRATION.md](ISP_CALIBRATION.md). Camera settings include the analog ISO limit, fixed-exposure ISO comparison presets, calibrated sensor color, optional highlight compression and persistent 64-frame dark/FPN calibration. Request a new camera dump or capture report after installing the updated APK to verify actual shading-map delivery on the device.

An experimental **Вращение · RGB** history mode is available in camera settings. It uses timestamped IMU rotation, calibrated lens geometry and noise-aware history validation. The static CFA mode remains the default. See [MOTION_MODEL.md](MOTION_MODEL.md) for assumptions, evidence semantics and prerequisites. The two supplied phone reports use an `UNKNOWN` camera timestamp source, so IMU history reuse is disabled for that recorded configuration; fresh frames continue to display with an explicit reason.

The viewfinder has separate **Настройки** (camera and capture settings) and **Камера** panels. The camera selector lists Camera2 devices advertising RAW; the static experiment additionally requires manual sensor control and a supported Bayer CFA. Changing camera clears the current accumulation. **Запросить информацию** enumerates the Camera2 characteristics exposed for every camera, including output formats, sizes, minimum frame durations and stall durations. It also includes the latest capture result if one has been received. **Сохранить JSON** opens Android's document picker. Camera2 may omit values, restrict them until camera permission is granted, or return vendor-specific values represented as text; per-key errors are included in the report.

1. Put the phone on a stable support and aim at a stationary ground scene or an evenly lit target. Focus is fixed at infinity.
2. Start with **250 ms**, **ISO 800** and the **32 seconds** window. Exposure/ISO are clamped to the camera's supported range; diagnostics show requested and actual values.
3. Tap **Start RAW**. Capture controls remain fixed during a series. A change in actual exposure/ISO or Bayer geometry stops the series instead of mixing incompatible measurements.
4. Compare the accumulated signal and the **Temporal noise** view. The latter shows per-photosite temporal sample standard deviation; scene texture is not counted as temporal noise.
5. After the automatic stop, tap **Save report** and choose a JSON file in Android's document picker. It contains accepted exposure sum, sensor timestamp span, delivered fps, native drop counts, noise profiles, timings and the central 16×16-quad mean/M2/count patch.
6. Stop before resetting history or changing capture settings. Repeat at 50, 100, 250, 500 and 1000 ms where supported, keeping display gain fixed for comparisons.

For a dark-frame experiment, use the separate 64-frame dark calibration workflow with the lens covered. Compare signed mean, temporal variance and profile classifications. When using a matching profile in a normal series, residual dark offsets are subtracted and hot/unstable quads are masked. Calibration uncertainty and temperature drift remain separate error sources. For flat-field work, use a stable uniform target; automatic PRNU calibration is not implemented. General moving-object and star alignment remain future work.

The sum of processed frame exposures is an upper bound per photosite: saturated quads contribute fewer observations. The report includes their ROI counts and rejection fraction. Queue completion includes GPU upload/compute/display scheduling; it is not an isolated shader execution timestamp. Crop/copy duration and delivered MB/s are measured separately; bridge-only latency is not isolated.

## Verification

```powershell
.\.pixi\bin\pixi.exe run test
.\.pixi\bin\pixi.exe run build
```

The Node tests cover binary metadata, invalid packets, fixed-setting series and temporal variance diagnostics. To run the actual WGSL regression tests, start `pixi run web-dev`, open `http://127.0.0.1:5173` in a WebGPU-capable browser, and run this in its developer console:

```javascript
await import('/test/gpu.test.ts').then(m => m.runGpuTests())
await import('/test/history-gpu.test.ts').then(m => m.runHistoryGpuTests())
await import('/test/isp-gpu.test.ts').then(m => m.runIspGpuTests())
```

These GPU tests check all four CFA layouts, independent greens, signed dark means, Welford variance, saturation masks, reset and non-workgroup-aligned boundaries. A physical camera is required to validate vendor metadata, RAW cadence, thermal behavior and real dark/flat calibration.

## Wire packet

Every native frame is one `ArrayBuffer`:

- bytes `0..767`: little-endian NRAW v4 header, including motion and ISP metadata
- bytes `768..768+payloadBytes-1`: tightly packed RAW_SENSOR crop, 16 bits/sample
- remaining bytes: optional float32 lens shading grid

The parser also reads legacy v2/256-byte and v3/512-byte packets. ISP and motion metadata have explicit validity flags; missing data is labeled and never substituted with an invented calibration.

Important header offsets are mirrored in `web/src/raw.ts`. Actual exposure/ISO are taken only from `TotalCaptureResult` with exactly the same sensor timestamp as the `Image`. Dynamic black/white levels are used where available, otherwise the packet flags explicitly identify static fallbacks. Four optional (S,O) noise-profile pairs are preserved in row-major CFA order. Requested settings, frame duration, acquired-image interval, crop/copy time and drop counts are separate header fields. ISP features require the updated v4 APK; v2/v3 frames remain readable with their original metadata capabilities.

Backpressure is explicit: native reserves one in-flight frame **before** invoking the RAW copy supplier. JS posts `{type:"ack", frameId}` only after GPU queue completion and any diagnostic readback. Stale acknowledgments cannot release another frame's slot. Metadata pairing retains at most one unpaired image (2-second timeout) and 16 capture results; unmatched images are closed and counted.

## Next commits, in order

1. **Device calibration**: measure dark/flat fields, black-level drift, exposure linearity and the noise profile on a physical phone.
2. **Better colour**: camera neutral / color matrices and a real demosaic after accumulation.
3. **Robust accumulation**: hot-pixel calibration, moving-object mismatch mask, then calibrated noise-aware weighting for changing acquisition settings.
4. **Validate rotation on a device**: the experimental RGB reprojection and validity gate are implemented; measure calibration, IMU timing, exposure blur and mobile performance. Cameras with UNKNOWN timestamps need image alignment or measured synchronization first.
5. **Visual correction**: refine IMU homography with image registration.
6. **Translation**: local flow/depth, then persistent world-space history.
7. **Transport upgrade**: replace WebMessage copies with native shared/GPU memory once RAW frame rate becomes the bottleneck.

## Files worth touching first

- `app/.../RawCamera.kt` — capture format, crop, manual exposure/ISO.
- `app/.../NativeBridge.kt` — binary backpressure bridge.
- `web/src/gpu.ts` — the actual temporal radiance machine.
- `web/src/shaders.ts` — signed CFA Welford accumulator and display shaders.
- `web/src/diagnostics.ts` — per-photosite temporal noise and standard error summaries.
- `web/src/raw.ts` — packet parser.
- `web/src/main.ts` — controls and diagnostics.
