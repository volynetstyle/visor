# Rotation-aware history: experimental implementation

The `Штатив · CFA` mode remains the controlled sensor experiment. `Вращение · RGB` adds a camera-aligned, reprojected history; it is not a persistent 3D world map. Exposure and ISO remain fixed for each series. ISP, adaptive acquisition and optical flow are separate future steps.

## Acquisition and geometry

Native capture uses a separate, bounded IMU timeline: game rotation vector (rotation vector as fallback) and calibrated gyroscope, sampled at a requested 100 Hz. Quaternion samples bracket the representative exposure midpoint; SLERP interpolates orientation. Gyroscope magnitude is integrated over exposure plus rolling-shutter readout to bound motion blur. Sensor timestamps and camera timestamps are compared only when Camera2 reports `SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME`. Android documents that `UNKNOWN` timestamps cannot be compared to arbitrary other timebases. [CaptureResult timestamp reference](https://developer.android.com/reference/android/hardware/camera2/CaptureResult#SENSOR_TIMESTAMP)

Pose samples need at least MEDIUM reported accuracy, at most 30 ms timestamp gaps, and full gyro coverage of the exposure interval. The IMU ring keeps at most six seconds / 1200 samples per stream. Missing or stale data never substitutes identity rotation for an unknown pose.

Calibrated intrinsics and camera-to-device orientation come from CaptureResult, with CameraCharacteristics as fallback. Intrinsics are accepted only for RAW dimensions matching the full pixel array or pre-correction active array. The crop offset, optical-black offset and half-resolution quad center are accounted for. Unknown binning/crop geometry is rejected rather than guessed. Undefined camera pose reference and missing distortion calibration also prevent reuse. OIS and electronic video stabilization are requested OFF. [Camera calibration conventions](https://developer.android.com/reference/android/hardware/camera2/CaptureResult#LENS_INTRINSIC_CALIBRATION)

With `D` = world-from-device and `C` = camera-from-device:

```
worldFromCamera = D transpose(C)
oldCameraFromCurrentCamera = transpose(oldWorldFromCamera) currentWorldFromCamera
```

Each current RGB quad center is unprojected through its K and inverse Brown-Conrady distortion, rotated into the old camera, then projected with the old lens model. With zero distortion this is inverse homography sampling. Non-convergent undistortion, negative ray depth, out-of-bounds coordinates and missing neighbors create fresh history. No display/screen rotation is mixed into the sensor geometry.

## Measurement and history state

Each motion-mode RAW observation is black-corrected into four signed CFA samples. A single-frame sensor pass converts these to half-resolution linear RGB (`R, (G1+G2)/2, B`). This is a superpixel reconstruction, not a full-resolution demosaic. Only the RGB history is spatially interpolated. Cumulative CFA means are never merged repeatedly into world history, which would count the same observations more than once.

The RGB history uses two GPU buffers, each with 48 bytes per output cell:

```
mean.xyz    linear RGB mean in black-corrected DN
mean.w      W = sum of weights
moment.xyz  weighted Welford M2
moment.w    Q = sum of squared weights
quality.x   confidence C
quality.y   decision: trusted / fresh / dubious / rejected
quality.z   patch normalized innovation
```

For direct, non-interpolated history, the frame variance estimate is `M2 / (W - Q/W)` and the mean variance estimate is `frameVariance * Q/W²`. Downweighting old history by beta scales W and M2 by beta and Q by beta² before a new unit-weight measurement is merged. Old W is capped at 128 for responsiveness and f32 precision.

Bilinear interpolation blends RGB means. It uses the minimum effective sample count `W²/Q`, maximum channel frame variance and minimum confidence of contributing neighbors. It does **not** add spatial contrast to temporal M2 or claim four independent new measurements. Interpolated evidence is capped at 32 and confidence reduced. This is a conservative engineering approximation: spatial correlations after repeated warps prevent treating it as an exact sufficient statistic or calibrated posterior.

At 1920×1440 RAW, the two RGB histories use about 63.3 MiB together, in addition to the RAW upload and sensor/display buffers. The later ISP calibration/gain/mask buffers add about 24 MiB, bringing the combined pipeline to roughly 117 MiB plus driver overhead. Actual mobile timings and thermal behavior still require measurement.

## History validity

The incoming variance uses the actual frame's optional noise profile converted from normalized RAW to DN², with independent green noise combined for RGB. A 3×3 patch tests coherent residual rather than discarding isolated low-photon samples. At least three neighbors must support the residual direction beyond half their individual expected standard deviation; an isolated large sample alone cannot invalidate the patch. The denominator includes incoming noise, conservative uncertainty of the old mean and a separate local-gradient registration-error term. Registration uncertainty never becomes temporal sensor variance.

- Innovation below 2: keep history and increase confidence.
- From 2 to 4: halve history weight and confidence.
- At least 4: discard old history immediately and initialize from the current measurement.
- Saturated current quads: do not retain an unverifiable old image at that location.

Thresholds are heuristic model-based gates, not guaranteed Gaussian significance tests. Vendor noise calibration can be inaccurate. Parallax, small moving objects, rolling-shutter deformation and inaccurate extrinsics can still defeat a rotation-only model.

Reuse also requires a noise profile, a capture gap no larger than two seconds, an inter-frame rotation below 0.35 radians, timing uncertainty below one output pixel and exposure gyro travel below 1.5 output pixels. Long-exposure blur is not corrected by a homography. On any failed prerequisite the app displays a fresh frame, records the reason, and clears the reusable pose reference as appropriate. New data continues to arrive.

## Device evidence and validation

The supplied `nightfield-1794685245408.json` and `nightfield-1794685358199.json` both report camera timestamp source `0` (`UNKNOWN`). They demonstrate RAW throughput, but cannot establish camera/IMU synchronization. Therefore the current implementation intentionally cannot enable IMU history reuse on that recorded configuration. Image-based alignment or measured synchronization is needed before enabling this mode there; clock offsets are not guessed from WebView delivery times.

`pixi run test` covers the binary extension, camera/device coordinate composition and invalid metadata. Browser WebGPU checks cover signed identity accumulation, confidence growth, instantaneous scene rejection, dubious weight reduction, inverse rotation, subpixel interpolation, disocclusion and clock/saturation failures. They validate the implementation against controlled synthetic signals. They do not validate a phone's calibration or prove a ghost-free handheld experience.

## Following stage

Keep RAW calibration, lens shading, sensor color matrices and display tone mapping after this history contract. A faster preview stream needs a separate acquisition design: adding YUV alongside a 400 ms manual RAW request does not create independent 30 fps sensor observations. Prefer measured supported stream combinations and interleaved short/long requests before promising two independent cadences. No learned or generative reconstruction is part of this implementation.
