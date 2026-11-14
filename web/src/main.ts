import './style.css';
import { Bridge } from './bridge';
import { DYNAMIC_BLACK, DYNAMIC_WHITE, NOISE_PROFILE, parseRawFrame } from './raw';
import { RawAccumulator } from './gpu';
import { summarizeRegion } from './diagnostics';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $('view') as HTMLCanvasElement;
const status = $('status');
const log = $('log');
const stats = $('stats');
const exposure = $('exposure') as HTMLInputElement;
const iso = $('iso') as HTMLInputElement;
const gain = $('gain') as HTMLInputElement;
const duration = $('duration') as HTMLSelectElement;
const display = $('display') as HTMLSelectElement;
const startButton = $('start') as HTMLButtonElement;
const stopButton = $('stop') as HTMLButtonElement;
const resetButton = $('reset') as HTMLButtonElement;
const exportButton = $('export') as HTMLButtonElement;

interface CameraCaps {
  id: string; manual: boolean; cfa: number; rawSize: string; cropSize: string;
  exposureMinNs: number; exposureMaxNs: number; isoMin: number; isoMax: number;
  minFrameDurationNs: number; stallDurationNs: number;
}
let accumulator: RawAccumulator | null = null;
let gpuPromise: Promise<RawAccumulator> | null = null;
let selectedCaps: CameraCaps | null = null;
let capturing = false;
let starting = false;
let nativeStartPending = false;
let stopping = false;
let working = false;
let windowTimer: ReturnType<typeof setTimeout> | undefined;
let sessionStartedAt = '';
let stopReason = '';
let reportFrames: Record<string, unknown>[] = [];
let latestRegion: ReturnType<typeof summarizeRegion> | null = null;
let regionFrame = 0;
let lastRegionWall = 0;
let nativeStats: Record<string, unknown> | null = null;
let totalBytes = 0;
let lastStatsLines: string[] = [];

function line(message: string) {
  log.textContent = `${new Date().toLocaleTimeString()} ${message}\n${log.textContent}`.slice(0, 6000);
}
function controls() {
  const active = capturing || starting || stopping || working;
  startButton.disabled = active || !selectedCaps?.manual || selectedCaps.cfa > 3;
  stopButton.disabled = !capturing && !starting;
  resetButton.disabled = active;
  exportButton.disabled = active || !accumulator?.series.frames;
  exposure.disabled = iso.disabled = duration.disabled = active;
}
async function ensureGpu() {
  if (!gpuPromise) {
    gpuPromise = RawAccumulator.create(canvas).then(gpu => {
      accumulator = gpu;
      gpu.setDisplayGain(Number(gain.value));
      gpu.setDisplayNoise(display.value === 'noise');
      return gpu;
    }).catch(error => { gpuPromise = null; throw error; });
  }
  return gpuPromise;
}
function resetReport() {
  sessionStartedAt = new Date().toISOString();
  stopReason = '';
  reportFrames = [];
  latestRegion = null;
  regionFrame = 0;
  lastRegionWall = 0;
  nativeStats = null;
  totalBytes = 0;
  lastStatsLines = [];
  stats.textContent = '';
}
function stopCapture(reason: string) {
  if (!capturing && !starting) return;
  const stopNative = capturing || nativeStartPending;
  stopReason = reason;
  capturing = starting = false;
  stopping = stopNative;
  nativeStartPending = false;
  clearTimeout(windowTimer);
  if (stopNative) bridge.stop();
  status.textContent = stopNative ? 'stopping' : 'stopped';
  line(reason);
  controls();
}
function showStats() {
  const channel = (values: number[] | null) => values ? values.map(v => v.toFixed(3)).join(' / ') : 'need 2+ observations';
  const roi = latestRegion ? [
    `Center ROI at frame ${regionFrame} · R / G1 / G2 / B`,
    `signed mean DN: ${channel(latestRegion.meanDN)}`,
    `temporal std DN: ${channel(latestRegion.temporalStdDN)}`,
    `estimated std(mean) DN*: ${channel(latestRegion.standardErrorDN)}`,
    `ROI saturated quad samples: ${(100 * latestRegion.rejectedQuadFraction).toFixed(2)}%`,
    '* Assumes independent stationary noise; no motion compensation.',
  ] : [];
  stats.textContent = [...lastStatsLines, ...roi].join('\n');
}

