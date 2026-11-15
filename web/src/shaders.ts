export const COMPUTE = /* wgsl */`
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
`;

export const VERT = /* wgsl */`
@vertex fn main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  return vec4<f32>(p[i], 0.0, 1.0);
}
`;

export const FRAG = /* wgsl */`
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
`;
