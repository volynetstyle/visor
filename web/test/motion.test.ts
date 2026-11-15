import assert from 'node:assert/strict';
import test from 'node:test';
import { planMotion, quaternion } from '../src/motion.ts';
import { motionFrame } from './motion-fixtures.ts';
import { frame } from './fixtures.ts';

test('NRAW v3 preserves pose and calibration, and v2 remains readable for static capture',()=>{
  const f=motionFrame();
  assert.equal(f.payload.byteOffset,512);
  assert.deepEqual(f.motion?.intrinsics,[20,20,3.5,3.5,0]);
  assert.equal(f.motion?.timestampNs,1_125_000_000n);
  assert.equal(frame().motion,null);
});
test('current camera rays map to previous camera rays through calibrated device extrinsics',()=>{
  const c=[Math.SQRT1_2,0,0,Math.SQRT1_2];
  const a=motionFrame(undefined,{motion:{cameraFromDevice:c}});
  const first=planMotion(null,a);
  assert.ok(first.reference);
  const b=motionFrame(undefined,{timestamp:1_250_000_000n,motion:{cameraFromDevice:c,worldFromDevice:[0,Math.sin(.05),0,Math.cos(.05)]}});
  const result=planMotion(first.reference,b);
  assert.ok(result.reuse);
  const expected=[Math.cos(.1),-Math.sin(.1),0,Math.sin(.1),Math.cos(.1),0,0,0,1];
  result.rotation.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-6));
  assert.throws(()=>quaternion([0,0,0,0]));
});
test('clock, sensor gaps, exposure blur, calibration and noise failures never reuse history',()=>{
  const reference=planMotion(null,motionFrame()).reference;
  for(const partial of [
    {flags:62},{flags:61},{flags:59},{flags:55},{flags:47},{flags:31},
    {gapNs:31_000_000n},{accuracy:0},{accuracy:1},{exposureTravelRad:.2},{intrinsics:[NaN,20,0,0,0]},
    {worldFromDevice:[0,0,0,0]},{timestampNs:0n},
  ]) {
    const p=planMotion(reference,motionFrame(undefined,{timestamp:1_250_000_000n,motion:partial}));
    assert.equal(p.reuse,false,JSON.stringify(partial,(_,v)=>typeof v==='bigint'?String(v):v));
    assert.equal(p.reference,null);
  }
  assert.equal(planMotion(reference,motionFrame(undefined,{timestamp:1_250_000_000n,flags:23})).reuse,false);
  assert.equal(planMotion(reference,frame()).reuse,false);
});
test('large pose jumps and time gaps restart, then allow a fresh stationary history',()=>{
  const reference=planMotion(null,motionFrame()).reference;
  const f=motionFrame(undefined,{timestamp:4_000_000_000n});
  const gap=planMotion(reference,f);
  assert.equal(gap.reuse,false);assert.ok(gap.reference);
  assert.equal(planMotion(gap.reference,motionFrame(undefined,{timestamp:4_250_000_000n})).reuse,true);
  const jump=planMotion(reference,motionFrame(undefined,{timestamp:1_250_000_000n,motion:{worldFromDevice:[0,0,Math.sin(.3),Math.cos(.3)]}}));
  assert.equal(jump.reuse,false);assert.ok(jump.reference);
});
