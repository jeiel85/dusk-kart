import test from 'node:test';
import assert from 'node:assert/strict';
import { Track, computeRacingLine, applyWeather, TRACKS, TRACK_IDS, TRACK_LABELS } from '../src/sim/track.js';
import { Kart, collideKarts } from '../src/sim/kart.js';
import { AIDriver } from '../src/sim/ai.js';
import { RaceTracker, gridSlot } from '../src/sim/race.js';
import { DriveAssist, PHYSICS_ASSISTS } from '../src/sim/assist.js';
import { runNovice } from './novice.js';

const DT = 1 / 240;
const BOT = { countersteer: true, brakeAssist: true };
// Fixed scenery (src/render/trackScene.js) every course must keep clear of.
const FUNFAIR = { minX: -110, maxX: 80, maxZ: -72 };
const CLUBHOUSE = { minX: -43, maxX: -17, minZ: -40.5, maxZ: -31.5 };

/** Full 3-lap bot race; returns time, resets and whether everyone finished. */
function botRace(track, line) {
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
  while (t < 450 && !rt.standings().every((s) => s.finished)) {
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
  return { t, resets: all.reduce((n, e) => n + e.resets, 0), finished: rt.standings().every((s) => s.finished) };
}

test('every course has an id, a label and a matching definition', () => {
  assert.ok(TRACK_IDS.length >= 2);
  for (const id of TRACK_IDS) {
    assert.equal(TRACKS[id].id, id);
    assert.equal(typeof TRACK_LABELS[id], 'string');
    assert.equal(new Track(TRACKS[id]).id, id);
  }
  // Course lengths must differ: stored ghosts are also checked by length.
  const lengths = TRACK_IDS.map((id) => new Track(TRACKS[id]).length.toFixed(2));
  assert.equal(new Set(lengths).size, lengths.length);
});

for (const id of TRACK_IDS) {
  const track = new Track(TRACKS[id]);
  const line = computeRacingLine(track);

  test(`${id}: a sane closed circuit that keeps clear of the scenery`, () => {
    let maxK = 0;
    for (let i = 0; i < track.count; i++) maxK = Math.max(maxK, Math.abs(track.k[i]));
    assert.ok(1 / maxK >= 10, `min radius ${1 / maxK} must leave room for the inner barrier`);
    let worst = Infinity;
    for (let i = 0; i < track.count; i += 2) {
      for (let j = i + 1; j < track.count; j += 2) {
        const sep = Math.min(j - i, track.count - (j - i)) * track.ds;
        if (sep < 40) continue;
        worst = Math.min(worst, Math.hypot(track.px[i] - track.px[j], track.pz[i] - track.pz[j]));
      }
    }
    assert.ok(worst > 2 * track.barrier + 4, `clearance ${worst}`);
    // Fence + lamps stand ~2.4 m outside the barrier; scenery must be beyond that.
    const margin = track.barrier + 3;
    for (let i = 0; i < track.count; i++) {
      const x = track.px[i], z = track.pz[i];
      if (x > FUNFAIR.minX && x < FUNFAIR.maxX) assert.ok(z - FUNFAIR.maxZ > margin, `funfair at ${x.toFixed(0)},${z.toFixed(0)}`);
      const dx = Math.max(CLUBHOUSE.minX - x, 0, x - CLUBHOUSE.maxX);
      const dz = Math.max(CLUBHOUSE.minZ - z, 0, z - CLUBHOUSE.maxZ);
      assert.ok(Math.hypot(dx, dz) > margin, `clubhouse at ${x.toFixed(0)},${z.toFixed(0)}`);
    }
  });

  test(`${id}: the grid sits on the main straight behind the start line`, () => {
    for (let slot = 0; slot < 8; slot++) {
      const g = gridSlot(track, slot);
      const p = track.project(g.x, g.z);
      assert.ok(Math.abs(p.lateral) < track.halfWidth - 1, `slot ${slot} lateral ${p.lateral}`);
      assert.ok(Math.abs(track.k[p.i]) < 1 / 60, `slot ${slot} is in a bend`);
    }
  });

  test(`${id}: a bot field finishes 3 laps without resets, dry and wet`, () => {
    for (const weather of ['dry', 'rain']) {
      applyWeather(track, line, weather);
      const r = botRace(track, line);
      assert.ok(r.finished, `${weather}: everyone finished (${r.t.toFixed(1)} s)`);
      assert.equal(r.resets, 0, `${weather}: no bot needed a reset`);
    }
    applyWeather(track, line, 'dry');
  });

  test(`${id}: easy mode gets a first-time player round cleanly`, () => {
    const da = new DriveAssist(track, line);
    const r = runNovice(track, {
      laps: 1, maxTime: 240, seed: 1,
      physAssists: PHYSICS_ASSISTS.easy,
      applyAssist: (k, input) => da.apply(k, input, 'easy'),
    });
    assert.equal(r.laps, 1, 'lap completed');
    assert.equal(r.hits, 0, 'no hard barrier hits');
    assert.equal(r.spins, 0, 'no spins');
  });
}
