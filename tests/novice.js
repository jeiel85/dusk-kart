import { Kart } from '../src/sim/kart.js';
import { gridSlot, RaceTracker } from '../src/sim/race.js';
import { rampSteer } from '../src/sim/controls.js';
import { mulberry32 } from '../src/sim/math.js';

/**
 * Scripted "first-time keyboard player": holds the throttle flat out, steers
 * with digital key presses toward the middle of the road, reacts late and
 * stamps on the brake only when badly out of line. Used to measure how
 * forgiving a control mode is.
 */
export function runNovice(track, { laps = 2, maxTime = 240, seed = 3, applyAssist = null, physAssists = {} } = {}) {
  const DT = 1 / 240;
  const rand = mulberry32(seed);
  const kart = new Kart();
  const g = gridSlot(track, 0);
  kart.reset(g.x, g.z, g.heading);
  kart.step({ brake: 1, hold: true }, DT, track);
  const rt = new RaceTracker(track, laps);
  rt.add('n', kart.s, 0);
  const f = {};
  const queue = []; // delayed key decisions
  let keys = { steer: 0, brake: 0 };
  let steer = 0;
  let t = 0, decide = 0;
  let hits = 0, contact = false, stuckT = 0, resets = 0, spins = 0, spinning = false;
  const delay = 0.18;
  while (t < maxTime) {
    decide -= DT;
    if (decide <= 0) {
      decide = 1 / 60;
      const look = 7 + kart.speed * 0.35;
      track.frameAt(kart.s + look, f);
      const dx = f.x - kart.x, dz = f.z - kart.z;
      const sin = Math.sin(kart.heading), cos = Math.cos(kart.heading);
      const err = Math.atan2(dx * -cos + dz * sin, dx * sin + dz * cos); // + = target to the right
      const dead = 0.07 + rand() * 0.04;
      queue.push({ at: t + delay, steer: err > dead ? 1 : err < -dead ? -1 : 0, brake: Math.abs(err) > 0.6 ? 1 : 0 });
    }
    while (queue.length && queue[0].at <= t) keys = queue.shift();
    steer = rampSteer(steer, keys.steer, DT, kart.speed);
    let input = { steer, throttle: keys.brake ? 0 : 1, brake: keys.brake };
    if (applyAssist) input = applyAssist(kart, input, DT);
    kart.impact = 0;
    kart.step(input, DT, track, physAssists);
    t += DT;

    if (kart.impact > 700 && !contact) hits++;
    contact = kart.impact > 50 ? true : kart.impact === 0 ? false : contact;
    const u = kart.forwardSpeed;
    const w = kart.vx * -Math.cos(kart.heading) + kart.vz * Math.sin(kart.heading);
    const beta = Math.abs(Math.atan2(w, Math.abs(u)));
    if (kart.speed > 4 && beta > 0.9 && !spinning) { spins++; spinning = true; }
    if (beta < 0.3) spinning = false;
    stuckT = kart.speed < 1 ? stuckT + DT : 0;
    if (stuckT > 3) {
      // A player would press R here.
      resets++;
      stuckT = 0;
      track.frameAt(kart.s, f);
      kart.reset(f.x, f.z, Math.atan2(f.tx, f.tz));
    }
    const ev = rt.update('n', kart.s, t);
    if (ev === 'finish') break;
  }
  const e = rt.entries.get('n');
  return { finished: e.finished, laps: e.lapTimes.length, lapTimes: e.lapTimes, time: t, hits, resets, spins };
}
