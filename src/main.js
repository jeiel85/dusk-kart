import * as THREE from 'three';
import './style.css';
import { Track, computeRacingLine } from './sim/track.js';
import { Kart, KART_SPEC, collideKarts } from './sim/kart.js';
import { AIDriver } from './sim/ai.js';
import { RaceTracker, gridSlot } from './sim/race.js';
import { DriveAssist, DRIVE_MODES, DRIVE_MODE_LABELS, PHYSICS_ASSISTS } from './sim/assist.js';
import { clamp, mulberry32 } from './sim/math.js';
import { buildTrackScene, buildSky } from './render/trackScene.js';
import { KartModel } from './render/kartModel.js';
import { CameraRig, CAMERA_MODES, CAMERA_LABELS } from './render/cameraRig.js';
import { PostFX } from './render/postfx.js';
import { SkidMarks } from './render/skidmarks.js';
import { rubberTexture, nameTagTexture } from './render/textures.js';
import { KartAudio } from './audio.js';
import { Input } from './input.js';
import { Hud, fmtTime, escapeHtml } from './hud.js';
import { NetSession, randomRoomCode, now } from './net.js';

const STEP = 1 / 240;
const RACE_LAPS = 3;
const COLORS = ['#2f6bff', '#e8322b', '#22b573', '#ff9f1a', '#9b5cff', '#f5d020', '#1fc8e0', '#ff4fa3'];
const BOT_NAMES = ['Mika', 'Jun', 'Rosa', 'Theo', 'Ari', 'Nils', 'Yuna'];
const SUITS = ['#1e4fd8', '#1d8a4b', '#e07b12', '#6d3fd1', '#2a2a2a', '#b0b0b0', '#c9202a'];
const params = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  camera: 'helmet', motionBlur: 1, lensDistortion: true, driveMode: 'easy', volume: 0.8,
  quality: isTouch ? 'low' : 'high', name: '', color: COLORS[0], number: 12,
};
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('duskkart.settings') || '{}') || {}; } catch { /* corrupt or blocked storage: use defaults */ }
  // v0.1.0 stored a single on/off "assists" flag.
  if (saved.driveMode === undefined && saved.assists !== undefined) saved.driveMode = saved.assists ? 'normal' : 'real';
  delete saved.assists;
  const merged = { ...DEFAULTS, ...saved };
  if (!DRIVE_MODES.includes(merged.driveMode)) merged.driveMode = DEFAULTS.driveMode;
  return merged;
}
const settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem('duskkart.settings', JSON.stringify(settings)); } catch { /* storage unavailable: keep in memory */ }
}
if (params.get('quality')) settings.quality = params.get('quality');

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, settings.quality === 'high' ? 1.5 : settings.quality === 'medium' ? 1.1 : 0.85);

const track = new Track();
const line = computeRacingLine(track);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x5a6384, 0.0026);
const sunDir = new THREE.Vector3(-0.75, 0.2, -0.62).normalize();
scene.add(buildSky(sunDir));
scene.add(new THREE.HemisphereLight(0x8aa4dc, 0x3a2c26, 1.3));
const sun = new THREE.DirectionalLight(0xffc49a, 1.15);
sun.castShadow = renderer.shadowMap.enabled;
sun.shadow.mapSize.setScalar(settings.quality === 'high' ? 2048 : 1024);
Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const trackScene = buildTrackScene(track, line, { quality: settings.quality });
scene.add(trackScene.group);
const skid = new SkidMarks(rubberTexture());
scene.add(skid.mesh);

const rig = new CameraRig(innerWidth / innerHeight);
rig.setMode(settings.camera);
const post = new PostFX(renderer, scene, rig.camera, { bloom: settings.quality !== 'low' });
const audio = new KartAudio();
audio.volume = settings.volume;
const input = new Input(document.getElementById('touch'));
const driveAssist = new DriveAssist(track, line);
const BOT_ASSISTS = { countersteer: true, brakeAssist: true };
const hud = new Hud(track, line);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h, false);
  post.setSize(w, h, pixelRatio());
  rig.camera.aspect = w / h;
  rig.camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- entities
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.22, depthWrite: false });

