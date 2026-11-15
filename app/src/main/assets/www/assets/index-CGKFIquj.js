(function(){const r=document.createElement("link").relList;if(r&&r.supports&&r.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))t(a);new MutationObserver(a=>{for(const s of a)if(s.type==="childList")for(const l of s.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&t(l)}).observe(document,{childList:!0,subtree:!0});function e(a){const s={};return a.integrity&&(s.integrity=a.integrity),a.referrerPolicy&&(s.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?s.credentials="include":a.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function t(a){if(a.ep)return;a.ep=!0;const s=e(a);fetch(a.href,s)}})();class Ge{onBinary;onEvent;constructor(){const r=()=>{if(!window.rawBridge){setTimeout(r,20);return}window.rawBridge.onmessage=e=>{if(e.data instanceof ArrayBuffer)this.onBinary?.(e.data);else try{this.onEvent?.(JSON.parse(String(e.data)))}catch{this.onEvent?.({type:"log",message:String(e.data)})}},this.send({type:"ready"})};r()}send(r){window.rawBridge?.postMessage(JSON.stringify(r))}ack(r){this.send({type:"ack",frameId:r})}start(r,e,t=!1){this.send({type:"start",exposureNs:r,iso:e,rotationHistory:t})}stop(){this.send({type:"stop"})}}const _e=256,pe=1,Se=2,He=4,se=8,ge=16;function Le(i){if(i.byteLength<_e)throw new Error("Short NRAW packet");const r=new Uint8Array(i,0,4);if(String.fromCharCode(...r)!=="NRAW")throw new Error("Bad NRAW magic");const e=new DataView(i),t=!0,a=e.getUint16(4,t),s=e.getUint16(6,t);if(!(a===2&&s===256||a===3&&s===512||a===4&&s===768))throw new Error(`Unsupported NRAW v${a}/${s}; install the matching APK`);const l=e.getUint32(112,t),d=a===4&&i.byteLength>=768?e.getUint32(440,t):0;if(d>65536||d%16!==0||s+l+d!==i.byteLength)throw new Error("Invalid NRAW payload length");const n={buffer:i,payload:new Uint8Array(i,s,l),format:e.getUint32(8,t),width:e.getUint32(12,t),height:e.getUint32(16,t),rowStride:e.getUint32(20,t),pixelStride:e.getUint32(24,t),sensorWidth:e.getUint32(28,t),sensorHeight:e.getUint32(32,t),cropX:e.getUint32(36,t),cropY:e.getUint32(40,t),frameId:e.getUint32(44,t),timestampNs:e.getBigUint64(48,t),exposureNs:e.getBigUint64(56,t),iso:e.getUint32(64,t),cfa:e.getUint32(68,t),whiteLevel:e.getUint32(72,t),black:[e.getFloat32(80,t),e.getFloat32(84,t),e.getFloat32(88,t),e.getFloat32(92,t)],payloadBytes:l,sensorOrientation:e.getUint32(116,t),flags:e.getUint32(76,t),requestedExposureNs:e.getBigUint64(96,t),requestedIso:e.getUint32(120,t),frameDurationNs:e.getBigUint64(104,t),noiseProfile:Array.from({length:4},(o,u)=>[e.getFloat64(128+u*16,t),e.getFloat64(136+u*16,t)]),captureIntervalNs:e.getBigUint64(192,t),copyTimeNs:e.getBigUint64(200,t),received:e.getUint32(208,t),droppedBusy:e.getUint32(212,t),droppedMetadata:e.getUint32(216,t),motion:a>=3?{flags:e.getUint32(256,t),accuracy:e.getUint32(260,t),timestampNs:e.getBigUint64(264,t),gapNs:e.getBigUint64(272,t),rollingSkewNs:e.getBigUint64(280,t),worldFromDevice:Array.from({length:4},(o,u)=>e.getFloat32(288+u*4,t)),cameraFromDevice:Array.from({length:4},(o,u)=>e.getFloat32(304+u*4,t)),intrinsics:Array.from({length:5},(o,u)=>e.getFloat32(320+u*4,t)),distortion:Array.from({length:5},(o,u)=>e.getFloat32(340+u*4,t)),exposureTravelRad:e.getFloat32(360,t)}:null,isp:a===4?{flags:e.getUint32(364,t),wb:Array.from({length:4},(o,u)=>e.getFloat32(368+u*4,t)),matrix:Array.from({length:9},(o,u)=>e.getFloat32(384+u*4,t)),neutral:Array.from({length:3},(o,u)=>e.getFloat32(420+u*4,t)),mapWidth:e.getUint32(432,t),mapHeight:e.getUint32(436,t),shading:new Float32Array(i,s+l,d/4),active:Array.from({length:4},(o,u)=>e.getFloat32(444+u*4,t)),maxAnalogIso:e.getUint32(464,t),imageCallbackNs:e.getBigUint64(468,t),resultCallbackNs:e.getBigUint64(476,t),rotationTimestampNs:e.getBigUint64(484,t),rotationQuaternion:Array.from({length:4},(o,u)=>e.getFloat32(492+u*4,t)),rotationAccuracy:e.getUint32(508,t)}:null};if(n.format!==32||n.width<2||n.height<2||((n.width|n.height|n.cropX|n.cropY)&1)!==0)throw new Error("Expected an even-aligned RAW_SENSOR Bayer crop");if(n.rowStride!==n.width*2||n.pixelStride!==2||l!==n.width*n.height*2)throw new Error("Expected tightly packed RAW16");if(n.cropX+n.width>n.sensorWidth||n.cropY+n.height>n.sensorHeight||n.cfa>3)throw new Error("Invalid sensor crop or unsupported CFA");if(n.exposureNs===0n||n.iso===0||n.whiteLevel>65535||n.black.some(o=>!Number.isFinite(o)||o<0||o>=n.whiteLevel))throw new Error("Invalid RAW exposure/ISO/black/white metadata");if(n.flags&se&&n.noiseProfile.some(o=>o.some(u=>!Number.isFinite(u)||u<0)))throw new Error("Invalid sensor noise profile");if(n.isp){const o=n.isp;if(o.flags&1&&o.wb.some(u=>!Number.isFinite(u)||u<=0||u>64))throw new Error("Invalid ISP white balance");if(o.flags&2&&o.matrix.some(u=>!Number.isFinite(u)||Math.abs(u)>64))throw new Error("Invalid ISP matrix");if(d&&(o.mapWidth<2||o.mapHeight<2||o.mapWidth>64||o.mapHeight>64||d!==o.mapWidth*o.mapHeight*16||o.shading.some(u=>!Number.isFinite(u)||u<1||u>64)))throw new Error("Invalid lens shading map");if(o.flags&4&&(!d||o.active.some(u=>!Number.isFinite(u))||o.active[2]<=1||o.active[3]<=1))throw new Error("Invalid shading geometry")}return n}class ve{frames=0;exposureNs=0n;firstTimestampNs=null;lastTimestampNs=null;reference=null;accept(r){if((r.flags&(pe|ge))!==(pe|ge))throw new Error("Static experiment requires timestamp-matched actual metadata and manual capture");const e=[r.width,r.height,r.sensorWidth,r.sensorHeight,r.cropX,r.cropY,r.cfa,r.sensorOrientation,r.exposureNs,r.iso].join("/");if(this.reference!==null&&this.reference!==e)throw new Error("Actual exposure, ISO or Bayer geometry changed. Stop and reset before accumulating a new series.");if(this.lastTimestampNs!==null&&r.timestampNs<=this.lastTimestampNs)throw new Error("Non-increasing sensor timestamp");this.reference=e,this.firstTimestampNs??=r.timestampNs,this.lastTimestampNs=r.timestampNs,this.frames++,this.exposureNs+=r.exposureNs}get elapsedSeconds(){return this.firstTimestampNs===null||this.lastTimestampNs===null?0:Number(this.lastTimestampNs-this.firstTimestampNs)/1e9}get fps(){return this.frames>1?(this.frames-1)/this.elapsedSeconds:0}}const je=`
struct Params {
  dims: vec4<u32>,
  black: vec4<f32>,
  white: vec4<f32>,
  mapDims: vec4<u32>,
  sensorArea: vec4<f32>,
  crop: vec4<f32>,
  calibration: vec4<u32>,
}
@group(0) @binding(0) var<storage, read> rawWords: array<u32>;
@group(0) @binding(1) var<storage, read_write> means: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> m2: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> counts: array<f32>;
@group(0) @binding(4) var<uniform> p: Params;
@group(0) @binding(5) var<storage, read> shading: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> dark: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> gains: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read> bad: array<u32>;

fn shadeAt(point:vec2<u32>, channel:u32) -> f32 {
  let uv=clamp((vec2<f32>(point)+p.crop.xy-p.sensorArea.xy)/max(p.sensorArea.zw-vec2<f32>(1),vec2<f32>(1)),vec2<f32>(0),vec2<f32>(1));
  let grid=uv*vec2<f32>(p.mapDims.xy-vec2<u32>(1));
  let a=vec2<u32>(floor(grid));let b=min(a+vec2<u32>(1),p.mapDims.xy-vec2<u32>(1));let f=fract(grid);
  return mix(mix(shading[a.y*p.mapDims.x+a.x][channel],shading[a.y*p.mapDims.x+b.x][channel],f.x),mix(shading[b.y*p.mapDims.x+a.x][channel],shading[b.y*p.mapDims.x+b.x][channel],f.x),f.y);
}

// G1 is the green on an even sensor row; G2 is the green on an odd row.
fn canonical(v: vec4<f32>, cfa: u32) -> vec4<f32> {
  if (cfa == 0u) { return v; }      // RGGB
  if (cfa == 1u) { return v.yxwz; } // GRBG
  if (cfa == 2u) { return v.zxwy; } // GBRG
  return v.wyzx;                   // BGGR
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let ow = p.dims.x / 2u;
  let oh = p.dims.y / 2u;
  if (id.x >= ow || id.y >= oh) { return; }
  let x = id.x * 2u;
  let y = id.y * 2u;
  // Two aligned uint32 reads for four RAW16 photosites.
  let top = rawWords[(y * p.dims.z + x * 2u) / 4u];
  let bottom = rawWords[((y + 1u) * p.dims.z + x * 2u) / 4u];
  let raw = vec4<f32>(f32(top & 65535u), f32(top >> 16u), f32(bottom & 65535u), f32(bottom >> 16u));
  // Reject the entire quad when any photosite is physically saturated.
  // Signed DN in a fixed unit. No floor, nominal-ISO scale, or per-frame white normalization.
  let i = id.y * ow + id.x;
  var z = canonical(raw - p.black, p.dims.w);
  if (p.calibration.x==1u) { z-=dark[i]; }
  var correction=vec4<f32>(1);
  if (p.calibration.y==1u) {
    var offsets=array<vec2<u32>,4>(vec2<u32>(x,y),vec2<u32>(x+1u,y),vec2<u32>(x,y+1u),vec2<u32>(x+1u,y+1u));
    var order=vec4<u32>(0,1,2,3);
    if(p.dims.w==1u){order=vec4<u32>(1,0,3,2);}else if(p.dims.w==2u){order=vec4<u32>(2,0,3,1);}else if(p.dims.w==3u){order=vec4<u32>(3,1,2,0);}
    correction=vec4<f32>(shadeAt(offsets[order.x],0u),shadeAt(offsets[order.y],1u),shadeAt(offsets[order.z],2u),shadeAt(offsets[order.w],3u));
  }
  gains[i]=correction;
  if (any(raw >= vec4<f32>(p.white.x)) || (p.calibration.x==1u && bad[i]!=0u)) { return; }
  z*=correction;
  let n = counts[i];
  if (n == 0.0) {
    means[i] = z;
    m2[i] = vec4<f32>(0.0);
    counts[i] = 1.0;
    return;
  }
  let total = n + 1.0;
  let delta = z - means[i];
  let nextMean = means[i] + delta / total;
  m2[i] = m2[i] + delta * (z - nextMean);
  means[i] = nextMean;
  counts[i] = total;
}
`,Ye=`
@vertex fn main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
`,Ve=`
struct ViewParams {
  dims: vec4<f32>,
  controls: vec4<f32>,
  wb:vec4<f32>,
  row0:vec4<f32>,row1:vec4<f32>,row2:vec4<f32>,
}
@group(0) @binding(0) var<storage, read> means: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> m2: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> counts: array<f32>;
@group(0) @binding(3) var<uniform> vp: ViewParams;

@fragment fn main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let x = min(u32(pos.x / vp.dims.x * vp.dims.z), u32(vp.dims.z) - 1u);
  let y = min(u32(pos.y / vp.dims.y * vp.dims.w), u32(vp.dims.w) - 1u);
  let i = y * u32(vp.dims.z) + x;
  let n = counts[i];
  var cfa = means[i];
  if (vp.controls.y > 0.5) {
    // Sample temporal standard deviation, not spatial texture or uncertainty of the mean.
    cfa = select(vec4<f32>(0.0), sqrt(max(m2[i], vec4<f32>(0.0)) / max(n - 1.0, 1.0)), n > 1.0);
  }
  if(n==0.0 && vp.controls.y<0.5) {
    // Display-only repair of masked quads. Missing data still has zero evidence in all statistics.
    var sum=vec4<f32>(0);var valid=0.0;
    for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
      let q=vec2<i32>(i32(x)+dx,i32(y)+dy);
      if(any(q<vec2<i32>(0))||any(q>=vec2<i32>(vp.dims.zw))){continue;}
      let j=u32(q.y)*u32(vp.dims.z)+u32(q.x);
      if(counts[j]>0){sum+=means[j];valid+=1;}
    }}
    cfa=sum/max(valid,1.0);
  }
  var rgb:vec3<f32>;
  let white=select(vec4<f32>(1),vp.wb,vp.controls.z>0.5);
  if(vp.controls.y>0.5){
    let v=cfa*cfa*white*white;
    let sensor=vec3<f32>(v.x,(v.y+v.z)*0.25,v.w);
    rgb=sqrt(sensor);
    if(vp.controls.z>0.5){rgb=sqrt(max(vec3<f32>(dot(vp.row0.xyz*vp.row0.xyz,sensor),dot(vp.row1.xyz*vp.row1.xyz,sensor),dot(vp.row2.xyz*vp.row2.xyz,sensor)),vec3<f32>(0)));}
  }else{
    cfa*=white;
    rgb=vec3<f32>(cfa.x,(cfa.y+cfa.z)*0.5,cfa.w);
    if(vp.controls.z>0.5){rgb=vec3<f32>(dot(vp.row0.xyz,rgb),dot(vp.row1.xyz,rgb),dot(vp.row2.xyz,rgb));}
  }
  rgb=max(rgb*vp.controls.x,vec3<f32>(0));
  if(vp.controls.w>0.5){
    let luminance=dot(rgb,vec3<f32>(0.2126,0.7152,0.0722));
    rgb*=log(1+4*luminance)/log(5.0)/max(luminance,1e-6);
  }
  rgb=clamp(rgb,vec3<f32>(0),vec3<f32>(1));
  rgb=select(12.92*rgb,1.055*pow(rgb,vec3<f32>(1.0/2.4))-vec3<f32>(0.055),rgb>vec3<f32>(0.0031308));
  return vec4<f32>(rgb, 1.0);
}
`,Ke=`
struct State { mean: vec4<f32>, moment: vec4<f32>, quality: vec4<f32> }
struct Params {
  dims: vec4<u32>,
  r0: vec4<f32>, r1: vec4<f32>, r2: vec4<f32>,
  currentK: vec4<f32>, oldK: vec4<f32>, skew: vec4<f32>,
  currentD: vec4<f32>, oldD: vec4<f32>, extra: vec4<f32>,
  noiseS: vec4<f32>, noiseO: vec4<f32>,
}
@group(0) @binding(0) var<storage, read> samples: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> valid: array<f32>;
@group(0) @binding(2) var<storage, read> previous: array<State>;
@group(0) @binding(3) var<storage, read_write> next: array<State>;
@group(0) @binding(4) var<uniform> p: Params;
@group(0) @binding(5) var<storage, read> calibrationGains: array<vec4<f32>>;

fn empty() -> State { return State(vec4<f32>(0),vec4<f32>(0),vec4<f32>(0)); }
fn rgb(i: u32) -> vec3<f32> {
  let v=samples[i]; return vec3<f32>(v.x,(v.y+v.z)*0.5,v.w);
}
fn variance(v: vec3<f32>, i:u32) -> vec3<f32> {
  let c=max(vec4<f32>(v.x,v.y,v.y,v.z),vec4<f32>(0));
  let g=calibrationGains[i];
  let noise=p.noiseS*c*g+p.noiseO*g*g;
  return max(vec3<f32>(noise.x,(noise.y+noise.z)*0.25,noise.w),vec3<f32>(0.0833333));
}
fn frameVariance(s: State, i:u32) -> vec3<f32> {
  let denominator=s.mean.w-s.moment.w/max(s.mean.w,1e-6);
  if (denominator>0.01) { return max(s.moment.xyz/denominator,vec3<f32>(0)); }
  return variance(s.mean.xyz,i);
}
fn meanVariance(s: State, i:u32) -> vec3<f32> {
  return frameVariance(s,i)*s.moment.w/max(s.mean.w*s.mean.w,1e-6);
}
fn distort(v: vec2<f32>, d: vec4<f32>, k5: f32) -> vec2<f32> {
  let r=dot(v,v); let radial=1.0+r*(d.x+r*(d.y+r*d.z));
  return v*radial+vec2<f32>(2*d.w*v.x*v.y+k5*(r+2*v.x*v.x),2*k5*v.x*v.y+d.w*(r+2*v.y*v.y));
}
fn unproject(pixel: vec2<f32>) -> vec2<f32> {
  let y=(pixel.y-p.currentK.w)/p.currentK.y;
  return vec2<f32>((pixel.x-p.currentK.z-p.skew.x*y)/p.currentK.x,y);
}
fn warp(pixel: vec2<f32>) -> vec2<f32> {
  let observed=unproject(pixel);
  var v=observed;
  // Fixed-point inverse Brown-Conrady; reject failures rather than sampling unrelated history.
  for (var i=0u;i<8u;i++) { v+=observed-distort(v,p.currentD,p.extra.x); }
  if (!all(abs(v)<vec2<f32>(10)) || length((distort(v,p.currentD,p.extra.x)-observed)*p.currentK.xy)>0.25) {
    return vec2<f32>(-1e6);
  }
  let ray=vec3<f32>(v,1);
  let old=vec3<f32>(dot(p.r0.xyz,ray),dot(p.r1.xyz,ray),dot(p.r2.xyz,ray));
  if (!(old.z>1e-5)) { return vec2<f32>(-1e6); }
  let distorted=distort(old.xy/old.z,p.oldD,p.extra.y);
  return vec2<f32>(p.oldK.x*distorted.x+p.skew.y*distorted.y+p.oldK.z,p.oldK.y*distorted.y+p.oldK.w);
}
fn sampleHistory(pixel: vec2<f32>) -> State {
  if (!all(pixel>=vec2<f32>(0)) || !all(pixel<=vec2<f32>(p.dims.xy)-vec2<f32>(1))) { return empty(); }
  let rounded=round(pixel);
  if (all(abs(pixel-rounded)<vec2<f32>(0.0001))) {
    return previous[u32(rounded.y)*p.dims.x+u32(rounded.x)];
  }
  let origin=vec2<i32>(floor(pixel)); let f=fract(pixel);
  var mean=vec3<f32>(0); var noise=vec3<f32>(0); var evidence=1e9; var confidence=1.0;
  for (var y=0;y<2;y++) { for (var x=0;x<2;x++) {
    let alpha=select(1-f.x,f.x,x==1)*select(1-f.y,f.y,y==1);
    if (alpha<0.00001) { continue; }
    let q=origin+vec2<i32>(x,y);
    if (any(q<vec2<i32>(0)) || any(q>=vec2<i32>(p.dims.xy))) { return empty(); }
    let s=previous[u32(q.y)*p.dims.x+u32(q.x)];
    if (s.mean.w<=0 || s.moment.w<=0) { return empty(); }
    mean+=alpha*s.mean.xyz;
    // Conservative evidence and frame noise. Spatial contrast never enters temporal M2.
    evidence=min(evidence,s.mean.w*s.mean.w/s.moment.w);
    noise=max(noise,frameVariance(s,u32(q.y)*p.dims.x+u32(q.x)));
    confidence=min(confidence,s.quality.x);
  }}
  evidence=min(evidence,32.0); // Repeated interpolation creates correlated estimates, not new observations.
  return State(vec4<f32>(mean,evidence),vec4<f32>(noise*max(evidence-1,0.0),evidence),vec4<f32>(confidence*0.8,0,0,0));
}
fn projected(pixel: vec2<f32>) -> State { return sampleHistory(warp(pixel)); }
fn fresh(value: vec3<f32>, gate: f32, z: f32) -> State {
  return State(vec4<f32>(value,1),vec4<f32>(0,0,0,1),vec4<f32>(select(0.0,0.25,p.dims.w==1u),gate,z,0));
}

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy>=p.dims.xy)) { return; }
  let i=id.y*p.dims.x+id.x;
  if (valid[i]<=0) { next[i]=empty(); return; }
  let value=rgb(i);
  if (p.dims.z==0u) { next[i]=fresh(value,1,0); return; }
  var history=projected(vec2<f32>(id.xy));
  if (history.mean.w<=0) { next[i]=fresh(value,1,0); return; }
  var residual=vec3<f32>(0); var incomingNoise=vec3<f32>(0); var historyNoise=vec3<f32>(0);
  var warpNoise=vec3<f32>(0); var n=0.0;
  var positive=vec3<f32>(0);var negative=vec3<f32>(0);
  // A spatial patch provides evidence of coherent mismatch; isolated dark photons are legitimate samples.
  for (var dy=-1;dy<=1;dy++) { for (var dx=-1;dx<=1;dx++) {
    let q=vec2<i32>(id.xy)+vec2<i32>(dx,dy);
    if (any(q<vec2<i32>(0)) || any(q>=vec2<i32>(p.dims.xy))) { continue; }
    let qi=u32(q.y)*p.dims.x+u32(q.x);
    if (valid[qi]<=0) { continue; }
    let old=projected(vec2<f32>(q));
    if (old.mean.w<=0) { continue; }
    let difference=rgb(qi)-old.mean.xyz;
    residual+=difference;
    incomingNoise+=variance(old.mean.xyz,qi);
    historyNoise=max(historyNoise,meanVariance(old,qi));
    // Local signal variation bounds registration error; this term is not accumulated as sensor noise.
    let gradient=old.mean.xyz-history.mean.xyz;
    warpNoise=max(warpNoise,gradient*gradient*p.extra.z*p.extra.z);
    let supportThreshold=0.5*sqrt(variance(old.mean.xyz,qi)+meanVariance(old,qi)+gradient*gradient*p.extra.z*p.extra.z);
    positive+=select(vec3<f32>(0),vec3<f32>(1),difference>supportThreshold);
    negative+=select(vec3<f32>(0),vec3<f32>(1),difference< -supportThreshold);
    n+=1;
  }}
  var z=0.0;
  if (n>=min(3.0,f32(p.dims.x*p.dims.y))) {
    let support=select(negative,positive,residual>=vec3<f32>(0));
    let normalized=select(vec3<f32>(0),abs(residual/n)/sqrt(max(incomingNoise/(n*n)+historyNoise+warpNoise,vec3<f32>(1e-5))),support>=vec3<f32>(min(3.0,n)));
    z=max(normalized.x,max(normalized.y,normalized.z));
  } else { next[i]=fresh(value,1,0); return; }
  if (z>=4.0) { next[i]=fresh(value,3,z); return; }
  var confidence=min(1.0,history.quality.x+0.125);
  var gate=0.0;
  var factor=1.0;
  if (z>=2.0) { factor=0.5; confidence=history.quality.x*0.5; gate=2; }
  // Cap old evidence before merging to keep f32 responsive and reject stale histories promptly.
  factor*=min(1.0,p.extra.w/max(history.mean.w,1.0));
  let weight=history.mean.w*factor;
  let moment=history.moment.xyz*factor;
  let q=history.moment.w*factor*factor;
  let total=weight+1;
  let delta=value-history.mean.xyz;
  let mean=history.mean.xyz+delta/total;
  next[i]=State(vec4<f32>(mean,total),vec4<f32>(moment+delta*(value-mean),q+1),vec4<f32>(confidence,gate,z,0));
}
`,Je=`
struct State { mean: vec4<f32>, moment: vec4<f32>, quality: vec4<f32> }
@group(0) @binding(0) var<storage, read> history: array<State>;
@group(0) @binding(1) var<storage, read_write> means: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> m2: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> counts: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i=id.x; if (i>=arrayLength(&history)) { return; }
  let s=history[i];
  let n=s.mean.w*s.mean.w/max(s.moment.w,1e-6);
  let denominator=s.mean.w-s.moment.w/max(s.mean.w,1e-6);
  var moment=vec3<f32>(0);
  if (denominator>0.01) { moment=s.moment.xyz/denominator*max(n-1,0.0); }
  // Compatibility with display-only green averaging. These are RGB, not independent CFA samples.
  means[i]=vec4<f32>(s.mean.x,s.mean.y,s.mean.y,s.mean.z);
  m2[i]=vec4<f32>(moment.x,moment.y,moment.y,moment.z);
  counts[i]=n;
}
`,Xe=[1,0,0,0,1,0,0,0,1];function ye(i,r){return Array.from({length:9},(e,t)=>{const a=Math.floor(t/3),s=t%3;return i[a*3]*r[s]+i[a*3+1]*r[3+s]+i[a*3+2]*r[6+s]})}function xe(i){return[i[0],i[3],i[6],i[1],i[4],i[7],i[2],i[5],i[8]]}function we(i){const r=Math.hypot(...i);if(i.length!==4||!i.every(Number.isFinite)||r<.5||r>1.5)throw new Error("Invalid orientation quaternion");const[e,t,a,s]=i.map(l=>l/r);return[1-2*t*t-2*a*a,2*e*t-2*a*s,2*e*a+2*t*s,2*e*t+2*a*s,1-2*e*e-2*a*a,2*t*a-2*e*s,2*e*a-2*t*s,2*t*a+2*e*s,1-2*e*e-2*t*t]}function Qe(i,r){const e=r.motion,t={reuse:!1,reason:"NRAW v3 motion metadata unavailable",rotation:Xe,current:e,previous:i?.metadata??null,reference:null,registrationErrorPx:.35,blurPx:0};if(!e)return t;const a=n=>({...t,reason:n});if(!(e.flags&1))return a("Camera timestamp source UNKNOWN; IMU clocks cannot be matched");if((e.flags&18)!==18||e.accuracy<2||e.accuracy>3||e.gapNs>30000000n)return a("Missing, unreliable or unbracketed IMU samples");if(!(e.flags&4))return a("No calibrated intrinsics for this RAW array layout");if(!(e.flags&8))return a("No calibrated camera-to-IMU orientation");if(!(e.flags&32))return a("Lens distortion calibration unavailable");if(!e.intrinsics.every(Number.isFinite)||e.intrinsics[0]<=0||e.intrinsics[1]<=0||!e.distortion.every(Number.isFinite))return a("Invalid lens calibration");if(!(r.flags&se)||!r.noiseProfile.every(n=>n.every(o=>Number.isFinite(o)&&o>=0)))return a("Noise profile unavailable; photometric history reuse disabled");if(e.timestampNs<r.timestampNs||e.timestampNs>r.timestampNs+r.exposureNs+e.rollingSkewNs)return a("Pose outside exposure interval");if(!Number.isFinite(e.exposureTravelRad)||e.exposureTravelRad<0)return a("Invalid exposure motion");if(t.blurPx=e.exposureTravelRad*Math.max(e.intrinsics[0],e.intrinsics[1]),t.blurPx>1.5)return a("Exposure motion exceeds 1.5 output pixels; show current frame only");let s;try{s=ye(we(e.worldFromDevice),xe(we(e.cameraFromDevice)))}catch{return a("Invalid camera or IMU quaternion")}if(t.reference={worldFromCamera:s,metadata:e,timestampNs:r.timestampNs},!i)return{...t,reason:"New RGB history"};if(r.timestampNs<=i.timestampNs||r.timestampNs-i.timestampNs>2000000000n)return{...t,reason:"Capture gap; history restarted"};if(t.rotation=ye(xe(i.worldFromCamera),s),Math.acos(Math.max(-1,Math.min(1,(t.rotation[0]+t.rotation[4]+t.rotation[8]-1)/2)))>.35)return{...t,reason:"Large rotation; history restarted"};const d=Number(r.exposureNs+e.rollingSkewNs)/1e9;return t.registrationErrorPx+=Number(e.gapNs)/1e9*e.exposureTravelRad/Math.max(d,1e-6)*Math.max(e.intrinsics[0],e.intrinsics[1]),t.registrationErrorPx>1?{...t,reason:"Pose timing uncertainty exceeds one output pixel"}:{...t,reuse:!0,reason:"Rotation + noise-aware validity gate"}}function Ze(i){const r=i.isp,e=r?.matrix,t=e?e[0]*(e[4]*e[8]-e[5]*e[7])-e[1]*(e[3]*e[8]-e[5]*e[6])+e[2]*(e[3]*e[7]-e[4]*e[6]):0,a=!!r&&(r.flags&3)===3&&Number.isFinite(t)&&Math.abs(t)>1e-6;return{calibrated:a,source:a?"CaptureResult gains + transform -> linear sRGB":"uncalibrated sensor RGB",wb:a?r.wb:[1,1,1,1],matrix:a?r.matrix:[1,0,0,0,1,0,0,0,1],neutral:r?.neutral??null}}class ne{constructor(r){this.canvas=r}canvas;device;ctx;rawBuffer;meanBuffer;m2Buffer;countBuffer;paramsBuffer;viewBuffer;shadingBuffer;darkBuffer;badBuffer;gainBuffer;darkProfile=null;darkDirty=!0;calibrationCapture=!1;colorEnabled=!0;toneCurve=!0;color={calibrated:!1,source:"uncalibrated sensor RGB",wb:[1,1,1,1],matrix:[1,0,0,0,1,0,0,0,1],neutral:null};ispStatus=null;computePipeline;renderPipeline;computeBind;renderBind;historyBuffers=[];historyPipeline;historyOutput;historyParams;historyIndex=0;reference=null;mode="static";motionStatus=null;width=0;height=0;outWidth=0;outHeight=0;displayUnit=1;displayGain=2;displayNoise=!1;busy=!1;failure=null;series=new ve;static async create(r){if(!navigator.gpu)throw new Error("WebGPU is unavailable in this Android WebView");const e=new ne(r),t=await navigator.gpu.requestAdapter();if(!t)throw new Error("No WebGPU adapter");if(e.device=await t.requestDevice(),e.device.lost.then(s=>{e.failure=`WebGPU device lost: ${s.message}`}),e.device.addEventListener("uncapturederror",s=>{e.failure=s.error.message}),e.ctx=r.getContext("webgpu"),!e.ctx)throw new Error("No WebGPU canvas context");const a=navigator.gpu.getPreferredCanvasFormat();return e.ctx.configure({device:e.device,format:a,alphaMode:"opaque"}),e.computePipeline=await e.device.createComputePipelineAsync({layout:"auto",compute:{module:e.device.createShaderModule({code:je}),entryPoint:"main"}}),e.historyPipeline=await e.device.createComputePipelineAsync({layout:"auto",compute:{module:e.device.createShaderModule({code:Ke}),entryPoint:"main"}}),e.historyOutput=await e.device.createComputePipelineAsync({layout:"auto",compute:{module:e.device.createShaderModule({code:Je}),entryPoint:"main"}}),e.renderPipeline=await e.device.createRenderPipelineAsync({layout:"auto",vertex:{module:e.device.createShaderModule({code:Ye}),entryPoint:"main"},fragment:{module:e.device.createShaderModule({code:Ve}),entryPoint:"main",targets:[{format:a}]},primitive:{topology:"triangle-list"}}),e}setDisplayGain(r){this.displayGain=r}setDisplayNoise(r){this.displayNoise=r}setColorEnabled(r){this.colorEnabled=r}setToneCurve(r){this.toneCurve=r}setCalibrationCapture(r){if(this.series.frames||this.busy)throw new Error("Reset before calibration capture");this.calibrationCapture=r}setDarkProfile(r){if(this.series.frames||this.busy)throw new Error("Reset before applying a dark profile");this.darkProfile=r,this.darkDirty=!0}setHistoryMode(r){if(this.busy||this.series.frames)throw new Error("Reset before changing the history mode");if(this.mode=r,r==="static"){for(const e of this.historyBuffers)e.destroy();this.historyBuffers=[],this.historyParams?.destroy(),this.historyParams=null}}ensure(r){if(this.series.frames===1&&(this.displayUnit=r.whiteLevel-r.black.reduce((s,l)=>s+l,0)/4,this.color=Ze(r)),this.width===r.width&&this.height===r.height&&(this.mode==="static"||this.historyBuffers.length))return;this.width=r.width,this.height=r.height,this.outWidth=r.width/2,this.outHeight=r.height/2;for(const s of[this.rawBuffer,this.meanBuffer,this.m2Buffer,this.countBuffer,this.paramsBuffer,this.viewBuffer,this.shadingBuffer,this.darkBuffer,this.badBuffer,this.gainBuffer])s?.destroy();for(const s of this.historyBuffers)s.destroy();this.historyParams?.destroy(),this.historyBuffers=[],this.historyIndex=0;const e=globalThis.GPUBufferUsage;this.rawBuffer=this.device.createBuffer({size:r.payload.byteLength,usage:e.STORAGE|e.COPY_DST});const t=this.outWidth*this.outHeight,a=e.STORAGE|e.COPY_SRC|e.COPY_DST;this.meanBuffer=this.device.createBuffer({size:t*16,usage:a}),this.m2Buffer=this.device.createBuffer({size:t*16,usage:a}),this.countBuffer=this.device.createBuffer({size:t*4,usage:a}),this.paramsBuffer=this.device.createBuffer({size:112,usage:e.UNIFORM|e.COPY_DST}),this.viewBuffer=this.device.createBuffer({size:96,usage:e.UNIFORM|e.COPY_DST}),this.shadingBuffer=this.device.createBuffer({size:65536,usage:e.STORAGE|e.COPY_DST}),this.darkBuffer=this.device.createBuffer({size:t*16,usage:e.STORAGE|e.COPY_DST}),this.badBuffer=this.device.createBuffer({size:t*4,usage:e.STORAGE|e.COPY_DST}),this.gainBuffer=this.device.createBuffer({size:t*16,usage:e.STORAGE|e.COPY_DST}),this.darkDirty=!0,this.mode==="rotation"&&(this.historyBuffers=Array.from({length:2},()=>this.device.createBuffer({size:t*48,usage:a})),this.historyParams=this.device.createBuffer({size:192,usage:e.UNIFORM|e.COPY_DST})),this.computeBind=this.device.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries:[this.rawBuffer,this.meanBuffer,this.m2Buffer,this.countBuffer,this.paramsBuffer,this.shadingBuffer,this.darkBuffer,this.gainBuffer,this.badBuffer].map((s,l)=>({binding:l,resource:{buffer:s}}))}),this.renderBind=this.device.createBindGroup({layout:this.renderPipeline.getBindGroupLayout(0),entries:[this.meanBuffer,this.m2Buffer,this.countBuffer,this.viewBuffer].map((s,l)=>({binding:l,resource:{buffer:s}}))})}async reset(){if(this.busy)throw new Error("Wait for the current GPU frame before resetting");if(this.series=new ve,this.reference=null,this.motionStatus=null,this.ispStatus=null,this.darkProfile=null,this.darkDirty=!0,this.calibrationCapture=!1,!this.meanBuffer)return;const r=this.device.createCommandEncoder();for(const e of[this.meanBuffer,this.m2Buffer,this.countBuffer])r.clearBuffer(e);for(const e of this.historyBuffers)r.clearBuffer(e);this.device.queue.submit([r.finish()]),await this.device.queue.onSubmittedWorkDone()}async add(r){if(this.failure)throw new Error(this.failure);if(this.busy)throw new Error("Only one GPU frame may be in flight");this.busy=!0;const e=performance.now();try{this.series.accept(r),this.ensure(r),this.device.queue.writeBuffer(this.rawBuffer,0,r.payload);const t=new ArrayBuffer(112),a=new DataView(t);[r.width,r.height,r.rowStride,r.cfa].forEach((f,m)=>a.setUint32(m*4,f,!0)),r.black.forEach((f,m)=>a.setFloat32(16+m*4,f,!0)),a.setFloat32(32,r.whiteLevel,!0);const s=!this.calibrationCapture&&!!(r.isp&&r.isp.flags&4),l=r.isp,d=(f,m)=>m.forEach((g,h)=>a.setFloat32(f+h*4,g,!0));if(a.setUint32(48,s?l.mapWidth:1,!0),a.setUint32(52,s?l.mapHeight:1,!0),d(64,s?l.active:[0,0,1,1]),d(80,[r.cropX,r.cropY,0,0]),a.setUint32(96,+(!!this.darkProfile&&!this.calibrationCapture),!0),a.setUint32(100,Number(s),!0),this.device.queue.writeBuffer(this.shadingBuffer,0,s?l.shading:new Float32Array([1,1,1,1])),this.darkDirty){const f=this.outWidth*this.outHeight,m=this.calibrationCapture?null:this.darkProfile;if(m&&(m.mean.length!==f*4||m.classes.length!==f*4))throw new Error("Dark map dimensions mismatch");this.device.queue.writeBuffer(this.darkBuffer,0,m?m.mean:new Float32Array(f*4));const g=new Uint32Array(f);if(m)for(let h=0;h<f;h++)for(let x=0;x<4;x++)m.classes[h*4+x]>=2&&(g[h]|=1<<x);this.device.queue.writeBuffer(this.badBuffer,0,g),this.darkDirty=!1}this.ispStatus={color:this.calibrationCapture?"dark calibration (raw DN)":this.color.source,shading:s,dark:this.calibrationCapture?null:this.darkProfile?.key??null,maxAnalogIso:l?.maxAnalogIso??null},this.device.queue.writeBuffer(this.paramsBuffer,0,t);const n=this.device.createCommandEncoder();if(this.mode==="rotation")for(const f of[this.meanBuffer,this.m2Buffer,this.countBuffer])n.clearBuffer(f);const o=n.beginComputePass();o.setPipeline(this.computePipeline),o.setBindGroup(0,this.computeBind),o.dispatchWorkgroups(Math.ceil(this.outWidth/8),Math.ceil(this.outHeight/8)),o.end(),this.mode==="rotation"&&this.mergeHistory(n,r),this.device.queue.submit([n.finish()]),this.render();const u=performance.now()-e;if(await this.device.queue.onSubmittedWorkDone(),this.failure)throw new Error(this.failure);return{submitMs:u,completionMs:performance.now()-e}}finally{this.busy=!1}}mergeHistory(r,e){const t=Qe(this.reference,e);this.reference=t.reference,this.motionStatus={reuse:t.reuse,reason:t.reason,blurPx:t.blurPx};const a=new ArrayBuffer(192),s=new DataView(a);[this.outWidth,this.outHeight,Number(t.reuse),+!!t.reference].forEach((p,D)=>s.setUint32(D*4,p,!0));const l=(p,D)=>D.forEach((L,U)=>s.setFloat32(p+U*4,L,!0));for(let p=0;p<3;p++)l(16+p*16,t.rotation.slice(p*3,p*3+3));const d=p=>p?.length===5&&p.every(Number.isFinite)&&p[0]>0&&p[1]>0?p:[1,1,0,0,0],n=d(t.current?.intrinsics),o=d(t.previous?.intrinsics),u=t.current?.distortion.every(Number.isFinite)?t.current.distortion:[0,0,0,0,0],f=t.previous?.distortion.every(Number.isFinite)?t.previous.distortion:[0,0,0,0,0];l(64,n.slice(0,4)),l(80,o.slice(0,4)),l(96,[n[4],o[4],0,0]),l(112,u.slice(0,4)),l(128,f.slice(0,4)),l(144,[u[4],f[4],t.registrationErrorPx,128]);const m=[[0,1,2,3],[1,0,3,2],[2,0,3,1],[3,1,2,0]][e.cfa];l(160,m.map(p=>e.noiseProfile[p][0]*(e.whiteLevel-e.black[p]))),l(176,m.map(p=>e.noiseProfile[p][1]*(e.whiteLevel-e.black[p])**2)),this.device.queue.writeBuffer(this.historyParams,0,a);const g=1-this.historyIndex,h=this.device.createBindGroup({layout:this.historyPipeline.getBindGroupLayout(0),entries:[this.meanBuffer,this.countBuffer,this.historyBuffers[this.historyIndex],this.historyBuffers[g],this.historyParams,this.gainBuffer].map((p,D)=>({binding:D,resource:{buffer:p}}))}),x=r.beginComputePass();x.setPipeline(this.historyPipeline),x.setBindGroup(0,h),x.dispatchWorkgroups(Math.ceil(this.outWidth/8),Math.ceil(this.outHeight/8)),x.end(),this.historyIndex=g;const y=this.device.createBindGroup({layout:this.historyOutput.getBindGroupLayout(0),entries:[this.historyBuffers[g],this.meanBuffer,this.m2Buffer,this.countBuffer].map((p,D)=>({binding:D,resource:{buffer:p}}))}),S=r.beginComputePass();S.setPipeline(this.historyOutput),S.setBindGroup(0,y),S.dispatchWorkgroups(Math.ceil(this.outWidth*this.outHeight/64)),S.end()}async exportCalibrationStatistics(){if(this.busy||this.mode!=="static"||!this.calibrationCapture)throw new Error("Full-map export requires a completed dark capture");const r=this.outWidth*this.outHeight,e=r*16,t=globalThis.GPUBufferUsage,a=this.device.createBuffer({size:r*36,usage:t.COPY_DST|t.MAP_READ});try{const s=this.device.createCommandEncoder();s.copyBufferToBuffer(this.meanBuffer,0,a,0,e),s.copyBufferToBuffer(this.m2Buffer,0,a,e,e),s.copyBufferToBuffer(this.countBuffer,0,a,e*2,r*4),this.device.queue.submit([s.finish()]),await a.mapAsync(globalThis.GPUMapMode.READ);const l=a.getMappedRange();return{width:this.outWidth,height:this.outHeight,means:new Float32Array(l.slice(0,e)),m2:new Float32Array(l.slice(e,e*2)),counts:new Float32Array(l.slice(e*2))}}finally{a.destroy()}}async readHistoryRegion(r,e,t,a){const s=globalThis.GPUBufferUsage,l=this.device.createBuffer({size:t*a*48,usage:s.COPY_DST|s.MAP_READ});try{const d=this.device.createCommandEncoder();for(let y=0;y<a;y++)d.copyBufferToBuffer(this.historyBuffers[this.historyIndex],((e+y)*this.outWidth+r)*48,l,y*t*48,t*48);this.device.queue.submit([d.finish()]),await l.mapAsync(globalThis.GPUMapMode.READ);const n=new Float32Array(l.getMappedRange()),o=new Float32Array(t*a*3),u=new Float32Array(o.length),f=new Float32Array(t*a);let m=0,g=0,h=0,x=0;for(let y=0;y<f.length;y++){const S=n[y*12+3],p=n[y*12+7],D=p>0?S*S/p:0,L=S-p/Math.max(S,1e-6);f[y]=D,x+=D,m+=n[y*12+8],g+=+(n[y*12+9]===3),h+=+(n[y*12+9]===2);for(let U=0;U<3;U++)o[y*3+U]=n[y*12+U],u[y*3+U]=L>.01?n[y*12+4+U]/L*Math.max(D-1,0):0}return{width:t,height:a,means:o,m2:u,counts:f,channels:["R","G","B"],motion:{confidence:m/f.length,rejected:g/f.length,dubious:h/f.length,effectiveEvidence:x/f.length}}}finally{l.destroy()}}async readRegion(r,e,t=Math.min(16,this.outWidth),a=Math.min(16,this.outHeight)){if(r??=Math.floor((this.outWidth-t)/2),e??=Math.floor((this.outHeight-a)/2),t<1||a<1||t*a>4096||r<0||e<0||r+t>this.outWidth||e+a>this.outHeight)throw new Error("Invalid calibration region");if(this.mode==="rotation")return this.readHistoryRegion(r,e,t,a);const s=t*a*16,l=t*a*4,d=globalThis.GPUBufferUsage,n=this.device.createBuffer({size:s*2+l,usage:d.COPY_DST|d.MAP_READ});try{const o=this.device.createCommandEncoder();for(let f=0;f<a;f++){const m=(e+f)*this.outWidth+r;o.copyBufferToBuffer(this.meanBuffer,m*16,n,f*t*16,t*16),o.copyBufferToBuffer(this.m2Buffer,m*16,n,s+f*t*16,t*16),o.copyBufferToBuffer(this.countBuffer,m*4,n,s*2+f*t*4,t*4)}this.device.queue.submit([o.finish()]),await n.mapAsync(globalThis.GPUMapMode.READ);const u=n.getMappedRange();return{width:t,height:a,means:new Float32Array(u.slice(0,s)),m2:new Float32Array(u.slice(s,s*2)),counts:new Float32Array(u.slice(s*2))}}finally{n.destroy()}}render(){if(!this.renderBind)return;const r=Math.min(devicePixelRatio||1,2),e=Math.max(1,Math.floor(this.canvas.clientWidth*r)),t=Math.max(1,Math.floor(this.canvas.clientHeight*r));(this.canvas.width!==e||this.canvas.height!==t)&&(this.canvas.width=e,this.canvas.height=t);const a=new Float32Array(24);a.set([e,t,this.outWidth,this.outHeight,this.displayGain/this.displayUnit,Number(this.displayNoise),Number(this.colorEnabled&&this.color.calibrated&&!this.calibrationCapture),Number(this.toneCurve)],0),a.set(this.color.wb,8);for(let d=0;d<3;d++)a.set(this.color.matrix.slice(d*3,d*3+3),12+d*4);this.device.queue.writeBuffer(this.viewBuffer,0,a);const s=this.device.createCommandEncoder(),l=s.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:1}}]});l.setPipeline(this.renderPipeline),l.setBindGroup(0,this.renderBind),l.draw(3),l.end(),this.device.queue.submit([s.finish()])}destroy(){if(this.busy)throw new Error("Wait for GPU completion before destroying the accumulator");for(const r of[this.rawBuffer,this.meanBuffer,this.m2Buffer,this.countBuffer,this.paramsBuffer,this.viewBuffer,this.historyParams,this.shadingBuffer,this.darkBuffer,this.badBuffer,this.gainBuffer,...this.historyBuffers])r?.destroy();this.ctx.unconfigure(),this.device.destroy()}}function Ce(i,r){const e=i.channels??["R","G1","G2","B"],t=e.length,a=Array(t).fill(0),s=Array(t).fill(0),l=Array(t).fill(0);let d=0,n=0,o=0;for(let u=0;u<i.counts.length;u++){const f=i.counts[u];if(o+=f,f>0){d++;for(let m=0;m<t;m++)a[m]+=i.means[u*t+m]}if(f>1){n++;for(let m=0;m<t;m++){const g=Math.max(0,i.m2[u*t+m])/(f-1);s[m]+=g,l[m]+=g/f}}}return{region:`${i.width}x${i.height} center Bayer quads`,channels:e,motion:i.motion??null,meanDN:d?a.map(u=>u/d):null,temporalStdDN:n?s.map(u=>Math.sqrt(u/n)):null,standardErrorDN:n?l.map(u=>Math.sqrt(u/n)):null,rejectedQuadFraction:i.motion?null:r?1-o/(i.counts.length*r):0,countMin:Math.min(...i.counts),countMax:Math.max(...i.counts)}}function be(i,r){return["dark-v1",i,r.width,r.height,r.sensorWidth,r.sensorHeight,r.cropX,r.cropY,r.cfa,r.sensorOrientation,String(r.exposureNs),r.iso,r.whiteLevel,r.flags&Se?"dynamic":`static:${r.black.join(",")}`].join("/")}function Be(i){return i.sort((r,e)=>r-e),i[Math.floor(i.length/2)]??0}function et(i,r,e,t){if(t<50)throw new Error("Нужно минимум 50 принятых кадров для калибровки");const a=r.width*r.height/4;if(e.means.length!==a*4||e.m2.length!==a*4||e.counts.length!==a)throw new Error("Размер тёмной карты не совпадает с RAW");const s=e.means,l=new Float32Array(s.length),d=new Uint8Array(s.length),n=[],o=[];for(let h=0;h<4;h++){const x=[],y=[],S=Math.max(1,Math.floor(a/8192));for(let p=0;p<a;p+=S)e.counts[p]>=t*.9&&(x.push(s[p*4+h]),y.push(e.m2[p*4+h]/Math.max(1,e.counts[p]-1)));if(x.length<Math.min(16,a))throw new Error("Слишком много отсутствующих измерений в тёмной серии");n.push(Be(x)),o.push(Be(y))}const u=r.whiteLevel-r.black.reduce((h,x)=>h+x,0)/4;if(n.some(h=>h>u*.1))throw new Error("Серия слишком яркая для dark-калибровки. Полностью закройте объектив.");let f=0,m=0,g=0;for(let h=0;h<s.length;h++){const x=h%4,y=e.counts[Math.floor(h/4)],S=e.m2[h]/Math.max(1,y-1);l[h]=S,y<t*.9||!Number.isFinite(s[h])||!Number.isFinite(S)||S>Math.max(4,o[x]*9)?(d[h]=3,g++):s[h]-n[x]>Math.max(8,8*Math.sqrt(o[x]))?(d[h]=2,m++):Math.abs(s[h]-n[x])>Math.max(1,3*Math.sqrt(o[x]/t))&&(d[h]=1,f++)}if((m+g)/s.length>.05)throw new Error("Более 5% нестабильных/горячих измерений: профиль не применён");return{key:i,createdAt:new Date().toISOString(),frames:t,mean:s,variance:l,classes:d,width:r.width,height:r.height,whiteLevel:r.whiteLevel,summary:{biased:f,hot:m,unstable:g,medianDN:n,medianVariance:o}}}async function tt(){return new Promise((i,r)=>{const e=indexedDB.open("nightfield-calibration",1);e.onupgradeneeded=()=>e.result.createObjectStore("dark",{keyPath:"key"}),e.onsuccess=()=>i(e.result),e.onerror=()=>r(e.error)})}async function ee(i,r,e){const t=await tt();try{return await new Promise((a,s)=>{const l=t.transaction("dark",i==="get"?"readonly":"readwrite"),d=l.objectStore("dark"),n=i==="get"?d.get(r):i==="put"?d.put(e):d.delete(r);let o=null;n.onsuccess=()=>{i==="get"&&(o=n.result??null)},l.oncomplete=()=>a(o),l.onerror=()=>s(l.error),l.onabort=()=>s(l.error??new Error("Calibration storage aborted"))})}finally{t.close()}}const c=i=>document.getElementById(i),rt=c("view"),$=c("status"),Ne=c("log"),Ae=c("stats"),A=c("exposure"),P=c("iso"),O=c("gain"),ke=c("duration"),oe=c("display"),F=c("cameraSelect"),Me=c("historyMode"),X=c("colorMode"),Q=c("toneMode"),K=c("darkCovered"),Pe=c("applyDark"),Ee=c("start"),De=c("stop"),Re=c("reset"),ze=c("export");let w=null,j=null,v=null,z=!1,R=!1,I=!1,J=!1,k=!1,G=!1,Ue,Y,te=null,Fe="",ce="",_=[],V=0;const qe=(i,r)=>typeof r=="bigint"?r.toString():r;let C=null,Z=0,re=0,le=null,ue=0,de=[],q="static",ie="",M=!1,ae=!1,b=null,fe=null;const $e=i=>({key:i.key,createdAt:i.createdAt,frames:i.frames,summary:i.summary,width:i.width,height:i.height});let W=null,me=null;function it(i){i!==ie&&(B(`Motion history: ${i}`),ie=i)}function B(i){Ne.textContent=`${new Date().toLocaleTimeString()} ${i}
${Ne.textContent}`.slice(0,6e3)}function N(){const i=z||R||J||k||G;Ee.disabled=i||!v?.manual||v.cfa>3,De.disabled=!z&&!R,Re.disabled=i,ze.disabled=i||!w?.series.frames,A.disabled=P.disabled=ke.disabled=F.disabled=Me.disabled=i,Pe.disabled=K.disabled=i,c("captureDark").disabled=i||!K.checked||!v?.manual,c("deleteDark").disabled=i||!b,document.querySelectorAll("[data-iso]").forEach(r=>r.disabled=i||!v),c("recordIndicator").classList.toggle("active",z)}async function Oe(){return j||(j=ne.create(rt).then(i=>(w=i,i.setDisplayGain(Number(O.value)),i.setDisplayNoise(oe.value==="noise"),i.setColorEnabled(X.value==="camera"),i.setToneCurve(Q.value==="day"),i)).catch(i=>{throw j=null,i})),j}function he(){Fe=new Date().toISOString(),ce="",_=[],V=0,C=null,Z=0,re=0,le=null,ue=0,de=[],ie="",ae=!1,W=null,me=null,fe=null,Ae.textContent="",c("framesHud").textContent="0000",c("timer").textContent="00:00:00"}function T(i){if(!z&&!R)return;const r=z||I;ce=i,z=R=!1,J=r,I=!1,clearTimeout(Ue),clearInterval(Y),r&&E.stop(),$.textContent=r?"stopping":"stopped",B(i),N()}function Te(){const i=e=>e?e.map(t=>t.toFixed(3)).join(" / "):"need 2+ observations",r=C?[`Center ROI at frame ${Z} · ${C.channels.join(" / ")}`,`signed mean DN: ${i(C.meanDN)}`,`temporal std DN: ${i(C.temporalStdDN)}`,`estimated std(mean) DN*: ${i(C.standardErrorDN)}`,C.motion?`RGB history · confidence ${C.motion.confidence.toFixed(2)} · effective evidence ${C.motion.effectiveEvidence.toFixed(1)} · rejected ${(100*C.motion.rejected).toFixed(1)}%`:`ROI rejected quad samples (saturation / mask): ${(100*(C.rejectedQuadFraction??0)).toFixed(2)}%`,C.motion?"* Reprojected effective evidence is approximate, not a calibrated confidence interval.":"* Assumes independent stationary noise; no motion compensation."]:[];Ae.textContent=[...de,...r].join(`
`)}const E=new Ge;E.onEvent=i=>{if(i.type==="capabilities"){G=!1,v=i.selected??null;const r=Array.isArray(i.cameras)?i.cameras:[];F.replaceChildren(...r.filter(e=>e.raw).map(e=>{const t=e.facing===1?"задняя":e.facing===0?"фронтальная":"другая",a=new Option(`${e.id} · ${t}${e.manual?"":" · без ручного режима"}`,e.id);return a.selected=e.id===v?.id,a})),F.options.length||F.add(new Option("RAW-камера не найдена","")),$.textContent=v?.manual&&v.cfa<=3?"RAW ready":"manual Bayer RAW required",v?(c("analogHint").textContent=v.maxAnalogIso?`Аналоговый предел ISO ${v.maxAnalogIso}. Выше возможно цифровое усиление.`:"Аналоговый предел ISO не сообщён камерой.",c("cameraHud").textContent=`ID ${v.id} · ${v.cropSize}`,A.min=String(Math.max(1,Math.ceil(v.exposureMinNs/1e6))),A.max=String(Math.max(Number(A.min),Math.min(2e3,Math.floor(v.exposureMaxNs/1e6)))),A.value=String(Math.max(Number(A.min),Math.min(Number(A.max),250))),P.min=String(v.isoMin),P.max=String(v.isoMax),P.step="1",P.value=String(Math.max(v.isoMin,Math.min(v.isoMax,800))),H(),B(`camera ${v.id}: RAW ${v.rawSize}, crop ${v.cropSize}, CFA ${v.cfa}`),B(`RAW minimum frame ${(v.minFrameDurationNs/1e6).toFixed(1)} ms; output stall ${(v.stallDurationNs/1e6).toFixed(1)} ms`)):B(String(i.error??"No RAW camera"))}else if(i.type==="started"){if(!R){E.stop();return}R=!1,I=!1,z=!0,$.textContent="REC · RAW";const r=performance.now();clearInterval(Y),Y=setInterval(()=>{const t=Math.floor((performance.now()-r)/1e3);c("timer").textContent=[Math.floor(t/3600),Math.floor(t/60)%60,t%60].map(a=>String(a).padStart(2,"0")).join(":")},250),B(`requested: ${JSON.stringify(i)}`);const e=Number(ke.value);e&&!M&&(Ue=setTimeout(()=>T(`${e}-second observation window finished`),e*1e3))}else i.type==="stopped"?(z=R=J=I=!1,clearInterval(Y),le=i,M&&(w?.series.frames??0)<64&&(c("darkStatus").textContent=`Dark-серия прервана: ${w?.series.frames??0} / 64. Профиль не сохранён.`),k||($.textContent="stopped"),B(`native totals: ${JSON.stringify(i)}`)):i.type==="cameraInfo"?(te=i,c("cameraInfo").textContent=JSON.stringify(i,null,2),c("cameraInfoStatus").textContent=`Получено камер: ${Array.isArray(i.cameras)?i.cameras.length:0}. Отсутствующие значения зависят от устройства и разрешений.`,c("requestCamera").disabled=!1,c("saveCamera").disabled=!1):i.type==="cameraInfoError"?(c("cameraInfoStatus").textContent=`Ошибка запроса: ${String(i.message)}`,c("requestCamera").disabled=!1):i.type==="error"?(G=!1,T("Capture stopped after an error"),J=!1,$.textContent="error",B(`ERROR: ${String(i.message)}`)):B(JSON.stringify(i));N()};E.onBinary=async i=>{const r=i.byteLength>=48?new DataView(i).getUint32(44,!0):0;if(!z){E.ack(r);return}if(k){T("Overlapping RAW packet"),E.ack(r);return}k=!0,N();try{const e=Le(i),t=await Oe();if(!ae){const g=be(v?.id??"",e);if(b=null,!M&&Pe.checked)try{b=await ee("get",g)}catch(h){B(`Dark profile unavailable: ${String(h)}`)}t.setDarkProfile(b),ae=!0,fe=b?$e(b):null,c("darkStatus").textContent=M?"Dark-серия: 0 / 64":b?`Профиль ISO ${e.iso}, ${Number(e.exposureNs)/1e6} ms: ${b.createdAt}, ${b.frames} кадров`:"Совпадающий профиль не найден или выключен.",M&&(W={...e,buffer:new ArrayBuffer(0),payload:new Uint8Array(0),isp:null,motion:null})}const a=await t.add(e);if(t.motionStatus){const g=t.motionStatus.reason;c("historyHint").textContent=t.motionStatus.reuse?"Компенсация вращения · история накапливается":g.includes("UNKNOWN")?"Часы камеры не синхронизированы с датчиками · только текущий кадр":g.includes("Exposure motion")?"Движение во время выдержки · история сброшена":g==="New RGB history"?"Начало новой RGB-истории":"Перенос истории недоступен · причина в диагностике",it(t.motionStatus.reason)}c("framesHud").textContent=String(t.series.frames).padStart(4,"0"),c("exposureHud").textContent=`${Number(e.exposureNs)/1e6} ms`,c("isoHud").textContent=String(e.iso),ue+=i.byteLength;const s=performance.now();let l=0;if(s-re>=1e3||!z||t.series.frames===1){const g=performance.now();C=Ce(await t.readRegion(),t.series.frames),l=performance.now()-g,Z=t.series.frames,re=s}const{buffer:d,payload:n,isp:o,...u}=e,{shading:f,...m}=o??{shading:null};if(o?.shading.length&&(me={width:o.mapWidth,height:o.mapHeight,active:o.active,gains:Array.from(o.shading)}),V<2e6&&_.length<4096){const g={...u,isp:o?m:null,...a,diagnosticReadMs:l,motionHistory:t.motionStatus,ispStatus:t.ispStatus},h=JSON.stringify(g,qe).length;V+h<=2e6&&(_.push(g),V+=h)}if(de=[`${e.width}×${e.height} RAW16 → ${e.width/2}×${e.height/2} CFA quads`,`frame ${e.frameId} · ${t.series.frames} processed (per-quad saturation masks apply)`,`actual ${Number(e.exposureNs)/1e6} ms · ISO ${e.iso}; requested ${Number(e.requestedExposureNs)/1e6} ms / ISO ${e.requestedIso}`,`accepted exposure sum ${(Number(t.series.exposureNs)/1e9).toFixed(3)} s · sensor span ${t.series.elapsedSeconds.toFixed(3)} s`,`delivered ${t.series.fps.toFixed(2)} fps · latest native interval ${(Number(e.captureIntervalNs)/1e6).toFixed(1)} ms`,`stream ${(e.payloadBytes*t.series.fps/1e6).toFixed(2)} MB/s · packet ${(i.byteLength/1048576).toFixed(2)} MiB`,`crop + packet copy ${(Number(e.copyTimeNs)/1e6).toFixed(2)} ms`,`WebGPU submit ${a.submitMs.toFixed(2)} ms · queue completion ${a.completionMs.toFixed(2)} ms (includes display)`,`native acquired ${e.received} · busy drops ${e.droppedBusy} · metadata drops ${e.droppedMetadata}`,`black ${e.flags&Se?"dynamic":"static fallback"} · white ${e.flags&He?"dynamic":"static fallback"} · noise profile ${e.flags&se?"available":"unavailable"}`,`ISP ${t.ispStatus?.color} · shading ${t.ispStatus?.shading?"on":"unavailable/off"} · dark ${t.ispStatus?.dark?"on":"off"}`],Te(),M&&(c("historyHint").textContent=`Dark-калибровка · ${t.series.frames} / 64 · объектив закрыт`,c("darkStatus").textContent=`Dark-серия: ${t.series.frames} / 64`,t.series.frames>=64&&W)){T("Dark calibration completed"),c("darkStatus").textContent="Подготовка полной карты…";const g=await t.exportCalibrationStatistics();await new Promise(h=>setTimeout(h,0)),b=et(be(v?.id??"",W),W,g,t.series.frames),await ee("put",b.key,b),c("darkStatus").textContent=`Профиль сохранён. Смещённых: ${b.summary.biased}, горячих: ${b.summary.hot}, нестабильных: ${b.summary.unstable}. Применится в следующей серии.`,c("historyHint").textContent="Dark-профиль сохранён · откройте объектив перед обычной съёмкой"}}catch(e){T("Capture stopped after a frame error"),M&&(b=null,c("darkStatus").textContent=`Калибровка не сохранена: ${e instanceof Error?e.message:String(e)}`),$.textContent="frame error",B(e instanceof Error?e.message:String(e))}finally{k=!1,E.ack(r),N()}};function H(){c("exposureOut").value=`${A.value} ms`,c("isoOut").value=P.value,c("gainOut").value=`${Number(O.value).toFixed(2)}×`,z||(c("exposureHud").textContent=`${A.value} ms`,c("isoHud").textContent=P.value),c("gainHud").textContent=`${Number(O.value).toFixed(2)}×`,w?.setDisplayGain(Number(O.value)),w?.setDisplayNoise(oe.value==="noise"),w?.setColorEnabled(X.value==="camera"),w?.setToneCurve(Q.value==="day"),w?.render()}A.oninput=P.oninput=O.oninput=oe.onchange=H;X.onchange=Q.onchange=H;K.onchange=N;document.querySelectorAll("[data-iso]").forEach(i=>i.onclick=()=>{A.value=String(Math.min(400,Number(A.max))),P.value=String(Math.max(Number(P.min),Math.min(Number(P.max),Number(i.dataset.iso)))),H()});F.onchange=async()=>{if(!F.value)return;const i=F.value;G=!0,N();try{await w?.reset(),he(),b=null,c("darkStatus").textContent="Профиль будет проверен по первому RAW-кадру.",w?.render(),E.send({type:"selectCamera",id:i})}catch(r){G=!1,F.value=v?.id??"",B(`Camera selection error: ${String(r)}`),N()}};H();N();async function Ie(i=!1){R=!0,k=!0,N();try{const r=await Oe();if(!R||(await r.reset(),!R))return;M=i,q=!i&&Me.value==="rotation"?"rotation":"static",r.setHistoryMode(q),r.setCalibrationCapture(i),c("historyModeHud").textContent=q==="rotation"?"ROTATION":"STATIC",c("historyHint").textContent=q==="rotation"?"Проверка данных движения…":"Установите телефон неподвижно и начните накопление RAW",he(),I=!0,E.start(Math.round(Number(A.value)*1e6),Number(P.value),q==="rotation")}catch(r){R=!1,I=!1,$.textContent="WebGPU error",B(r instanceof Error?r.message:String(r))}finally{k=!1,N()}}Ee.onclick=()=>Ie(!1);c("captureDark").onclick=()=>{K.checked&&(We.close(),Ie(!0))};c("deleteDark").onclick=async()=>{if(b){k=!0,N();try{await ee("delete",b.key),b=null,c("darkStatus").textContent="Профиль удалён. Изменение применяется со следующей серии."}catch(i){B(`Dark deletion failed: ${String(i)}`)}finally{k=!1,N()}}};De.onclick=()=>T("Stopped by user");Re.onclick=async()=>{k=!0,N();try{await w?.reset(),he(),w?.render()}catch(i){B(`Reset error: ${String(i)}`)}finally{k=!1,N()}};ze.onclick=async()=>{if(w?.series.frames){k=!0,N();try{const i=await w.readRegion();C=Ce(i,w.series.frames),Z=w.series.frames,Te();const r={schema:M?"nightfield-dark-v1":q==="rotation"?"nightfield-rotation-v2":"nightfield-static-v2",startedAt:Fe,stopReason:ce,units:M?"signed black-corrected sensor DN (dark calibration)":"signed dark-subtracted, lens-shading-corrected DN where available; no electron calibration",calibrationRun:M,isp:w.ispStatus,lensShadingMap:me,darkProfile:fe,createdDarkProfile:M&&b?$e(b):null,display:{gain:Number(O.value),color:X.value,tone:Q.value},camera:v,frames:w.series.frames,exposureSumNs:w.series.exposureNs,sensorSpanSeconds:w.series.elapsedSeconds,deliveredFps:w.series.fps,totalPacketBytes:ue,nativeStats:le,roi:C,roiData:{width:i.width,height:i.height,channels:i.channels??["R","G1","G2","B"],means:Array.from(i.means),m2:Array.from(i.m2),counts:Array.from(i.counts),evidence:i.motion?"approximate effective N":"accepted observations"},metadata:_,metadataTruncated:w.series.frames>_.length,limitations:[q==="rotation"?"rotation-only; no translation, optical flow or within-exposure deblurring":"static scene assumed","dark calibration may drift with temperature; calibration uncertainty is not included in std(mean)","no gain/exposure mixing","queue completion is not an isolated GPU execution timestamp"]},e=JSON.stringify(r,qe);E.send({type:"saveReport",json:e})}catch(i){B(`Report error: ${String(i)}`)}finally{k=!1,N()}}};window.addEventListener("resize",()=>w?.render());const We=c("settingsDialog"),at=c("infoDialog");c("settingsOpen").onclick=()=>We.showModal();c("infoOpen").onclick=()=>at.showModal();document.querySelectorAll("[data-close]").forEach(i=>{i.onclick=()=>c(i.dataset.close).close()});c("requestCamera").onclick=()=>{if(!window.rawBridge){c("cameraInfoStatus").textContent="Запрос доступен в приложении на Android.";return}c("requestCamera").disabled=!0,c("cameraInfoStatus").textContent="Получение характеристик…",E.send({type:"cameraInfo"})};c("saveCamera").onclick=()=>{te&&E.send({type:"saveReport",json:JSON.stringify(te,null,2)})};
