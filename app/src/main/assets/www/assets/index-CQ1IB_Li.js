(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))i(s);new MutationObserver(s=>{for(const a of s)if(a.type==="childList")for(const n of a.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&i(n)}).observe(document,{childList:!0,subtree:!0});function e(s){const a={};return s.integrity&&(a.integrity=s.integrity),s.referrerPolicy&&(a.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?a.credentials="include":s.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function i(s){if(s.ep)return;s.ep=!0;const a=e(s);fetch(s.href,a)}})();class O{onBinary;onEvent;constructor(){const t=()=>{if(!window.rawBridge){setTimeout(t,20);return}window.rawBridge.onmessage=e=>{if(e.data instanceof ArrayBuffer)this.onBinary?.(e.data);else try{this.onEvent?.(JSON.parse(String(e.data)))}catch{this.onEvent?.({type:"log",message:String(e.data)})}},this.send({type:"ready"})};t()}send(t){window.rawBridge?.postMessage(JSON.stringify(t))}ack(){this.send({type:"ack"})}start(t,e){this.send({type:"start",exposureNs:t,iso:e})}stop(){this.send({type:"stop"})}}const y=128;function E(r){if(r.byteLength<y)throw new Error("Short NRAW packet");const t=new Uint8Array(r,0,4);if(String.fromCharCode(...t)!=="NRAW")throw new Error("Bad NRAW magic");const e=new DataView(r),i=!0,s=e.getUint16(4,i),a=e.getUint16(6,i);if(s!==1||a!==y)throw new Error(`Unsupported NRAW v${s}/${a}`);const n=e.getUint32(112,i);if(y+n>r.byteLength)throw new Error("Truncated NRAW payload");return{buffer:r,payload:new Uint8Array(r,y,n),format:e.getUint32(8,i),width:e.getUint32(12,i),height:e.getUint32(16,i),rowStride:e.getUint32(20,i),pixelStride:e.getUint32(24,i),sensorWidth:e.getUint32(28,i),sensorHeight:e.getUint32(32,i),cropX:e.getUint32(36,i),cropY:e.getUint32(40,i),frameId:e.getUint32(44,i),timestampNs:e.getBigUint64(48,i),exposureNs:e.getBigUint64(56,i),iso:e.getUint32(64,i),cfa:e.getUint32(68,i),whiteLevel:e.getUint32(72,i),black:[e.getFloat32(80,i),e.getFloat32(84,i),e.getFloat32(88,i),e.getFloat32(92,i)],payloadBytes:n,sensorOrientation:e.getUint32(116,i)}}const N=`
struct Params {
  dims: vec4<u32>,
  levels0: vec4<f32>,
  levels1: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> rawWords: array<u32>;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> p: Params;

fn sampleRaw(x: u32, y: u32) -> f32 {
  let byteOffset = y * p.dims.z + x * 2u;
  let word = rawWords[byteOffset >> 2u];
  let shift = (byteOffset & 2u) * 8u;
  return f32((word >> shift) & 0xffffu);
}

fn blackAt(x: u32, y: u32) -> f32 {
  let i = (y & 1u) * 2u + (x & 1u);
  if (i == 0u) { return p.levels0.y; }
  if (i == 1u) { return p.levels0.z; }
  if (i == 2u) { return p.levels0.w; }
  return p.levels1.x;
}

fn linear(x: u32, y: u32) -> f32 {
  let b = blackAt(x, y);
  return clamp((sampleRaw(x, y) - b) / max(1.0, p.levels0.x - b), 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let ow = p.dims.x / 2u;
  let oh = p.dims.y / 2u;
  if (id.x >= ow || id.y >= oh) { return; }

  let x = id.x * 2u;
  let y = id.y * 2u;
  let s00 = linear(x, y);
  let s10 = linear(x + 1u, y);
  let s01 = linear(x, y + 1u);
  let s11 = linear(x + 1u, y + 1u);
  let cfa = p.dims.w;

  var rgb: vec3<f32>;
  if (cfa == 0u) {        // RGGB
    rgb = vec3<f32>(s00, 0.5 * (s10 + s01), s11);
  } else if (cfa == 1u) { // GRBG
    rgb = vec3<f32>(s10, 0.5 * (s00 + s11), s01);
  } else if (cfa == 2u) { // GBRG
    rgb = vec3<f32>(s01, 0.5 * (s00 + s11), s10);
  } else {                // BGGR
    rgb = vec3<f32>(s11, 0.5 * (s10 + s01), s00);
  }

  rgb *= p.levels1.y; // exposure normalization to first frame
  let w = p.levels1.z;
  let idx = id.y * ow + id.x;
  let old = accum[idx];
  let total = old.w + w;
  let mean = select(rgb, (old.xyz * old.w + rgb * w) / max(total, 1e-6), old.w > 0.0);
  accum[idx] = vec4<f32>(mean, total);
}
`,R=`
@vertex fn main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0)
  );
  return vec4<f32>(p[i], 0.0, 1.0);
}
`,G=`
struct ViewParams {
  dims: vec4<f32>,
  controls: vec4<f32>,
}
@group(0) @binding(0) var<storage, read> accum: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> vp: ViewParams;

@fragment fn main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let cw = vp.dims.x;
  let ch = vp.dims.y;
  let ow = vp.dims.z;
  let oh = vp.dims.w;
  let uv = vec2<f32>(pos.x / cw, pos.y / ch);
  let x = min(u32(uv.x * ow), u32(ow) - 1u);
  let y = min(u32(uv.y * oh), u32(oh) - 1u);
  let a = accum[y * u32(ow) + x];
  var rgb = a.xyz * vp.controls.x;
  // Basic daylight-ish WB. UI display gain is folded into vp.x scale via JS viewport trick later.
  rgb *= vec3<f32>(1.85, 1.0, 1.55);
  rgb = vec3<f32>(1.0) - exp(-rgb);
  rgb = pow(max(rgb, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
  return vec4<f32>(rgb, 1.0);
}
`;class P{constructor(t){this.canvas=t}canvas;device;ctx;format="";rawBuffer;accumBuffer;paramsBuffer;viewBuffer;computePipeline;renderPipeline;computeBind;renderBind;width=0;height=0;outWidth=0;outHeight=0;rawCapacity=0;refExposureIso=0;displayGain=2;static async create(t){if(!navigator.gpu)throw new Error("WebGPU is unavailable in this Android WebView");const e=new P(t),i=await navigator.gpu.requestAdapter();if(!i)throw new Error("No WebGPU adapter");if(e.device=await i.requestDevice(),e.ctx=t.getContext("webgpu"),!e.ctx)throw new Error("No WebGPU canvas context");return e.format=navigator.gpu.getPreferredCanvasFormat(),e.ctx.configure({device:e.device,format:e.format,alphaMode:"opaque"}),e}setDisplayGain(t){this.displayGain=t}ensure(t){if(this.width===t.width&&this.height===t.height&&this.rawCapacity>=t.payload.byteLength)return;this.width=t.width,this.height=t.height,this.outWidth=t.width>>1,this.outHeight=t.height>>1,this.rawCapacity=t.payload.byteLength+3&-4,this.refExposureIso=0,this.rawBuffer?.destroy?.(),this.accumBuffer?.destroy?.(),this.paramsBuffer?.destroy?.(),this.viewBuffer?.destroy?.();const e=globalThis.GPUBufferUsage;this.rawBuffer=this.device.createBuffer({size:this.rawCapacity,usage:e.STORAGE|e.COPY_DST}),this.accumBuffer=this.device.createBuffer({size:this.outWidth*this.outHeight*16,usage:e.STORAGE|e.COPY_DST}),this.paramsBuffer=this.device.createBuffer({size:48,usage:e.UNIFORM|e.COPY_DST}),this.viewBuffer=this.device.createBuffer({size:32,usage:e.UNIFORM|e.COPY_DST}),this.computePipeline=this.device.createComputePipeline({layout:"auto",compute:{module:this.device.createShaderModule({code:N}),entryPoint:"main"}}),this.computeBind=this.device.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.rawBuffer}},{binding:1,resource:{buffer:this.accumBuffer}},{binding:2,resource:{buffer:this.paramsBuffer}}]}),this.renderPipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:this.device.createShaderModule({code:R}),entryPoint:"main"},fragment:{module:this.device.createShaderModule({code:G}),entryPoint:"main",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}}),this.renderBind=this.device.createBindGroup({layout:this.renderPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.accumBuffer}},{binding:1,resource:{buffer:this.viewBuffer}}]}),this.reset()}reset(){this.accumBuffer&&(this.device.queue.writeBuffer(this.accumBuffer,0,new Uint8Array(this.outWidth*this.outHeight*16)),this.refExposureIso=0)}add(t){this.ensure(t),this.device.queue.writeBuffer(this.rawBuffer,0,t.payload);const e=Number(t.exposureNs)*Math.max(t.iso,1);this.refExposureIso||(this.refExposureIso=e);const i=this.refExposureIso/Math.max(1,e),s=Math.max(.001,Number(t.exposureNs)/1e9),a=new ArrayBuffer(48),n=new DataView(a),o=!0;n.setUint32(0,t.width,o),n.setUint32(4,t.height,o),n.setUint32(8,t.rowStride,o),n.setUint32(12,t.cfa,o),n.setFloat32(16,t.whiteLevel,o),n.setFloat32(20,t.black[0],o),n.setFloat32(24,t.black[1],o),n.setFloat32(28,t.black[2],o),n.setFloat32(32,t.black[3],o),n.setFloat32(36,i,o),n.setFloat32(40,s,o),n.setFloat32(44,t.frameId,o),this.device.queue.writeBuffer(this.paramsBuffer,0,a);const l=this.device.createCommandEncoder(),w=l.beginComputePass();w.setPipeline(this.computePipeline),w.setBindGroup(0,this.computeBind),w.dispatchWorkgroups(Math.ceil(this.outWidth/8),Math.ceil(this.outHeight/8)),w.end(),this.device.queue.submit([l.finish()]),this.render()}render(){if(!this.renderPipeline)return;const t=Math.min(devicePixelRatio||1,2),e=Math.max(1,this.canvas.clientWidth),i=Math.max(1,this.canvas.clientHeight),s=Math.max(1,Math.floor(e*t)),a=Math.max(1,Math.floor(i*t));(this.canvas.width!==s||this.canvas.height!==a)&&(this.canvas.width=s,this.canvas.height=a);const n=new Float32Array([s,a,this.outWidth,this.outHeight,this.displayGain,0,0,0]);this.device.queue.writeBuffer(this.viewBuffer,0,n);const o=this.device.createCommandEncoder(),l=o.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:1}}]});l.setPipeline(this.renderPipeline),l.setBindGroup(0,this.renderBind),l.draw(3),l.end(),this.device.queue.submit([o.finish()])}}const u=r=>document.getElementById(r),W=u("view"),x=u("status"),U=u("log"),A=u("stats"),m=u("exposure"),f=u("iso"),B=u("gain"),C=u("exposureOut"),$=u("isoOut"),F=u("gainOut");let d=null,p=0,g=0,M=performance.now(),c=null;function h(r){U.textContent=`${new Date().toLocaleTimeString()} ${r}
${U.textContent}`.slice(0,6e3)}async function S(){return d||(d=await P.create(W)),d}const v=new O;v.onEvent=r=>{r.type==="capabilities"?(c=r.selected,x.textContent=c?"RAW ready":"NO RAW",c?(m.min=String(Math.max(1,Math.ceil(c.exposureMinNs/1e6))),m.max=String(Math.min(2e3,Math.floor(c.exposureMaxNs/1e6))),f.min=String(c.isoMin),f.max=String(c.isoMax),f.step=String(Math.max(1,Math.round((c.isoMax-c.isoMin)/100))),h(`camera ${c.id}: RAW ${c.rawSize}, bridge crop ${c.cropSize}, CFA ${c.cfa}`)):h(String(r.error??"No RAW camera"))):r.type==="started"?(x.textContent="capturing",h(`started: ${JSON.stringify(r)}`)):r.type==="error"?(x.textContent="error",h(`ERROR: ${String(r.message)}`)):h(JSON.stringify(r))};v.onBinary=async r=>{const t=performance.now();try{const e=E(r);(await S()).add(e),p++,g||(g=t);const s=Math.max(.001,(t-g)/1e3),a=1e3/Math.max(1,t-M);M=t,A.textContent=[`${e.width}×${e.height} RAW16 crop → ${e.width>>1}×${e.height>>1} RGB`,`frame ${e.frameId} · ${p} accumulated`,`capture ${Number(e.exposureNs)/1e6} ms · ISO ${e.iso}`,`stream ${a.toFixed(1)} fps · avg ${(p/s).toFixed(1)} fps`,`packet ${(r.byteLength/1024/1024).toFixed(2)} MiB`,`GPU submit ${(performance.now()-t).toFixed(2)} ms`].join(`
`)}catch(e){h(`frame error: ${e instanceof Error?e.message:String(e)}`)}finally{v.ack()}};function b(){C.value=`${m.value} ms`,$.value=f.value,F.value=`${Number(B.value).toFixed(2)}×`,d?.setDisplayGain(Number(B.value)),d?.render()}m.oninput=b;f.oninput=b;B.oninput=b;b();u("start").onclick=async()=>{try{await S(),p=0,g=0,d?.reset(),v.start(Math.round(Number(m.value)*1e6),Number(f.value))}catch(r){x.textContent="WebGPU error",h(r instanceof Error?r.message:String(r))}};u("stop").onclick=()=>v.stop();u("reset").onclick=()=>{p=0,g=0,d?.reset(),d?.render()};window.addEventListener("resize",()=>d?.render());
