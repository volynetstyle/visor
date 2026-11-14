import { MANUAL_SENSOR, MATCHED_RESULT, type RawFrame } from './raw.ts';

/** Fixed-gain experiment. DN are kept in a fixed unit; nominal ISO is never used as a gain calibration. */
export class StaticSeries {
  frames = 0;
  exposureNs = 0n;
  firstTimestampNs: bigint | null = null;
  lastTimestampNs: bigint | null = null;
  private reference: string | null = null;

  accept(frame: RawFrame) {
    if ((frame.flags & (MATCHED_RESULT | MANUAL_SENSOR)) !== (MATCHED_RESULT | MANUAL_SENSOR)) {
      throw new Error('Static experiment requires timestamp-matched actual metadata and manual capture');
    }
    const key = [frame.width, frame.height, frame.sensorWidth, frame.sensorHeight, frame.cropX, frame.cropY,
      frame.cfa, frame.sensorOrientation, frame.exposureNs, frame.iso].join('/');
    if (this.reference !== null && this.reference !== key) {
      throw new Error('Actual exposure, ISO or Bayer geometry changed. Stop and reset before accumulating a new series.');
    }
    if (this.lastTimestampNs !== null && frame.timestampNs <= this.lastTimestampNs) {
      throw new Error('Non-increasing sensor timestamp');
    }
    this.reference = key;
    this.firstTimestampNs ??= frame.timestampNs;
    this.lastTimestampNs = frame.timestampNs;
    this.frames++;
    this.exposureNs += frame.exposureNs;
  }

  get elapsedSeconds() {
    if (this.firstTimestampNs === null || this.lastTimestampNs === null) return 0;
    return Number(this.lastTimestampNs - this.firstTimestampNs) / 1e9;
  }

  get fps() { return this.frames > 1 ? (this.frames - 1) / this.elapsedSeconds : 0; }
}
