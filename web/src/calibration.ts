import {DYNAMIC_BLACK,type RawFrame} from './raw.ts';
export interface DarkProfile {
  key:string;createdAt:string;frames:number;mean:Float32Array;variance:Float32Array;classes:Uint8Array;
  width:number;height:number;whiteLevel:number;summary:{biased:number;hot:number;unstable:number;medianDN:number[];medianVariance:number[]};
}
export function calibrationKey(cameraId:string,f:RawFrame) {
  return ['dark-v1',cameraId,f.width,f.height,f.sensorWidth,f.sensorHeight,f.cropX,f.cropY,f.cfa,f.sensorOrientation,
    String(f.exposureNs),f.iso,f.whiteLevel,(f.flags&DYNAMIC_BLACK)?'dynamic':`static:${f.black.join(',')}`].join('/');
}
function median(a:number[]) {a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)]??0;}
export function buildDarkProfile(key:string,f:RawFrame,region:{means:Float32Array;m2:Float32Array;counts:Float32Array},frames:number):DarkProfile {
  if(frames<50)throw new Error('Нужно минимум 50 принятых кадров для калибровки');
  const quads=f.width*f.height/4;
  if(region.means.length!==quads*4||region.m2.length!==quads*4||region.counts.length!==quads)throw new Error('Размер тёмной карты не совпадает с RAW');
  const mean=region.means,variance=new Float32Array(mean.length),classes=new Uint8Array(mean.length);
  const centers:number[]=[],baseVariance:number[]=[];
  for(let c=0;c<4;c++){
    const a:number[]=[],v:number[]=[];
    const step=Math.max(1,Math.floor(quads/8192));
    for(let i=0;i<quads;i+=step)if(region.counts[i]>=frames*0.9){a.push(mean[i*4+c]);v.push(region.m2[i*4+c]/Math.max(1,region.counts[i]-1));}
    if(a.length<Math.min(16,quads))throw new Error('Слишком много отсутствующих измерений в тёмной серии');
    centers.push(median(a));baseVariance.push(median(v));
  }
  const range=f.whiteLevel-f.black.reduce((a,b)=>a+b,0)/4;
  if(centers.some(v=>v>range*0.1))throw new Error('Серия слишком яркая для dark-калибровки. Полностью закройте объектив.');
  let biased=0,hot=0,unstable=0;
  for(let i=0;i<mean.length;i++){
    const c=i%4,n=region.counts[Math.floor(i/4)];
    const v=region.m2[i]/Math.max(1,n-1);variance[i]=v;
    if(n<frames*0.9||!Number.isFinite(mean[i])||!Number.isFinite(v)||v>Math.max(4,baseVariance[c]*9)){classes[i]=3;unstable++;}
    else if(mean[i]-centers[c]>Math.max(8,8*Math.sqrt(baseVariance[c]))){classes[i]=2;hot++;}
    else if(Math.abs(mean[i]-centers[c])>Math.max(1,3*Math.sqrt(baseVariance[c]/frames))){classes[i]=1;biased++;}
  }
  if((hot+unstable)/mean.length>0.05)throw new Error('Более 5% нестабильных/горячих измерений: профиль не применён');
  return {key,createdAt:new Date().toISOString(),frames,mean,variance,classes,width:f.width,height:f.height,whiteLevel:f.whiteLevel,
    summary:{biased,hot,unstable,medianDN:centers,medianVariance:baseVariance}};
}
async function database(){
  return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('nightfield-calibration',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('dark',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
export async function darkStore(action:'get'|'put'|'delete',key:string,profile?:DarkProfile):Promise<DarkProfile|null>{
  const db=await database();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('dark',action==='get'?'readonly':'readwrite'),store=tx.objectStore('dark');
    const request=action==='get'?store.get(key):action==='put'?store.put(profile):store.delete(key);
    let result:DarkProfile|null=null;
    request.onsuccess=()=>{if(action==='get')result=request.result??null;};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Calibration storage aborted'));
  });}finally{db.close();}
}