class Entity {
  constructor({ id, name, color, number, suit, kind }) {
    this.id = id; this.name = name; this.color = color; this.number = number; this.kind = kind;
    this.model = new KartModel({ color, number, suit });
    scene.add(this.model.root);
    this.model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    if (kind === 'remote' || kind === 'ghost') {
      this.kart = { x: 0, z: 0, heading: 0, vx: 0, vz: 0, omega: 0, steer: 0, rpm: 1900, throttle: 0, s: 0, lateral: 0, spec: KART_SPEC, rumble: 0, impact: 0, ax: 0, ay: 0, get speed() { return Math.hypot(this.vx, this.vz); } };
      this.spin = [0, 0, 0, 0];
    } else {
      this.kart = new Kart();
    }
    if (kind === 'ghost') this.model.root.traverse((o) => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; } });
    if (kind !== 'player' && kind !== 'ghost') {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTagTexture(name, color), transparent: true, depthWrite: false }));
      tag.scale.set(1.3, 0.33, 1);
      tag.position.y = 1.45;
      this.model.root.add(tag);
      this.tag = tag;
    }
    this.hidden = false;
  }

  pose(alpha, time) {
    const k = this.kart;
    if (this.kind === 'remote' || this.kind === 'ghost') {
      const sp = k.speed;
      for (let i = 0; i < 4; i++) this.spin[i] += (sp / (i < 2 ? 0.13 : 0.14)) * (1 / 60);
      const ay = -sp * k.omega;
      return { x: k.x, z: k.z, heading: k.heading, steer: k.steer, wheelSpin: this.spin, roll: clamp(ay * 0.0045, -0.06, 0.06), pitch: 0, lift: 0, liftSide: 1 };
    }
    const p = k.prev;
    let dh = k.heading - p.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const att = k.attitude();
    return {
      x: p.x + (k.x - p.x) * alpha,
      z: p.z + (k.z - p.z) * alpha,
      heading: p.heading + dh * alpha,
      steer: k.steer,
      wheelSpin: k.wheels.map((w) => w.spin),
      roll: att.roll, pitch: att.pitch, lift: att.lift, liftSide: att.liftSide,
      bump: k.rumble ? Math.sin(time * 90) * 0.004 * k.rumble : 0,
    };
  }

  dispose() {
    scene.remove(this.model.root);
    this.model.dispose();
  }
}

// ---------------------------------------------------------------- game state
const G = {
  mode: 'attract', // attract | race | trial | online
  phase: 'idle', // grid | go | done | free
  entities: [],
  player: null,
  ghost: null,
  tracker: null,
  simTime: 0,
  acc: 0,
  paused: false,
  goTime: Infinity,
  lightsStart: Infinity,
  lightsShown: -1,
  follow: null,
  attractTimer: 0,
  finishAt: null,
  resultsShown: false,
  lastReset: -10,
  ghostRec: [],
  ghostBest: null,
  net: null,
  raceId: null,
  grid: [],
  remoteFin: new Map(),
  sendTimer: 0,
  wrongShown: 0,
};


function clearEntities() {
  for (const e of G.entities) e.dispose();
  G.entities = [];
  G.player = null;
  if (G.ghost) { G.ghost.dispose(); G.ghost = null; }
  skid.clear();
  audio.stopOthers();
}

function place(e, slot) {
  const g = gridSlot(track, slot);
  e.kart.reset(g.x, g.z, g.heading);
  if (e.kart.step) e.kart.step({ brake: 1, hold: true }, STEP, track);
  if (e.kart.savePrev) e.kart.savePrev();
}

function addBots(count, startSlot, rand) {
  for (let i = 0; i < count; i++) {
    const e = new Entity({
      id: `bot${i}`, name: BOT_NAMES[i % BOT_NAMES.length], color: COLORS[(i + 1) % COLORS.length],
      number: [7, 21, 33, 44, 5, 88, 16][i % 7], suit: SUITS[i % SUITS.length], kind: 'bot',
    });
    e.ai = new AIDriver(track, line, { pace: 0.9 + rand() * 0.075, seed: 100 + i, lineBias: (rand() - 0.5) * 0.8 });
    place(e, startSlot + i);
    G.entities.push(e);
  }
}

function addPlayer(slot) {
  const e = new Entity({ id: 'me', name: settings.name || 'You', color: settings.color, number: settings.number, suit: '#c9202a', kind: 'player' });
  place(e, slot);
  G.entities.push(e);
  G.player = e;
  G.follow = e;
  if (params.get('autopilot')) e.ai = new AIDriver(track, line, { pace: 0.95, seed: 9 });
  return e;
}

function startCountdown(goTime) {
  G.phase = 'grid';
  G.goTime = goTime;
  G.lightsStart = goTime - 5.4 - (G.mode === 'online' ? 0 : Math.random() * 0.8);
  G.lightsShown = -1;
  G.finishAt = null;
  G.resultsShown = false;
  G.finalShown = false;
}

function startLocal(mode) {
  closeOnline();
  clearEntities();
  G.mode = mode;
  G.paused = false;
  const rand = mulberry32((Math.random() * 1e9) | 0);
  if (mode === 'race') {
    addBots(5, 0, rand);
    const bots = G.entities.slice();
    // Player starts 4th on the grid.
    addPlayer(3);
    bots.forEach((b, i) => place(b, i < 3 ? i : i + 1));
    G.tracker = new RaceTracker(track, RACE_LAPS);
  } else {
    addPlayer(0);
    G.tracker = new RaceTracker(track, 0);
    G.ghostRec = [];
    G.ghost = null;
  }
  for (const e of G.entities) G.tracker.add(e.id, e.kart.s, 0);
  rig.setMode(settings.camera);
  startCountdown(G.simTime + (mode === 'trial' ? 5.5 : 6.4));
  if (mode === 'trial') G.lightsStart = G.goTime - 5.2;
  enterDriving();
}

