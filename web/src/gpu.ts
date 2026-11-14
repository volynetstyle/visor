import type { RawFrame } from './raw';

const COMPUTE = /* wgsl */`
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
`;

const VERT = /* wgsl */`
@vertex fn main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0)
  );
  return vec4<f32>(p[i], 0.0, 1.0);
}
`;

const FRAG = /* wgsl */`
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
`;

export class RawAccumulator {
  private device: any;
  private ctx: any;
  private format: string = '';
  private rawBuffer: any;
  private accumBuffer: any;
  private paramsBuffer: any;
  private viewBuffer: any;
  private computePipeline: any;
  private renderPipeline: any;
  private computeBind: any;
  private renderBind: any;
  private width = 0;
  private height = 0;
  private outWidth = 0;
  private outHeight = 0;
  private rawCapacity = 0;
  private refExposureIso = 0;
  private displayGain = 2;

  private constructor(private canvas: HTMLCanvasElement) {}

  static async create(canvas: HTMLCanvasElement): Promise<RawAccumulator> {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable in this Android WebView');
    const self = new RawAccumulator(canvas);
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    self.device = await adapter.requestDevice();
    self.ctx = canvas.getContext('webgpu');
    if (!self.ctx) throw new Error('No WebGPU canvas context');
    self.format = navigator.gpu.getPreferredCanvasFormat();
    self.ctx.configure({ device: self.device, format: self.format, alphaMode: 'opaque' });
    return self;
  }

  setDisplayGain(v: number) {
    this.displayGain = v;
  }

  private ensure(frame: RawFrame) {
    if (this.width === frame.width && this.height === frame.height && this.rawCapacity >= frame.payload.byteLength) return;
    this.width = frame.width;
    this.height = frame.height;
    this.outWidth = frame.width >> 1;
    this.outHeight = frame.height >> 1;
    this.rawCapacity = (frame.payload.byteLength + 3) & ~3;
    this.refExposureIso = 0;

    this.rawBuffer?.destroy?.();
    this.accumBuffer?.destroy?.();
    this.paramsBuffer?.destroy?.();
    this.viewBuffer?.destroy?.();

    const U = (globalThis as any).GPUBufferUsage;
    this.rawBuffer = this.device.createBuffer({ size: this.rawCapacity, usage: U.STORAGE | U.COPY_DST });
    this.accumBuffer = this.device.createBuffer({
      size: this.outWidth * this.outHeight * 16,
      usage: U.STORAGE | U.COPY_DST,
    });
    this.paramsBuffer = this.device.createBuffer({ size: 48, usage: U.UNIFORM | U.COPY_DST });
    this.viewBuffer = this.device.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.device.createShaderModule({ code: COMPUTE }), entryPoint: 'main' },
    });
    this.computeBind = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.rawBuffer } },
        { binding: 1, resource: { buffer: this.accumBuffer } },
        { binding: 2, resource: { buffer: this.paramsBuffer } },
      ],
    });

    this.renderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this.device.createShaderModule({ code: VERT }), entryPoint: 'main' },
      fragment: {
        module: this.device.createShaderModule({ code: FRAG }),
        entryPoint: 'main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.renderBind = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.accumBuffer } },
        { binding: 1, resource: { buffer: this.viewBuffer } },
      ],
    });
    this.reset();
  }

  reset() {
    if (!this.accumBuffer) return;
    this.device.queue.writeBuffer(this.accumBuffer, 0, new Uint8Array(this.outWidth * this.outHeight * 16));
    this.refExposureIso = 0;
  }

  add(frame: RawFrame) {
    this.ensure(frame);
    this.device.queue.writeBuffer(this.rawBuffer, 0, frame.payload);

    const exposureIso = Number(frame.exposureNs) * Math.max(frame.iso, 1);
    if (!this.refExposureIso) this.refExposureIso = exposureIso;
    const scale = this.refExposureIso / Math.max(1, exposureIso);
    const weight = Math.max(0.001, Number(frame.exposureNs) / 1e9);

    const p = new ArrayBuffer(48);
    const d = new DataView(p);
    const le = true;
    d.setUint32(0, frame.width, le);
    d.setUint32(4, frame.height, le);
    d.setUint32(8, frame.rowStride, le);
    d.setUint32(12, frame.cfa, le);
    d.setFloat32(16, frame.whiteLevel, le);
    d.setFloat32(20, frame.black[0], le);
    d.setFloat32(24, frame.black[1], le);
    d.setFloat32(28, frame.black[2], le);
    d.setFloat32(32, frame.black[3], le);
    d.setFloat32(36, scale, le);
    d.setFloat32(40, weight, le);
    d.setFloat32(44, frame.frameId, le);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, p);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.computeBind);
    pass.dispatchWorkgroups(Math.ceil(this.outWidth / 8), Math.ceil(this.outHeight / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.render();
  }

  render() {
    if (!this.renderPipeline) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cssW = Math.max(1, this.canvas.clientWidth);
    const cssH = Math.max(1, this.canvas.clientHeight);
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const vp = new Float32Array([
      w, h, this.outWidth, this.outHeight,
      this.displayGain, 0, 0, 0,
    ]);
    this.device.queue.writeBuffer(this.viewBuffer, 0, vp);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBind);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
