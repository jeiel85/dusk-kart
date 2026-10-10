import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../sim/math.js';
import * as T from './textures.js';

const ROAD_TILE = 9; // metres of road per texture repeat

/** Ribbon following the centre line between two lateral offsets. */
function ribbon(track, i0, i1, offA, offB, y, vScale) {
  const rows = i1 - i0 + 1;
  const pos = new Float32Array(rows * 2 * 3);
  const uv = new Float32Array(rows * 2 * 2);
  const idx = [];
  for (let r = 0; r < rows; r++) {
    const i = track.idx(i0 + r);
    const a = typeof offA === 'function' ? offA(i) : offA;
    const b = typeof offB === 'function' ? offB(i) : offB;
    const px = track.px[i], pz = track.pz[i], nx = track.nx[i], nz = track.nz[i];
    pos.set([px + nx * a, y, pz + nz * a, px + nx * b, y, pz + nz * b], r * 6);
    const v = ((i0 + r) * track.ds) / vScale;
    uv.set([0, v, 1, v], r * 4);
    if (r < rows - 1) {
      const A = r * 2, B = A + 1, C = A + 2, D = A + 3;
      idx.push(A, B, C, B, D, C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Walk an offset curve, calling cb at equal arc-length spacing. */
function placeAlong(track, offset, spacing, cb, phase = 0) {
  let since = spacing - phase; // distance travelled since the last placement
  let n = 0;
  let px = track.px[0] + track.nx[0] * offset, pz = track.pz[0] + track.nz[0] * offset;
  for (let k = 1; k <= track.count; k++) {
    const i = track.idx(k);
    const x = track.px[i] + track.nx[i] * offset, z = track.pz[i] + track.nz[i] * offset;
    const seg = Math.hypot(x - px, z - pz);
    let pos = 0;
    while (seg - pos >= spacing - since) {
      pos += spacing - since;
      since = 0;
      const t = pos / seg;
      cb(px + (x - px) * t, pz + (z - pz) * t, Math.atan2(track.tx[i], track.tz[i]), n++, i);
    }
    since += seg - pos;
    px = x; pz = z;
  }
}

function distanceToTrack(track, x, z) {
  const p = track.project(x, z);
  return Math.abs(p.lateral);
}

const bulbVertex = /* glsl */ `
  attribute float aPhase;
  varying float vPhase;
  void main() {
    vPhase = aPhase;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const bulbFragment = /* glsl */ `
  uniform float uTime;
  uniform float uMode;
  varying float vPhase;
  vec3 hsv(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
  void main() {
    float chase = 0.55 + 0.45 * sin(uTime * 6.0 - vPhase * 40.0);
    vec3 c = uMode < 0.5 ? hsv(fract(vPhase * 3.0 + uTime * 0.08)) : mix(vec3(1.0, 0.75, 0.35), vec3(1.0), 0.3);
    gl_FragColor = vec4(c * (1.4 + 3.2 * chase), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function bulbMaterial(mode = 0) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMode: { value: mode } },
    vertexShader: bulbVertex,
    fragmentShader: bulbFragment,
    toneMapped: true,
  });
}

function neon(color, intensity = 5) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
}

export function buildTrackScene(track, racingLine, { quality = 'high' } = {}) {
  const group = new THREE.Group();
  const animated = [];
  const rand = mulberry32(1234);
  const hw = track.halfWidth;
  const bar = track.barrier;
  const n = track.count;

  // --- ground ------------------------------------------------------------
  const grass = T.grassTexture();
  grass.repeat.set(160, 160);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 1, color: 0x9aa39a }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);

  // Paved area under the funfair and the paddock.
  const lot = T.lotTexture();
  lot.repeat.set(30, 12);
  const lotMat = new THREE.MeshStandardMaterial({ map: lot, roughness: 0.95 });
  const lotMesh = new THREE.Mesh(new THREE.PlaneGeometry(190, 70), lotMat);
  lotMesh.rotation.x = -Math.PI / 2;
  lotMesh.position.set(-20, -0.01, -104);
  lotMesh.receiveShadow = true;
  group.add(lotMesh);

  // --- road, aprons, curbs --------------------------------------------------
  const roadMat = new THREE.MeshStandardMaterial({ map: T.roadTexture(), roughness: 1, metalness: 0 });
  const road = new THREE.Mesh(ribbon(track, 0, n, -hw, hw, 0, ROAD_TILE), roadMat);
  road.receiveShadow = true;
  group.add(road);

  const conc = T.concreteTexture();
  const apronMat = new THREE.MeshStandardMaterial({ map: conc, roughness: 1, color: 0x9c9890 });
  for (const [a, b] of [[-bar - 0.9, -hw], [hw, bar + 0.9]]) {
    const g = ribbon(track, 0, n, a, b, 0.002, 4);
    const m = new THREE.Mesh(g, apronMat);
    m.receiveShadow = true;
    group.add(m);
  }

  const curbMat = new THREE.MeshStandardMaterial({
    map: T.curbTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  for (const side of [-1, 1]) {
    const flags = side < 0 ? track.curbL : track.curbR;
    let i = 0;
    while (i < n) {
      if (!flags[i]) { i++; continue; }
      let j = i;
      while (j < n && flags[j]) j++;
      const a = side < 0 ? -hw - 0.05 : hw - track.curbWidth;
      const b = side < 0 ? -hw + track.curbWidth : hw + 0.05;
      const m = new THREE.Mesh(ribbon(track, i, Math.min(j, n), a, b, 0.018, 2.4), curbMat);
      m.receiveShadow = true;
      group.add(m);
      i = j;
    }
  }

  // Rubbered-in racing line.
  const rubber = T.rubberTexture();
  const rubberMat = new THREE.MeshBasicMaterial({
    color: 0x000000, alphaMap: rubber, transparent: true, opacity: 0.42, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const off = racingLine.offset;
  group.add(new THREE.Mesh(ribbon(track, 0, n, (i) => off[i] - 1.1, (i) => off[i] + 1.1, 0.004, 14), rubberMat));

  // Start / finish line and grid boxes.
  const paint = new THREE.MeshBasicMaterial({ color: 0xe8e8e2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const checker = new THREE.Mesh(new THREE.PlaneGeometry(2 * hw, 1.1), new THREE.MeshStandardMaterial({
    map: T.checkerTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  const f0 = track.frameAt(0);
  checker.rotation.x = -Math.PI / 2;
  const cHolder = new THREE.Group();
  cHolder.position.set(f0.x, 0.006, f0.z);
  cHolder.rotation.y = Math.atan2(f0.tx, f0.tz);
  cHolder.add(checker);
  group.add(cHolder);
  for (let slot = 0; slot < 8; slot++) {
    const s = -6 - slot * 4.5 + 1.2;
    const f = track.frameAt(s);
    const side = slot % 2 === 0 ? -1.8 : 1.8;
    const box = new THREE.Group();
    box.position.set(f.x + f.nx * side, 0.006, f.z + f.nz * side);
    box.rotation.y = Math.atan2(f.tx, f.tz);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.12), paint);
    front.rotation.x = -Math.PI / 2;
    box.add(front);
    for (const sx of [-0.75, 0.75]) {
      const leg = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.8), paint);
      leg.rotation.x = -Math.PI / 2;
      leg.position.set(sx, 0, -0.4);
      box.add(leg);
    }
    group.add(box);
  }

  // Orange braking marks painted across the road before slow corners.
  const orangeMat = new THREE.MeshBasicMaterial({
    color: 0xff7a1a, alphaMap: rubber, transparent: true, opacity: 0.85, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const v = racingLine.speed;
  const apexes = [];
  for (let i = 0; i < n; i++) {
    if (v[i] < 15 && v[i] <= v[track.idx(i - 1)] && v[i] < v[track.idx(i + 1)]) {
      if (!apexes.length || i - apexes[apexes.length - 1] > 40) apexes.push(i);
    }
  }
  for (const a of apexes) {
    let b = a;
    while (v[track.idx(b - 1)] > v[track.idx(b)] + 0.01 && a - b < 80) b--;
    for (const k of [0, 9, 18]) {
      const f = track.frameAt((b - k) * track.ds);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * hw * 0.92, 0.9), orangeMat);
      m.rotation.x = -Math.PI / 2;
      const h = new THREE.Group();
      h.position.set(f.x, 0.007, f.z);
      h.rotation.y = Math.atan2(f.tx, f.tz) + 0.35;
      h.add(m);
      group.add(h);
    }
  }

  // --- barriers ------------------------------------------------------------
  const blockGeo = new RoundedBoxGeometry(1.14, 0.82, 0.6, 2, 0.1);
  blockGeo.translate(0, 0.41, 0);
  const blockMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.0 });
  const placements = [];
  for (const side of [-1, 1]) {
    placeAlong(track, side * (bar + 0.3), 1.2, (x, z, h) => placements.push([x, z, h]), 0.3);
  }
  const blocks = new THREE.InstancedMesh(blockGeo, blockMat, placements.length);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const red = new THREE.Color(0xd8231f), white = new THREE.Color(0xf1f1ec);
  placements.forEach(([x, z, h], k) => {
    q.setFromAxisAngle(up, h - Math.PI / 2);
    mtx.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1));
    blocks.setMatrixAt(k, mtx);
    blocks.setColorAt(k, k % 2 ? red : white);
  });
  blocks.castShadow = quality === 'high';
  blocks.receiveShadow = true;
  group.add(blocks);

  // Chain-link fence behind the barriers.
  const fenceTex = T.chainLinkTexture();
  fenceTex.repeat.set(1, 1);
  const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, color: 0x6c7078, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const o = side * (bar + 1.6);
    const pos = [], uv = [], idx = [];
    let len = 0;
    for (let k = 0; k <= n; k++) {
      const i = track.idx(k);
      const x = track.px[i] + track.nx[i] * o, z = track.pz[i] + track.nz[i] * o;
      if (k > 0) {
        const p = track.idx(k - 1);
        len += Math.hypot(x - (track.px[p] + track.nx[p] * o), z - (track.pz[p] + track.nz[p] * o));
      }
      pos.push(x, 0, z, x, 2.2, z);
      uv.push(len / 0.9, 0, len / 0.9, 2.2 / 0.9);
      if (k < n) { const A = k * 2; idx.push(A, A + 2, A + 1, A + 1, A + 2, A + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, fenceMat));
  }

  // --- street lamps with fake light pools ---------------------------------
  const lampSpots = [];
  for (const side of [-1, 1]) {
    placeAlong(track, side * (bar + 2.4), 38, (x, z, h) => lampSpots.push([x, z, h, side]), side > 0 ? 19 : 0);
  }
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 7, 8);
  poleGeo.translate(0, 3.5, 0);
  const armGeo = new THREE.BoxGeometry(0.08, 0.08, 1.6);
  const headGeo = new THREE.BoxGeometry(0.34, 0.12, 0.7);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.7, roughness: 0.4 });
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.86, 0.62).multiplyScalar(9) });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
  const arms = new THREE.InstancedMesh(armGeo, poleMat, lampSpots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
  const poolTex = T.glowTexture([255, 220, 170], 0.14);
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const poolGeo = new THREE.PlaneGeometry(13, 13);
  poolGeo.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lampSpots.length);
  lampSpots.forEach(([x, z, h, side], k) => {
    // Arm points towards the road (inwards).
    const ang = Math.atan2(side * Math.cos(h), -side * Math.sin(h));
    const dx = Math.sin(ang), dz = Math.cos(ang);
    q.setFromAxisAngle(up, ang);
    mtx.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1));
    poles.setMatrixAt(k, mtx);
    mtx.compose(new THREE.Vector3(x + dx * 0.8, 7, z + dz * 0.8), q, new THREE.Vector3(1, 1, 1));
    arms.setMatrixAt(k, mtx);
    mtx.compose(new THREE.Vector3(x + dx * 1.5, 6.92, z + dz * 1.5), q, new THREE.Vector3(1, 1, 1));
    heads.setMatrixAt(k, mtx);
    mtx.compose(new THREE.Vector3(x + dx * 3.5, 0.03, z + dz * 3.5), q, new THREE.Vector3(1, 1, 1));
    pools.setMatrixAt(k, mtx);
  });
  poles.castShadow = true;
  group.add(poles, arms, heads, pools);

  // --- start gantry --------------------------------------------------------
  const gantry = new THREE.Group();
  gantry.position.set(f0.x, 0, f0.z);
  gantry.rotation.y = Math.atan2(f0.tx, f0.tz);
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.45 });
  for (const sx of [-(bar + 0.9), bar + 0.9]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), trussMat);
    p.position.set(sx, 3, 0);
    p.castShadow = true;
    gantry.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * bar + 2.4, 1.1, 0.5), trussMat);
  beam.position.set(0, 5.6, 0);
  gantry.add(beam);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(2 * bar + 1.6, 0.9), new THREE.MeshBasicMaterial({ map: T.bannerTexture(`LUMEN PARK  ·  ${track.def.tag || 'DUSK KART'}`) }));
  // Faces the approaching karts (they come from local -Z).
  banner.position.set(0, 5.6, -0.26);
  banner.rotation.y = Math.PI;
  gantry.add(banner);
  const lightsOff = new THREE.MeshStandardMaterial({ color: 0x220707, roughness: 0.3 });
  const lightsRed = neon(0xff2010, 14);
  const lightsGreen = neon(0x20ff60, 14);
  const startLamps = [];
  for (let k = 0; k < 5; k++) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), lightsOff);
    lamp.position.set((k - 2) * 0.62, 4.75, -0.26);
    lamp.rotation.y = Math.PI;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.3), trussMat);
    housing.position.set((k - 2) * 0.62, 4.75, -0.05);
    gantry.add(housing, lamp);
    startLamps.push(lamp);
  }
  group.add(gantry);
  const setStartLights = (count, green) => {
    startLamps.forEach((l, k) => { l.material = green ? lightsGreen : k < count ? lightsRed : lightsOff; });
  };

  // --- funfair on the outside of the main straight ---------------------------
  const fair = new THREE.Group();
  group.add(fair);
  const bulbs = []; // [x,y,z]
  // Booth row.
  for (let b = 0; b < 8; b++) {
    const x = -78 + b * 14.5;
    const hue = (b * 47) % 360;
    const booth = new THREE.Group();
    booth.position.set(x, 0, -80);
    const body = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 4.5), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue / 360, 0.35, 0.22), roughness: 0.8 }));
    body.position.y = 1.7;
    body.castShadow = true;
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.25, 2.4), new THREE.MeshStandardMaterial({ map: T.stripeTexture(`hsl(${hue},85%,55%)`, '#f5f5f5', 10), roughness: 0.7 }));
    canopy.position.set(0, 3.1, 3.2);
    canopy.rotation.x = 0.25;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.6), new THREE.MeshBasicMaterial({ map: T.boothSignTexture(b, hue), color: new THREE.Color(2.2, 2.2, 2.2) }));
    sign.position.set(0, 4.3, 2.3);
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.2), neon(new THREE.Color().setHSL(((hue + 30) % 360) / 360, 0.9, 0.55), 1.6));
    inside.position.set(0, 1.5, 2.26);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(8, 0.08, 0.08), neon(new THREE.Color().setHSL(((hue + 200) % 360) / 360, 1, 0.6), 7));
    trim.position.set(0, 3.45, 2.3);
    booth.add(body, canopy, sign, inside, trim);
    fair.add(booth);
    for (let k = 0; k < 14; k++) bulbs.push([x - 4 + (k * 8) / 13, 5.3 - Math.sin((k / 13) * Math.PI) * 0.4, -77.6]);
  }

  // Ferris wheel.
  const wheel = new THREE.Group();
  wheel.position.set(-28, 21, -118);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 0.6, roughness: 0.35 });
  const R = 17;
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.25, 8, 96), rimMat));
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R - 1.2, 0.12, 6, 96), rimMat));
  const spokes = 24;
  const wheelBulbs = [];
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, R, 5), rimMat);
    sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0);
    sp.rotation.z = a - Math.PI / 2;
    wheel.add(sp);
    for (let j = 1; j <= 6; j++) wheelBulbs.push([Math.cos(a) * (R * j) / 6.2, Math.sin(a) * (R * j) / 6.2, 0.2]);
  }
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * Math.PI * 2;
    wheelBulbs.push([Math.cos(a) * R, Math.sin(a) * R, 0.3]);
  }
  const gondolaMat = new THREE.MeshStandardMaterial({ color: 0xffc23d, roughness: 0.5 });
  const gondolas = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const gnd = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 1.6), gondolaMat);
    gnd.position.set(Math.cos(a) * R, Math.sin(a) * R - 1.2, 0);
    wheel.add(gnd);
    gondolas.push(gnd);
  }
  const wheelBulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 4), bulbMaterial(0), wheelBulbs.length);
  const phase = new Float32Array(wheelBulbs.length);
  wheelBulbs.forEach((p, k) => { mtx.makeTranslation(p[0], p[1], p[2]); wheelBulbMesh.setMatrixAt(k, mtx); phase[k] = k / wheelBulbs.length; });
  wheelBulbMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  wheel.add(wheelBulbMesh);
  fair.add(wheel);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 23, 8), rimMat);
      leg.position.set(-28 + sx * 5.5, 10.5, -118 + sz * 2.2);
      leg.rotation.z = -sx * 0.25;
      leg.rotation.x = sz * 0.1;
      fair.add(leg);
    }
  }
  animated.push((t) => {
    wheel.rotation.z = t * 0.07;
    for (const gnd of gondolas) gnd.rotation.z = -wheel.rotation.z;
    wheelBulbMesh.material.uniforms.uTime.value = t;
  });

  // Pendulum ride (like the one in the reference shot).
  const pend = new THREE.Group();
  pend.position.set(22, 13, -102);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xe23d8b, metalness: 0.4, roughness: 0.4 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 15, 8), frameMat);
      leg.position.set(22 + sx * 4.5, 6.5, -102 + sz * 3);
      leg.rotation.x = -sz * 0.22;
      fair.add(leg);
    }
  }
  const arm = new THREE.Group();
  const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 11, 0.8), frameMat);
  armMesh.position.y = -5.5;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.6, 32), new THREE.MeshStandardMaterial({ color: 0x2b2f7a }));
  disc.position.y = -11;
  const discGlow = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.12, 6, 48), neon(0x33e6ff, 8));
  discGlow.rotation.x = Math.PI / 2;
  discGlow.position.y = -11;
  const armStrip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 10.5, 0.85), neon(0xffe640, 6));
  armStrip.position.y = -5.5;
  arm.add(armMesh, armStrip, disc, discGlow);
  pend.add(arm);
  fair.add(pend);
  animated.push((t) => {
    arm.rotation.z = Math.sin(t * 0.55) * 1.5;
    disc.rotation.y = t * 1.5;
  });

  // Carousel.
  const car = new THREE.Group();
  car.position.set(-66, 0, -104);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.4, 0.8, 40), new THREE.MeshStandardMaterial({ color: 0x7a2130, roughness: 0.6 }));
  base.position.y = 0.4;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(8, 3.5, 24, 1, true), new THREE.MeshStandardMaterial({ map: T.stripeTexture('#e62b3b', '#f7e9c8', 24), side: THREE.DoubleSide, roughness: 0.6 }));
  roof.position.y = 6.8;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 5, 16), new THREE.MeshStandardMaterial({ color: 0xf0c060, metalness: 0.6, roughness: 0.3 }));
  post.position.y = 3;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.9, 0.12, 6, 64), neon(0xffd27a, 7));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 5.05;
  const spin = new THREE.Group();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const horse = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 1.6), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(k / 10, 0.6, 0.65) }));
    horse.position.set(Math.cos(a) * 5, 1.9, Math.sin(a) * 5);
    horse.rotation.y = -a;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 6), post.material);
    pole.position.set(Math.cos(a) * 5, 3, Math.sin(a) * 5);
    spin.add(horse, pole);
  }
  car.add(base, roof, post, ring, spin);
  fair.add(car);
  animated.push((t) => { spin.rotation.y = t * 0.6; roof.rotation.y = t * 0.6; spin.children.forEach((c, k) => { if (k % 2 === 0) c.position.y = 1.9 + Math.sin(t * 2 + k) * 0.35; }); });

  // Drop tower.
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, 42, 1.6), new THREE.MeshStandardMaterial({ color: 0x1d2330, metalness: 0.5, roughness: 0.5 }));
  tower.position.set(58, 21, -118);
  fair.add(tower);
  for (let k = 0; k < 40; k++) bulbs.push([58 + (k % 2 ? 0.85 : -0.85), 1 + k, -117.1]);

  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 4), bulbMaterial(0), bulbs.length);
  const ph2 = new Float32Array(bulbs.length);
  bulbs.forEach((p, k) => { mtx.makeTranslation(p[0], p[1], p[2]); bulbMesh.setMatrixAt(k, mtx); ph2[k] = k / bulbs.length; });
  bulbMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph2, 1));
  fair.add(bulbMesh);
  animated.push((t) => { bulbMesh.material.uniforms.uTime.value = t; });

  // Coloured light spilling from the fair onto the barriers.
  const fairLights = [
    [-60, 6, -84, 0xff3fb4], [-20, 6, -84, 0x39d7ff], [20, 6, -84, 0xffa733], [60, 6, -84, 0x7dff5a], [-28, 10, -108, 0xff5a3c],
  ];
  if (quality !== 'low') {
    for (const [x, y, z, c] of fairLights) {
      const L = new THREE.PointLight(c, 220, 32, 2);
      L.position.set(x, y, z);
      fair.add(L);
    }
  }

  // --- paddock / clubhouse in the infield ---------------------------------
  const club = new THREE.Group();
  club.position.set(-30, 0, -36);
  const winTex = T.windowsTexture(3);
  winTex.repeat.set(2, 0.4);
  const clubBody = new THREE.Mesh(new THREE.BoxGeometry(26, 6, 9), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: 1.2, map: winTex }));
  clubBody.position.y = 3;
  clubBody.castShadow = true;
  const clubRoof = new THREE.Mesh(new THREE.BoxGeometry(28, 0.5, 11), new THREE.MeshStandardMaterial({ color: 0x33363c }));
  clubRoof.position.y = 6.25;
  const clubSign = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.6), new THREE.MeshBasicMaterial({ map: T.bannerTexture('LUMEN PARK KARTING', '#0c0f16', '#5fd4ff'), color: new THREE.Color(1.8, 1.8, 1.8) }));
  clubSign.position.set(0, 7.4, -0.2);
  clubSign.rotation.y = Math.PI;
  club.add(clubBody, clubRoof, clubSign);
  group.add(club);

  // --- trees ---------------------------------------------------------------
  const treeSpots = [];
  for (let k = 0; k < 2600 && treeSpots.length < (quality === 'low' ? 150 : 420); k++) {
    const x = (rand() - 0.5) * 520, z = (rand() - 0.5) * 520;
    if (z < -60 && z > -140 && x > -110 && x < 80) continue; // funfair
    if (Math.abs(x + 30) < 20 && Math.abs(z + 36) < 10) continue; // clubhouse
    if (distanceToTrack(track, x, z) < bar + 7) continue;
    treeSpots.push([x, z, 0.7 + rand() * 0.8]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
  trunkGeo.translate(0, 1.5, 0);
  const crownGeo = new THREE.ConeGeometry(2.2, 7, 7);
  crownGeo.translate(0, 6, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x3b2c22 }), treeSpots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x1f3a26, roughness: 0.95, flatShading: true }), treeSpots.length);
  treeSpots.forEach(([x, z, s], k) => {
    q.setFromAxisAngle(up, rand() * 6);
    mtx.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.4), s));
    trunks.setMatrixAt(k, mtx);
    crowns.setMatrixAt(k, mtx);
    crowns.setColorAt(k, new THREE.Color().setHSL(0.36 + rand() * 0.06, 0.35, 0.14 + rand() * 0.08));
  });
  crowns.castShadow = quality === 'high';
  group.add(trunks, crowns);

  // --- distant city and hills ----------------------------------------------
  const cityMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, emissive: 0xffffff, emissiveIntensity: 0.9 });
  for (let k = 0; k < 46; k++) {
    const a = -0.4 - rand() * 2.4; // mostly south-west to south-east
    const r = 300 + rand() * 180;
    const w = 14 + rand() * 20, h = 18 + rand() * 60, d = 14 + rand() * 18;
    const g = new THREE.BoxGeometry(w, h, d);
    const tex = T.windowsTexture(40 + k);
    tex.repeat.set(w / 30, h / 60);
    const mat = cityMat.clone();
    mat.map = tex; mat.emissiveMap = tex;
    const b = new THREE.Mesh(g, mat);
    b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    b.rotation.y = rand() * Math.PI;
    group.add(b);
  }
  const hillPts = [];
  const HILLS = 180;
  for (let k = 0; k <= HILLS; k++) {
    const a = (k / HILLS) * Math.PI * 2;
    const h = 22 + 28 * Math.abs(Math.sin(a * 3.1 + 1)) + 16 * Math.sin(a * 7.3) + 8 * Math.sin(a * 17.1);
    hillPts.push(a, h);
  }
  const hp = [], hi = [];
  for (let k = 0; k <= HILLS; k++) {
    const a = hillPts[k * 2], h = hillPts[k * 2 + 1];
    hp.push(Math.cos(a) * 700, -2, Math.sin(a) * 700, Math.cos(a) * 700, h, Math.sin(a) * 700);
    if (k < HILLS) { const A = k * 2; hi.push(A, A + 1, A + 2, A + 1, A + 3, A + 2); }
  }
  const hillGeo = new THREE.BufferGeometry();
  hillGeo.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
  hillGeo.setIndex(hi);
  group.add(new THREE.Mesh(hillGeo, new THREE.MeshBasicMaterial({ color: 0x1a2236, side: THREE.DoubleSide, fog: true })));

  // Wet look: lower roughness so lamp and sun highlights streak across the
  // road, darker albedo (water darkens asphalt), brighter lamp pools as a
  // cheap stand-in for their reflections. Dry values are read back from
  // the materials so the two states can never drift apart.
  const wetTargets = [
    [roadMat, 0.28, 0.75], [apronMat, 0.45, 0.7], [curbMat, 0.22, 0.8], [lotMat, 0.4, 0.7],
  ].map(([m, rough, dark]) => ({ m, rough, dark, dry: { rough: m.roughness, color: m.color.clone() } }));
  const poolDry = poolMat.color.clone();
  const setWet = (wet) => {
    for (const t of wetTargets) {
      t.m.roughness = wet ? t.rough : t.dry.rough;
      t.m.color.copy(t.dry.color);
      if (wet) t.m.color.multiplyScalar(t.dark);
    }
    poolMat.color.copy(poolDry);
    if (wet) poolMat.color.multiplyScalar(1.7);
    rubberMat.opacity = wet ? 0.6 : 0.42;
  };

  return {
    group,
    setStartLights,
    setWet,
    update(t) { for (const f of animated) f(t); },
  };
}