const bridge = new Bridge();
bridge.onEvent = event => {
  if (event.type === 'capabilities') {
    selectedCaps = event.selected as CameraCaps ?? null;
    status.textContent = selectedCaps?.manual && selectedCaps.cfa <= 3 ? 'RAW ready' : 'manual Bayer RAW required';
    if (selectedCaps) {
      exposure.min = String(Math.max(1, Math.ceil(selectedCaps.exposureMinNs / 1e6)));
      exposure.max = String(Math.max(Number(exposure.min), Math.min(2000, Math.floor(selectedCaps.exposureMaxNs / 1e6))));
      exposure.value = String(Math.max(Number(exposure.min), Math.min(Number(exposure.max), 250)));
      iso.min = String(selectedCaps.isoMin);
      iso.max = String(selectedCaps.isoMax);
      iso.step = '1';
      iso.value = String(Math.max(selectedCaps.isoMin, Math.min(selectedCaps.isoMax, 800)));
      updateLabels();
      line(`camera ${selectedCaps.id}: RAW ${selectedCaps.rawSize}, crop ${selectedCaps.cropSize}, CFA ${selectedCaps.cfa}`);
      line(`RAW minimum frame ${(selectedCaps.minFrameDurationNs / 1e6).toFixed(1)} ms; output stall ${(selectedCaps.stallDurationNs / 1e6).toFixed(1)} ms`);
    } else line(String(event.error ?? 'No RAW camera'));
  } else if (event.type === 'started') {
    if (!starting) { bridge.stop(); return; }
    starting = false;
    nativeStartPending = false;
    capturing = true;
    status.textContent = 'capturing fixed RAW';
    line(`requested: ${JSON.stringify(event)}`);
    const seconds = Number(duration.value);
    if (seconds) windowTimer = setTimeout(() => stopCapture(`${seconds}-second observation window finished`), seconds * 1000);
  } else if (event.type === 'stopped') {
    capturing = starting = stopping = nativeStartPending = false;
    nativeStats = event;
    if (!working) status.textContent = 'stopped';
    line(`native totals: ${JSON.stringify(event)}`);
  } else if (event.type === 'error') {
    stopCapture('Capture stopped after an error');
    stopping = false;
    status.textContent = 'error';
    line(`ERROR: ${String(event.message)}`);
  } else line(JSON.stringify(event));
  controls();
};

bridge.onBinary = async buffer => {
  const frameId = buffer.byteLength >= 48 ? new DataView(buffer).getUint32(44, true) : 0;
  if (!capturing) { bridge.ack(frameId); return; }
  if (working) { stopCapture('Overlapping RAW packet'); bridge.ack(frameId); return; }
  working = true;
  controls();
  try {
    const frame = parseRawFrame(buffer);
    const gpu = await ensureGpu();
    const timing = await gpu.add(frame);
    totalBytes += buffer.byteLength;
    const now = performance.now();
    let diagnosticReadMs = 0;
    if (now - lastRegionWall >= 1000 || !capturing || gpu.series.frames === 1) {
      const t = performance.now();
      latestRegion = summarizeRegion(await gpu.readRegion(), gpu.series.frames);
      diagnosticReadMs = performance.now() - t;
      regionFrame = gpu.series.frames;
      lastRegionWall = now;
    }
    // Keep metadata only, never retain an unbounded history of RAW buffers.
    const { buffer: _buffer, payload: _payload, ...metadata } = frame;
    if (reportFrames.length < 4096) reportFrames.push({ ...metadata, ...timing, diagnosticReadMs });
    lastStatsLines = [
      `${frame.width}×${frame.height} RAW16 → ${frame.width / 2}×${frame.height / 2} CFA quads`,
      `frame ${frame.frameId} · ${gpu.series.frames} processed (per-quad saturation masks apply)`,
      `actual ${Number(frame.exposureNs) / 1e6} ms · ISO ${frame.iso}; requested ${Number(frame.requestedExposureNs) / 1e6} ms / ISO ${frame.requestedIso}`,
      `accepted exposure sum ${(Number(gpu.series.exposureNs) / 1e9).toFixed(3)} s · sensor span ${gpu.series.elapsedSeconds.toFixed(3)} s`,
      `delivered ${gpu.series.fps.toFixed(2)} fps · latest native interval ${(Number(frame.captureIntervalNs) / 1e6).toFixed(1)} ms`,
      `stream ${(frame.payloadBytes * gpu.series.fps / 1e6).toFixed(2)} MB/s · packet ${(buffer.byteLength / 1048576).toFixed(2)} MiB`,
      `crop + packet copy ${(Number(frame.copyTimeNs) / 1e6).toFixed(2)} ms`,
      `WebGPU submit ${timing.submitMs.toFixed(2)} ms · queue completion ${timing.completionMs.toFixed(2)} ms (includes display)`,
      `native acquired ${frame.received} · busy drops ${frame.droppedBusy} · metadata drops ${frame.droppedMetadata}`,
      `black ${frame.flags & DYNAMIC_BLACK ? 'dynamic' : 'static fallback'} · white ${frame.flags & DYNAMIC_WHITE ? 'dynamic' : 'static fallback'} · noise profile ${frame.flags & NOISE_PROFILE ? 'available' : 'unavailable'}`,
    ];
    showStats();
  } catch (error) {
    stopCapture('Capture stopped after a frame error');
    status.textContent = 'frame error';
    line(error instanceof Error ? error.message : String(error));
  } finally {
    // GPU completion and diagnostic readback have both finished before the next native packet can be copied.
    working = false;
    bridge.ack(frameId);
    controls();
  }
};

