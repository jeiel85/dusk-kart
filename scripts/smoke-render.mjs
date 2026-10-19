// Smoke test: execute the render layer in Node with a canvas stub, for every
// course and every weather. Catches runtime errors in the procedural scene
// build (new dressing, night look, headlight beams) without a GPU.
const ctxStub = () => new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 120 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'canvas') return { width: 8, height: 8 };
    return () => {};
  },
  set() { return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub() }) };

const THREE = await import('three');
const { Track, computeRacingLine, TRACKS, TRACK_IDS, WEATHERS } = await import('../src/sim/track.js');
const { buildTrackScene, buildSky } = await import('../src/render/trackScene.js');
const { KartModel } = await import('../src/render/kartModel.js');
const { CameraRig } = await import('../src/render/cameraRig.js');
const { Rain, WeatherLook } = await import('../src/render/weather.js');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); } catch (err) { failures++; console.log(`  FAIL ${name}: ${err.message}\n${err.stack.split('\n').slice(1, 3).join('\n')}`); }
};

for (const quality of ['low', 'high']) {
  console.log(`quality=${quality}`);
  for (const id of TRACK_IDS) {
    check(`scene ${id}`, () => {
      const track = new Track(TRACKS[id]);
      const line = computeRacingLine(track);
      const ts = buildTrackScene(track, line, { quality });
      ts.update(1.5); ts.update(9.75); // bird/balloon/crowd animation frames
      ts.setStartLights(3, false); ts.setStartLights(0, true);
      ts.setWet(true); ts.update(3); ts.setWet(false);
      ts.setNight(true); ts.update(4); ts.setNight(false);
      let meshes = 0, inst = 0, lights = 0;
      ts.group.traverse((o) => { if (o.isMesh) meshes++; if (o.isInstancedMesh) inst++; if (o.isLight) lights++; });
      if (meshes < 50) throw new Error(`too few meshes: ${meshes}`);
    });
  }
}

console.log('weather looks');
{
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0, 0);
  const sky = buildSky(new THREE.Vector3(-0.75, 0.2, -0.62));
  const hemi = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight();
  const renderer = { toneMappingExposure: 1 };
  const track = new Track(TRACKS.lumen);
  const ts = buildTrackScene(track, computeRacingLine(track), { quality: 'high' });
  const rain = new Rain('high');
  const look = new WeatherLook({ scene, renderer, sky, hemi, sun, trackScene: ts, rain });
  for (const w of WEATHERS) {
    check(`apply ${w}`, () => {
      look.apply(w);
      if (look.id !== w) throw new Error('id not applied');
      if (rain.mesh.visible !== (w === 'rain')) throw new Error('rain mesh visibility');
    });
  }
  look.apply('unknown-id'); if (look.id !== 'dry') { failures++; console.log('  FAIL unknown weather fallback'); }
  // Course change mid-weather: the new scene inherits wet + night.
  const ts2 = buildTrackScene(track, computeRacingLine(track), { quality: 'high' });
  look.apply('night'); look.setTrackScene(ts2); ts2.update(1);
  if (!ts2.group) throw new Error('track scene swap');
}

console.log('karts & camera');
check('kart model + headlights', () => {
  const m = new KartModel({ color: '#2f6bff', number: 12, suit: '#1e4fd8' });
  m.setNight(false); if (m.headlights.visible) throw new Error('beams on by day');
  m.setNight(true); if (!m.headlights.visible) throw new Error('beams off at night');
  m.setFirstPerson(true); m.update({ x: 0, z: 0, heading: 0.3, steer: 0.1, ax: 0, ay: 1, rumble: 0, impact: 0, wheels: [0, 0, 0, 0], rpm: 4000, throttle: 1 });
  m.dispose();
});
check('camera rig fps kick + lens', () => {
  const rig = new CameraRig(16 / 9);
  const model = { body: new THREE.Object3D(), camMount: new THREE.Object3D(), setFirstPerson() {} };
  model.camMount.position.set(0, 0.93, -0.3);
  model.body.add(model.camMount);
  const kart = { speed: 22, ay: 2, ax: 0, steer: 0.2, omega: 0.1, rumble: 0, impact: 0, vx: 0, vz: 22, x: 0, z: 0 };
  rig.update(1 / 60, model, kart, 0);
  const fovFast = rig.camera.fov;
  rig.update(1 / 60, model, { ...kart, speed: 0, vx: 0, vz: 0 }, 0);
  if (fovFast <= rig.camera.fov + 3) throw new Error(`helmet fov does not kick (${fovFast} vs ${rig.camera.fov})`);
  const lens = rig.lens(kart, { motionBlur: 1, lensDistortion: true });
  if (lens.blur < 0.1 || lens.streak < 0.5) throw new Error(`lens weak at speed: ${JSON.stringify(lens)}`);
  if (rig.lens({ speed: 0 }, { motionBlur: 1, lensDistortion: true }).streak !== 0) throw new Error('streaks while parked');
});

console.log(failures ? `\n${failures} FAILURES` : '\nALL SMOKE TESTS PASSED');
process.exit(failures ? 1 : 0);
