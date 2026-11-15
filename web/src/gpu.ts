import type { RawFrame } from './raw';
import { StaticSeries } from './series';
import { COMPUTE, FRAG, VERT } from './shaders';
import { HISTORY, HISTORY_OUTPUT } from './history-shader';
import { planMotion, type MotionReference } from './motion';
import {colorProfile} from './isp';
import type {DarkProfile} from './calibration';

export interface RegionStatistics {
  width: number;
  height: number;
  means: Float32Array;
  m2: Float32Array;
  counts: Float32Array;
  channels?: string[];
  motion?: { confidence: number; rejected: number; dubious: number; effectiveEvidence: number };
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
  private shadingBuffer:any;
  private darkBuffer:any;
  private badBuffer:any;
  private gainBuffer:any;
  private darkProfile:DarkProfile|null=null;
  private darkDirty=true;
  private calibrationCapture=false;
  private colorEnabled=true;
  private toneCurve=true;
  private color={calibrated:false,source:'uncalibrated sensor RGB',wb:[1,1,1,1],matrix:[1,0,0,0,1,0,0,0,1],neutral:null as number[]|null};
  ispStatus:{color:string;shading:boolean;dark:string|null;maxAnalogIso:number|null}|null=null;
  private computePipeline: any;
  private renderPipeline: any;
  private computeBind: any;
  private renderBind: any;
  private historyBuffers: any[] = [];
  private historyPipeline: any;
  private historyOutput: any;
  private historyParams: any;
  private historyIndex = 0;
  private reference: MotionReference | null = null;
  private mode: 'static' | 'rotation' = 'static';
  motionStatus: { reuse: boolean; reason: string; blurPx: number } | null = null;
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
    self.historyPipeline = await self.device.createComputePipelineAsync({
      layout:'auto', compute:{module:self.device.createShaderModule({code:HISTORY}),entryPoint:'main'},
    });
    self.historyOutput = await self.device.createComputePipelineAsync({
      layout:'auto', compute:{module:self.device.createShaderModule({code:HISTORY_OUTPUT}),entryPoint:'main'},
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
  setColorEnabled(v:boolean){this.colorEnabled=v;}
  setToneCurve(v:boolean){this.toneCurve=v;}
  setCalibrationCapture(v:boolean){if(this.series.frames||this.busy)throw new Error('Reset before calibration capture');this.calibrationCapture=v;}
  setDarkProfile(profile:DarkProfile|null){if(this.series.frames||this.busy)throw new Error('Reset before applying a dark profile');this.darkProfile=profile;this.darkDirty=true;}
  setHistoryMode(mode: 'static' | 'rotation') {
    if (this.busy || this.series.frames) throw new Error('Reset before changing the history mode');
    this.mode = mode;
    if(mode==='static'){for(const b of this.historyBuffers)b.destroy();this.historyBuffers=[];this.historyParams?.destroy();this.historyParams=null;}
  }

  private ensure(frame: RawFrame) {
    if (this.series.frames === 1) {
      // Frozen display conversion only; persistent state remains in signed, black-corrected DN.
      this.displayUnit = frame.whiteLevel - frame.black.reduce((a, b) => a + b, 0) / 4;
      this.color=colorProfile(frame);
    }
    if (this.width === frame.width && this.height === frame.height && (this.mode==='static' || this.historyBuffers.length)) return;
    this.width = frame.width;
    this.height = frame.height;
    this.outWidth = frame.width / 2;
    this.outHeight = frame.height / 2;
    for (const b of [this.rawBuffer, this.meanBuffer, this.m2Buffer, this.countBuffer, this.paramsBuffer, this.viewBuffer,this.shadingBuffer,this.darkBuffer,this.badBuffer,this.gainBuffer]) b?.destroy();
    for (const b of this.historyBuffers) b.destroy();
    this.historyParams?.destroy();
    this.historyBuffers=[];
    this.historyIndex=0;
    const U = (globalThis as any).GPUBufferUsage;
    this.rawBuffer = this.device.createBuffer({ size: frame.payload.byteLength, usage: U.STORAGE | U.COPY_DST });
    const quads = this.outWidth * this.outHeight;
    const statisticUsage = U.STORAGE | U.COPY_SRC | U.COPY_DST;
    this.meanBuffer = this.device.createBuffer({ size: quads * 16, usage: statisticUsage });
    this.m2Buffer = this.device.createBuffer({ size: quads * 16, usage: statisticUsage });
    this.countBuffer = this.device.createBuffer({ size: quads * 4, usage: statisticUsage });
    this.paramsBuffer = this.device.createBuffer({ size: 112, usage: U.UNIFORM | U.COPY_DST });
    this.viewBuffer = this.device.createBuffer({ size: 96, usage: U.UNIFORM | U.COPY_DST });
    this.shadingBuffer=this.device.createBuffer({size:65536,usage:U.STORAGE|U.COPY_DST});
    this.darkBuffer=this.device.createBuffer({size:quads*16,usage:U.STORAGE|U.COPY_DST});
    this.badBuffer=this.device.createBuffer({size:quads*4,usage:U.STORAGE|U.COPY_DST});
    this.gainBuffer=this.device.createBuffer({size:quads*16,usage:U.STORAGE|U.COPY_DST});
    this.darkDirty=true;
    if (this.mode==='rotation') {
      this.historyBuffers=Array.from({length:2},()=>this.device.createBuffer({size:quads*48,usage:statisticUsage}));
      this.historyParams=this.device.createBuffer({size:192,usage:U.UNIFORM|U.COPY_DST});
    }
    this.computeBind = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [this.rawBuffer, this.meanBuffer, this.m2Buffer, this.countBuffer, this.paramsBuffer,this.shadingBuffer,this.darkBuffer,this.gainBuffer,this.badBuffer]
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
    this.reference=null;
    this.motionStatus=null;
    this.ispStatus=null;
    this.darkProfile=null;this.darkDirty=true;this.calibrationCapture=false;
    if (!this.meanBuffer) return;
    const encoder = this.device.createCommandEncoder();
    for (const b of [this.meanBuffer, this.m2Buffer, this.countBuffer]) encoder.clearBuffer(b);
    for (const b of this.historyBuffers) encoder.clearBuffer(b);
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
      const params = new ArrayBuffer(112);
      const d = new DataView(params);
      [frame.width, frame.height, frame.rowStride, frame.cfa].forEach((v, i) => d.setUint32(i * 4, v, true));
      frame.black.forEach((v, i) => d.setFloat32(16 + i * 4, v, true));
      d.setFloat32(32, frame.whiteLevel, true);
      const shading=!this.calibrationCapture && !!(frame.isp && (frame.isp.flags&4));
      const isp=frame.isp;
      const put=(offset:number,values:number[])=>values.forEach((v,i)=>d.setFloat32(offset+i*4,v,true));
      d.setUint32(48,shading?isp!.mapWidth:1,true);d.setUint32(52,shading?isp!.mapHeight:1,true);
      put(64,shading?isp!.active:[0,0,1,1]);put(80,[frame.cropX,frame.cropY,0,0]);
      d.setUint32(96,Number(!!this.darkProfile&&!this.calibrationCapture),true);d.setUint32(100,Number(shading),true);
      this.device.queue.writeBuffer(this.shadingBuffer,0,shading?isp!.shading:new Float32Array([1,1,1,1]));
      if(this.darkDirty){
        const quads=this.outWidth*this.outHeight;
        const profile=this.calibrationCapture?null:this.darkProfile;
        if(profile && (profile.mean.length!==quads*4||profile.classes.length!==quads*4))throw new Error('Dark map dimensions mismatch');
        this.device.queue.writeBuffer(this.darkBuffer,0,profile?profile.mean:new Float32Array(quads*4));
        const mask=new Uint32Array(quads);
        if(profile)for(let i=0;i<quads;i++)for(let c=0;c<4;c++)if(profile.classes[i*4+c]>=2)mask[i]|=1<<c;
        this.device.queue.writeBuffer(this.badBuffer,0,mask);this.darkDirty=false;
      }
      this.ispStatus={color:this.calibrationCapture?'dark calibration (raw DN)':this.color.source,shading,dark:this.calibrationCapture?null:this.darkProfile?.key??null,maxAnalogIso:isp?.maxAnalogIso??null};
      this.device.queue.writeBuffer(this.paramsBuffer, 0, params);
      const encoder = this.device.createCommandEncoder();
      if (this.mode==='rotation') {
        // One fresh sensor observation per RGB merge. Never merge a cumulative CFA mean repeatedly.
        for (const b of [this.meanBuffer,this.m2Buffer,this.countBuffer]) encoder.clearBuffer(b);
      }
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.computePipeline);
      pass.setBindGroup(0, this.computeBind);
      pass.dispatchWorkgroups(Math.ceil(this.outWidth / 8), Math.ceil(this.outHeight / 8));
      pass.end();
      if (this.mode==='rotation') this.mergeHistory(encoder,frame);
      this.device.queue.submit([encoder.finish()]);
      this.render();
      const submitMs = performance.now() - start;
      // ACK is allowed only after compute and display work have completed.
      await this.device.queue.onSubmittedWorkDone();
      if (this.failure) throw new Error(this.failure);
      return { submitMs, completionMs: performance.now() - start };
    } finally { this.busy = false; }
  }

