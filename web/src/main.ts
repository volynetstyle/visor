import './style.css';
import { Bridge } from './bridge';
import { parseRawFrame } from './raw';
import { RawAccumulator } from './gpu';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $('view') as HTMLCanvasElement;
const status = $('status');
const log = $('log');
const stats = $('stats');
const exposure = $('exposure') as HTMLInputElement;
const iso = $('iso') as HTMLInputElement;
const gain = $('gain') as HTMLInputElement;
const exposureOut = $('exposureOut') as HTMLOutputElement;
const isoOut = $('isoOut') as HTMLOutputElement;
const gainOut = $('gainOut') as HTMLOutputElement;

let accumulator: RawAccumulator | null = null;
let frames = 0;
let firstTs = 0;
let lastFrameWall = performance.now();
let selectedCaps: any = null;

function line(s: string) {
  log.textContent = `${new Date().toLocaleTimeString()} ${s}\n${log.textContent}`.slice(0, 6000);
}

async function ensureGpu() {
  if (!accumulator) accumulator = await RawAccumulator.create(canvas);
  return accumulator;
}

const bridge = new Bridge();
bridge.onEvent = (event) => {
  if (event.type === 'capabilities') {
    selectedCaps = (event as any).selected;
    status.textContent = selectedCaps ? 'RAW ready' : 'NO RAW';
    if (selectedCaps) {
      exposure.min = String(Math.max(1, Math.ceil(selectedCaps.exposureMinNs / 1e6)));
      exposure.max = String(Math.min(2000, Math.floor(selectedCaps.exposureMaxNs / 1e6)));
      iso.min = String(selectedCaps.isoMin);
      iso.max = String(selectedCaps.isoMax);
      iso.step = String(Math.max(1, Math.round((selectedCaps.isoMax - selectedCaps.isoMin) / 100)));
      line(`camera ${selectedCaps.id}: RAW ${selectedCaps.rawSize}, bridge crop ${selectedCaps.cropSize}, CFA ${selectedCaps.cfa}`);
    } else {
      line(String((event as any).error ?? 'No RAW camera'));
    }
  } else if (event.type === 'started') {
    status.textContent = 'capturing';
    line(`started: ${JSON.stringify(event)}`);
  } else if (event.type === 'error') {
    status.textContent = 'error';
    line(`ERROR: ${String((event as any).message)}`);
  } else {
    line(JSON.stringify(event));
  }
};

bridge.onBinary = async (buffer) => {
  const t0 = performance.now();
  try {
    const frame = parseRawFrame(buffer);
    const gpu = await ensureGpu();
    gpu.add(frame);
    frames++;
    if (!firstTs) firstTs = t0;
    const dt = Math.max(0.001, (t0 - firstTs) / 1000);
    const instant = 1000 / Math.max(1, t0 - lastFrameWall);
    lastFrameWall = t0;
    stats.textContent = [
      `${frame.width}×${frame.height} RAW16 crop → ${frame.width >> 1}×${frame.height >> 1} RGB`,
      `frame ${frame.frameId} · ${frames} accumulated`,
      `capture ${Number(frame.exposureNs) / 1e6} ms · ISO ${frame.iso}`,
      `stream ${instant.toFixed(1)} fps · avg ${(frames / dt).toFixed(1)} fps`,
      `packet ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MiB`,
      `GPU submit ${(performance.now() - t0).toFixed(2)} ms`,
    ].join('\n');
  } catch (e) {
    line(`frame error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    bridge.ack();
  }
};

function updateLabels() {
  exposureOut.value = `${exposure.value} ms`;
  isoOut.value = iso.value;
  gainOut.value = `${Number(gain.value).toFixed(2)}×`;
  accumulator?.setDisplayGain(Number(gain.value));
  accumulator?.render();
}
exposure.oninput = updateLabels;
iso.oninput = updateLabels;
gain.oninput = updateLabels;
updateLabels();

$('start').onclick = async () => {
  try {
    await ensureGpu();
    frames = 0;
    firstTs = 0;
    accumulator?.reset();
    bridge.start(Math.round(Number(exposure.value) * 1e6), Number(iso.value));
  } catch (e) {
    status.textContent = 'WebGPU error';
    line(e instanceof Error ? e.message : String(e));
  }
};
$('stop').onclick = () => bridge.stop();
$('reset').onclick = () => {
  frames = 0;
  firstTs = 0;
  accumulator?.reset();
  accumulator?.render();
};

window.addEventListener('resize', () => accumulator?.render());
