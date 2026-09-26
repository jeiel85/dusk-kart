import { wrapDelta } from './math.js';

/**
 * Lap/position bookkeeping. Progress is integrated from the arc-length
 * position so driving backwards over the line never counts as a lap.
 */
export class RaceTracker {
  constructor(track, laps = 3) {
    this.track = track;
    this.laps = laps;
    this.entries = new Map();
  }

  add(id, s, time = 0, meta = {}) {
    const p = wrapDelta(s, this.track.length);
    this.entries.set(id, {
      id, ...meta,
      lastS: s, progress: p, lap: 0, maxLap: 0,
      lapStart: null, lastLap: null, bestLap: null, lapTimes: [],
      finished: false, finishTime: null, wrongWay: 0,
    });
    return this.entries.get(id);
  }

  remove(id) { this.entries.delete(id); }

  /** Returns events: 'start' (first crossing), 'lap', 'finish'. */
  update(id, s, time, dt = 0) {
    const e = this.entries.get(id);
    if (!e) return null;
    const L = this.track.length;
    const d = wrapDelta(s - e.lastS, L);
    e.lastS = s;
    e.progress += d;
    if (dt > 0) e.wrongWay = d < -0.02 ? e.wrongWay + dt : Math.max(0, e.wrongWay - dt * 2);
    if (e.finished) return null;
    const lap = Math.floor(e.progress / L) + 1; // 1 once the line is crossed
    if (lap <= e.maxLap) return null;
    e.maxLap = lap;
    if (lap === 1 || e.lapStart === null) {
      e.lapStart = time;
      e.lap = 1;
      return 'start';
    }
    const lt = time - e.lapStart;
    e.lapTimes.push(lt);
    e.lastLap = lt;
    if (e.bestLap === null || lt < e.bestLap) e.bestLap = lt;
    e.lapStart = time;
    e.lap = lap;
    if (this.laps > 0 && lap > this.laps) {
      e.finished = true;
      e.finishTime = time;
      e.lap = this.laps;
      return 'finish';
    }
    return 'lap';
  }

  standings() {
    return [...this.entries.values()].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
  }

  positionOf(id) {
    return this.standings().findIndex((e) => e.id === id) + 1;
  }
}

/** Staggered two-wide grid behind the start line. */
export function gridSlot(track, slot) {
  const f = track.frameAt(-6 - slot * 4.5);
  const side = slot % 2 === 0 ? -1.8 : 1.8;
  return {
    x: f.x + f.nx * side,
    z: f.z + f.nz * side,
    heading: Math.atan2(f.tx, f.tz),
    s: -6 - slot * 4.5,
  };
}