  private mergeHistory(encoder: any, frame: RawFrame) {
    const plan=planMotion(this.reference,frame);
    this.reference=plan.reference;
    this.motionStatus={reuse:plan.reuse,reason:plan.reason,blurPx:plan.blurPx};
    const params=new ArrayBuffer(192);
    const d=new DataView(params);
    [this.outWidth,this.outHeight,Number(plan.reuse),Number(!!plan.reference)].forEach((v,i)=>d.setUint32(i*4,v,true));
    const put=(offset:number,values:number[])=>values.forEach((v,i)=>d.setFloat32(offset+i*4,v,true));
    for (let row=0;row<3;row++) put(16+row*16,plan.rotation.slice(row*3,row*3+3));
    const safeK=(k?:number[])=>k?.length===5 && k.every(Number.isFinite) && k[0]>0 && k[1]>0 ? k : [1,1,0,0,0];
    const current=safeK(plan.current?.intrinsics), old=safeK(plan.previous?.intrinsics);
    const currentD=plan.current?.distortion.every(Number.isFinite) ? plan.current.distortion : [0,0,0,0,0];
    const oldD=plan.previous?.distortion.every(Number.isFinite) ? plan.previous.distortion : [0,0,0,0,0];
    put(64,current.slice(0,4)); put(80,old.slice(0,4)); put(96,[current[4],old[4],0,0]);
    put(112,currentD.slice(0,4)); put(128,oldD.slice(0,4));
    put(144,[currentD[4],oldD[4],plan.registrationErrorPx,128]);
    const indices=[[0,1,2,3],[1,0,3,2],[2,0,3,1],[3,1,2,0]][frame.cfa];
    put(160,indices.map(i=>frame.noiseProfile[i][0]*(frame.whiteLevel-frame.black[i])));
    put(176,indices.map(i=>frame.noiseProfile[i][1]*(frame.whiteLevel-frame.black[i])**2));
    this.device.queue.writeBuffer(this.historyParams,0,params);
    const nextIndex=1-this.historyIndex;
    const bind=this.device.createBindGroup({layout:this.historyPipeline.getBindGroupLayout(0),entries:
      [this.meanBuffer,this.countBuffer,this.historyBuffers[this.historyIndex],this.historyBuffers[nextIndex],this.historyParams,this.gainBuffer]
        .map((buffer,binding)=>({binding,resource:{buffer}})),
    });
    const pass=encoder.beginComputePass();
    pass.setPipeline(this.historyPipeline);pass.setBindGroup(0,bind);
    pass.dispatchWorkgroups(Math.ceil(this.outWidth/8),Math.ceil(this.outHeight/8));pass.end();
    this.historyIndex=nextIndex;
    const output=this.device.createBindGroup({layout:this.historyOutput.getBindGroupLayout(0),entries:
      [this.historyBuffers[nextIndex],this.meanBuffer,this.m2Buffer,this.countBuffer].map((buffer,binding)=>({binding,resource:{buffer}})),
    });
    const display=encoder.beginComputePass();display.setPipeline(this.historyOutput);display.setBindGroup(0,output);
    display.dispatchWorkgroups(Math.ceil(this.outWidth*this.outHeight/64));display.end();
  }

