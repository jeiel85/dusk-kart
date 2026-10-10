import test from 'node:test';
import assert from 'node:assert/strict';
import { Track, computeRacingLine } from '../src/sim/track.js';
import { Kart } from '../src/sim/kart.js';
import { AIDriver } from '../src/sim/ai.js';
import { RaceTracker, gridSlot } from '../src/sim/race.js';
import { GHOST_DT, encodeGhost, sanitizeGhost } from '../src/ghost.js';

const DT = 1 / 240;
const track = new Track();
const line = computeRacingLine(track);

/**
 * One timed lap by a bot, sampled the way main.js records the ghost:
 * restart at each line crossing, sample on the crossing step, then every
 * GHOST_DT of sim time.
 */
function recordLap() {
  const kart = new Kart();
  const g = gridSlot(track, 0);
  kart.reset(g.x, g.z, g.heading);
  const ai = new AIDriver(track, line, { pace: 0.95, seed: 3 });
  const rt = new RaceTracker(track, 0);
  rt.add('me', kart.s, 0);
  let t = 0, tick = 0, rec = null;
  while (t < 200) {
    kart.step(ai.update(kart, [kart], DT), DT, track, { countersteer: true, brakeAssist: true });
    t += DT;
    const ev = rt.update('me', kart.s, t, DT);
    if (ev === 'lap') return { time: rt.entries.get('me').lastLap, rec };
    if (ev === 'start') { rec = []; tick = GHOST_DT - DT; }
    if (rec) {
      tick += DT;
      if (tick >= GHOST_DT - 1e-9) { tick -= GHOST_DT; rec.push([kart.x, kart.z, kart.heading, kart.steer]); }
    }
  }
  throw new Error('bot never completed a lap');
}

const lap = recordLap();
const stored = () => JSON.parse(JSON.stringify(encodeGhost({ time: lap.time, rec: lap.rec, trackLength: track.length })));

test('the ghost holds one sample per GHOST_DT of the lap, so it replays in real time', () => {
  // Zeroing the tick instead of subtracting sampled every 13th 1/240 s step (~8% too sparse).
  assert.ok(Math.abs(lap.rec.length - lap.time / GHOST_DT) <= 1.01, `${lap.rec.length} samples for ${lap.time.toFixed(3)} s`);
});

test('a saved record survives the storage round trip', () => {
  const out = sanitizeGhost(stored(), track.length);
  assert.ok(out, 'accepted');
  assert.equal(out.time, lap.time);
  assert.equal(out.rec.length, lap.rec.length);
  for (let i = 0; i < out.rec.length; i += 97) {
    assert.ok(Math.abs(out.rec[i][0] - lap.rec[i][0]) <= 0.005 && Math.abs(out.rec[i][2] - lap.rec[i][2]) <= 0.0005, `sample ${i}`);
  }
  assert.ok(JSON.stringify(stored()).length < 80_000, 'small enough for localStorage');
});

test('stale, corrupt or forged records are ignored', () => {
  const edit = (fn) => { const r = stored(); fn(r); return r; };
  const bad = {
    'nothing saved': null,
    'not an object': 'ghost',
    'other version': edit((r) => { r.v = 2; }),
    'track layout changed': edit((r) => { r.track += 5; }),
    'impossible lap time': edit((r) => { r.time = 5; }),
    'time disagrees with samples': edit((r) => { r.time *= 1.5; }),
    'NaN sample': edit((r) => { r.rec[10][0] = null; }),
    'short sample': edit((r) => { r.rec[3] = [1, 2]; }),
    'far outside the map': edit((r) => { r.rec[5][1] = 1e6; }),
    'steer out of range': edit((r) => { r.rec[5][3] = 3; }),
    'no samples': edit((r) => { r.rec = []; }),
  };
  for (const [why, raw] of Object.entries(bad)) assert.equal(sanitizeGhost(raw, track.length), null, why);
});
