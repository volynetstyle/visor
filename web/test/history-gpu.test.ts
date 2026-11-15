import { RawAccumulator } from '../src/gpu.ts';
import { motionFrame } from './motion-fixtures.ts';

export async function runHistoryGpuTests() {
  const canvas=document.createElement('canvas');canvas.style.width=canvas.style.height='32px';document.body.append(canvas);
  const gpu=await RawAccumulator.create(canvas);
  gpu.setHistoryMode('rotation');
  let t=1_000_000_000n;
  const results:string[]=[];
  function check(condition:boolean,message:string){if(!condition)throw new Error(message);}
  function raw(values:(x:number,y:number)=>number){
    const samples=Array(16*16).fill(64);
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)samples[(2*y+dy)*16+2*x+dx]=Math.round(64+values(x,y));
    return samples;
  }
  async function add(values:(x:number,y:number)=>number,options:Parameters<typeof motionFrame>[1]={},variance=2){
    const f=motionFrame(raw(values),{...options,timestamp:t});t+=250_000_000n;
    f.noiseProfile=Array.from({length:4},()=>[0,variance/(959*959)]);
    await gpu.add(f);
  }
  try {
    for(let i=0;i<8;i++)await add((x,y)=>((x+y+i)%2?1:-1));
    let r=await gpu.readRegion(0,0,8,8);
    check(r.means.every(v=>Math.abs(v)<1e-5),'Signed RGB dark mean drifted');
    check(r.counts.every(v=>Math.abs(v-8)<1e-5),'Identity history lost or duplicated evidence');
    check(r.m2.every(v=>Math.abs(v-8)<1e-4),'RGB Welford variance incorrect');
    check((r.motion?.confidence??0)>0.95,'Stationary confidence did not grow');
    results.push('identity signed RGB accumulation, M2, one observation per merge and confidence growth');

    await add(()=>100);
    r=await gpu.readRegion(0,0,8,8);
    check(r.means.every(v=>Math.abs(v-100)<1e-5),'Invalid old image ghost survived hard reject');
    check(r.counts.every(v=>v===1),'Hard rejection did not kill old evidence immediately');
    check(r.motion?.rejected===1,'Hard rejection not reflected in diagnostics');
    results.push('coherent scene replacement kills previous history in one frame');

    await gpu.reset();
    for(let i=0;i<4;i++)await add(()=>10);
    await add((x,y)=>x===3&&y===3?60:10);
    r=await gpu.readRegion(2,2,3,3);
    check(r.counts.every(v=>v>4.99),'An isolated sample incorrectly killed a spatial patch of history');
    check(r.motion?.rejected===0,'Isolated sample was treated as coherent motion');
    results.push('isolated photon-like innovation does not invalidate surrounding history');

    await gpu.reset();
    for(let i=0;i<4;i++)await add(()=>10);
    const before=await gpu.readRegion(2,2,3,3);
    await add(()=>11);
    r=await gpu.readRegion(2,2,3,3);
    check(r.motion?.dubious===1,'2..4 sigma innovation did not mark dubious history');
    check((r.motion?.confidence??1)<(before.motion?.confidence??0),'Dubious confidence failed to decrease');
    check(r.counts.every(v=>v<5 && v>1),'Dubious history evidence was not downweighted');
    results.push('moderate innovation strongly reduces history weight and confidence');

    await gpu.reset();
    await add((x,y)=>10+2*x+3*y);
    const angle=0.1,cs=Math.cos(angle),sn=Math.sin(angle);
    const signal=(x:number,y:number)=>10+2*(cs*(x-3.5)-sn*(y-3.5)+3.5)+3*(sn*(x-3.5)+cs*(y-3.5)+3.5);
    await add(signal,{motion:{worldFromDevice:[0,0,Math.sin(angle/2),Math.cos(angle/2)]}});
    r=await gpu.readRegion(2,2,3,3);
    for(let y=0;y<3;y++)for(let x=0;x<3;x++) {
      const i=y*3+x;
      check(r.counts[i]>1.9,'Rotated interior lost history');
      for(let c=0;c<3;c++)check(Math.abs(r.means[i*3+c]-signal(x+2,y+2))<0.51,'Inverse rotation sampled wrong history coordinates');
    }
    check((await gpu.readRegion(0,0,1,1)).counts[0]===1,'Disoccluded border inherited unrelated history');
    results.push('inverse rotation, fractional RGB interpolation and fresh disocclusion borders');

    await gpu.reset();
    const lens={distortion:[0.1,-0.01,0.005,0.001,-0.002]};
    await add((x,y)=>10+2*x+3*y,{motion:lens});
    await add((x,y)=>10+2*x+3*y,{motion:lens});
    r=await gpu.readRegion(2,2,3,3);
    check(r.counts.every(v=>v>1.99),'Inverse/forward distortion did not preserve identity coordinates');
    for(let y=0;y<3;y++)for(let x=0;x<3;x++)check(Math.abs(r.means[(y*3+x)*3]-(10+2*(x+2)+3*(y+2)))<1e-3,'Distortion introduced a spatial shift');
    await gpu.reset();
    await add((x,y)=>10+2*x+3*y);
    await add((x,y)=>9+2*x+3*y,{motion:{intrinsics:[20,20,4,3.5,0]}});
    r=await gpu.readRegion(2,2,3,3);
    for(let y=0;y<3;y++)for(let x=0;x<3;x++)check(Math.abs(r.means[(y*3+x)*3]-(9+2*(x+2)+3*(y+2)))<1e-3,'Changed intrinsics did not reproject fractional coordinates');
    results.push('Brown-Conrady inverse/forward consistency and per-frame intrinsics changes');

    await add(()=>42,{motion:{flags:62}});
    r=await gpu.readRegion(2,2,3,3);
    check(r.counts.every(v=>v===1) && r.means.every(v=>v===42),'Unknown clock kept stale history');
    check(r.motion?.confidence===0 && !gpu.motionStatus?.reuse,'Invalid metadata reported trusted history');
    results.push('clock failure invalidates confidence and history without freezing live data');

    await gpu.reset();
    await add(()=>10);
    const saturated=motionFrame(Array(16*16).fill(1023),{timestamp:t});t+=250_000_000n;
    await gpu.add(saturated);
    r=await gpu.readRegion(2,2,3,3);
    check(r.counts.every(v=>v===0),'Saturated current data retained unverified old history');
    results.push('saturation cannot revive or preserve unverified RGB history');
    return {passed:results,failures:0};
  } finally {gpu.destroy();canvas.remove();}
}
