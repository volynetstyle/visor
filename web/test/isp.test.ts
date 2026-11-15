import test from 'node:test';import assert from 'node:assert/strict';
import {ispFrame} from './isp-fixtures.ts';import {colorProfile} from '../src/isp.ts';
import {calibrationKey,buildDarkProfile} from '../src/calibration.ts';import {parseRawFrame} from '../src/raw.ts';

test('NRAW v4 separates RAW bytes, shading grid, color and timing metadata',()=>{
  const f=ispFrame();assert.equal(f.payload.byteOffset,768);assert.equal(f.payload.byteLength,512);
  assert.equal(f.isp?.shading.length,16);assert.equal(f.isp?.maxAnalogIso,1600);
  assert.equal(f.isp?.imageCallbackNs,2_000_000_000n);assert.equal(f.isp?.rotationTimestampNs,1_998_000_000n);
  const b=f.buffer.slice(0);new DataView(b).setUint32(440,32,true);assert.throws(()=>parseRawFrame(b));
  assert.throws(()=>ispFrame(undefined,{shading:Array(16).fill(NaN)}));
});
test('camera color uses row-major matrix and reported gains; singular data remains sensor RGB',()=>{
  const f=ispFrame(undefined,{wb:[2,1,1,4],matrix:[1.5,-.5,0,0,1,0,0,-.5,1.5]});
  const p=colorProfile(f);assert.ok(p.calibrated);
  const neutral=[.5,1,.25],balanced=[neutral[0]*p.wb[0],neutral[1],neutral[2]*p.wb[3]];
  assert.deepEqual([0,1,2].map(r=>p.matrix.slice(r*3,r*3+3).reduce((v,x,c)=>v+x*balanced[c],0)),[1,1,1]);
  assert.equal(colorProfile(ispFrame(undefined,{matrix:Array(9).fill(0)})).calibrated,false);
});
test('dark profile keys distinguish actual ISO, exposure, camera and crop',()=>{
  const f=ispFrame();const key=calibrationKey('0',f);
  assert.notEqual(key,calibrationKey('1',f));assert.notEqual(key,calibrationKey('0',{...f,iso:801}));
  assert.notEqual(key,calibrationKey('0',{...f,exposureNs:f.exposureNs+1n}));
  assert.notEqual(key,calibrationKey('0',{...f,whiteLevel:f.whiteLevel-1}));
  assert.equal(key,calibrationKey('0',{...f,requestedIso:16000}));
});
test('dark calibration preserves signed offsets and classifies hot/unstable sites without floor clipping',()=>{
  const f=ispFrame(),means=new Float32Array(256).fill(-.5),m2=new Float32Array(256).fill(63),counts=new Float32Array(64).fill(64);
  means[0]=3;means[4]=40;m2[8]=6300;
  const p=buildDarkProfile('test',f,{means,m2,counts},64);
  assert.equal(p.mean[20],-.5);assert.equal(p.classes[0],1);assert.equal(p.classes[4],2);assert.equal(p.classes[8],3);
  assert.equal(p.variance[20],1);assert.equal(p.summary.hot,1);assert.equal(p.summary.unstable,1);
  assert.throws(()=>buildDarkProfile('test',f,{means,m2,counts},10));
  assert.throws(()=>buildDarkProfile('test',f,{means:new Float32Array(256).fill(200),m2,counts},64),/яркая/);
});
