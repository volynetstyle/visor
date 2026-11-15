import { packet } from './fixtures.ts';
import { parseRawFrame, type MotionMetadata } from '../src/raw.ts';

export function motionFrame(samples:number[]=Array(16*16).fill(74), options: {
  timestamp?:bigint; width?:number; height?:number; motion?:Partial<MotionMetadata>; flags?:number;
}={}) {
  const timestamp=options.timestamp??1_000_000_000n;
  const legacy=packet(samples,{width:options.width??16,height:options.height??16,timestamp,flags:options.flags??31});
  const buffer=new ArrayBuffer(512+samples.length*2);
  new Uint8Array(buffer,0,256).set(new Uint8Array(legacy,0,256));
  new Uint8Array(buffer,512).set(new Uint8Array(legacy,256));
  const d=new DataView(buffer);
  d.setUint16(4,3,true);d.setUint16(6,512,true);
  const m:MotionMetadata={flags:63,accuracy:3,timestampNs:timestamp+125_000_000n,gapNs:1_000_000n,rollingSkewNs:0n,
    worldFromDevice:[0,0,0,1],cameraFromDevice:[0,0,0,1],intrinsics:[20,20,3.5,3.5,0],distortion:[0,0,0,0,0],exposureTravelRad:0,
    ...options.motion};
  d.setUint32(256,m.flags,true);d.setUint32(260,m.accuracy,true);
  d.setBigUint64(264,m.timestampNs,true);d.setBigUint64(272,m.gapNs,true);d.setBigUint64(280,m.rollingSkewNs,true);
  m.worldFromDevice.forEach((v,i)=>d.setFloat32(288+i*4,v,true));
  m.cameraFromDevice.forEach((v,i)=>d.setFloat32(304+i*4,v,true));
  m.intrinsics.forEach((v,i)=>d.setFloat32(320+i*4,v,true));
  m.distortion.forEach((v,i)=>d.setFloat32(340+i*4,v,true));
  d.setFloat32(360,m.exposureTravelRad,true);
  // A known synthetic sensor: 1 DN^2 read variance, no shot term.
  for(let i=0;i<4;i++){d.setFloat64(128+i*16,0,true);d.setFloat64(136+i*16,1/(959*959),true);}
  return parseRawFrame(buffer);
}
