export const HEADER_BYTES = 256;
export const MATCHED_RESULT = 1;
export const DYNAMIC_BLACK = 2;
export const DYNAMIC_WHITE = 4;
export const NOISE_PROFILE = 8;
export const MANUAL_SENSOR = 16;

export interface RawFrame {
  buffer: ArrayBuffer;
  payload: Uint8Array;
  format: number;
  width: number;
  height: number;
  rowStride: number;
  pixelStride: number;
  sensorWidth: number;
  sensorHeight: number;
  cropX: number;
  cropY: number;
  frameId: number;
  timestampNs: bigint;
  exposureNs: bigint;
  iso: number;
  cfa: number;
  whiteLevel: number;
  black: [number, number, number, number];
  payloadBytes: number;
  sensorOrientation: number;
  flags: number;
  requestedExposureNs: bigint;
  requestedIso: number;
  frameDurationNs: bigint;
  noiseProfile: [number, number][];
  captureIntervalNs: bigint;
  copyTimeNs: bigint;
  received: number;
  droppedBusy: number;
  droppedMetadata: number;
}

export function parseRawFrame(buffer: ArrayBuffer): RawFrame {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('Short NRAW packet');
  const u8 = new Uint8Array(buffer, 0, 4);
  if (String.fromCharCode(...u8) !== 'NRAW') throw new Error('Bad NRAW magic');
  const d = new DataView(buffer);
  const le = true;
  const version = d.getUint16(4, le);
  const headerBytes = d.getUint16(6, le);
  if (version !== 2 || headerBytes !== HEADER_BYTES) throw new Error(`Unsupported NRAW v${version}/${headerBytes}; install the matching APK`);
  const payloadBytes = d.getUint32(112, le);
  if (HEADER_BYTES + payloadBytes !== buffer.byteLength) throw new Error('Invalid NRAW payload length');
  const frame: RawFrame = {
    buffer,
    payload: new Uint8Array(buffer, HEADER_BYTES, payloadBytes),
    format: d.getUint32(8, le),
    width: d.getUint32(12, le),
    height: d.getUint32(16, le),
    rowStride: d.getUint32(20, le),
    pixelStride: d.getUint32(24, le),
    sensorWidth: d.getUint32(28, le),
    sensorHeight: d.getUint32(32, le),
    cropX: d.getUint32(36, le),
    cropY: d.getUint32(40, le),
    frameId: d.getUint32(44, le),
    timestampNs: d.getBigUint64(48, le),
    exposureNs: d.getBigUint64(56, le),
    iso: d.getUint32(64, le),
    cfa: d.getUint32(68, le),
    whiteLevel: d.getUint32(72, le),
    black: [d.getFloat32(80, le), d.getFloat32(84, le), d.getFloat32(88, le), d.getFloat32(92, le)],
    payloadBytes,
    sensorOrientation: d.getUint32(116, le),
    flags: d.getUint32(76, le),
    requestedExposureNs: d.getBigUint64(96, le),
    requestedIso: d.getUint32(120, le),
    frameDurationNs: d.getBigUint64(104, le),
    noiseProfile: Array.from({ length: 4 }, (_, i) => [d.getFloat64(128 + i * 16, le), d.getFloat64(136 + i * 16, le)]),
    captureIntervalNs: d.getBigUint64(192, le),
    copyTimeNs: d.getBigUint64(200, le),
    received: d.getUint32(208, le),
    droppedBusy: d.getUint32(212, le),
    droppedMetadata: d.getUint32(216, le),
  };
  if (frame.format !== 32 || frame.width < 2 || frame.height < 2 || ((frame.width | frame.height | frame.cropX | frame.cropY) & 1) !== 0) {
    throw new Error('Expected an even-aligned RAW_SENSOR Bayer crop');
  }
  if (frame.rowStride !== frame.width * 2 || frame.pixelStride !== 2 || payloadBytes !== frame.width * frame.height * 2) {
    throw new Error('Expected tightly packed RAW16');
  }
  if (frame.cropX + frame.width > frame.sensorWidth || frame.cropY + frame.height > frame.sensorHeight || frame.cfa > 3) {
    throw new Error('Invalid sensor crop or unsupported CFA');
  }
  if (frame.exposureNs === 0n || frame.iso === 0 || frame.whiteLevel > 65535 ||
      frame.black.some(b => !Number.isFinite(b) || b < 0 || b >= frame.whiteLevel)) {
    throw new Error('Invalid RAW exposure/ISO/black/white metadata');
  }
  if ((frame.flags & NOISE_PROFILE) && frame.noiseProfile.some(pair => pair.some(v => !Number.isFinite(v) || v < 0))) {
    throw new Error('Invalid sensor noise profile');
  }
  return frame;
}