function startAttract() {
  closeOnline();
  clearEntities();
  G.mode = 'attract';
  G.phase = 'go';
  G.goTime = G.simTime;
  const rand = mulberry32(42);
  addBots(6, 0, rand);
  G.tracker = null;
  // Spread the field around the lap so the camera always has company.
  G.entities.forEach((e, i) => {
    const f = track.frameAt(80 + i * 11);
    e.kart.reset(f.x + f.nx * (i % 2 ? 1.5 : -1.5), f.z + f.nz * (i % 2 ? 1.5 : -1.5), Math.atan2(f.tx, f.tz));
    e.kart.vx = f.tx * 12; e.kart.vz = f.tz * 12;
  });
  G.follow = G.entities[2];
  G.attractTimer = 0;
  rig.setMode('helmet');
  hud.show(false);
  trackScene.setStartLights(0, false);
}

// ---------------------------------------------------------------- simulation
function playerInput() {
  const e = G.player;
  if (!e) return { steer: 0, throttle: 0, brake: 0 };
  if (e.ai && (e.autopilot || params.get('autopilot'))) return e.ai.update(e.kart, G.entities.map((x) => x.kart), STEP);
  if (G.paused || uiBlocksDriving()) return { steer: 0, throttle: 0, brake: 0.4 };
  return driveAssist.apply(e.kart, { steer: input.steer, throttle: input.throttle, brake: input.brake }, settings.driveMode);
}

function playerDriving(e) {
  return e.kind === 'player' && !(e.ai && (e.autopilot || params.get('autopilot')));
}

function resetKart(e) {
  const k = e.kart;
  const f = track.frameAt(k.s);
  const lat = clamp(k.lateral, -2.5, 2.5);
  k.reset(f.x + f.nx * lat, f.z + f.nz * lat, Math.atan2(f.tx, f.tz));
  k.step({ brake: 1, hold: true }, STEP, track);
  k.savePrev();
}

function simStep(h) {
  G.simTime += h;
  const t = G.simTime;
  const canDrive = G.phase === 'go' || G.phase === 'free' || G.phase === 'done';
  const others = G.entities.map((e) => e.kart);
  for (const e of G.entities) {
    if (e.kind === 'remote') continue;
    let inp;
    if (e.kind === 'player') inp = playerInput();
    else inp = e.ai.update(e.kart, others, h);
    if (inp.reset) resetKart(e);
    if (!canDrive) inp = { steer: 0, throttle: e.kind === 'player' ? inp.throttle * 0.6 : 0, brake: 1, hold: true };
    e.kart.savePrev();
    e.kart.step(inp, h, track, playerDriving(e) ? PHYSICS_ASSISTS[settings.driveMode] : BOT_ASSISTS);
  }
  // Contacts.
  const ents = G.entities;
  for (let i = 0; i < ents.length; i++) {
    const a = ents[i];
    if (a.hidden) continue;
    for (let j = i + 1; j < ents.length; j++) {
      const b = ents[j];
      if (b.hidden || b.noCollide || a.noCollide) continue;
      if (a.kind === 'remote' && b.kind === 'remote') continue;
      if (a.kind === 'remote') collideKarts(b.kart, a.kart, false);
      else collideKarts(a.kart, b.kart, b.kind !== 'remote');
    }
  }
  if (G.tracker && G.phase !== 'grid') {
    const rt = t - G.goTime;
    for (const e of ents) {
      if (e.kind === 'remote' || !G.tracker.entries.has(e.id)) continue;
      const ev = G.tracker.update(e.id, e.kart.s, rt, h);
      if (ev) onRaceEvent(e, ev, rt);
    }
  }
  if (G.mode === 'trial' && G.phase === 'go' && G.player) {
    G.ghostTick = (G.ghostTick || 0) + h;
    if (G.ghostTick >= 0.05) {
      G.ghostTick = 0;
      const k = G.player.kart;
      G.ghostRec.push([k.x, k.z, k.heading, k.steer]);
    }
  }
}

function onRaceEvent(e, ev, rt) {
  const entry = G.tracker.entries.get(e.id);
  if (e.kind !== 'player') return;
  if (ev === 'start') {
    if (G.mode === 'trial') G.ghostRec = [];
    return;
  }
  if (ev === 'lap') {
    const lt = entry.lastLap;
    if (G.mode === 'trial') {
      const improved = entry.bestLap === lt;
      const prevBest = entry.lapTimes.length > 1 ? Math.min(...entry.lapTimes.slice(0, -1)) : null;
      const delta = prevBest !== null ? ` (${lt - prevBest >= 0 ? '+' : ''}${(lt - prevBest).toFixed(3)})` : '';
      hud.flash(`${fmtTime(lt)}${delta}`, 2200, improved ? 'good' : 'warn');
      if (improved) {
        G.ghostBest = G.ghostRec;
        spawnGhost();
      }
      G.ghostRec = [];
      G.ghostT0 = G.simTime;
      return;
    }
    const laps = G.tracker.laps;
    hud.flash(entry.lap === laps ? 'FINAL LAP' : `LAP ${entry.lap}/${laps}`, 1500, entry.lap === laps ? 'gold' : '');
  }
  if (ev === 'finish') {
    const pos = positionOfMe();
    hud.flash(`FINISH · P${pos}`, 3500, 'gold');
    audio.beep(880, 0.4, 0.2);
    e.autopilot = true;
    if (!e.ai) e.ai = new AIDriver(track, line, { pace: 0.8, seed: 5 });
    G.finishAt = G.simTime;
    if (G.mode === 'online' && G.net) G.net.sendFinish({ raceId: G.raceId, time: rt });
  }
}

