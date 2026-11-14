import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRawFrame } from '../src/raw.ts';
import { StaticSeries } from '../src/series.ts';
import { summarizeRegion } from '../src/diagnostics.ts';
import { frame, packet } from './fixtures.ts';

test('NRAW v2 keeps actual metadata separate from requested settings and preserves 64-bit timestamps', () => {
  const f = frame();
  assert.equal(f.timestampNs, 9_007_199_254_740_993n);
  assert.equal(f.exposureNs, 250_000_000n);
  assert.equal(f.requestedExposureNs, 500_000_000n);
  assert.equal(f.iso, 800);
  assert.equal(f.requestedIso, 1600);
  assert.equal(f.frameDurationNs, 260_000_000n);
  assert.equal(f.noiseProfile[3][1], 0.0005);
  assert.equal(f.copyTimeNs, 1_234_567n);
  assert.deepEqual([f.received, f.droppedBusy, f.droppedMetadata], [21, 3, 2]);
  assert.deepEqual([...new Uint16Array(f.payload.buffer, f.payload.byteOffset)], [62, 65, 60, 67]);
});

test('rejects malformed, mismatched, non-Bayer and misaligned packets before GPU access', () => {
  for (const change of [
    (d: DataView) => d.setUint16(4, 1, true),
    (d: DataView) => d.setUint32(112, 1000, true),
    (d: DataView) => d.setUint32(20, 6, true),
    (d: DataView) => d.setUint32(36, 1, true),
    (d: DataView) => d.setUint32(68, 4, true),
    (d: DataView) => d.setFloat32(80, NaN, true),
    (d: DataView) => d.setFloat32(80, 1023, true),
    (d: DataView) => d.setFloat64(128, -1, true),
  ]) {
    const b = packet();
    change(new DataView(b));
    assert.throws(() => parseRawFrame(b));
  }
  assert.throws(() => parseRawFrame(packet().slice(0, 100)), /Short/);
});

test('static series counts accepted exposure, timestamp gaps and fps without assuming a continuous sensor', () => {
  const s = new StaticSeries();
  s.accept(frame(undefined, { timestamp: 0n }));
  s.accept(frame(undefined, { timestamp: 500_000_000n }));
  s.accept(frame(undefined, { timestamp: 1_000_000_000n }));
  assert.equal(s.frames, 3);
  assert.equal(s.exposureNs, 750_000_000n);
  assert.equal(s.elapsedSeconds, 1);
  assert.equal(s.fps, 2);
});

test('static series rejects gain/exposure changes and stale/missing metadata without mutating the statistic', () => {
  const s = new StaticSeries();
  s.accept(frame(undefined, { timestamp: 1n }));
  for (const options of [
    { timestamp: 2n, iso: 1600 }, { timestamp: 2n, exposure: 100_000_000n },
    { timestamp: 1n }, { timestamp: 2n, flags: 1 }, { timestamp: 2n, cfa: 1 },
  ]) assert.throws(() => s.accept(frame(undefined, options)));
  assert.equal(s.frames, 1);
  s.accept(frame(undefined, { timestamp: 2n, black: [65, 66, 67, 68], white: 1000 }));
  assert.equal(s.frames, 2);
});

test('ROI variance measures per-photosite temporal noise, never variation of scene texture', () => {
  const summary = summarizeRegion({ width: 2, height: 1,
    means: new Float32Array([-2, 5, 10, 20, 200, 500, 800, 900]),
    m2: new Float32Array(8), counts: new Float32Array([4, 4]),
  }, 4);
  assert.deepEqual(summary.temporalStdDN, [0, 0, 0, 0]);
  assert.equal(summary.rejectedQuadFraction, 0);
  assert.equal(summary.meanDN?.[0], 99);
  const noisy = summarizeRegion({ width: 1, height: 1,
    means: new Float32Array(4), m2: new Float32Array([20, 20, 20, 20]), counts: new Float32Array([4]),
  }, 5);
  assert.equal(noisy.temporalStdDN?.[0], Math.sqrt(20 / 3));
  assert.equal(noisy.standardErrorDN?.[0], Math.sqrt(5 / 3));
  assert.ok(Math.abs(noisy.rejectedQuadFraction - 0.2) < 1e-12);
});
