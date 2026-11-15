/** Linear RGB history. W and Q preserve weighted-Welford degrees of freedom. */
export const HISTORY = /* wgsl */`
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
`;

export const HISTORY_OUTPUT = /* wgsl */`
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
`;
