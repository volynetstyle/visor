export const COMPUTE = /* wgsl */`
struct Params {
  dims: vec4<u32>,
  black: vec4<f32>,
  white: vec4<f32>,
}
@group(0) @binding(0) var<storage, read> rawWords: array<u32>;
@group(0) @binding(1) var<storage, read_write> means: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> m2: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> counts: array<f32>;
@group(0) @binding(4) var<uniform> p: Params;

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
  if (any(raw >= vec4<f32>(p.white.x))) { return; }
  // Signed DN in a fixed unit. No floor, nominal-ISO scale, or per-frame white normalization.
  let z = canonical(raw - p.black, p.dims.w);
  let i = id.y * ow + id.x;
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
  var rgb = vec3<f32>(cfa.x, (cfa.y + cfa.z) * 0.5, cfa.w) * vp.controls.x;
  if (n == 0.0) { rgb = vec3<f32>(0.0); }
  rgb *= vec3<f32>(1.85, 1.0, 1.55); // Display-only approximate white balance.
  rgb = vec3<f32>(1.0) - exp(-max(rgb, vec3<f32>(0.0)));
  rgb = pow(rgb, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(rgb, 1.0);
}
`;