/** Dusk sky dome with a warm horizon, soft cloud bands and the set sun. */
export function buildSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: sunDir.clone().normalize() },
      uTop: { value: new THREE.Color(0x0f2350) },
      uMid: { value: new THREE.Color(0x3d5a8c) },
      uHorizon: { value: new THREE.Color(0xe79a6e) },
      uGlow: { value: new THREE.Color(0xff8a3d) },
      uTime: { value: 0 },
      uOvercast: { value: 0 }, // 0 = broken dusk clouds, 1 = solid rain cover
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uTop, uMid, uHorizon, uGlow;
      uniform float uTime, uOvercast;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, h));
        col = mix(col, uTop, smoothstep(0.15, 0.7, h));
        float sun = max(dot(d, uSun), 0.0);
        float sunVis = 1.0 - 0.85 * uOvercast;
        col += uGlow * pow(sun, 8.0) * 0.9 * sunVis * (1.0 - smoothstep(0.0, 0.35, h));
        col += uGlow * pow(sun, 60.0) * 0.6 * sunVis;
        // Cloud bands, lit from below near the sun.
        vec2 uv = d.xz / max(h + 0.12, 0.05);
        float c = fbm(uv * 1.3 + vec2(uTime * 0.004, 0.0));
        c = smoothstep(0.5 - 0.4 * uOvercast, 0.85 - 0.3 * uOvercast, c) * smoothstep(0.02, 0.2, h) * (1.0 - smoothstep(0.5 + 0.4 * uOvercast, 0.9 + 0.1 * uOvercast, h));
        vec3 cloud = mix(vec3(0.22, 0.25, 0.35), uGlow * 0.9 + vec3(0.2), pow(sun, 3.0) * sunVis);
        col = mix(col, cloud * (1.0 - 0.35 * uOvercast), c * (0.75 + 0.2 * uOvercast));
        col = mix(col, uHorizon * 0.25, smoothstep(0.0, -0.08, h));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