  async exportCalibrationStatistics():Promise<RegionStatistics>{
    if(this.busy||this.mode!=='static'||!this.calibrationCapture)throw new Error('Full-map export requires a completed dark capture');
    const quads=this.outWidth*this.outHeight,meanBytes=quads*16;
    const U=(globalThis as any).GPUBufferUsage;
    const staging=this.device.createBuffer({size:quads*36,usage:U.COPY_DST|U.MAP_READ});
    try{
      const encoder=this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(this.meanBuffer,0,staging,0,meanBytes);
      encoder.copyBufferToBuffer(this.m2Buffer,0,staging,meanBytes,meanBytes);
      encoder.copyBufferToBuffer(this.countBuffer,0,staging,meanBytes*2,quads*4);
      this.device.queue.submit([encoder.finish()]);await staging.mapAsync((globalThis as any).GPUMapMode.READ);
      const bytes=staging.getMappedRange();
      return {width:this.outWidth,height:this.outHeight,means:new Float32Array(bytes.slice(0,meanBytes)),m2:new Float32Array(bytes.slice(meanBytes,meanBytes*2)),counts:new Float32Array(bytes.slice(meanBytes*2))};
    }finally{staging.destroy();}
  }

  private async readHistoryRegion(x:number,y:number,width:number,height:number):Promise<RegionStatistics> {
    const U=(globalThis as any).GPUBufferUsage;
    const staging=this.device.createBuffer({size:width*height*48,usage:U.COPY_DST|U.MAP_READ});
    try {
      const encoder=this.device.createCommandEncoder();
      for(let row=0;row<height;row++) encoder.copyBufferToBuffer(this.historyBuffers[this.historyIndex],((y+row)*this.outWidth+x)*48,staging,row*width*48,width*48);
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync((globalThis as any).GPUMapMode.READ);
      const values=new Float32Array(staging.getMappedRange());
      const means=new Float32Array(width*height*3),m2=new Float32Array(means.length),counts=new Float32Array(width*height);
      let confidence=0,rejected=0,dubious=0,evidence=0;
      for(let i=0;i<counts.length;i++) {
        const W=values[i*12+3],Q=values[i*12+7];
        const n=Q>0?W*W/Q:0,denominator=W-Q/Math.max(W,1e-6);
        counts[i]=n;evidence+=n;confidence+=values[i*12+8];
        rejected+=Number(values[i*12+9]===3);dubious+=Number(values[i*12+9]===2);
        for(let c=0;c<3;c++) {
          means[i*3+c]=values[i*12+c];
          m2[i*3+c]=denominator>0.01?values[i*12+4+c]/denominator*Math.max(n-1,0):0;
        }
      }
      return {width,height,means,m2,counts,channels:['R','G','B'],motion:{confidence:confidence/counts.length,
        rejected:rejected/counts.length,dubious:dubious/counts.length,effectiveEvidence:evidence/counts.length}};
    } finally {staging.destroy();}
  }

