import test from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/sim/track.js';
import { gridSlot } from '../src/sim/race.js';
import {
  sanitizeSnapshot, snapshotLimits, ProgressGuard, finishClaimPlausible, minRaceTime, NO_PROGRESS, MAX_SPEED,
} from '../src/netcheck.js';
import { sanitizeSettings } from '../src/settings.js';
import { ResolutionGovernor } from '../src/perf.js';

const track = new Track();
const lim = snapshotLimits(track);

function snap(over = {}) {
  const g = gridSlot(track, 0);
  const s = { t: 1000, x: g.x, z: g.z, heading: g.heading, vx: 3, vz: 4, omega: 0.1, steer: 0.1, rpm: 4000, throttle: 1, progress: 12, flags: 1, s: 999, lateral: 99, ...over };
  return [s.t, s.x, s.z, s.heading, s.vx, s.vz, s.omega, s.steer, s.rpm, s.throttle, s.progress, s.flags, s.s, s.lateral];
}

test('snapshots on the circuit pass, with arc position recomputed', () => {
  const g = gridSlot(track, 0);
  const out = sanitizeSnapshot([...snap(), 'extra'], lim);
  assert.ok(out, 'valid snapshot accepted');
  assert.equal(out.length, 14, 'extra fields dropped');
  // s/lateral come from the position, not from what the peer claimed.
  const p = track.project(g.x, g.z);
  assert.ok(Math.abs(out[12] - p.s) < 1e-9 && Math.abs(out[13] - p.lateral) < 1e-9);
  assert.equal(sanitizeSnapshot(snap({ progress: NO_PROGRESS }), lim)?.[10], NO_PROGRESS);
});

test('forged or broken snapshots are dropped', () => {
  const f = track.frameAt(200);
  const off = (d) => ({ x: f.x + f.nx * d, z: f.z + f.nz * d });
  const bad = {
    'not an array': 'x',
    'too short': snap().slice(0, 10),
    'NaN field': snap({ vx: NaN }),
    'beyond the tyre wall': snap(off(track.barrier + 1)),
    'far outside the map': snap({ x: 1e5, z: -1e5 }),
    'impossible speed': snap({ vx: MAX_SPEED, vz: 5 }),
    'bad throttle': snap({ throttle: 3 }),
    'bad flags': snap({ flags: 9 }),
    'fractional flags': snap({ flags: 1.5 }),
    'progress past any race': snap({ progress: track.length * 20 }),
  };
  for (const [name, s] of Object.entries(bad)) assert.equal(sanitizeSnapshot(s, lim), null, name);
  assert.ok(sanitizeSnapshot(snap(off(track.barrier - 0.5)), lim), 'kart against the wall is fine');
});

test('progress may not grow faster than a kart can drive', () => {
  const g = new ProgressGuard();
  assert.equal(g.accept(NO_PROGRESS, 0), NO_PROGRESS);
  // Race start: grid positions are just behind the line.
  assert.equal(g.accept(-20, 50), -20);
  let t = 50, p = -20;
  for (let i = 0; i < 100; i++) { t += 50; p += 1.2; assert.equal(g.accept(p, t), p, 'honest 24 m/s'); }
  assert.equal(g.violations, 0);
  // A jump of a whole lap is capped at the accrued credit (at most one burst).
  const before = g.value;
  const capped = g.accept(p + track.length, t + 50);
  assert.ok(capped <= before + g.burst + 1e-9, `capped to ${capped}`);
  assert.equal(g.violations, 1);
  // A peer jumping from the lobby straight to lap 3 is held at the line.
  const lobby = new ProgressGuard();
  lobby.accept(NO_PROGRESS, 0);
  assert.ok(lobby.accept(track.length * 2.5, 50) <= 4);
  // Going backwards is always allowed (reversing, next race).
  assert.equal(g.accept(-30, t + 100), -30);
});

test('flooding snapshots cannot outrun the speed limit', () => {
  // A stationary or modified peer claiming +10 m per packet, at 20 Hz and at
  // 1 kHz: over 60 s neither may gain more than 60 s at the limit + one burst.
  for (const hz of [20, 1000]) {
    const g = new ProgressGuard();
    g.accept(NO_PROGRESS, 0);
    g.accept(-10, 0);
    let claimed = -10;
    for (let i = 1; i <= hz * 60; i++) { claimed += 10; g.accept(claimed, (i * 1000) / hz); }
    assert.ok(g.value + 10 <= MAX_SPEED * 60 + g.burst + 1e-6, `${hz} Hz reached ${g.value} m`);
    assert.ok(g.value < minRaceTime(3, track.length) * MAX_SPEED, 'still short of a 3-lap finish after 60 s');
  }
});

test('finish claims must fit the race clock and the track length', () => {
  const L = track.length, laps = 3;
  const min = minRaceTime(laps, L);
  assert.ok(min > 60, `min race ${min}s`);
  assert.equal(finishClaimPlausible({ time: 150, laps, length: L, elapsed: 150.3 }), true, 'honest, arrives 0.3 s later');
  assert.equal(finishClaimPlausible({ time: 150, laps, length: L, elapsed: 158 }), false, 'claims 8 s better than the clock');
  assert.equal(finishClaimPlausible({ time: min - 1, laps, length: L, elapsed: NaN }), false, 'faster than physically possible');
  assert.equal(finishClaimPlausible({ time: Infinity, laps, length: L, elapsed: 10 }), false);
  assert.equal(finishClaimPlausible({ time: '150', laps, length: L, elapsed: 150 }), false, 'non-number');
});

