# NightField: RAW Bayesian/weighted temporal accumulator, v0.1 research spec

**Status:** mathematical design and verification checklist, not benchmark measurements. Target: static RAW Bayer on Android Camera2, TS/WebGPU processing, later reprojection. Numeric noise values below are *illustrative*, not Redmi measurements.

**Initial static implementation (2026-11-14):** the core preserves signed black-corrected DN, matches actual capture results by timestamp, keeps independent R/G1/G2/B mean/M2/count statistics, rejects saturated quads, reserves bridge capacity before RAW copying, and ACKs after GPU queue completion. The default requested exposure is 250 ms at ISO 800 with a 32-second window. Later motion and ISP/calibration additions are documented below; calibrated inverse-variance weighting, full demosaicing and general motion/sky reconstruction remain future work. See [README.md](README.md) for device experiments and regression checks.

**Experimental rotation update:** rotation-only RGB history and validity gating are now implemented separately from this static CFA estimator. Assumptions, approximate evidence semantics, regression checks and device limitations are documented in [MOTION_MODEL.md](MOTION_MODEL.md). General motion, sky alignment and persistent world reconstruction remain future work.

## 1. Measurement model

**ISP/calibration update:** [ISP_CALIBRATION.md](ISP_CALIBRATION.md) documents implemented residual dark/FPN correction, defect masking, per-photosite lens shading, reported camera color and display processing. The historical static model below remains the reference for acquisition noise; calibration drift and uncertainty are separate from temporal M2.

For CFA photosite `p`, captured frame `k`:

`Y[p,k] = B[p,k] + g[p,k] ( Poisson((lambda[p] + d[p]) * t[k]) + epsilon[p,k] ) + e_ADC[p,k]`

- `Y`: integer RAW DN; `B`: black level, DN; `g`: DN/electron conversion including effective gain; `lambda`: incident photoelectron rate, e-/s; `d`: dark current, e-/s; `t`: **actual** exposure in seconds; `epsilon`: zero-mean read noise (electrons), variance `sigma_r^2`.
- Pixel-dependent shading, fixed pattern, hot pixels, exposure nonlinearity, color cross-talk and temperature changes are additional model errors to measure or calibrate.
- For fixed ISO, exposure and sensor state, directly estimate the *mean black-corrected RAW signal*: `mu = mean_k(Y-B)`; this does not require conversion to electrons. Compare it with a single-frame raw and a long-exposure reference at identical display gain.
- To normalize differing exposures/gains, estimate `z[p,k]=(Y-B)/(g*t)` (electrons/s), with `Var(z) ≈ (lambda+d)/t + sigma_r^2/t^2` and add quantization variance if relevant.

## 2. Optimal stacking and predictive SNR

For equal frame exposure `t`, `N` accepted independent frames, source rate `lambda`, additive sky/dark background `b`, read-noise standard deviation `sigma_r`:

`SNR = lambda * N*t / sqrt((lambda+b)*N*t + N*sigma_r^2)`.

When continuous with `T=N*t`:

`SNR(T,t) = lambda*T / sqrt((lambda+b)*T + (T/t)*sigma_r^2)`.

When there are dropped frames or idle sensor intervals, use *only accepted exposures*, `N*t`, not elapsed wall time. For arbitrary exposures and variable noise, inverse-variance weighting of the per-frame rate estimates `z` gives `w ~ 1/Var(z)`, estimating rate as `M=sum(w*z)/sum(w)`.

**Illustrative 32-second scenario:** lambda=2 e-/s; b=0.6 e-/s; sigma_r=2 e-/read; independent errors, 100% capture duty, no motion or saturation.

| Exposure per frame | Frames | Result SNR |
| ---: | ---: | ---: |
| 1/30 s | 960 | 1.02 |
| 100 ms | 320 | 1.73 |
| 250 ms | 128 | 2.62 |
| 500 ms | 64 | 3.47 |
| 1 s | 32 | 4.40 |
| 2 s | 16 | 5.28 |
| One continuous 32 s capture | 1 | 6.85 |

The chosen lambda and read noise are a thought experiment, **not** device-specific. Longer frames may be limited by camera capture frequency, sky rotation, foreground motion, hot pixels, saturation, and UI latency. The frame rate for rendering can be 30–60 fps independently of RAW acquisition rate.

## 3. Most important correctness defects in initial `web/src/gpu.ts`

### A. Never clip to zero before averaging