  async readRegion(x?: number, y?: number, width = Math.min(16, this.outWidth), height = Math.min(16, this.outHeight)): Promise<RegionStatistics> {
    x ??= Math.floor((this.outWidth - width) / 2);
    y ??= Math.floor((this.outHeight - height) / 2);
    if (width < 1 || height < 1 || width * height > 4096 || x < 0 || y < 0 || x + width > this.outWidth || y + height > this.outHeight) {
      throw new Error('Invalid calibration region');
    }
    if (this.mode==='rotation') return this.readHistoryRegion(x,y,width,height);
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
    const values=new Float32Array(24);
    values.set([w,h,this.outWidth,this.outHeight,this.displayGain/this.displayUnit,Number(this.displayNoise),Number(this.colorEnabled&&this.color.calibrated&&!this.calibrationCapture),Number(this.toneCurve)],0);
    values.set(this.color.wb,8);
    for(let row=0;row<3;row++)values.set(this.color.matrix.slice(row*3,row*3+3),12+row*4);
    this.device.queue.writeBuffer(this.viewBuffer,0,values);
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

  destroy() {
    if (this.busy) throw new Error('Wait for GPU completion before destroying the accumulator');
    for (const b of [this.rawBuffer,this.meanBuffer,this.m2Buffer,this.countBuffer,this.paramsBuffer,this.viewBuffer,this.historyParams,this.shadingBuffer,this.darkBuffer,this.badBuffer,this.gainBuffer,...this.historyBuffers]) b?.destroy();
    this.ctx.unconfigure();
    this.device.destroy();
  }
}
