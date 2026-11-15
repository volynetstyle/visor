import type {RawFrame} from './raw.ts';
export function colorProfile(frame:RawFrame) {
  const isp=frame.isp;
  const m=isp?.matrix;
  const determinant=m?m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]):0;
  const calibrated=!!isp && (isp.flags&3)===3 && Number.isFinite(determinant) && Math.abs(determinant)>1e-6;
  return {calibrated,source:calibrated?'CaptureResult gains + transform -> linear sRGB':'uncalibrated sensor RGB',
    wb:calibrated?isp!.wb:[1,1,1,1],matrix:calibrated?isp!.matrix:[1,0,0,0,1,0,0,0,1],neutral:isp?.neutral??null};
}
