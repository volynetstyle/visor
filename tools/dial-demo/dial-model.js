import { signal, computed, get, set, batch } from "@visor/framework";

export function createDialModel({
  min,
  max,
  step = 1,
  initial = 0,
  unitsPerPixel = 0.25,
  format = (v) => `${v > 0 ? "+" : ""}${v}`,
}) {
  if (
    ![min, max, step, initial, unitsPerPixel].every(Number.isFinite) ||
    min >= max ||
    step <= 0 ||
    unitsPerPixel <= 0
  )
    throw new RangeError("Invalid dial configuration");
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const raw = signal(clamp(initial));
  const offset = signal(0);
  const value = computed(() =>
    clamp(Number((min + Math.round((get(raw) - min) / step) * step).toPrecision(12))),
  );
  const formatted = computed(() => format(get(value)));
  const trailWidth = computed(() => {
    const origin = clamp(0),
      v = get(value);
    const span = v >= origin ? max - origin : origin - min;
    return span ? (170 * Math.abs(v - origin)) / span : 0;
  });
  const trailX = computed(() => (get(value) < clamp(0) ? 170 - get(trailWidth) : 170));
  return {
    raw,
    offset,
    value,
    formatted,
    trailWidth,
    trailX,
    update(next) {
      if (!Number.isFinite(next)) return;
      const accepted = clamp(next),
        delta = accepted - get(raw);
      batch(() => {
        set(raw, accepted);
        set(offset, (((get(offset) - delta / unitsPerPixel) % 50) + 50) % 50);
      });
    },
  };
}