function spawnGhost() {
  if (!G.ghost) {
    G.ghost = new Entity({ id: 'ghost', name: 'ghost', color: '#9fe0ff', number: 0, kind: 'ghost' });
  }
  G.ghostT0 = G.simTime;
}

function updateGhost() {
  const g = G.ghost;
  if (!g || !G.ghostBest || G.ghostBest.length < 2) return;
  const f = (G.simTime - G.ghostT0) / 0.05;
  const i = Math.floor(f);
  if (i >= G.ghostBest.length - 1) { g.model.root.visible = false; return; }
  g.model.root.visible = true;
  const a = G.ghostBest[i], b = G.ghostBest[i + 1], k = f - i;
  let dh = b[2] - a[2];
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  const K = g.kart;
  K.vx = (b[0] - a[0]) / 0.05; K.vz = (b[1] - a[1]) / 0.05;
  K.x = a[0] + (b[0] - a[0]) * k; K.z = a[1] + (b[1] - a[1]) * k;
  K.heading = a[2] + dh * k; K.steer = a[3];
  K.omega = dh / 0.05;
}

// ---------------------------------------------------------------- standings
function raceRows() {
  const rows = [];
  if (G.mode === 'online') {
    for (const id of G.grid) {
      if (id === G.net.selfId && G.player) {
        const en = G.tracker.entries.get('me');
        rows.push({ id, name: G.player.name, color: G.player.color, me: true, progress: en.progress, finished: en.finished, time: en.finishTime, best: en.bestLap });
      } else {
        const e = G.entities.find((x) => x.id === id);
        if (!e) continue;
        const fin = G.remoteFin.get(id);
        rows.push({ id, name: e.name, color: e.color, progress: e.kart.progress ?? -1e9, finished: fin !== undefined, time: fin, best: e.kart.best ?? null });
      }
    }
  } else if (G.tracker) {
    for (const en of G.tracker.entries.values()) {
      const e = G.entities.find((x) => x.id === en.id);
      rows.push({ id: en.id, name: e.name, color: e.color, me: e.kind === 'player', progress: en.progress, finished: en.finished, time: en.finishTime, best: en.bestLap });
    }
  }
  rows.sort((a, b) => {
    if (a.finished && b.finished) return a.time - b.time;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.progress - a.progress;
  });
  return rows;
}

function positionOfMe() {
  return raceRows().findIndex((r) => r.me) + 1;
}

function showResults() {
  G.resultsShown = true;
  const rows = raceRows();
  const leader = rows.find((r) => r.finished);
  const tbl = document.getElementById('res-table');
  tbl.innerHTML = '<tr><th>#</th><th>드라이버</th><th class="t">기록</th><th class="t">베스트 랩</th></tr>' + rows.map((r, i) => {
    const time = r.finished ? (i === 0 || !leader ? fmtTime(r.time) : `+${(r.time - leader.time).toFixed(3)}`) : '주행 중';
    return `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td class="t">${time}</td><td class="t">${fmtTime(r.best)}</td></tr>`;
  }).join('');
  const me = rows.findIndex((r) => r.me) + 1;
  document.getElementById('res-title').textContent = me ? `결과 — P${me}` : '결과';
  document.getElementById('btn-again').textContent = G.mode === 'online' ? '로비로' : '다시 하기';
  document.getElementById('btn-again').disabled = false;
  ui.show('results');
}

// ---------------------------------------------------------------- online
function closeOnline() {
  if (G.net) { G.net.leave(); G.net = null; }
  hud.netStatus('');
  G.remoteFin.clear();
  G.grid = [];
}

function profile() {
  return { name: settings.name || 'Driver', color: settings.color, number: settings.number };
}

function joinOnline(code) {
  closeOnline();
  clearEntities();
  G.mode = 'online';
  G.phase = 'free';
  G.tracker = null;
  G.raceId = null;
  G.paused = false;
  const net = new NetSession(code, profile(), {
    onProfile: () => refreshLobby(),
    onPeerJoin: (id) => {
      refreshLobby();
      // Tell latecomers a race is already running (they wait in the lobby).
      if (G.net?.isHost && G.raceId && G.phase !== 'free') G.net.aRace.send({ type: 'busy', raceId: G.raceId }, { target: id });
    },
    onPeerLeave: (id) => {
      const e = G.entities.find((x) => x.id === id);
      if (e) { e.dispose(); G.entities.splice(G.entities.indexOf(e), 1); }
      hud.info('드라이버가 나갔습니다');
      refreshLobby();
    },
    onRace: (m, from) => handleRaceMsg(m, from),
    onFinish: (m, from) => {
      if (m?.raceId === G.raceId && Number.isFinite(m.time)) G.remoteFin.set(from, m.time);
    },
    onError: (msg) => hud.info(msg, 4000),
  });
  G.net = net;
  addPlayer(Math.floor(Math.random() * 6));
  rig.setMode(settings.camera);
  document.getElementById('lobby-code').textContent = code;
  history.replaceState(null, '', `#room=${code}`);
  refreshLobby();
  ui.show('lobby');
  hud.show(true);
  hud.setLights(0, false, false);
  trackScene.setStartLights(0, false);
}

