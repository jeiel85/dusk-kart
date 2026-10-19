import test from 'node:test';
import assert from 'node:assert/strict';
import { Track, computeRacingLine } from '../src/sim/track.js';
import { Kart } from '../src/sim/kart.js';
import { AIDriver } from '../src/sim/ai.js';
import { RaceTracker, gridSlot } from '../src/sim/race.js';
import { DriveAssist, PHYSICS_ASSISTS } from '../src/sim/assist.js';
import { runNovice } from './novice.js';

const DT = 1 / 240;
const track = new Track();
const line = computeRacingLine(track);

function novice(mode, seed) {
  const da = new DriveAssist(track, line);
  return runNovice(track, {
    laps: 1, maxTime: 200, seed,
    physAssists: PHYSICS_ASSISTS[mode],
    applyAssist: (k, input) => da.apply(k, input, mode),
  });
}

test('steer limiter caps full input below full lock, off in real mode', () => {
  const k = new Kart();
  for (const v of [2, 6, 12, 20]) {
    assert.equal(k.steerRange(v, 0), k.maxSteer(v));
    assert.ok(k.steerRange(v, 1) <= k.maxSteer(v));
  }
  // At 6 m/s a full key press must not exceed ~0.9 rad/s of turn rate.
  const L = k.spec.a + k.spec.b;
  assert.ok((6 * Math.tan(k.steerRange(6, 1))) / L <= 0.91);
});

test('traction control feeds the throttle back when the rears slide', () => {
  // Mechanism: a kart whose rears lit up on the last step gets its throttle cut
  // on the next one; one with grip does not.
  const k = new Kart();
  const g = gridSlot(track, 0);
  k.reset(g.x, g.z, g.heading);
  k.vx = Math.sin(g.heading) * 8; k.vz = Math.cos(g.heading) * 8;
  for (const i of [2, 3]) { k.wheels[i].sliding = true; k.wheels[i].slip = 6; }
  k.step({ throttle: 1, steer: 0 }, DT, track, PHYSICS_ASSISTS.easy);
  assert.ok(k.throttle < 0.9, `throttle cut to ${k.throttle} while sliding`);

  const gripped = new Kart();
  gripped.reset(g.x, g.z, g.heading);
  gripped.vx = Math.sin(g.heading) * 8; gripped.vz = Math.cos(g.heading) * 8;
  gripped.step({ throttle: 1, steer: 0 }, DT, track, PHYSICS_ASSISTS.easy);
  assert.equal(gripped.throttle, 1, 'no cut when the rears have grip');

  // Integration: build speed on the straight, then full throttle into full
  // lock. Normal mode shows the TC working (easy mode's stability assist
  // already prevents the breakaway — that is its job).
  const run = (assists) => {
    const k = new Kart();
    k.reset(g.x, g.z, g.heading);
    for (let i = 0; i < 240 * 3; i++) k.step({ throttle: 1, steer: 0 }, DT, track, assists);
    let slideSteps = 0;
    for (let i = 0; i < 240 * 1.5; i++) {
      k.step({ throttle: 1, steer: 1 }, DT, track, assists);
      for (let w = 2; w < 4; w++) if (k.wheels[w].sliding) slideSteps++;
    }
    return slideSteps;
  };
  const off = run({ ...PHYSICS_ASSISTS.normal, tc: false });
  const on = run(PHYSICS_ASSISTS.normal);
  assert.ok(on < off, `normal-mode slide steps with TC ${on} vs without ${off}`);
});

test('easy mode: a first-time keyboard player laps cleanly', () => {
  for (const seed of [1, 2]) {
    const r = novice('easy', seed);
    assert.equal(r.laps, 1, 'lap completed');
    assert.ok(r.lapTimes[0] < 75, `lap ${r.lapTimes[0]}`);
    assert.equal(r.hits, 0, 'no hard barrier hits');
    assert.equal(r.resets, 0, 'never stuck');
    assert.equal(r.spins, 0, 'no spins');
  }
});

test('normal mode: a first-time keyboard player can still finish a lap', () => {
  const r = novice('normal', 1);
  assert.equal(r.laps, 1, 'lap completed');
  assert.ok(r.lapTimes[0] < 130, `lap ${r.lapTimes[0]}`);
  assert.ok(r.hits <= 3, `hits ${r.hits}`);
  assert.equal(r.resets, 0);
});

test('assists do not slow down a skilled driver', () => {
  const lap = (assists) => {
    const k = new Kart();
    const g = gridSlot(track, 0);
    k.reset(g.x, g.z, g.heading);
    k.step({ brake: 1, hold: true }, DT, track);
    const bot = new AIDriver(track, line, { pace: 0.97, seed: 7 });
    const rt = new RaceTracker(track, 2);
    rt.add('b', k.s, 0);
    let t = 0;
    while (t < 200) {
      const inp = bot.update(k, [k], DT);
      inp.steer = Math.max(-1, Math.min(1, (inp.steer * k.maxSteer(k.speed)) / k.steerRange(k.speed, assists.steerLimit || 0)));
      k.step(inp, DT, track, assists);
      t += DT;
      if (rt.update('b', k.s, t) === 'lap') return rt.entries.get('b').lastLap;
    }
    return Infinity;
  };
  const base = lap({ countersteer: true, brakeAssist: true });
  for (const mode of ['easy', 'normal']) {
    const l = lap(PHYSICS_ASSISTS[mode]);
    assert.ok(l < base * 1.03, `${mode} flying lap ${l} vs ${base}`);
  }
});
