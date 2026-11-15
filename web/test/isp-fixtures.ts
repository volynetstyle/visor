import {motionFrame} from './motion-fixtures.ts';
import {parseRawFrame} from '../src/raw.ts';
export function ispFrame(samples:number[]=Array(256).fill(66),options:{width?:number;height?:number;timestamp?:bigint;cfa?:number;shading?:number[];mapWidth?:number;mapHeight?:number;active?:number[];crop?:number[];wb?:number[];matrix?:number[];flags?:number}={}){
  const base=motionFrame(samples,{width:options.width??16,height:options.height??16,timestamp:options.timestamp});
  const map=options.shading??Array(16).fill(1),bytes=new ArrayBuffer(768+base.payloadBytes+map.length*4);
  new Uint8Array(bytes,0,512).set(new Uint8Array(base.buffer,0,512));new Uint8Array(bytes,768,base.payloadBytes).set(base.payload);
  const d=new DataView(bytes);d.setUint16(4,4,true);d.setUint16(6,768,true);d.setUint32(68,options.cfa??0,true);
  d.setUint32(364,options.flags??7,true);
  (options.wb??[1,1,1,1]).forEach((v,i)=>d.setFloat32(368+i*4,v,true));
  (options.matrix??[1,0,0,0,1,0,0,0,1]).forEach((v,i)=>d.setFloat32(384+i*4,v,true));
  [1,1,1].forEach((v,i)=>d.setFloat32(420+i*4,v,true));
  d.setUint32(432,options.mapWidth??2,true);d.setUint32(436,options.mapHeight??2,true);d.setUint32(440,map.length*4,true);
  (options.active??[0,0,base.width,base.height]).forEach((v,i)=>d.setFloat32(444+i*4,v,true));
  if(options.crop){d.setUint32(36,options.crop[0],true);d.setUint32(40,options.crop[1],true);d.setUint32(28,options.crop[2],true);d.setUint32(32,options.crop[3],true);}
  d.setUint32(464,1600,true);d.setBigUint64(468,2_000_000_000n,true);d.setBigUint64(476,1_999_000_000n,true);d.setBigUint64(484,1_998_000_000n,true);
  d.setFloat32(504,1,true);d.setUint32(508,3,true);
  map.forEach((v,i)=>d.setFloat32(768+base.payloadBytes+i*4,v,true));
  return parseRawFrame(bytes);
}
