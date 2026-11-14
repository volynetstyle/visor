import type { RegionStatistics } from './gpu';

export function summarizeRegion(region: RegionStatistics, frames: number) {
  const mean = [0, 0, 0, 0];
  const variance = [0, 0, 0, 0];
  const meanVariance = [0, 0, 0, 0];
  let pixels = 0;
  let variancePixels = 0;
  let observations = 0;
  for (let i = 0; i < region.counts.length; i++) {
    const n = region.counts[i];
    observations += n;
    if (n > 0) {
      pixels++;
      for (let c = 0; c < 4; c++) mean[c] += region.means[i * 4 + c];
    }
    if (n > 1) {
      variancePixels++;
      for (let c = 0; c < 4; c++) {
        const v = Math.max(0, region.m2[i * 4 + c]) / (n - 1);
        variance[c] += v;
        meanVariance[c] += v / n;
      }
    }
  }
  return {
    region: `${region.width}x${region.height} center Bayer quads`,
    channels: ['R', 'G1', 'G2', 'B'],
    meanDN: pixels ? mean.map(v => v / pixels) : null,
    temporalStdDN: variancePixels ? variance.map(v => Math.sqrt(v / variancePixels)) : null,
    // This is an estimate under independent, stationary frame noise, not a calibration guarantee.
    standardErrorDN: variancePixels ? meanVariance.map(v => Math.sqrt(v / variancePixels)) : null,
    rejectedQuadFraction: frames ? 1 - observations / (region.counts.length * frames) : 0,
    countMin: Math.min(...region.counts),
    countMax: Math.max(...region.counts),
  };
}