Initial shader does `clamp((raw-black)/(white-black),0,1)` before accumulation. For zero-signal normal noise `X ~ N(0,sigma^2)`, `E[max(0,X)] = sigma/sqrt(2*pi) ≈ 0.399 sigma`: the floor creates a permanent *positive bias*, not averaging noise. Preserve signed f32 values in the statistic; clamp only at display. Detect and explicitly reject saturation; don't conflate clip detection with numeric cleanup.

### B. Sensor metadata is per captured frame

Initial `RawCamera.kt` sends **requested** exposure and ISO and static black/white data. `CaptureResult` can report actual `SENSOR_EXPOSURE_TIME`, `SENSOR_SENSITIVITY`, `SENSOR_TIMESTAMP`, `SENSOR_NOISE_PROFILE`, `SENSOR_DYNAMIC_BLACK_LEVEL`, and `SENSOR_DYNAMIC_WHITE_LEVEL` where supported. Pair capture results with `Image.timestamp`/`SENSOR_TIMESTAMP` before normalization. A requested exposure may be shortened; noise profile depends on ISO and CFA.

### C. Keep four CFA samples, including G1/G2

Initial shader merges each 2x2 Bayer quad to `vec3(R, (G1+G2)/2, B)` *before* stacking. Convenient for MVP display but loses spatial information, especially for point sources. Improve by maintaining `vec4(R,G1,G2,B)` in a persistent GPU buffer per quad. Demosaic or combine greens **after** temporal accumulation. If RGB is displayed at half sensor resolution, no full-res storage for final image is needed.

### D. Lock exposure and gain for the first controlled test

The initial `refExposureIso/(exposureNs*iso)` scale assumes effective sensor gain is proportional to nominal ISO, which may be false in dual-conversion-gain/digital-gain regimes. Start with locked ISO, exposure, focus and WB; use actual CaptureResult for later HDR/gain-aware combining.

### E. Drop before copying RAW, not after

Initial native path executes `copyCrop(image, info)` on every ImageReader callback, even if the WebMessage bridge will discard its packet because an earlier frame is in flight. Backpressure needs to act before the 5.3 MiB allocation/copy, or the native side burns CPU and garbage collector capacity during overload.

## 4. Stable GPU statistic

**Static, constant ISO/exposure MVP:** one invocation per Bayer 2x2 cell; packed input is 2 uint32 reads (one top Bayer row pair and one bottom row pair). Four signed corrected samples are `z = vec4<f32>(R,G1,G2,B)`. Every quad has:

- `mean: vec4<f32>` (16 B)
- `M2: vec4<f32>` (16 B), optional variance diagnostic
- `weight: f32` (4 B), one scalar when all four samples have identical validity and exposure

Weighted Welford update:

```
Wnew  = W + w
Delta = z - mean
Mean2 = mean + (w / Wnew) * Delta
M2new = M2 + w * Delta * (z - Mean2)
```

When `W=0`, set mean=z, M2=0, W=w. `M2 / W` describes observed temporal variance (with weighted-statistic corrections as needed), not automatically the uncertainty of the mean. For independent equal-variance samples, `Var(mean) ~ sigma_frame^2/N`. For inverse-variance weights, `Var(mean)=1/sum(w)` in the assumed model.

- Keep accumulation in **f32**. f16 is usable later for display but not for persistent fine increments.
- Store signed RAW signal normalized to a *fixed unit*, never normalize by a changing first-frame reference unless it is explicitly frozen and validated.
- For per-channel saturation masks, either reject an entire quad (MVP) or promote `weight` to `vec4<f32>` so individual CFA channels may be skipped independently.
- Do not sigma-clip based solely on pixel residual in extremely dark scenes; small photon counts are non-Gaussian and zero-photon samples are legitimate. Calibrate read/shot statistics and detect spatially coherent motion separately.
- A single compute dispatch updates disjoint quads, no atomics or cross-workgroup communication. `@workgroup_size(8,8)` is a sensible baseline; benchmark 8x8, 16x8, 16x16 after device testing.

## 5. Memory and bandwidth for 1920x1440 RAW crop

