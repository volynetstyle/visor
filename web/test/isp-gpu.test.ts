import {RawAccumulator} from '../src/gpu.ts';
import {ispFrame} from './isp-fixtures.ts';
import {buildDarkProfile,darkStore,type DarkProfile} from '../src/calibration.ts';
import {FRAG,VERT} from '../src/shaders.ts';
async function renderedPixel(){
  const adapter=await navigator.gpu.requestAdapter(),d=await adapter.requestDevice();
  const U=(globalThis as any).GPUBufferUsage,T=(globalThis as any).GPUTextureUsage;
  const create=(data:Float32Array,uniform=false)=>{const b=d.createBuffer({size:data.byteLength,usage:(uniform?U.UNIFORM:U.STORAGE)|U.COPY_DST});d.queue.writeBuffer(b,0,data);return b;};
  const params=new Float32Array(24);params.set([4,4,1,1,1,0,1,0,2,1,1,3,1,1,0,0,0,1,1,0,1,0,1,0]);
  const buffers=[create(new Float32Array([.1,.1,.1,.1])),create(new Float32Array(4)),create(new Float32Array([1])),create(params,true)];
  const texture=d.createTexture({size:[4,4],format:'rgba8unorm',usage:T.RENDER_ATTACHMENT|T.COPY_SRC});
  const read=d.createBuffer({size:1024,usage:U.COPY_DST|U.MAP_READ});
  try{
    const pipeline=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:d.createShaderModule({code:VERT}),entryPoint:'main'},fragment:{module:d.createShaderModule({code:FRAG}),entryPoint:'main',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
    const bind=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
    const e=d.createCommandEncoder(),pass=e.beginRenderPass({colorAttachments:[{view:texture.createView(),loadOp:'clear',storeOp:'store'}]});
    pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
    e.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:256},[4,4]);d.queue.submit([e.finish()]);
    await read.mapAsync((globalThis as any).GPUMapMode.READ);return Array.from(new Uint8Array(read.getMappedRange(),0,4));
  }finally{for(const b of buffers)b.destroy();read.destroy();texture.destroy();d.destroy();}
}
export async function runIspGpuTests(){
  const canvas=document.createElement('canvas');canvas.style.width=canvas.style.height='32px';document.body.append(canvas);
  const gpu=await RawAccumulator.create(canvas);let timestamp=1_000_000_000n;const passed:string[]=[];
  const near=(a:ArrayLike<number>,b:number[],eps=1e-4)=>{if(a.length!==b.length||b.some((v,i)=>Math.abs(a[i]-v)>eps||!Number.isFinite(a[i])))throw Error(`ISP result ${Array.from(a)} != ${b}`);};
  const add=async(samples:number[],options:Parameters<typeof ispFrame>[1]={})=>{const f=ispFrame(samples,{...options,timestamp});timestamp+=250_000_000n;await gpu.add(f);return f;};
  const map=[1,2,3,4,2,4,6,8,3,6,9,12,4,8,12,16];
  function profile():DarkProfile{return {key:'gpu-test',createdAt:'test',frames:64,mean:new Float32Array([1,-2,3,-4]),variance:new Float32Array(4),classes:new Uint8Array(4),width:2,height:2,whiteLevel:1023,summary:{biased:0,hot:0,unstable:0,medianDN:[0,0,0,0],medianVariance:[1,1,1,1]}};}
  try{
    const expected=[[1,8,27,64],[4,2,48,36],[9,2,48,16],[16,8,27,4]];
    for(let cfa=0;cfa<4;cfa++){await gpu.reset();await add([65,66,67,68],{width:2,height:2,cfa,shading:map});near((await gpu.readRegion()).means,expected[cfa]);}
    passed.push('all CFA layouts use canonical shading channels at physical photosite locations');
    await gpu.reset();await add([65,65,65,65],{width:2,height:2,crop:[2,2,4,4],active:[0,0,4,4],shading:map});
    near((await gpu.readRegion()).means,[3,20/3,11,16]);
    passed.push('cropped RAW samples the full active-array shading map');
    await gpu.reset();gpu.setDarkProfile(profile());await add([64,64,64,64],{width:2,height:2});
    near((await gpu.readRegion()).means,[-1,2,-3,4]);
    passed.push('signed dark offset is subtracted before accumulation without clamping');
    await gpu.reset();await add([65,65,65,65],{width:2,height:2,shading:Array(16).fill(2)});
    await add([67,67,67,67],{width:2,height:2,shading:Array(16).fill(2)});
    const r=await gpu.readRegion();near(r.means,[4,4,4,4]);near(r.m2,[8,8,8,8]);
    passed.push('shading scales both signed mean and temporal variance in the correct units');
    await gpu.reset();const p=profile();p.mean=new Float32Array(64);p.classes=new Uint8Array(64);p.classes[20]=2;p.width=p.height=8;
    gpu.setDarkProfile(p);await add(Array(64).fill(74),{width:8,height:8});
    const masked=await gpu.readRegion(1,1,1,1);near(masked.counts,[0]);near(masked.means,[0,0,0,0]);
    passed.push('bad-pixel quads never receive fabricated temporal evidence');
    await gpu.reset();gpu.setDarkProfile(profile());gpu.setCalibrationCapture(true);
    for(let n=0;n<64;n++)await add([66,66,66,66],{width:2,height:2,shading:Array(16).fill(3)});
    const full=await gpu.exportCalibrationStatistics();near(full.means,[2,2,2,2]);near(full.counts,[64]);
    passed.push('dark capture bypasses existing dark/shading correction and exports full sensor statistics');
    const source=ispFrame([66,66,66,66],{width:2,height:2});const stored=buildDarkProfile('gpu-idb-test',source,full,64);
    await darkStore('put',stored.key,stored);const restored=await darkStore('get',stored.key);
    if(!restored)throw Error('Dark profile not persisted');near(restored.mean,[2,2,2,2]);await darkStore('delete',stored.key);
    passed.push('IndexedDB preserves typed calibration maps across read/write transactions');
    near(await renderedPixel(),[149,170,188,255],1);
    passed.push('actual fragment output applies WB, row-major sensor matrix and sRGB transfer');
    return {passed,failures:0};
  }finally{await darkStore('delete','gpu-idb-test');gpu.destroy();canvas.remove();}
}