const OPTS = { cameraModes: ['helmet', 'chase', 'far'], driveModes: ['easy', 'normal', 'real'], colors: ['#2f6bff', '#e8322b'] };
const DEFAULTS = { camera: 'helmet', motionBlur: 1, cameraShake: 1, lensDistortion: true, driveMode: 'easy', volume: 0.8, quality: 'high', name: '', color: '#2f6bff', number: 12 };

test('stored settings are validated field by field', () => {
  const good = { camera: 'far', motionBlur: 0.4, cameraShake: 0, lensDistortion: false, driveMode: 'real', volume: 0, quality: 'low', name: 'Ann', color: '#e8322b', number: 99 };
  assert.deepEqual(sanitizeSettings(good, DEFAULTS, OPTS), good);
  const bad = { camera: 'drone', motionBlur: 9, cameraShake: -0.5, lensDistortion: 'yes', driveMode: 'turbo', volume: -1, quality: 'ultra', name: 'x'.repeat(40), color: 'red', number: 1000, extra: 1 };
  assert.deepEqual(sanitizeSettings(bad, DEFAULTS, OPTS), DEFAULTS);
  for (const junk of [null, 'str', 42, [1, 2], undefined]) assert.deepEqual(sanitizeSettings(junk, DEFAULTS, OPTS), DEFAULTS);
});

test('v0.1.0 assists flag migrates to a drive mode', () => {
  assert.equal(sanitizeSettings({ assists: true }, DEFAULTS, OPTS).driveMode, 'normal');
  assert.equal(sanitizeSettings({ assists: false }, DEFAULTS, OPTS).driveMode, 'real');
  assert.equal(sanitizeSettings({ assists: false, driveMode: 'easy' }, DEFAULTS, OPTS).driveMode, 'easy');
  assert.equal('assists' in sanitizeSettings({ assists: true }, DEFAULTS, OPTS), false);
});

test('resolution drops under sustained low fps and recovers slowly', () => {
  const gov = new ResolutionGovernor();
  const run = (fps, seconds) => {
    const changes = [];
    for (let i = 0; i < fps * seconds; i++) { const r = gov.sample(1 / fps); if (r !== null) changes.push(r); }
    return changes;
  };
  assert.deepEqual(run(60, 10), [], 'smooth: no change');
  assert.deepEqual(run(30, 1.5), [], 'a single slow second is not enough');
  const down = run(30, 10);
  assert.ok(down.length >= 2 && gov.scale === gov.min, `stepped down to the floor: ${down}`);
  run(30, 10);
  assert.equal(gov.scale, gov.min, 'never below the floor');
  const up = run(60, 20);
  assert.ok(up.length >= 1 && up.every((v, i) => i === 0 || v > up[i - 1]), `recovers upwards: ${up}`);
  run(60, 120);
  assert.equal(gov.scale, 1, 'back to the preset resolution, never above');
  // Hitches and hidden tabs are ignored.
  for (let i = 0; i < 20; i++) assert.equal(gov.sample(2), null);
  assert.equal(gov.scale, 1);
});

test('a real race with contact never trips the network checks', async () => {
  const { computeRacingLine } = await import('../src/sim/track.js');
  const { Kart, collideKarts } = await import('../src/sim/kart.js');
  const { AIDriver } = await import('../src/sim/ai.js');
  const { RaceTracker } = await import('../src/sim/race.js');
  const DT = 1 / 240;
  const line = computeRacingLine(track);
  const rt = new RaceTracker(track, 2);
  const all = [0.9, 0.93, 0.96, 0.975].map((pace, i) => {
    const kart = new Kart();
    const g = gridSlot(track, i);
    kart.reset(g.x, g.z, g.heading);
    kart.step({ brake: 1, hold: true }, DT, track);
    rt.add(i, kart.s, 0);
    return { id: i, kart, ai: new AIDriver(track, line, { pace, seed: i + 1 }), guard: new ProgressGuard() };
  });
  for (const e of all) e.guard.accept(NO_PROGRESS, 0);
  const karts = all.map((e) => e.kart);
  let t = 0, sent = 0, tick = 0;
  while (t < 200 && !rt.standings().every((s) => s.finished)) {
    for (const e of all) e.kart.step(e.ai.update(e.kart, karts, DT), DT, track, { countersteer: true, brakeAssist: true });
    for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) collideKarts(karts[i], karts[j]);
    t += DT;
    for (const e of all) rt.update(e.id, e.kart.s, t);
    if (++tick % 12) continue; // 20 Hz like the game
    for (const e of all) {
      const k = e.kart, en = rt.entries.get(e.id);
      const s = sanitizeSnapshot([t * 1000, k.x, k.z, k.heading, k.vx, k.vz, k.omega, k.steer, k.rpm, k.throttle, en.progress, en.finished ? 3 : 1, k.s, k.lateral], lim);
      assert.ok(s, `snapshot of kart ${e.id} at ${t.toFixed(2)}s rejected`);
      e.guard.accept(s[10], t * 1000);
      sent++;
    }
  }
  assert.ok(rt.standings().every((s) => s.finished), 'race finished');
  for (const e of all) {
    assert.equal(e.guard.violations, 0, `kart ${e.id} progress flagged`);
    const fin = rt.entries.get(e.id).finishTime;
    assert.ok(finishClaimPlausible({ time: fin, laps: 2, length: track.length, elapsed: fin + 0.2 }), `finish ${fin}`);
  }
  assert.ok(sent > 1000);
});
