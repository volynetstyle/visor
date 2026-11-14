import { RawAccumulator } from '../src/gpu.ts';
import { frame } from './fixtures.ts';

/** Run in a WebGPU-capable browser through Vite: import('/test/gpu.test.ts').then(m => m.runGpuTests()). */
export async function runGpuTests() {
  const canvas = document.createElement('canvas');
  canvas.style.width = canvas.style.height = '32px';
  document.body.append(canvas);
  const gpu = await RawAccumulator.create(canvas);
  let timestamp = 1n;
  const results: string[] = [];
  const near = (actual: ArrayLike<number>, expected: number[], epsilon = 1e-5) => {
    if (actual.length !== expected.length || expected.some((v, i) => Math.abs(actual[i] - v) > epsilon || !Number.isFinite(actual[i]))) {
      throw new Error(`GPU result ${Array.from(actual)} != ${expected}`);
    }
  };
  const add = (samples: number[], options: Parameters<typeof frame>[1] = {}) => gpu.add(frame(samples, { ...options, timestamp: timestamp++ }));
  try {
    const arrangements = [[1, 4, 9, 16], [4, 1, 16, 9], [9, 1, 16, 4], [16, 4, 9, 1]];
    for (let cfa = 0; cfa < 4; cfa++) {
      await gpu.reset();
      await add([11, 24, 39, 56], { cfa, black: [10, 20, 30, 40] });
      const r = await gpu.readRegion();
      near(r.means, arrangements[cfa]);
      near(r.counts, [1]);
    }
    results.push('all four CFA layouts and independent green channels');
    await gpu.reset();
    await add([62, 65, 60, 67]);
    near((await gpu.readRegion()).means, [-2, 1, -4, 3]);
    await add([66, 63, 68, 61]);
    let r = await gpu.readRegion();
    near(r.means, [0, 0, 0, 0]);
    near(r.m2, [8, 2, 32, 18]);
    near(r.counts, [2]);
    results.push('signed dark mean has no rectification bias; Welford M2 matches two-pass variance');
    await add([64, 1023, 64, 64]);
    r = await gpu.readRegion();
    near(r.counts, [2]);
    near(r.m2, [8, 2, 32, 18]);
    results.push('one saturated channel rejects the complete quad without changing statistics');
    await gpu.reset();
    r = await gpu.readRegion();
    near(r.counts, [0]);
    near(r.means, [0, 0, 0, 0]);
    near(r.m2, [0, 0, 0, 0]);
    await add([66, 66, 66, 66]);
    await add([72, 72, 72, 72], { black: [70, 70, 70, 70], white: 500 });
    near((await gpu.readRegion()).means, [2, 2, 2, 2]);
    results.push('reset clears all statistics; dynamic black/white do not change DN units');
    await gpu.reset();
    for (let i = 0; i < 64; i++) {
      const sign = i % 2 ? 1 : -1;
      await add([64 + sign * 2, 64 + sign, 64 + sign * 4, 64 + sign * 3]);
    }
    r = await gpu.readRegion();
    near(r.means, [0, 0, 0, 0]);
    near(r.m2, [256, 64, 1024, 576], 0.002);
    results.push('64-frame f32 dark stack remains unbiased with stable temporal variance');
    await gpu.reset();
    await add(Array(18 * 6).fill(65), { width: 18, height: 6 });
    r = await gpu.readRegion(0, 0, 9, 3);
    near(r.counts, Array(27).fill(1));
    near(r.means, Array(108).fill(1));
    results.push('non-workgroup-aligned image boundaries and readback row strides');
    return { passed: results, failures: 0 };
  } finally { canvas.remove(); }
}
