import { NOISE_PROFILE, type MotionMetadata, type RawFrame } from "./raw.ts";

export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function multiply(a: number[], b: number[]) {
  return Array.from({ length: 9 }, (_, i) => {
    const r = Math.floor(i / 3),
      c = i % 3;
    return a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  });
}
export function transpose(a: number[]) {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}
export function quaternion(q: number[]) {
  const norm = Math.hypot(...q);
  if (q.length !== 4 || !q.every(Number.isFinite) || norm < 0.5 || norm > 1.5)
    throw new Error("Invalid orientation quaternion");
  const [x, y, z, w] = q.map((v) => v / norm);
  return [
    1 - 2 * y * y - 2 * z * z,
    2 * x * y - 2 * z * w,
    2 * x * z + 2 * y * w,
    2 * x * y + 2 * z * w,
    1 - 2 * x * x - 2 * z * z,
    2 * y * z - 2 * x * w,
    2 * x * z - 2 * y * w,
    2 * y * z + 2 * x * w,
    1 - 2 * x * x - 2 * y * y,
  ];
}
export interface MotionReference {
  worldFromCamera: number[];
  metadata: MotionMetadata;
  timestampNs: bigint;
}
export interface MotionPlan {
  reuse: boolean;
  reason: string;
  rotation: number[]; // Current camera ray -> previous camera ray, row-major.
  current: MotionMetadata | null;
  previous: MotionMetadata | null;
  reference: MotionReference | null;
  registrationErrorPx: number;
  blurPx: number;
}
export function planMotion(
  previous: MotionReference | null,
  frame: RawFrame,
): MotionPlan {
  const m = frame.motion;
  const plan: MotionPlan = {
    reuse: false,
    reason: "NRAW v3 motion metadata unavailable",
    rotation: IDENTITY,
    current: m,
    previous: previous?.metadata ?? null,
    reference: null,
    registrationErrorPx: 0.35,
    blurPx: 0,
  };
  if (!m) return plan;
  const fail = (reason: string) => ({ ...plan, reason });
  if (!(m.flags & 1))
    return fail(
      "Camera timestamp source UNKNOWN; IMU clocks cannot be matched",
    );
  if ((m.flags & 18) !== 18 || m.accuracy < 2 || m.accuracy > 3 || m.gapNs > 30_000_000n)
    return fail("Missing, unreliable or unbracketed IMU samples");
  if (!(m.flags & 4))
    return fail("No calibrated intrinsics for this RAW array layout");
  if (!(m.flags & 8)) return fail("No calibrated camera-to-IMU orientation");
  if (!(m.flags & 32)) return fail("Lens distortion calibration unavailable");
  if (
    !m.intrinsics.every(Number.isFinite) ||
    m.intrinsics[0] <= 0 ||
    m.intrinsics[1] <= 0 ||
    !m.distortion.every(Number.isFinite)
  )
    return fail("Invalid lens calibration");
  if (
    !(frame.flags & NOISE_PROFILE) ||
    !frame.noiseProfile.every((p) =>
      p.every((v) => Number.isFinite(v) && v >= 0),
    )
  )
    return fail(
      "Noise profile unavailable; photometric history reuse disabled",
    );
  if (
    m.timestampNs < frame.timestampNs ||
    m.timestampNs > frame.timestampNs + frame.exposureNs + m.rollingSkewNs
  )
    return fail("Pose outside exposure interval");
  if (!Number.isFinite(m.exposureTravelRad) || m.exposureTravelRad < 0)
    return fail("Invalid exposure motion");
  plan.blurPx =
    m.exposureTravelRad * Math.max(m.intrinsics[0], m.intrinsics[1]);
  if (plan.blurPx > 1.5)
    return fail(
      "Exposure motion exceeds 1.5 output pixels; show current frame only",
    );
  let worldFromCamera: number[];
  try {
    worldFromCamera = multiply(
      quaternion(m.worldFromDevice),
      transpose(quaternion(m.cameraFromDevice)),
    );
  } catch {
    return fail("Invalid camera or IMU quaternion");
  }
  plan.reference = {
    worldFromCamera,
    metadata: m,
    timestampNs: frame.timestampNs,
  };
  if (!previous) return { ...plan, reason: "New RGB history" };
  if (
    frame.timestampNs <= previous.timestampNs ||
    frame.timestampNs - previous.timestampNs > 2_000_000_000n
  )
    return { ...plan, reason: "Capture gap; history restarted" };
  plan.rotation = multiply(
    transpose(previous.worldFromCamera),
    worldFromCamera,
  );
  const angle = Math.acos(
    Math.max(
      -1,
      Math.min(
        1,
        (plan.rotation[0] + plan.rotation[4] + plan.rotation[8] - 1) / 2,
      ),
    ),
  );
  if (angle > 0.35)
    return { ...plan, reason: "Large rotation; history restarted" };
  const seconds = Number(frame.exposureNs + m.rollingSkewNs) / 1e9;
  plan.registrationErrorPx +=
    (((Number(m.gapNs) / 1e9) * m.exposureTravelRad) /
      Math.max(seconds, 1e-6)) *
    Math.max(m.intrinsics[0], m.intrinsics[1]);
  if (plan.registrationErrorPx > 1)
    return {
      ...plan,
      reason: "Pose timing uncertainty exceeds one output pixel",
    };
  return {
    ...plan,
    reuse: true,
    reason: "Rotation + noise-aware validity gate",
  };
}
