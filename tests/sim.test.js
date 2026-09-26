import test from 'node:test';
import assert from 'node:assert/strict';
import { Track, computeRacingLine } from '../src/sim/track.js';
import { Kart, collideKarts } from '../src/sim/kart.js';
import { AIDriver } from '../src/sim/ai.js';
import { RaceTracker, gridSlot } from '../src/sim/race.js';

const DT = 1 / 240;
const track = new Track();
const line = computeRacingLine(track);

function placeOnStraight(kart) {
  const g = gridSlot(track, 0);
  kart.reset(g.x, g.z, g.heading);
  return kart;
}

test('track is a sane closed circuit', () => {
  assert.ok(track.length > 700 && track.length < 1000, `length ${track.length}`);
  let maxK = 0;
  for (let i = 0; i < track.count; i++) maxK = Math.max(maxK, Math.abs(track.k[i]));
  assert.ok(1 / maxK >= 10, `min radius ${1 / maxK} must leave room for the inner barrier`);
  // Non-adjacent parts of the track must never share barriers.
  let worst = Infinity;
  for (let i = 0; i < track.count; i += 2) {
    for (let j = i + 1; j < track.count; j += 2) {
      const sep = Math.min(j - i, track.count - (j - i)) * track.ds;
      if (sep < 40) continue;
      worst = Math.min(worst, Math.hypot(track.px[i] - track.px[j], track.pz[i] - track.pz[j]));
    }
  }
  assert.ok(worst > 2 * track.barrier + 4, `clearance ${worst}`);
});

test('projection round-trips lateral offsets', () => {
  const f = {};
  for (const s of [3, 120.5, 400, 777]) {
    track.frameAt(s, f);
    const p = track.project(f.x + f.nx * 2.5, f.z + f.nz * 2.5);
    assert.ok(Math.abs(p.lateral - 2.5) < 0.05, `lateral ${p.lateral}`);
    assert.ok(Math.abs(p.s - s) < 0.3, `s ${p.s} vs ${s}`);
  }
});

test('kart accelerates to a rental-kart top speed', () => {
  const kart = placeOnStraight(new Kart());
  let t50 = null;
  for (let i = 0; i < 240 * 6; i++) {
    kart.step({ throttle: 1 }, DT, track);
    if (t50 === null && kart.speed * 3.6 >= 50) t50 = i * DT;
  }
  assert.ok(t50 !== null && t50 > 3 && t50 < 7.5, `0-50 km/h in ${t50}s`);
  // Top speed on a long virtual straight (ignore barriers by rebasing position).
  const k2 = placeOnStraight(new Kart());
  const x0 = k2.x, z0 = k2.z;
  for (let i = 0; i < 240 * 40; i++) {
    k2.step({ throttle: 1 }, DT, track);
    k2.x = x0; k2.z = z0; k2.hint = -1;
  }
  const kmh = k2.speed * 3.6;
  assert.ok(kmh > 70 && kmh < 90, `top speed ${kmh} km/h`);
});

test('rear-only brakes stop the kart in a realistic distance', () => {
  const kart = placeOnStraight(new Kart());
  kart.vx = Math.sin(kart.heading) * 18;
  kart.vz = Math.cos(kart.heading) * 18;
  const x0 = kart.x, z0 = kart.z;
  let t = 0;
  while (kart.speed > 0.2 && t < 10) {
    kart.step({ brake: 1 }, DT, track, { brakeAssist: true });
    t += DT;
  }
  const d = Math.hypot(kart.x - x0, kart.z - z0);
  assert.ok(d > 20 && d < 40, `stopping distance from 65 km/h: ${d}m`);
});

test('cornering grip is bounded by the tyres', () => {
  const kart = placeOnStraight(new Kart());
  kart.vx = Math.sin(kart.heading) * 15;
  kart.vz = Math.cos(kart.heading) * 15;
  let maxAy = 0;
  const x0 = kart.x, z0 = kart.z;
  for (let i = 0; i < 240 * 12; i++) {
    kart.step({ throttle: 0.7, steer: 0.35 }, DT, track, { countersteer: true });
    kart.x = x0; kart.z = z0; kart.hint = -1;
    assert.ok(Number.isFinite(kart.vx) && Number.isFinite(kart.omega));
    if (i > 240 * 4) maxAy = Math.max(maxAy, Math.abs(kart.ay));
  }
  assert.ok(maxAy > 5 && maxAy < 1.45 * 9.81, `lateral accel ${maxAy}`);
});

