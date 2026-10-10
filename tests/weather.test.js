import test from 'node:test';
import assert from 'node:assert/strict';
import { Track, computeRacingLine, applyWeather, SURFACE, WEATHER } from '../src/sim/track.js';
import { Kart, collideKarts } from '../src/sim/kart.js';
import { AIDriver } from '../src/sim/ai.js';
import { RaceTracker, gridSlot } from '../src/sim/race.js';
import { DriveAssist, PHYSICS_ASSISTS } from '../src/sim/assist.js';
import { runNovice } from './novice.js';

const DT = 1 / 240;
const track = new Track();
const line = computeRacingLine(track);
const BOT = { countersteer: true, brakeAssist: true };

function placeOnStraight(kart) {
  const g = gridSlot(track, 0);
  kart.reset(g.x, g.z, g.heading);
  return kart;
}

/** Metres a kart needs to stop from `v0` m/s on the main straight. */
function stoppingDistance(v0) {
  const kart = placeOnStraight(new Kart());
  kart.vx = Math.sin(kart.heading) * v0; kart.vz = Math.cos(kart.heading) * v0;
  const x0 = kart.x, z0 = kart.z;
  for (let i = 0; i < 240 * 10 && kart.speed > 0.3; i++) kart.step({ brake: 1 }, DT, track, { brakeAssist: true });
  return Math.hypot(kart.x - x0, kart.z - z0);
}

/**
 * Peak lateral acceleration at full lock from 14 m/s — fast enough that the
 * tyres, not the steering angle, set the limit. Barriers are moved out of
 * the way so the circle is not cut short by the tyre wall.
 */
function cornerAy() {
  const open = Object.create(track);
  open.barrier = 1e9;
  const kart = placeOnStraight(new Kart());
  kart.vx = Math.sin(kart.heading) * 14; kart.vz = Math.cos(kart.heading) * 14;
  let peak = 0;
  for (let i = 0; i < 240 * 1.2; i++) {
    kart.step({ throttle: 1, steer: 1 }, DT, open);
    if (i > 60) peak = Math.max(peak, Math.abs(kart.ay));
  }
  return peak;
}

test('wet kerbs lose more grip than wet asphalt; dry is unchanged', () => {
  applyWeather(track, line, 'dry');
  assert.equal(track.gripOf(SURFACE.asphalt), 1);
  assert.equal(track.gripOf(SURFACE.curb), SURFACE.curb.grip);
  applyWeather(track, line, 'rain');
  const asphalt = track.gripOf(SURFACE.asphalt), curb = track.gripOf(SURFACE.curb);
  assert.equal(asphalt, WEATHER.rain.grip);
  assert.ok(curb / SURFACE.curb.grip < asphalt, `kerb ${curb} should drop more than asphalt ${asphalt}`);
  applyWeather(track, line, 'dry');
});

test('unknown weather ids fall back to dry', () => {
  assert.equal(applyWeather(track, line, 'snow'), 'dry');
  assert.equal(applyWeather(track, line, undefined), 'dry');
  assert.equal(track.weather, WEATHER.dry);
});

test('rain lengthens braking and lowers cornering grip', () => {
  applyWeather(track, line, 'dry');
  const dryStop = stoppingDistance(18), dryAy = cornerAy();
  applyWeather(track, line, 'rain');
  const wetStop = stoppingDistance(18), wetAy = cornerAy();
  applyWeather(track, line, 'dry');
  assert.ok(wetStop > dryStop * 1.2, `stopping ${dryStop.toFixed(1)} m dry vs ${wetStop.toFixed(1)} m wet`);
  assert.ok(wetAy < dryAy * 0.8, `lateral ${dryAy.toFixed(2)} dry vs ${wetAy.toFixed(2)} m/s² wet`);
});

test('the AI speed profile slows corners in the rain and restores exactly when dry', () => {
  applyWeather(track, line, 'dry');
  const dry = Float64Array.from(line.speed);
  applyWeather(track, line, 'rain');
  const wet = Float64Array.from(line.speed);
  applyWeather(track, line, 'dry');
  assert.deepEqual(Array.from(line.speed), Array.from(dry), 'dry profile restored');
  const slowest = (v) => Math.min(...v);
  // Corner speed ~ sqrt(grip): the tightest corner drops by about that much.
  const ratio = slowest(wet) / slowest(dry);
  assert.ok(ratio < 0.9 && ratio > Math.sqrt(WEATHER.rain.grip) - 0.05, `slowest corner ratio ${ratio.toFixed(3)}`);
  assert.equal(Math.max(...wet), Math.max(...dry), 'top speed is engine-limited, not grip-limited');
});

test('a bot field finishes a 3-lap rain race without resets, slower than in the dry', () => {
  const race = (weather) => {
    applyWeather(track, line, weather);
    const paces = [0.9, 0.915, 0.93, 0.945, 0.96, 0.975];
    const all = paces.map((pace, i) => ({ id: `bot${i}`, ai: new AIDriver(track, line, { pace, seed: i + 1 }), kart: new Kart(), resets: 0 }));
    const rt = new RaceTracker(track, 3);
    all.forEach((e, i) => {
      const g = gridSlot(track, i);
      e.kart.reset(g.x, g.z, g.heading);
      e.kart.step({ brake: 1, hold: true }, DT, track);
      rt.add(e.id, e.kart.s, 0);
    });
    const karts = all.map((e) => e.kart);
    let t = 0;
    while (t < 400 && !rt.standings().every((s) => s.finished)) {
      for (const e of all) {
        const inp = e.ai.update(e.kart, karts, DT);
        if (inp.reset) {
          e.resets++;
          const f = track.frameAt(e.kart.s);
          e.kart.reset(f.x, f.z, Math.atan2(f.tx, f.tz));
        }
        e.kart.step(inp, DT, track, BOT);
      }
      for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) collideKarts(karts[i], karts[j]);
      t += DT;
      for (const e of all) rt.update(e.id, e.kart.s, t);
    }
    applyWeather(track, line, 'dry');
    return { t, resets: all.reduce((n, e) => n + e.resets, 0), finished: rt.standings().every((s) => s.finished) };
  };
  const dry = race('dry');
  const wet = race('rain');
  assert.ok(wet.finished, 'everyone finished in the rain');
  assert.equal(wet.resets, 0, 'no bot needed a reset in the rain');
  assert.ok(wet.t > dry.t * 1.05, `race time ${dry.t.toFixed(1)} s dry vs ${wet.t.toFixed(1)} s wet`);
});

test('easy mode still gets a first-time player round cleanly in the rain', () => {
  applyWeather(track, line, 'rain');
  try {
    for (const seed of [1, 2]) {
      const da = new DriveAssist(track, line);
      const r = runNovice(track, {
        laps: 1, maxTime: 200, seed,
        physAssists: PHYSICS_ASSISTS.easy,
        applyAssist: (k, input) => da.apply(k, input, 'easy'),
      });
      assert.equal(r.laps, 1, 'lap completed');
      assert.ok(r.lapTimes[0] < 85, `lap ${r.lapTimes[0]}`);
      assert.equal(r.hits, 0, 'no hard barrier hits');
      assert.equal(r.spins, 0, 'no spins');
    }
  } finally {
    applyWeather(track, line, 'dry');
  }
});