function handleRaceMsg(m, from) {
  if (!G.net || !m || typeof m !== 'object') return;
  // Only the current host may direct races.
  if (from !== G.net.hostId && from !== G.net.selfId) return;
  if (m.type === 'start' && Array.isArray(m.grid)) {
    G.raceId = String(m.raceId);
    G.grid = m.grid.filter((x) => typeof x === 'string').slice(0, 8);
    G.remoteFin.clear();
    const mySlot = G.grid.indexOf(G.net.selfId);
    G.tracker = new RaceTracker(track, clamp(Number(m.laps) || RACE_LAPS, 1, 10));
    if (mySlot >= 0 && G.player) {
      place(G.player, mySlot);
      G.player.autopilot = false;
      G.tracker.add('me', G.player.kart.s, 0);
    }
    for (const e of G.entities) if (e.kind === 'remote') e.noCollide = !G.grid.includes(e.id);
    const startLocal = from === G.net.selfId ? m.startAt : G.net.toLocal(m.startAt, from);
    startCountdown(G.simTime + (startLocal - now()) / 1000);
    skid.clear();
    enterDriving();
    hud.info(mySlot >= 0 ? `그리드 ${mySlot + 1}번에서 출발합니다` : '관전 중 — 다음 레이스에 참가할 수 있어요', 2500);
  } else if (m.type === 'lobby') {
    backToLobby();
  } else if (m.type === 'busy') {
    hud.info('레이스 진행 중 — 끝나면 다음 레이스에 참가합니다', 3500);
  }
}

function hostStart() {
  const net = G.net;
  if (!net || !net.isHost) return;
  const ids = net.members().filter((id) => id === net.selfId || net.peers.get(id)?.snaps.length);
  // Shuffle the grid.
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const msg = { type: 'start', raceId: randomRoomCode(), startAt: now() + 5500, laps: RACE_LAPS, grid: ids.slice(0, 8) };
  net.sendRace(msg);
  handleRaceMsg(msg, net.selfId);
}

function backToLobby() {
  G.phase = 'free';
  G.tracker = null;
  G.raceId = null;
  G.grid = [];
  if (G.player) G.player.autopilot = false;
  for (const e of G.entities) e.noCollide = false;
  hud.setLights(0, false, false);
  trackScene.setStartLights(0, false);
  refreshLobby();
  ui.show('lobby');
}

function refreshLobby() {
  const net = G.net;
  if (!net) return;
  const list = document.getElementById('lobby-list');
  const members = net.members();
  list.innerHTML = members.map((id) => {
    const me = id === net.selfId;
    const p = me ? profile() : net.peers.get(id)?.profile;
    if (!p) return '';
    const rtt = me ? '나' : `${Math.round(net.peers.get(id).rtt || 0)} ms`;
    return `<li><i style="background:${p.color}"></i>${escapeHtml(p.name)}${id === net.hostId ? ' <small>👑 호스트</small>' : ''}<em>${rtt}</em></li>`;
  }).join('');
  const n = members.length;
  document.getElementById('lobby-status').textContent = n > 1
    ? `${n}명 접속 중. ${net.isHost ? '준비되면 레이스를 시작하세요.' : '호스트가 레이스를 시작하면 자동으로 그리드에 섭니다.'}`
    : '다른 드라이버를 기다리는 중… 초대 링크를 보내보세요. (혼자서도 시작할 수 있어요)';
  const start = document.getElementById('btn-start');
  start.disabled = !net.isHost;
  start.textContent = net.isHost ? '레이스 시작' : '호스트 대기 중';
  hud.netStatus(`ONLINE · ${escapeHtml(net.code)} · ${n}명`);
}

function syncRemotes(dt) {
  const net = G.net;
  if (!net) return;
  for (const [id, peer] of net.peers) {
    if (!peer.profile || !peer.snaps.length) continue;
    let e = G.entities.find((x) => x.id === id);
    if (!e) {
      e = new Entity({ id, name: peer.profile.name, color: peer.profile.color, number: peer.profile.number, suit: '#333', kind: 'remote' });
      e.noCollide = G.phase !== 'free' && !G.grid.includes(id);
      G.entities.push(e);
    }
    const p = net.sample(id);
    if (!p) continue;
    Object.assign(e.kart, { x: p.x, z: p.z, heading: p.heading, vx: p.vx, vz: p.vz, omega: p.omega, steer: p.steer, rpm: p.rpm, throttle: p.throttle, s: p.s, lateral: p.lateral });
    e.kart.progress = p.progress;
    e.hidden = net.stale(id, 6000);
    e.model.root.visible = !e.hidden;
  }
  // Broadcast our kart at 20 Hz.
  G.sendTimer += dt;
  if (G.sendTimer >= 0.05 && G.player) {
    G.sendTimer = 0;
    const k = G.player.kart;
    const en = G.tracker?.entries.get('me');
    const flags = (G.grid.includes(net.selfId) ? 1 : 0) | (en?.finished ? 2 : 0);
    net.sendState([now(), k.x, k.z, k.heading, k.vx, k.vz, k.omega, k.steer, k.rpm, k.throttle, en ? en.progress : -1e6, flags, k.s, k.lateral]);
  }
}

