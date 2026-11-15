# RAW ISP and dark calibration

## Verified device facts

The supplied `nightfield-1794687928271.json` reports `maxAnalogSensitivity=1600`, total ISO range 100–16000, RAW 4080×3072, GBRG CFA, black 64 and white 1023. It includes per-frame color-correction gains/transform and neutral point, but lens shading statistics are OFF. A game rotation vector is listed and a separate gyro is absent. Camera timestamps remain UNKNOWN. These are device metadata, not proof that ISO above 1600 is entirely digital, that the vendor noise profile is calibrated, or that camera/IMU clocks agree.

## Processing order

```
RAW16 -> signed black subtraction -> matching dark mean subtraction
      -> lens shading gain per CFA photosite
      -> temporal CFA estimator / experimental RGB history
      -> frozen reported white-balance gains -> reported sensor-to-linear-sRGB matrix
      -> display exposure and optional global luminance compression -> sRGB transfer
```

The old fixed WB multipliers are removed. The color transform is taken from the first frame's `COLOR_CORRECTION_GAINS` and `COLOR_CORRECTION_TRANSFORM`, which Camera2 defines as Bayer-domain white balance followed by a sensor-to-linear-sRGB matrix. Neutral point is also recorded; native code uses its reciprocal ratios as a WB fallback when reported gains are missing. Invalid/missing gains or a singular color matrix leave the view explicitly labeled uncalibrated sensor RGB. [Camera2 color processing contract](https://developer.android.com/reference/android/hardware/camera2/CaptureResult#COLOR_CORRECTION_MODE)

The HAL's runtime matrix is used instead of guessing how to interpolate the two reference-illuminant DNG profiles. Static calibration/color/forward matrices remain available in the camera dump. Reported FAST/HIGH_QUALITY matrices are only approximately the complete vendor ISP; color-chart validation and robust low-light AWB remain necessary. This is still half-resolution RGB superpixels, not full demosaic or multi-frame super-resolution.

Native capture requests the lens shading map and a supported shading processing mode. The returned map represents the remaining correction needed for RAW, even when the HAL already applies part of the shading correction. The code bilinearly samples its R/Geven/Godd/B channels at the actual photosite coordinates across the full active array, accounting for the center crop and known RAW-array origin. Unknown RAW geometry or an invalid map disables shading with an explicit status. [Camera2 shading-map contract](https://developer.android.com/reference/android/hardware/camera2/CaptureResult#STATISTICS_LENS_SHADING_CORRECTION_MAP)

Shading is applied before accumulation, so M2 naturally scales by gain squared. Motion gating propagates the shading gains through the input noise model; the few-observation prior remains an approximation. WB and the display matrix are frozen per series to avoid introducing color pumping into the live view. Color/tone controls change only display; shading and dark correction change the estimator's DN units and are identified in reports.

The linear display mode applies the sRGB transfer and clips only at output. The highlight-compression display mode applies `log(1+4Y)/log(5)` to luminance and preserves channel ratios before gamut clipping. It is a global display curve, not local Retinex, learned enhancement or a claim of daylight color accuracy. The noise view propagates channel variances through WB and the squared color matrix under an independent-channel approximation.

## ISO comparison

Settings show the camera's own analog ISO limit. Presets request 400 ms and ISO 800, 1600 or 3200, clamped to advertised limits. They preserve display gain. Capture the same stationary scene and save a separate report for each setting; compare actual metadata, clipping, temporal noise and retained detail. A higher nominal ISO is not assumed to add photons or improve SNR. The display-gain range extends to 128× so lower sensor gains can be compared with stronger software exposure.

## Dark/FPN profile

1. Set the intended ISO and exposure, fully cover the lens, then check **Объектив полностью закрыт**.
2. Press **Снять 64 dark-кадра**. This forces static CFA capture and bypasses previous dark/shading corrections. The ordinary 32-second timer is not used.
3. After 64 processed frames, all crop means, M2 and counts are read from GPU. The profile stores signed mean, sample variance and per-photosite classification in IndexedDB.
4. Open the lens and start a normal series. A matching profile is loaded before the first measurement enters the estimator.

Profiles match camera ID, sensor/crop dimensions and offsets, CFA/orientation, **actual** exposure/ISO, white level and black-level source. A changed static black pattern also changes the key. Requested ISO alone is never used to match a profile. Profiles are local to the WebView origin/app data; development localhost and bundled app origins have separate stores. Clearing app data removes them. **Удалить этот профиль** removes the loaded profile; the change applies to the next series.

Every stable photosite's measured residual dark mean is subtracted, including negative offsets. Robust per-channel sampled medians describe the normal dark baseline and variance. Large stable positive outliers are classified hot; excess temporal variance, missing measurements and invalid values are classified unstable. Stable deviations from the channel median are labeled biased. At least 50 frames, adequate valid coverage, a dark-enough median and fewer than 5% hot/unstable sites are required. These are conservative engineering thresholds, not a calibrated defect specification or an automatic guarantee that the lens was covered.

Because the current CFA accumulator has one count per 2×2 quad, any hot/unstable channel masks the entire quad. Its statistical weight stays zero. Display-only neighbor interpolation fills such holes; it does not invent accepted observations or reduce reported variance. Per-channel evidence is a future refinement.

The profile mean has finite calibration uncertainty, approximately `darkVariance / calibrationCount`, and temperature/readout drift can change its validity. That uncertainty is **not included** in the live `std(mean)` diagnostic. Exposure or ISO changes require separate profiles. This implements residual dark/FPN correction and defect masking; PRNU, flat-field calibration, sensor-temperature modeling and learned denoising are not implemented.

## Wire format and reports

NRAW v4 has a 768-byte header, the packed RAW16 crop, then an optional interleaved float32 shading grid. Earlier v2/v3 packets remain readable. The ISP block contains WB, matrix, neutral point, active-array geometry, analog ISO limit and timing diagnostics. Maps are validated before GPU upload.

Reports use `nightfield-static-v2`, `nightfield-rotation-v2` or `nightfield-dark-v1`. They include ISP status, the last shading map, a profile summary, display settings and bounded frame metadata. Full dark maps stay in IndexedDB. Typed shading views into the RAW packet are never retained in frame-history metadata. Metadata has a 2-million-character budget and `metadataTruncated` identifies truncation.

Each frame records image callback elapsed time, capture-result callback elapsed time, and the latest callback-time rotation-vector quaternion/timestamp/accuracy. These are diagnostic observations, not exposure-aligned pose on UNKNOWN-clock devices. Delivery latency is mixed with camera/IMU offset in callback comparisons: collecting these values does not justify silently estimating a calibrated affine clock mapping. IMU history reuse remains guarded.

## Checks

Node tests validate wire bounds, matrix/gain conventions, actual-setting profile keys and dark classification. Browser WebGPU tests validate all CFA layouts, full-array crop coordinates, signed correction, M2 scaling, zero evidence for masked data, uncooked calibration export, persistent typed-array storage and actual fragment output colors. The UI test exercises all 64 calibration frames, automatic save, profile application in the next series, ISO presets, reporting and deletion. Real device shading behavior, dark stability and color accuracy still need a new physical capture.
