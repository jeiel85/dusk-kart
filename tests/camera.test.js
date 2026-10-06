import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraRig, helmetVibration, noise1 } from '../src/render/cameraRig.js';

// Minimal stand-in for KartModel: the rig only needs the body and its mount.
function stubModel() {
  const body = new THREE.Object3D();
  const camMount = new THREE.Object3D();
  camMount.position.set(0, 0.93, -0.3);
  body.add(camMount);
  return { body, camMount, setFirstPerson() {} };
}
const parked = { speed: 0, ay: 0, ax: 0, steer: 0, omega: 0, rumble: 0, impact: 0, vx: 0, vz: 0, x: 0, z: 0 };

test('helmet cam is perfectly still at a standstill', () => {
  const rig = new CameraRig(16 / 9);
  const model = stubModel();
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    // A body bump from the kart model must not leak into the helmet view either.
    model.body.position.y = (i % 2) * 0.004;
    rig.update(1 / 60, model, parked, 0);
    if (i > 240) seen.add(rig.camera.matrixWorld.elements.map((v) => v.toFixed(9)).join() + rig.camera.position.y.toFixed(9) + rig.camera.quaternion.toArray().map((v) => v.toFixed(9)).join());
  }
  assert.equal(seen.size, 1, 'camera pose does not change frame to frame');
  // Even parked on a curb nothing should move.
  const v = helmetVibration(3.21, 0, 1, 0);
  assert.deepEqual([v.y, v.pitch, v.roll].map(Math.abs), [0, 0, 0]);
});

test('vibration grows with speed and curbs, and stays small', () => {
  const peak = (speed, rumble, shake) => {
    let y = 0, p = 0;
    for (let t = 0; t < 20; t += 0.004) {
      const v = helmetVibration(t, speed, rumble, shake);
      y = Math.max(y, Math.abs(v.y)); p = Math.max(p, Math.abs(v.pitch));
    }
    return { y, p };
  };
  const slow = peak(5, 0, 0), fast = peak(25, 0, 0), curb = peak(25, 1, 0), hit = peak(25, 0, 1);
  assert.ok(slow.y < fast.y, 'faster shakes more');
  assert.ok(fast.y < curb.y && fast.y < hit.y, 'curbs and impacts stand out over road texture');
  assert.ok(fast.y <= 0.0035 && fast.p <= 0.0035, `road texture at top speed stays subtle (${fast.y}, ${fast.p})`);
  assert.ok(curb.p < 0.01, 'curb pitch well under a degree');
});

test('shake is smooth noise, independent of the frame rate', () => {
  // Same time → same value however you got there, and no sample-to-sample
  // jumps bigger than a smooth curve allows (no aliasing at 60 fps).
  assert.equal(noise1(12.345), noise1(12.345));
  let maxStep = 0, prev = helmetVibration(0, 25, 1, 0).y;
  for (let i = 1; i < 6000; i++) {
    const y = helmetVibration(i / 60, 25, 1, 0).y;
    maxStep = Math.max(maxStep, Math.abs(y - prev));
    prev = y;
  }
  // Peak-to-peak is about 2 × 0.0145 m; a 60 fps frame moves well under half of that.
  assert.ok(maxStep < 0.01, `frame-to-frame step ${maxStep}`);
  for (let x = -50; x < 50; x += 0.37) assert.ok(Math.abs(noise1(x)) <= 1);
});

test('shake setting 0 removes vibration and grain', () => {
  const rig = new CameraRig(16 / 9);
  rig.shakeScale = 0;
  const model = stubModel();
  const kart = { ...parked, speed: 25, rumble: 1, impact: 5000 };
  rig.update(1 / 60, model, kart, 0);
  const a = rig.camera.quaternion.clone();
  const ay = rig.camera.position.y;
  for (let i = 0; i < 30; i++) rig.update(1 / 60, model, { ...kart, impact: 0 }, 0);
  // Only the smoothed head motion remains, which has settled for a constant state.
  assert.ok(Math.abs(rig.camera.position.y - ay) < 1e-9);
  assert.ok(rig.camera.quaternion.angleTo(a) < 0.02);
  assert.equal(rig.lens(kart, { motionBlur: 1, lensDistortion: true }).grain, 0);
});
