import type { RawFrame } from './raw';
import { StaticSeries } from './series';
import { COMPUTE, FRAG, VERT } from './shaders';

export interface RegionStatistics {
  width: number;
  height: number;
  means: Float32Array;
  m2: Float32Array;
  counts: Float32Array;
}

export class RawAccumulator {
  private device: any;
  private ctx: any;
  private rawBuffer: any;
  private meanBuffer: any;
  private m2Buffer: any;
  private countBuffer: any;
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
  private displayUnit = 1;
  private displayGain = 2;
  private displayNoise = false;
  private busy = false;
  private failure: string | null = null;
  series = new StaticSeries();

  private constructor(private canvas: HTMLCanvasElement) {}

  static async create(canvas: HTMLCanvasElement): Promise<RawAccumulator> {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable in this Android WebView');
    const self = new RawAccumulator(canvas);
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    self.device = await adapter.requestDevice();
    self.device.lost.then((info: any) => { self.failure = `WebGPU device lost: ${info.message}`; });
    self.device.addEventListener('uncapturederror', (event: any) => { self.failure = event.error.message; });
    self.ctx = canvas.getContext('webgpu');
    if (!self.ctx) throw new Error('No WebGPU canvas context');
    const format = navigator.gpu.getPreferredCanvasFormat();
    self.ctx.configure({ device: self.device, format, alphaMode: 'opaque' });
    self.computePipeline = await self.device.createComputePipelineAsync({
      layout: 'auto', compute: { module: self.device.createShaderModule({ code: COMPUTE }), entryPoint: 'main' },
    });
    self.renderPipeline = await self.device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: self.device.createShaderModule({ code: VERT }), entryPoint: 'main' },
      fragment: { module: self.device.createShaderModule({ code: FRAG }), entryPoint: 'main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    return self;
  }

  setDisplayGain(v: number) { this.displayGain = v; }
  setDisplayNoise(v: boolean) { this.displayNoise = v; }

  private ensure(frame: RawFrame) {
    if (this.series.frames === 1) {
      // Frozen display conversion only; persistent state remains in signed, black-corrected DN.
      this.displayUnit = frame.whiteLevel - frame.black.reduce((a, b) => a + b, 0) / 4;
    }
    if (this.width === frame.width && this.height === frame.height) return;
    this.width = frame.width;
    this.height = frame.height;
    this.outWidth = frame.width / 2;
    this.outHeight = frame.height / 2;
    for (const b of [this.rawBuffer, this.meanBuffer, this.m2Buffer, this.countBuffer, this.paramsBuffer, this.viewBuffer]) b?.destroy();
    const U = (globalThis as any).GPUBufferUsage;
    this.rawBuffer = this.device.createBuffer({ size: frame.payload.byteLength, usage: U.STORAGE | U.COPY_DST });
    const quads = this.outWidth * this.outHeight;
    const statisticUsage = U.STORAGE | U.COPY_SRC | U.COPY_DST;
    this.meanBuffer = this.device.createBuffer({ size: quads * 16, usage: statisticUsage });
    this.m2Buffer = this.device.createBuffer({ size: quads * 16, usage: statisticUsage });
    this.countBuffer = this.device.createBuffer({ size: quads * 4, usage: statisticUsage });
    this.paramsBuffer = this.device.createBuffer({ size: 48, usage: U.UNIFORM | U.COPY_DST });
    this.viewBuffer = this.device.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST });
    this.computeBind = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [this.rawBuffer, this.meanBuffer, this.m2Buffer, this.countBuffer, this.paramsBuffer]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.renderBind = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [this.meanBuffer, this.m2Buffer, this.countBuffer, this.viewBuffer]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  }

  async reset() {
    if (this.busy) throw new Error('Wait for the current GPU frame before resetting');
    this.series = new StaticSeries();
    if (!this.meanBuffer) return;
    const encoder = this.device.createCommandEncoder();
    for (const b of [this.meanBuffer, this.m2Buffer, this.countBuffer]) encoder.clearBuffer(b);
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
  }

  async add(frame: RawFrame): Promise<{ submitMs: number; completionMs: number }> {
    if (this.failure) throw new Error(this.failure);
    if (this.busy) throw new Error('Only one GPU frame may be in flight');
    this.busy = true;
    const start = performance.now();
    try {
      this.series.accept(frame);
      this.ensure(frame);
      this.device.queue.writeBuffer(this.rawBuffer, 0, frame.payload);
      const params = new ArrayBuffer(48);
      const d = new DataView(params);
      [frame.width, frame.height, frame.rowStride, frame.cfa].forEach((v, i) => d.setUint32(i * 4, v, true));
      frame.black.forEach((v, i) => d.setFloat32(16 + i * 4, v, true));
      d.setFloat32(32, frame.whiteLevel, true);
      this.device.queue.writeBuffer(this.paramsBuffer, 0, params);
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.computePipeline);
      pass.setBindGroup(0, this.computeBind);
      pass.dispatchWorkgroups(Math.ceil(this.outWidth / 8), Math.ceil(this.outHeight / 8));
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      this.render();
      const submitMs = performance.now() - start;
      // ACK is allowed only after compute and display work have completed.
      await this.device.queue.onSubmittedWorkDone();
      if (this.failure) throw new Error(this.failure);
      return { submitMs, completionMs: performance.now() - start };
    } finally { this.busy = false; }
  }

  /** Read a small calibration patch. Per-pixel temporal statistics never mix spatial texture into variance. */
  async readRegion(x?: number, y?: number, width = Math.min(16, this.outWidth), height = Math.min(16, this.outHeight)): Promise<RegionStatistics> {
    x ??= Math.floor((this.outWidth - width) / 2);
    y ??= Math.floor((this.outHeight - height) / 2);
    if (width < 1 || height < 1 || width * height > 4096 || x < 0 || y < 0 || x + width > this.outWidth || y + height > this.outHeight) {
      throw new Error('Invalid calibration region');
    }
    const meanBytes = width * height * 16;
    const countBytes = width * height * 4;
    const U = (globalThis as any).GPUBufferUsage;
    const staging = this.device.createBuffer({ size: meanBytes * 2 + countBytes, usage: U.COPY_DST | U.MAP_READ });
    try {
      const encoder = this.device.createCommandEncoder();
      for (let row = 0; row < height; row++) {
        const src = (y + row) * this.outWidth + x;
        encoder.copyBufferToBuffer(this.meanBuffer, src * 16, staging, row * width * 16, width * 16);
        encoder.copyBufferToBuffer(this.m2Buffer, src * 16, staging, meanBytes + row * width * 16, width * 16);
        encoder.copyBufferToBuffer(this.countBuffer, src * 4, staging, meanBytes * 2 + row * width * 4, width * 4);
      }
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync((globalThis as any).GPUMapMode.READ);
      const bytes = staging.getMappedRange();
      return {
        width, height,
        means: new Float32Array(bytes.slice(0, meanBytes)),
        m2: new Float32Array(bytes.slice(meanBytes, meanBytes * 2)),
        counts: new Float32Array(bytes.slice(meanBytes * 2)),
      };
    } finally { staging.destroy(); }
  }

  render() {
    if (!this.renderBind) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.device.queue.writeBuffer(this.viewBuffer, 0, new Float32Array([
      w, h, this.outWidth, this.outHeight, this.displayGain / this.displayUnit, Number(this.displayNoise), 0, 0,
    ]));
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }] });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBind);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