- 1920x1440 sensor samples = 2,764,800.
- Packed RAW16 upload = **5.27 MiB/frame**.
- Bayer quads (output 960x720) = 691,200.
- Existing RGB-mean RGBA32F = **10.55 MiB persistent**.
- Proposed CFA mean vec4 + scalar weight = **13.18 MiB persistent**.
- Proposed CFA mean vec4 + M2 vec4 + scalar weight = **23.73 MiB persistent**.
- If every CFA component needs its own weight (mean, M2, weight each vec4): **31.64 MiB persistent**.
- With mean+weight: approximate GPU state read/write plus RAW read ~**33.18 MB/frame**, **0.33 GB/s** at 10 RAW fps, **1.0 GB/s** at 30 fps.
- With mean+M2+weight: ~**55.30 MB/frame**, **0.55 GB/s** at 10 RAW fps, **1.66 GB/s** at 30 fps.

Numbers are lower-bound arithmetic traffic estimates, not measured GPU bandwidth, and exclude display/demosaic, cache effects, WebView/Java allocations and driver copies. GPU compute should be manageable on modern phone GPUs at a modest RAW frame rate; sensor HAL, bridge copies and thermal behavior may dominate.

A **center crop** only reduces data transferred *after* camera sensor readout in the current native implementation; it does not guarantee a reduced physical RAW capture size or higher camera capture fps.

## 6. Time-varying world and night sky

A fixed tripod does not make the night sky fixed. Earth rotation is approximately 15 arcseconds/s against distant stars, scaled by declination and local image projection. For an illustrative *actual 70-degree horizontal FOV across 1920 sampled pixels*, star drift at the equatorial maximum is about 0.114 pixels/s, or **3.66 pixels in 32 seconds**. This is only an illustration; the actual crop FOV and lens projection must be measured.

First benchmark on a stationary *ground* object. Then add two spatially different histories: fixed ground coordinate accumulator and celestial-coordinate star accumulator. Motion of clouds, tree leaves, headlights, and sensor vibration should be excluded from static merging or modeled separately.

## 7. Benchmarks and calibration gates

1. **Capability dump:** RAW sizes, min frame duration, output stall duration, requested versus actual exposure/ISO, noise profile, dynamic black/white, Bayer arrangement, timestamp intervals.
2. **Dark frames:** cover the lens (where feasible), fixed exposure/ISO, capture 50+ RAW frames, estimate dark mean, temporal read variance, hot-pixel fraction. Compare with `SENSOR_NOISE_PROFILE` and dynamic black. Do not clip negative residuals.
3. **Flat fields:** evenly illuminated stationary matte target. Verify means scale linearly with exposure. Use frame *differences* to estimate random noise without confounding fixed pixel-pattern response; fit photon-transfer curve if the signal range allows.
4. **Static scene test:** 1, 5, 15, 32, 60 s; exposure sequence 50,100,250,500,1000 ms (if available). Record actual accepted frames, `sum(exposureNs)`, and timestamp gaps.
5. **Quality metric:** temporal standard deviation of stable patches and high-frequency detail against a separate long-exposure reference; do not count spatial texture as temporal noise. Plot predicted SNR versus measured SNR.
6. **Performance:** CPU crop/copy time, bridge time, payload MB/s, WebGPU submit time vs `onSubmittedWorkDone()` completion, actual queue depth, temperature, delivered RAW fps. ACK on JavaScript submit alone does not guarantee GPU completion; enforce finite in-flight GPU work.
7. **Motion gate:** test tiny hand perturbations; without registration they must fail gracefully or pause accumulation. Next iteration uses homography/IMU, and raw CFA needs channel-aware warp or post-demosaic RGB before interpolation.

## 8. Prioritized implementation plan

**P0:** remove negative clipping; pair CaptureResult metadata; log timestamps and fps; move native drop before byte copy; freeze manual exposure/ISO.

**P1:** maintain 4-channel Bayer mean on GPU and demosaic only for display; capture dark/flat calibration; compare temporal noise against theory.

**P2:** per-CFA M2 or noise-profile-based uncertainty; saturation/hot-pixel masks; time-adaptive reset on scene change; separate sky/ground region.

**P3:** rotation-aware reprojection, then depth/flow for translation, without changing the measurement/noise model.

## References (official, checked Nov 2026)

- Android `CaptureResult` sensor noise profile and timestamps: https://developer.android.com/reference/android/hardware/camera2/CaptureResult
- Android `CameraCharacteristics` black level/white level/binned CFA: https://developer.android.com/reference/android/hardware/camera2/CameraCharacteristics
- Android `CameraMetadata` RAW capability: https://developer.android.com/reference/android/hardware/camera2/CameraMetadata
- Google Night Sight low-light acquisition/alignment research: https://research.google/pubs/handheld-mobile-photography-in-very-low-light/
- WebGPU storage resource behavior: https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu
