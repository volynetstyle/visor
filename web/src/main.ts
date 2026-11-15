import './style.css';
import { Bridge } from './bridge';
import { DYNAMIC_BLACK, DYNAMIC_WHITE, NOISE_PROFILE, parseRawFrame } from './raw';
import { RawAccumulator } from './gpu';
import { summarizeRegion } from './diagnostics';
import {calibrationKey,buildDarkProfile,darkStore,type DarkProfile} from './calibration';
import type {RawFrame} from './raw';

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
const cameraSelect = $('cameraSelect') as HTMLSelectElement;
const historyMode = $('historyMode') as HTMLSelectElement;
const colorMode=$('colorMode') as HTMLSelectElement;
const toneMode=$('toneMode') as HTMLSelectElement;
const darkCovered=$('darkCovered') as HTMLInputElement;
const applyDark=$('applyDark') as HTMLInputElement;
const startButton = $('start') as HTMLButtonElement;
const stopButton = $('stop') as HTMLButtonElement;
const resetButton = $('reset') as HTMLButtonElement;
const exportButton = $('export') as HTMLButtonElement;

interface CameraCaps {
  id: string; manual: boolean; cfa: number; rawSize: string; cropSize: string;
  exposureMinNs: number; exposureMaxNs: number; isoMin: number; isoMax: number;
  minFrameDurationNs: number; stallDurationNs: number;
  maxAnalogIso?:number;
}
let accumulator: RawAccumulator | null = null;
let gpuPromise: Promise<RawAccumulator> | null = null;
let selectedCaps: CameraCaps | null = null;
let capturing = false;
let starting = false;
let nativeStartPending = false;
let stopping = false;
let working = false;
let switchingCamera = false;
let windowTimer: ReturnType<typeof setTimeout> | undefined;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let cameraInfo: Record<string, unknown> | null = null;
let sessionStartedAt = '';
let stopReason = '';
let reportFrames: Record<string, unknown>[] = [];
let reportMetadataChars=0;
const jsonValue=(_:string,value:unknown)=>typeof value==='bigint'?value.toString():value;
let latestRegion: ReturnType<typeof summarizeRegion> | null = null;
let regionFrame = 0;
let lastRegionWall = 0;
let nativeStats: Record<string, unknown> | null = null;
let totalBytes = 0;
let lastStatsLines: string[] = [];
let sessionHistoryMode: 'static' | 'rotation' = 'static';
let lastMotionReason='';
let calibrationRun=false,profileChecked=false;
let activeProfile:DarkProfile|null=null;
let sessionDarkSummary:Record<string,unknown>|null=null;
const profileSummary=(p:DarkProfile)=>({key:p.key,createdAt:p.createdAt,frames:p.frames,summary:p.summary,width:p.width,height:p.height});
let firstDarkFrame:RawFrame|null=null;
let lastShading:Record<string,unknown>|null=null;
function lineMotionStatus(reason:string) {
  if (reason!==lastMotionReason) { line(`Motion history: ${reason}`);lastMotionReason=reason; }
}

function line(message: string) {
  log.textContent = `${new Date().toLocaleTimeString()} ${message}\n${log.textContent}`.slice(0, 6000);
}
function controls() {
  const active = capturing || starting || stopping || working || switchingCamera;
  startButton.disabled = active || !selectedCaps?.manual || selectedCaps.cfa > 3;
  stopButton.disabled = !capturing && !starting;
  resetButton.disabled = active;
  exportButton.disabled = active || !accumulator?.series.frames;
  exposure.disabled = iso.disabled = duration.disabled = cameraSelect.disabled = historyMode.disabled = active;
  applyDark.disabled=darkCovered.disabled=active;
  ($('captureDark') as HTMLButtonElement).disabled=active||!darkCovered.checked||!selectedCaps?.manual;
  ($('deleteDark') as HTMLButtonElement).disabled=active||!activeProfile;
  document.querySelectorAll<HTMLButtonElement>('[data-iso]').forEach(button=>button.disabled=active||!selectedCaps);
  $('recordIndicator').classList.toggle('active', capturing);
}
async function ensureGpu() {
  if (!gpuPromise) {
    gpuPromise = RawAccumulator.create(canvas).then(gpu => {
      accumulator = gpu;
      gpu.setDisplayGain(Number(gain.value));
      gpu.setDisplayNoise(display.value === 'noise');
      gpu.setColorEnabled(colorMode.value==='camera');gpu.setToneCurve(toneMode.value==='day');
      return gpu;
    }).catch(error => { gpuPromise = null; throw error; });
  }
  return gpuPromise;
}
function resetReport() {
  sessionStartedAt = new Date().toISOString();
  stopReason = '';
  reportFrames = [];
  reportMetadataChars=0;
  latestRegion = null;
  regionFrame = 0;
  lastRegionWall = 0;
  nativeStats = null;
  totalBytes = 0;
  lastStatsLines = [];
  lastMotionReason='';
  profileChecked=false;firstDarkFrame=null;lastShading=null;
  sessionDarkSummary=null;
  stats.textContent = '';
  $('framesHud').textContent = '0000';
  $('timer').textContent = '00:00:00';
}
function stopCapture(reason: string) {
  if (!capturing && !starting) return;
  const stopNative = capturing || nativeStartPending;
  stopReason = reason;
  capturing = starting = false;
  stopping = stopNative;
  nativeStartPending = false;
  clearTimeout(windowTimer);
  clearInterval(clockTimer);
  if (stopNative) bridge.stop();
  status.textContent = stopNative ? 'stopping' : 'stopped';
  line(reason);
  controls();
}
function showStats() {
  const channel = (values: number[] | null) => values ? values.map(v => v.toFixed(3)).join(' / ') : 'need 2+ observations';
  const roi = latestRegion ? [
    `Center ROI at frame ${regionFrame} · ${latestRegion.channels.join(' / ')}`,
    `signed mean DN: ${channel(latestRegion.meanDN)}`,
    `temporal std DN: ${channel(latestRegion.temporalStdDN)}`,
    `estimated std(mean) DN*: ${channel(latestRegion.standardErrorDN)}`,
    latestRegion.motion ? `RGB history · confidence ${latestRegion.motion.confidence.toFixed(2)} · effective evidence ${latestRegion.motion.effectiveEvidence.toFixed(1)} · rejected ${(100*latestRegion.motion.rejected).toFixed(1)}%` : `ROI rejected quad samples (saturation / mask): ${(100 * (latestRegion.rejectedQuadFraction ?? 0)).toFixed(2)}%`,
    latestRegion.motion ? '* Reprojected effective evidence is approximate, not a calibrated confidence interval.' : '* Assumes independent stationary noise; no motion compensation.',
  ] : [];
  stats.textContent = [...lastStatsLines, ...roi].join('\n');
}

const bridge = new Bridge();
bridge.onEvent = event => {
  if (event.type === 'capabilities') {
    switchingCamera = false;
    selectedCaps = event.selected as CameraCaps ?? null;
    const cameras = Array.isArray(event.cameras) ? event.cameras as { id: string; raw: boolean; manual: boolean; facing: number | null }[] : [];
    cameraSelect.replaceChildren(...cameras.filter(camera => camera.raw).map(camera => {
      const facing = camera.facing === 1 ? 'задняя' : camera.facing === 0 ? 'фронтальная' : 'другая';
      const option = new Option(`${camera.id} · ${facing}${camera.manual ? '' : ' · без ручного режима'}`, camera.id);
      option.selected = camera.id === selectedCaps?.id;
      return option;
    }));
    if (!cameraSelect.options.length) cameraSelect.add(new Option('RAW-камера не найдена', ''));
    status.textContent = selectedCaps?.manual && selectedCaps.cfa <= 3 ? 'RAW ready' : 'manual Bayer RAW required';
    if (selectedCaps) {
      $('analogHint').textContent=selectedCaps.maxAnalogIso?`Аналоговый предел ISO ${selectedCaps.maxAnalogIso}. Выше возможно цифровое усиление.`:'Аналоговый предел ISO не сообщён камерой.';
      $('cameraHud').textContent = `ID ${selectedCaps.id} · ${selectedCaps.cropSize}`;
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
    status.textContent = 'REC · RAW';
    const started = performance.now();
    clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      const seconds = Math.floor((performance.now() - started) / 1000);
      $('timer').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
    }, 250);
    line(`requested: ${JSON.stringify(event)}`);
    const seconds = Number(duration.value);
    if (seconds && !calibrationRun) windowTimer = setTimeout(() => stopCapture(`${seconds}-second observation window finished`), seconds * 1000);
  } else if (event.type === 'stopped') {
    capturing = starting = stopping = nativeStartPending = false;
    clearInterval(clockTimer);
    nativeStats = event;
    if(calibrationRun && (accumulator?.series.frames??0)<64)$('darkStatus').textContent=`Dark-серия прервана: ${accumulator?.series.frames??0} / 64. Профиль не сохранён.`;
    if (!working) status.textContent = 'stopped';
    line(`native totals: ${JSON.stringify(event)}`);
  } else if (event.type === 'cameraInfo') {
    cameraInfo = event;
    $('cameraInfo').textContent = JSON.stringify(event, null, 2);
    $('cameraInfoStatus').textContent = `Получено камер: ${Array.isArray(event.cameras) ? event.cameras.length : 0}. Отсутствующие значения зависят от устройства и разрешений.`;
    ($('requestCamera') as HTMLButtonElement).disabled = false;
    ($('saveCamera') as HTMLButtonElement).disabled = false;
  } else if (event.type === 'cameraInfoError') {
    $('cameraInfoStatus').textContent = `Ошибка запроса: ${String(event.message)}`;
    ($('requestCamera') as HTMLButtonElement).disabled = false;
  } else if (event.type === 'error') {
    switchingCamera = false;
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
    if(!profileChecked){
      const key=calibrationKey(selectedCaps?.id??'',frame);
      activeProfile=null;
      if(!calibrationRun && applyDark.checked){
        try{activeProfile=await darkStore('get',key);}catch(error){line(`Dark profile unavailable: ${String(error)}`);}
      }
      gpu.setDarkProfile(activeProfile);profileChecked=true;
      sessionDarkSummary=activeProfile?profileSummary(activeProfile):null;
      $('darkStatus').textContent=calibrationRun?'Dark-серия: 0 / 64':activeProfile?`Профиль ISO ${frame.iso}, ${Number(frame.exposureNs)/1e6} ms: ${activeProfile.createdAt}, ${activeProfile.frames} кадров`:'Совпадающий профиль не найден или выключен.';
      if(calibrationRun)firstDarkFrame={...frame,buffer:new ArrayBuffer(0),payload:new Uint8Array(0),isp:null,motion:null};
    }
    const timing = await gpu.add(frame);
    if (gpu.motionStatus) {
      const reason=gpu.motionStatus.reason;
      $('historyHint').textContent = gpu.motionStatus.reuse ? 'Компенсация вращения · история накапливается'
        : reason.includes('UNKNOWN') ? 'Часы камеры не синхронизированы с датчиками · только текущий кадр'
        : reason.includes('Exposure motion') ? 'Движение во время выдержки · история сброшена'
        : reason==='New RGB history' ? 'Начало новой RGB-истории'
        : 'Перенос истории недоступен · причина в диагностике';
      lineMotionStatus(gpu.motionStatus.reason);
    }
    $('framesHud').textContent = String(gpu.series.frames).padStart(4, '0');
    $('exposureHud').textContent = `${Number(frame.exposureNs) / 1e6} ms`;
    $('isoHud').textContent = String(frame.iso);
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
    const { buffer: _buffer, payload: _payload, isp, ...metadata } = frame;
    const {shading:_shading,...ispMetadata}=isp??{shading:null};
    if(isp?.shading.length)lastShading={width:isp.mapWidth,height:isp.mapHeight,active:isp.active,gains:Array.from(isp.shading)};
    if(reportMetadataChars<2_000_000 && reportFrames.length<4096){
      const entry={...metadata,isp:isp?ispMetadata:null,...timing,diagnosticReadMs,motionHistory:gpu.motionStatus,ispStatus:gpu.ispStatus};
      const chars=JSON.stringify(entry,jsonValue).length;
      if(reportMetadataChars+chars<=2_000_000){reportFrames.push(entry);reportMetadataChars+=chars;}
    }
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
      `ISP ${gpu.ispStatus?.color} · shading ${gpu.ispStatus?.shading?'on':'unavailable/off'} · dark ${gpu.ispStatus?.dark?'on':'off'}`,
    ];
    showStats();
    if(calibrationRun){
      $('historyHint').textContent=`Dark-калибровка · ${gpu.series.frames} / 64 · объектив закрыт`;
      $('darkStatus').textContent=`Dark-серия: ${gpu.series.frames} / 64`;
      if(gpu.series.frames>=64 && firstDarkFrame){
        stopCapture('Dark calibration completed');
        $('darkStatus').textContent='Подготовка полной карты…';
        const data=await gpu.exportCalibrationStatistics();
        await new Promise(resolve=>setTimeout(resolve,0));
        activeProfile=buildDarkProfile(calibrationKey(selectedCaps?.id??'',firstDarkFrame),firstDarkFrame,data,gpu.series.frames);
        await darkStore('put',activeProfile.key,activeProfile);
        $('darkStatus').textContent=`Профиль сохранён. Смещённых: ${activeProfile.summary.biased}, горячих: ${activeProfile.summary.hot}, нестабильных: ${activeProfile.summary.unstable}. Применится в следующей серии.`;
        $('historyHint').textContent='Dark-профиль сохранён · откройте объектив перед обычной съёмкой';
      }
    }
  } catch (error) {
    stopCapture('Capture stopped after a frame error');
    if(calibrationRun){activeProfile=null;$('darkStatus').textContent=`Калибровка не сохранена: ${error instanceof Error?error.message:String(error)}`;}
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
  if (!capturing) {
    $('exposureHud').textContent = `${exposure.value} ms`;
    $('isoHud').textContent = iso.value;
  }
  $('gainHud').textContent = `${Number(gain.value).toFixed(2)}×`;
  accumulator?.setDisplayGain(Number(gain.value));
  accumulator?.setDisplayNoise(display.value === 'noise');
  accumulator?.setColorEnabled(colorMode.value==='camera');accumulator?.setToneCurve(toneMode.value==='day');
  accumulator?.render();
}
exposure.oninput = iso.oninput = gain.oninput = display.onchange = updateLabels;
colorMode.onchange=toneMode.onchange=updateLabels;
darkCovered.onchange=controls;
document.querySelectorAll<HTMLButtonElement>('[data-iso]').forEach(button=>button.onclick=()=>{
  exposure.value=String(Math.min(400,Number(exposure.max)));iso.value=String(Math.max(Number(iso.min),Math.min(Number(iso.max),Number(button.dataset.iso))));updateLabels();
});
cameraSelect.onchange = async () => {
  if (!cameraSelect.value) return;
  const id = cameraSelect.value;
  switchingCamera = true;
  controls();
  try {
    await accumulator?.reset();
    resetReport();
    activeProfile=null;$('darkStatus').textContent='Профиль будет проверен по первому RAW-кадру.';
    accumulator?.render();
    bridge.send({ type: 'selectCamera', id });
  } catch (error) {
    switchingCamera = false;
    cameraSelect.value = selectedCaps?.id ?? '';
    line(`Camera selection error: ${String(error)}`);
    controls();
  }
};
updateLabels();
controls();

async function startCapture(dark=false) {
  starting = true;
  working = true;
  controls();
  try {
    const gpu = await ensureGpu();
    if (!starting) return;
    await gpu.reset();
    if (!starting) return;
    calibrationRun=dark;
    sessionHistoryMode=!dark && historyMode.value==='rotation'?'rotation':'static';
    gpu.setHistoryMode(sessionHistoryMode);
    gpu.setCalibrationCapture(dark);
    $('historyModeHud').textContent=sessionHistoryMode==='rotation'?'ROTATION':'STATIC';
    $('historyHint').textContent=sessionHistoryMode==='rotation'?'Проверка данных движения…':'Установите телефон неподвижно и начните накопление RAW';
    resetReport();
    nativeStartPending = true;
    bridge.start(Math.round(Number(exposure.value) * 1e6), Number(iso.value),sessionHistoryMode==='rotation');
  } catch (error) {
    starting = false;
    nativeStartPending = false;
    status.textContent = 'WebGPU error';
    line(error instanceof Error ? error.message : String(error));
  } finally { working = false; controls(); }
}
startButton.onclick=()=>startCapture(false);
$('captureDark').onclick=()=>{if(darkCovered.checked){settingsDialog.close();void startCapture(true);}};
$('deleteDark').onclick=async()=>{
  if(!activeProfile)return;
  working=true;controls();
  try{await darkStore('delete',activeProfile.key);activeProfile=null;$('darkStatus').textContent='Профиль удалён. Изменение применяется со следующей серии.';}
  catch(error){line(`Dark deletion failed: ${String(error)}`);}finally{working=false;controls();}
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
      schema: calibrationRun?'nightfield-dark-v1':sessionHistoryMode==='rotation'?'nightfield-rotation-v2':'nightfield-static-v2', startedAt: sessionStartedAt, stopReason,
      units: calibrationRun?'signed black-corrected sensor DN (dark calibration)':'signed dark-subtracted, lens-shading-corrected DN where available; no electron calibration',
      calibrationRun,isp:accumulator.ispStatus,lensShadingMap:lastShading,darkProfile:sessionDarkSummary,createdDarkProfile:calibrationRun&&activeProfile?profileSummary(activeProfile):null,
      display:{gain:Number(gain.value),color:colorMode.value,tone:toneMode.value},
      camera: selectedCaps, frames: accumulator.series.frames, exposureSumNs: accumulator.series.exposureNs,
      sensorSpanSeconds: accumulator.series.elapsedSeconds, deliveredFps: accumulator.series.fps, totalPacketBytes: totalBytes,
      nativeStats, roi: latestRegion,
      roiData: { width: region.width, height: region.height, channels:region.channels??['R','G1','G2','B'], means: Array.from(region.means), m2: Array.from(region.m2), counts: Array.from(region.counts), evidence:region.motion?'approximate effective N':'accepted observations' },
      metadata: reportFrames, metadataTruncated: accumulator.series.frames > reportFrames.length,
      limitations: [sessionHistoryMode==='rotation'?'rotation-only; no translation, optical flow or within-exposure deblurring':'static scene assumed', 'dark calibration may drift with temperature; calibration uncertainty is not included in std(mean)', 'no gain/exposure mixing', 'queue completion is not an isolated GPU execution timestamp'],
    };
    const json = JSON.stringify(report,jsonValue);
    bridge.send({ type: 'saveReport', json });
  } catch (error) { line(`Report error: ${String(error)}`); }
  finally { working = false; controls(); }
};
window.addEventListener('resize', () => accumulator?.render());

const settingsDialog = $('settingsDialog') as HTMLDialogElement;
const infoDialog = $('infoDialog') as HTMLDialogElement;
$('settingsOpen').onclick = () => settingsDialog.showModal();
$('infoOpen').onclick = () => infoDialog.showModal();
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => {
  button.onclick = () => ($(button.dataset.close!) as HTMLDialogElement).close();
});
$('requestCamera').onclick = () => {
  if (!window.rawBridge) { $('cameraInfoStatus').textContent = 'Запрос доступен в приложении на Android.'; return; }
  ($('requestCamera') as HTMLButtonElement).disabled = true;
  $('cameraInfoStatus').textContent = 'Получение характеристик…';
  bridge.send({ type: 'cameraInfo' });
};
$('saveCamera').onclick = () => {
  if (cameraInfo) bridge.send({ type: 'saveReport', json: JSON.stringify(cameraInfo, null, 2) });
};