function updateLabels() {
  ($('exposureOut') as HTMLOutputElement).value = `${exposure.value} ms`;
  ($('isoOut') as HTMLOutputElement).value = iso.value;
  ($('gainOut') as HTMLOutputElement).value = `${Number(gain.value).toFixed(2)}×`;
  accumulator?.setDisplayGain(Number(gain.value));
  accumulator?.setDisplayNoise(display.value === 'noise');
  accumulator?.render();
}
exposure.oninput = iso.oninput = gain.oninput = display.onchange = updateLabels;
updateLabels();
controls();

startButton.onclick = async () => {
  starting = true;
  working = true;
  controls();
  try {
    const gpu = await ensureGpu();
    if (!starting) return;
    await gpu.reset();
    if (!starting) return;
    resetReport();
    nativeStartPending = true;
    bridge.start(Math.round(Number(exposure.value) * 1e6), Number(iso.value));
  } catch (error) {
    starting = false;
    nativeStartPending = false;
    status.textContent = 'WebGPU error';
    line(error instanceof Error ? error.message : String(error));
  } finally { working = false; controls(); }
};
stopButton.onclick = () => stopCapture('Stopped by user');
resetButton.onclick = async () => {
  working = true;
  controls();
  try {
    await accumulator?.reset();
    resetReport();
    accumulator?.render();
  } catch (error) { line(`Reset error: ${String(error)}`); }
  finally { working = false; controls(); }
};
exportButton.onclick = async () => {
  if (!accumulator?.series.frames) return;
  working = true;
  controls();
  try {
    const region = await accumulator.readRegion();
    latestRegion = summarizeRegion(region, accumulator.series.frames);
    regionFrame = accumulator.series.frames;
    showStats();
    const report = {
      schema: 'nightfield-static-v1', startedAt: sessionStartedAt, stopReason,
      units: 'signed black-corrected sensor DN; no electron calibration or ISO gain approximation',
      camera: selectedCaps, frames: accumulator.series.frames, exposureSumNs: accumulator.series.exposureNs,
      sensorSpanSeconds: accumulator.series.elapsedSeconds, deliveredFps: accumulator.series.fps, totalPacketBytes: totalBytes,
      nativeStats, roi: latestRegion,
      roiData: { width: region.width, height: region.height, means: Array.from(region.means), m2: Array.from(region.m2), counts: Array.from(region.counts) },
      metadata: reportFrames, metadataTruncated: accumulator.series.frames > reportFrames.length,
      limitations: ['static scene assumed', 'no hot-pixel or dark-current calibration', 'no gain/exposure mixing', 'queue completion is not an isolated GPU execution timestamp'],
    };
    const json = JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2);
    bridge.send({ type: 'saveReport', json });
  } catch (error) { line(`Report error: ${String(error)}`); }
  finally { working = false; controls(); }
};
window.addEventListener('resize', () => accumulator?.render());