// ---------------------------------------------------------------- UI
const ui = {
  stack: [],
  current: null,
  show(name) {
    for (const s of document.querySelectorAll('#ui .panel')) s.hidden = s.id !== `scr-${name}`;
    this.current = name;
    document.getElementById('ui').classList.toggle('dim', name !== null && name !== 'main');
    updateTouch();
  },
  hide() {
    for (const s of document.querySelectorAll('#ui .panel')) s.hidden = true;
    this.current = null;
    document.getElementById('ui').classList.remove('dim');
    updateTouch();
  },
  push(name) { this.stack.push(this.current); this.show(name); },
  back() { const prev = this.stack.pop(); if (prev) this.show(prev); else this.hide(); },
};

function uiBlocksDriving() {
  return ui.current !== null && ui.current !== 'results';
}

function updateTouch() {
  const on = isTouch && G.mode !== 'attract' && !uiBlocksDriving();
  document.getElementById('touch').hidden = !on;
  document.body.classList.toggle('touch', isTouch);
}

function enterDriving() {
  audio.start();
  audio.setVolume(settings.volume);
  ui.stack = [];
  ui.hide();
  hud.show(true);
}

function pause(on) {
  if (G.mode === 'attract') return;
  if (G.mode === 'online') {
    if (on) ui.show(G.phase === 'free' ? 'lobby' : 'pause');
    else enterDriving();
    return;
  }
  G.paused = on;
  if (on) ui.show('pause'); else enterDriving();
}

function toMenu() {
  history.replaceState(null, '', location.pathname + location.search);
  startAttract();
  ui.stack = [];
  ui.show('main');
}

document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
  const go = b.dataset.go;
  audio.start();
  if (go === 'race' || go === 'trial') startLocal(go);
  else if (go === 'online') { fillOnline(); ui.push('online'); }
  else if (go === 'main') { ui.stack = []; ui.show('main'); }
  else { if (go === 'settings') fillSettings(); ui.push(go); }
}));
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => ui.back()));
document.getElementById('btn-resume').onclick = () => pause(false);
document.getElementById('btn-restart').onclick = () => (G.mode === 'online' ? backToLobby() : startLocal(G.mode));
document.getElementById('btn-quit').onclick = toMenu;
document.getElementById('btn-menu').onclick = toMenu;
document.getElementById('btn-again').onclick = () => {
  if (G.mode === 'online') {
    if (G.net?.isHost) G.net.sendRace({ type: 'lobby' });
    backToLobby();
  } else startLocal(G.mode);
};
document.getElementById('hud-pause').onclick = () => pause(true);
document.getElementById('hud-cam').onclick = () => cycleCamera();

// Online form.
const swatches = document.getElementById('colors');
COLORS.forEach((c) => {
  const b = document.createElement('button');
  b.style.background = c;
  b.setAttribute('aria-label', c);
  b.onclick = () => { settings.color = c; saveSettings(); fillOnline(); };
  swatches.appendChild(b);
});
function fillOnline() {
  const name = document.getElementById('in-name');
  if (!settings.name) settings.name = `Driver${Math.floor(Math.random() * 900 + 100)}`;
  name.value = settings.name;
  [...swatches.children].forEach((b, i) => b.classList.toggle('on', COLORS[i] === settings.color));
  const m = location.hash.match(/room=([A-Z0-9]{5})/i);
  if (m) document.getElementById('in-room').value = m[1].toUpperCase();
}
document.getElementById('btn-join').onclick = () => {
  settings.name = document.getElementById('in-name').value.trim().slice(0, 14) || settings.name;
  saveSettings();
  let code = document.getElementById('in-room').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) code = randomRoomCode();
  audio.start();
  joinOnline(code);
};
document.getElementById('btn-start').onclick = () => hostStart();
document.getElementById('btn-freeroam').onclick = () => enterDriving();
document.getElementById('btn-leave').onclick = toMenu;
document.getElementById('btn-copy').onclick = async () => {
  const url = `${location.origin}${location.pathname}#room=${G.net?.code}`;
  try { await navigator.clipboard.writeText(url); hud.info('초대 링크를 복사했습니다'); } catch { prompt('초대 링크', url); }
};

