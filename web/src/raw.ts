export const HEADER_BYTES = 256;
export const MATCHED_RESULT = 1;
export const DYNAMIC_BLACK = 2;
export const DYNAMIC_WHITE = 4;
export const NOISE_PROFILE = 8;
export const MANUAL_SENSOR = 16;

export interface IspMetadata {
  flags: number; wb: number[]; matrix: number[]; neutral: number[];
  mapWidth: number; mapHeight: number; shading: Float32Array; active: number[];
  maxAnalogIso: number; imageCallbackNs: bigint; resultCallbackNs: bigint;
  rotationTimestampNs: bigint; rotationQuaternion: number[]; rotationAccuracy: number;
}

export interface MotionMetadata {
  flags: number;
  accuracy: number;
  timestampNs: bigint;
  gapNs: bigint;
  rollingSkewNs: bigint;
  worldFromDevice: number[]; // Quaternion x,y,z,w.
  cameraFromDevice: number[];
  intrinsics: number[]; // fx,fy,cx,cy,skew in half-resolution quad-center coordinates.
  distortion: number[];
  exposureTravelRad: number;
}

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
  motion: MotionMetadata | null;
  isp: IspMetadata | null;
}

export function parseRawFrame(buffer: ArrayBuffer): RawFrame {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('Short NRAW packet');
  const u8 = new Uint8Array(buffer, 0, 4);
  if (String.fromCharCode(...u8) !== 'NRAW') throw new Error('Bad NRAW magic');
  const d = new DataView(buffer);
  const le = true;
  const version = d.getUint16(4, le);
  const headerBytes = d.getUint16(6, le);
  if (!((version === 2 && headerBytes === 256) || (version === 3 && headerBytes === 512) || (version === 4 && headerBytes === 768))) throw new Error(`Unsupported NRAW v${version}/${headerBytes}; install the matching APK`);
  const payloadBytes = d.getUint32(112, le);
  const mapBytes=version===4 && buffer.byteLength>=768 ? d.getUint32(440,le) : 0;
  if (mapBytes>65536 || mapBytes%16!==0 || headerBytes + payloadBytes + mapBytes !== buffer.byteLength) throw new Error('Invalid NRAW payload length');
  const frame: RawFrame = {
    buffer,
    payload: new Uint8Array(buffer, headerBytes, payloadBytes),
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
    motion: version >= 3 ? {
      flags: d.getUint32(256, le), accuracy: d.getUint32(260, le),
      timestampNs: d.getBigUint64(264, le), gapNs: d.getBigUint64(272, le), rollingSkewNs: d.getBigUint64(280, le),
      worldFromDevice: Array.from({length:4}, (_,i) => d.getFloat32(288+i*4,le)),
      cameraFromDevice: Array.from({length:4}, (_,i) => d.getFloat32(304+i*4,le)),
      intrinsics: Array.from({length:5}, (_,i) => d.getFloat32(320+i*4,le)),
      distortion: Array.from({length:5}, (_,i) => d.getFloat32(340+i*4,le)),
      exposureTravelRad: d.getFloat32(360,le),
    } : null,
    isp: version===4 ? {
      flags:d.getUint32(364,le),wb:Array.from({length:4},(_,i)=>d.getFloat32(368+i*4,le)),
      matrix:Array.from({length:9},(_,i)=>d.getFloat32(384+i*4,le)),neutral:Array.from({length:3},(_,i)=>d.getFloat32(420+i*4,le)),
      mapWidth:d.getUint32(432,le),mapHeight:d.getUint32(436,le),shading:new Float32Array(buffer,headerBytes+payloadBytes,mapBytes/4),
      active:Array.from({length:4},(_,i)=>d.getFloat32(444+i*4,le)),maxAnalogIso:d.getUint32(464,le),
      imageCallbackNs:d.getBigUint64(468,le),resultCallbackNs:d.getBigUint64(476,le),rotationTimestampNs:d.getBigUint64(484,le),
      rotationQuaternion:Array.from({length:4},(_,i)=>d.getFloat32(492+i*4,le)),rotationAccuracy:d.getUint32(508,le),
    } : null,
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
  if(frame.isp) {
    const s=frame.isp;
    if((s.flags&1) && s.wb.some(v=>!Number.isFinite(v)||v<=0||v>64))throw new Error('Invalid ISP white balance');
    if((s.flags&2) && s.matrix.some(v=>!Number.isFinite(v)||Math.abs(v)>64))throw new Error('Invalid ISP matrix');
    if(mapBytes && (s.mapWidth<2||s.mapHeight<2||s.mapWidth>64||s.mapHeight>64||mapBytes!==s.mapWidth*s.mapHeight*16||s.shading.some(v=>!Number.isFinite(v)||v<1||v>64)))throw new Error('Invalid lens shading map');
    if((s.flags&4) && (!mapBytes||s.active.some(v=>!Number.isFinite(v))||s.active[2]<=1||s.active[3]<=1))throw new Error('Invalid shading geometry');
  }
  return frame;
}
