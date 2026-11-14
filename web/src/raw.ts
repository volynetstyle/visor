export const HEADER_BYTES = 128;

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
}

export function parseRawFrame(buffer: ArrayBuffer): RawFrame {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('Short NRAW packet');
  const u8 = new Uint8Array(buffer, 0, 4);
  if (String.fromCharCode(...u8) !== 'NRAW') throw new Error('Bad NRAW magic');
  const d = new DataView(buffer);
  const le = true;
  const version = d.getUint16(4, le);
  const headerBytes = d.getUint16(6, le);
  if (version !== 1 || headerBytes !== HEADER_BYTES) throw new Error(`Unsupported NRAW v${version}/${headerBytes}`);
  const payloadBytes = d.getUint32(112, le);
  if (HEADER_BYTES + payloadBytes > buffer.byteLength) throw new Error('Truncated NRAW payload');
  return {
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
  };
}