// Settings form.
function fillSettings() {
  document.getElementById('set-camera').value = settings.camera;
  document.getElementById('set-blur').value = settings.motionBlur;
  document.getElementById('set-lens').checked = settings.lensDistortion;
  document.getElementById('set-mode').value = settings.driveMode;
  document.getElementById('set-volume').value = settings.volume;
  document.getElementById('set-quality').value = settings.quality;
}
document.getElementById('set-camera').onchange = (e) => { settings.camera = e.target.value; rig.setMode(settings.camera); saveSettings(); };
document.getElementById('set-blur').oninput = (e) => { settings.motionBlur = Number(e.target.value); saveSettings(); };
document.getElementById('set-lens').onchange = (e) => { settings.lensDistortion = e.target.checked; saveSettings(); };
document.getElementById('set-mode').onchange = (e) => setDriveMode(e.target.value);

// Control mode picker on the main menu.
const MODE_HINTS = {
  easy: '처음이라면 추천 — 라인을 따라 조향을 돕고, 코너 앞에서 자동 감속하며, 벽에 가까워지면 밀어냅니다. 익숙해지면 보통으로!',
  normal: '조향 한계·스핀 방지만 켜진 상태. 속도 조절과 라인은 직접.',
  real: '보조 없음. 후륜 잠김, 솔리드 액슬 끌림 등 카트 특성을 그대로.',
};
const modeRow = document.getElementById('mode-pick');
for (const m of DRIVE_MODES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.mode = m;
  b.textContent = DRIVE_MODE_LABELS[m];
  b.onclick = () => setDriveMode(m);
  modeRow.appendChild(b);
}
function setDriveMode(m) {
  if (!DRIVE_MODES.includes(m)) return;
  settings.driveMode = m;
  saveSettings();
  for (const b of modeRow.children) b.classList.toggle('on', b.dataset.mode === m);
  document.getElementById('mode-hint').textContent = MODE_HINTS[m];
  document.getElementById('set-mode').value = m;
}
setDriveMode(settings.driveMode);
document.getElementById('set-volume').oninput = (e) => { settings.volume = Number(e.target.value); audio.setVolume(settings.volume); saveSettings(); };
document.getElementById('set-quality').onchange = (e) => { settings.quality = e.target.value; saveSettings(); location.reload(); };

function cycleCamera() {
  const i = CAMERA_MODES.indexOf(rig.mode);
  rig.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
  hud.info(CAMERA_LABELS[rig.mode]);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (G.mode === 'race' || G.mode === 'trial') && !G.paused && G.phase !== 'done') pause(true);
});

// ---------------------------------------------------------------- frame
let last = performance.now();
const listener = { position: new THREE.Vector3(), forward: new THREE.Vector3() };

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
  last = nowMs;
  const followK = G.follow?.kart;
  input.update(dt, followK ? followK.speed : 0);

  if (G.mode !== 'attract') {
    if (input.consume('pause')) pause(!(G.paused || uiBlocksDriving()));
    if (input.consume('camera')) cycleCamera();
    if (input.consume('reset') && G.player && G.simTime - G.lastReset > 1 && G.phase !== 'grid') {
      G.lastReset = G.simTime;
      resetKart(G.player);
    }
  }
  if (input.consume('mute')) hud.info(audio.toggleMute() ? '음소거' : '소리 켜짐');
  input.endFrame();

  if (!G.paused) {
    for (const e of G.entities) if (e.kart.impact !== undefined) e.kart.impact = 0;
    G.acc += dt;
    let n = 0;
    while (G.acc >= STEP && n < 60) { simStep(STEP); G.acc -= STEP; n++; }
    if (n === 60) G.acc = 0;
  }
  syncRemotes(dt);
  updateGhost();
  updateRaceFlow();

  // Render poses.
  const alpha = G.paused ? 1 : clamp(G.acc / STEP, 0, 1);
  for (const e of G.entities) {
    e.model.setFirstPerson(false);
    if (!e.hidden) e.model.update(e.pose(alpha, G.simTime));
  }
  if (G.ghost?.model.root.visible) G.ghost.model.update(G.ghost.pose(1, G.simTime));

  // Tyre marks.
  for (const e of G.entities) {
    if (e.kind === 'remote' || e.hidden) continue;
    const k = e.kart;
    k.wheels.forEach((w, i) => {
      const s = w.sliding ? clamp((w.slip - 1.2) / 4, 0, 1) : 0;
      skid.add(`${e.id}${i}`, w.x, w.z, 0, 0, i < 2 ? 0.12 : 0.19, s * 0.7);
    });
  }

  // Attract mode: cut between karts and cameras.
  if (G.mode === 'attract') {
    G.attractTimer += dt;
    if (G.attractTimer > 8) {
      G.attractTimer = 0;
      const i = (G.entities.indexOf(G.follow) + 2) % G.entities.length;
      G.follow = G.entities[i];
      rig.setMode(rig.mode === 'helmet' ? 'chase' : 'helmet');
    }
  }

  const f = G.follow;
  if (f) {
    const k = f.kart;
    const pose = f.kind === 'remote' ? { heading: k.heading } : f.pose(alpha, G.simTime);
    rig.update(dt, f.model, k, pose.heading);
    sun.target.position.set(pose.x ?? k.x, 0, pose.z ?? k.z);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 80);
    if (k.wheels) audio.update(k);
    rig.camera.getWorldPosition(listener.position);
    rig.camera.getWorldDirection(listener.forward);
    audio.updateOthers(listener, G.entities.filter((e) => e !== f && !e.hidden).map((e) => ({ id: e.id, x: e.kart.x, z: e.kart.z, rpm: e.kart.rpm, throttle: e.kart.throttle })));
  }

  trackScene.update(G.simTime);
  updateHud();
  hud.tick();
  post.render(G.simTime, rig.lens(f ? f.kart : { speed: 0 }, settings));
}