test('solid axle lifts the inside rear wheel under steering', () => {
  const kart = placeOnStraight(new Kart());
  const x0 = kart.x, z0 = kart.z;
  for (let i = 0; i < 240 * 5; i++) {
    kart.step({ throttle: 0.6, steer: 1 }, DT, track);
    kart.x = x0; kart.z = z0; kart.hint = -1;
  }
  // Steering right: RR is the inside rear wheel.
  assert.ok(kart.wheels[3].load < kart.wheels[2].load * 0.5, `RR ${kart.wheels[3].load} RL ${kart.wheels[2].load}`);
});

test('barrier contact keeps the kart on the circuit', () => {
  const kart = placeOnStraight(new Kart());
  kart.heading += Math.PI / 2; // aim straight at the barrier
  kart.vx = Math.sin(kart.heading) * 15;
  kart.vz = Math.cos(kart.heading) * 15;
  for (let i = 0; i < 240 * 2; i++) kart.step({}, DT, track);
  const p = track.project(kart.x, kart.z);
  assert.ok(Math.abs(p.lateral) <= track.barrier, `lateral ${p.lateral}`);
  assert.ok(kart.impact > 500, 'impact registered');
});

test('karts bounce off each other', () => {
  const a = placeOnStraight(new Kart());
  const b = placeOnStraight(new Kart());
  b.x += Math.sin(a.heading) * 1.0; b.z += Math.cos(a.heading) * 1.0;
  a.vx = Math.sin(a.heading) * 5; a.vz = Math.cos(a.heading) * 5;
  const hit = collideKarts(a, b);
  assert.ok(hit > 0);
  assert.ok(b.forwardSpeed > 0 && a.forwardSpeed < 5);
});

test('race tracker counts laps and ignores reversing over the line', () => {
  const rt = new RaceTracker(track, 2);
  const L = track.length;
  rt.add('p', L - 5, 0);
  assert.equal(rt.update('p', 1, 1), 'start');
  // Back over the line and forward again does not start a new lap.
  rt.update('p', L - 2, 2);
  assert.equal(rt.update('p', 2, 3), null);
  for (let s = 10; s < L; s += 10) rt.update('p', s, 10);
  assert.equal(rt.update('p', 1, 50), 'lap');
  for (let s = 10; s < L; s += 10) rt.update('p', s, 60);
  assert.equal(rt.update('p', 1, 95), 'finish');
  const e = rt.entries.get('p');
  assert.equal(e.lapTimes.length, 2);
  assert.ok(Math.abs(e.lapTimes[0] - 49) < 1e-9 && Math.abs(e.lapTimes[1] - 45) < 1e-9);
});

test('an AI bot laps the circuit cleanly at a believable pace', () => {
  const kart = placeOnStraight(new Kart());
  const bot = new AIDriver(track, line, { pace: 0.97, seed: 7 });
  const rt = new RaceTracker(track, 2);
  kart.step({}, DT, track);
  rt.add('bot', kart.s, 0);
  let t = 0, hardHits = 0, resets = 0, lap = null;
  while (t < 150) {
    kart.impact = 0;
    const input = bot.update(kart, [kart], DT);
    if (input.reset) resets++;
    kart.step(input, DT, track, { countersteer: true, brakeAssist: true });
    if (kart.impact > 900) hardHits++;
    t += DT;
    const ev = rt.update('bot', kart.s, t);
    if (ev === 'lap') { lap = rt.entries.get('bot').lastLap; break; }
  }
  assert.equal(resets, 0, 'bot never got stuck');
  assert.ok(lap !== null, 'bot completed a flying lap');
  assert.ok(lap > 45 && lap < 75, `lap time ${lap}`);
  assert.ok(hardHits < 20, `hard barrier hits ${hardHits}`);
});
