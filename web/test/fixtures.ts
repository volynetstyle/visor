import { HEADER_BYTES, parseRawFrame } from '../src/raw.ts';

export function packet(samples: number[] = [62, 65, 60, 67], options: {
  width?: number; height?: number; cfa?: number; black?: number[]; white?: number;
  timestamp?: bigint; exposure?: bigint; iso?: number; flags?: number;
} = {}) {
  const width = options.width ?? 2;
  const height = options.height ?? 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + samples.length * 2);
  const d = new DataView(buffer);
  new Uint8Array(buffer, 0, 4).set([78, 82, 65, 87]);
  d.setUint16(4, 2, true);
  d.setUint16(6, HEADER_BYTES, true);
  [[8, 32], [12, width], [16, height], [20, width * 2], [24, 2], [28, width], [32, height], [44, 7],
    [64, options.iso ?? 800], [68, options.cfa ?? 0], [72, options.white ?? 1023], [76, options.flags ?? 31],
    [112, samples.length * 2], [116, 90], [120, 1600], [208, 21], [212, 3], [216, 2]]
    .forEach(([offset, value]) => d.setUint32(offset, value, true));
  d.setBigUint64(48, options.timestamp ?? 9_007_199_254_740_993n, true);
  d.setBigUint64(56, options.exposure ?? 250_000_000n, true);
  (options.black ?? [64, 64, 64, 64]).forEach((v, i) => d.setFloat32(80 + i * 4, v, true));
  d.setBigUint64(96, 500_000_000n, true);
  d.setBigUint64(104, 260_000_000n, true);
  for (let i = 0; i < 4; i++) {
    d.setFloat64(128 + 16 * i, 0.01 + i * 0.001, true);
    d.setFloat64(136 + 16 * i, 0.0002 + i * 0.0001, true);
  }
  d.setBigUint64(192, 270_000_000n, true);
  d.setBigUint64(200, 1_234_567n, true);
  samples.forEach((v, i) => d.setUint16(HEADER_BYTES + i * 2, v, true));
  return buffer;
}

export function frame(samples?: number[], options?: Parameters<typeof packet>[1]) {
  return parseRawFrame(packet(samples, options));
}