function updateRaceFlow() {
  const t = G.simTime;
  if (G.phase === 'grid') {
    const lit = Math.floor(t - G.lightsStart) + 1;
    const n = clamp(lit, 0, 5);
    if (t >= G.lightsStart && n !== G.lightsShown) {
      G.lightsShown = n;
      if (n > 0) audio.beep(440, 0.15, 0.15);
    }
    trackScene.setStartLights(t >= G.lightsStart ? n : 0, false);
    hud.setLights(t >= G.lightsStart ? n : 0, false, true);
    if (t >= G.goTime) {
      G.phase = 'go';
      audio.beep(880, 0.35, 0.2);
      hud.flash('GO!', 900, 'good');
      trackScene.setStartLights(0, true);
      hud.setLights(0, true, true);
      G.greenUntil = t + 1.5;
    }
  } else if (G.greenUntil && t > G.greenUntil) {
    G.greenUntil = 0;
    trackScene.setStartLights(0, false);
    hud.setLights(0, false, false);
  }

  if (G.phase === 'go' && G.finishAt !== null && G.mode !== 'trial') {
    const allDone = raceRows().every((r) => r.finished);
    if (!G.resultsShown) {
      if (allDone || t - G.finishAt > 4) showResults();
    } else if (ui.current === 'results' && !G.finalShown) {
      // Keep the table live while the rest of the field finishes.
      if (allDone) G.finalShown = true;
      if (Math.floor(t * 2) !== G.lastResTick) { G.lastResTick = Math.floor(t * 2); showResults(); }
    }
  }

  // Wrong-way warning.
  const me = G.tracker?.entries.get(G.player ? 'me' : '');
  if (me && me.wrongWay > 1.2 && G.simTime - G.wrongShown > 1.5) {
    G.wrongShown = G.simTime;
    hud.flash('역주행!', 1200, 'warn');
  }
}

function updateHud() {
  if (G.mode === 'attract' || !G.player) return;
  const k = G.player.kart;
  const en = G.tracker?.entries.get('me');
  const rt = G.simTime - G.goTime;
  const racing = G.tracker && G.mode !== 'trial';
  const rows = racing ? raceRows() : [];
  hud.update({
    pos: racing ? rows.findIndex((r) => r.me) + 1 : 0,
    total: rows.length,
    lap: en ? Math.max(1, en.lap) : 1,
    laps: G.tracker ? G.tracker.laps : 0,
    cur: en && en.lapStart !== null && !en.finished && G.phase === 'go' ? rt - en.lapStart : null,
    last: en?.lastLap ?? null,
    best: en?.bestLap ?? null,
    kmh: k.speed * 3.6,
    rpm: k.rpm,
  });
  hud.standings(racing ? rows.map((r) => ({ ...r })) : []);
  const dots = G.entities.filter((e) => !e.hidden).map((e) => ({ x: e.kart.x, z: e.kart.z, color: e.color, me: e.kind === 'player' }));
  if (G.ghost?.model.root.visible) dots.push({ x: G.ghost.kart.x, z: G.ghost.kart.z, color: 'rgba(160,225,255,0.7)' });
  hud.drawMap(dots.sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0)));
}

// Dev-only: save screenshots of the running game to docs/ (see vite.config.js).
if (import.meta.env.DEV) {
  window.__shot = async (name) => {
    post.render(G.simTime, rig.lens(G.follow ? G.follow.kart : { speed: 0 }, settings));
    const data = canvas.toDataURL('image/jpeg', 0.9);
    const r = await fetch('/__shot', { method: 'POST', body: JSON.stringify({ name, data }) });
    return r.status;
  };
  window.__game = G;
  window.__ui = ui;
  window.__startLocal = startLocal;
  window.__rig = rig;
  window.__frame = frame;
  window.__scene = scene;
}

// ---------------------------------------------------------------- boot
startAttract();
const roomInHash = location.hash.match(/room=([A-Z0-9]{5})/i);
if (params.get('mode') === 'race' || params.get('mode') === 'trial') startLocal(params.get('mode'));
else if (params.get('demo')) ui.hide();
else if (roomInHash) { fillOnline(); ui.show('online'); }
else ui.show('main');
if (params.get('cam')) rig.setMode(params.get('cam'));
requestAnimationFrame((t) => { last = t; frame(t); });
setTimeout(() => document.getElementById('boot').classList.add('gone'), 300);
