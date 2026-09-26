import test from 'node:test';
import assert from 'node:assert/strict';
import { Track, computeRacingLine } from '../src/sim/track.js';
import { Kart, collideKarts } from '../src/sim/kart.js';
import { AIDriver } from '../src/sim/ai.js';
import { RaceTracker, gridSlot } from '../src/sim/race.js';
import { mulberry32 } from '../src/sim/math.js';
import { DriveAssist, PHYSICS_ASSISTS } from '../src/sim/assist.js';

const DT = 1 / 240;
const track = new Track();
const line = computeRacingLine(track);
const BOT = { countersteer: true, brakeAssist: true };

/** Full 3-lap race with contact. `player` (optional) drives from slot 3. */
function runRace(bots, player = null) {
  const all = bots.map((b, i) => ({ id: `bot${i}`, ai: new AIDriver(track, line, b), slot: i < 3 || !player ? i : i + 1, resets: 0 }));
  if (player) all.push({ id: 'me', slot: 3, player, resets: 0 });
  const rt = new RaceTracker(track, 3);
  for (const e of all) {
    e.kart = new Kart();
    const g = gridSlot(track, e.slot);
    e.kart.reset(g.x, g.z, g.heading);
    e.kart.step({ brake: 1, hold: true }, DT, track);
    rt.add(e.id, e.kart.s, 0);
  }
  const karts = all.map((e) => e.kart);
  let t = 0;
  while (t < 320 && !rt.standings().every((s) => s.finished)) {
    for (const e of all) {
      const inp = e.ai ? e.ai.update(e.kart, karts, DT) : e.player.input(e.kart, karts);
      if (inp.reset) {
        e.resets++;
        const f = track.frameAt(e.kart.s);
        e.kart.reset(f.x, f.z, Math.atan2(f.tx, f.tz));
      }
      e.kart.step(inp, DT, track, e.ai ? BOT : e.player.assists);
    }
    for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) collideKarts(karts[i], karts[j]);
    t += DT;
    for (const e of all) rt.update(e.id, e.kart.s, t);
  }
  return { rt, all, t };
}

test('bots overtake slower karts and recover from spins without resets', () => {
  // Worst case for a "train": slowest bot on pole, fastest at the back.
  const paces = [0.9, 0.915, 0.93, 0.945, 0.96, 0.975];
  const { rt, all, t } = runRace(paces.map((pace, i) => ({ pace, seed: i + 1 })));
  assert.ok(t < 320, 'everyone finished');
  assert.equal(all.reduce((n, e) => n + e.resets, 0), 0, 'no bot needed a reset');
  assert.ok(rt.positionOf('bot5') <= 3, `fastest bot from last on the grid finished P${rt.positionOf('bot5')}`);
});

test('easy mode on throttle alone finishes safely but does not win every race', () => {
  const positions = [];
  for (let seed = 1; seed <= 4; seed++) {
    const rand = mulberry32(seed);
    const bots = [0, 1, 2, 3, 4].map((i) => ({ pace: 0.9 + rand() * 0.075, seed: 100 + i, lineBias: (rand() - 0.5) * 0.8 }));
    const da = new DriveAssist(track, line);
    const player = {
      assists: PHYSICS_ASSISTS.easy,
      input: (kart, karts) => da.apply(kart, { steer: 0, throttle: 1, brake: 0 }, 'easy', karts.filter((k) => k !== kart), DT),
    };
    const { rt, all } = runRace(bots, player);
    assert.ok(rt.entries.get('me').finished, `seed ${seed}: finished`);
    assert.equal(all.find((e) => e.id === 'me').resets, 0);
    positions.push(rt.positionOf('me'));
  }
  const avg = positions.reduce((a, b) => a + b) / positions.length;
  assert.ok(avg >= 2, `average finishing position ${avg} (${positions.join(',')})`);
});
