/**
 * Time-trial record (best lap + its ghost) kept across visits in
 * localStorage. Pure helpers so the checks run under `node --test`.
 *
 * Whatever comes back from storage is untrusted (older builds, hand edits,
 * a changed track layout), so it is validated before the ghost is replayed.
 */
import { MAX_SPEED } from './netcheck.js';

/** Seconds between ghost samples (main.js records at this rate). */
export const GHOST_DT = 0.05;
export const GHOST_KEY = 'duskkart.trial';
const VERSION = 1;
/** 20 minutes of samples: far beyond any real lap, bounds a hand-edited blob. */
const MAX_SAMPLES = 24000;
const COORD_LIMIT = 1e4;

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * Input: lap time (s), samples [[x, z, heading, steer], ...], track length (m).
 * Output: plain object ready for JSON.stringify.
 * Why rounded: a ~1 min lap is ~1200 samples; full doubles make the blob
 * ~3x larger for precision (sub-cm, sub-mrad) nobody can see on a ghost.
 */
export function encodeGhost({ time, rec, trackLength }) {
  return {
    v: VERSION,
    track: round(trackLength, 2),
    time,
    rec: rec.map(([x, z, h, steer]) => [round(x, 2), round(z, 2), round(h, 3), round(steer, 3)]),
  };
}

/**
 * Input: parsed storage value (anything), current track length (m).
 * Output: { time, rec } or null when the record must be ignored.
 * Why each check:
 * - track length: a layout change makes the old ghost drive through walls,
 *   and its time no longer compares with laps on the new track.
 * - time floor: a lap faster than the network speed cap is not drivable.
 * - sample count vs. time: the ghost is replayed at GHOST_DT, so a blob whose
 *   length disagrees with its lap time would replay at the wrong speed.
 */
export function sanitizeGhost(raw, trackLength) {
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
  if (!Number.isFinite(raw.track) || Math.abs(raw.track - round(trackLength, 2)) > 0.011) return null;
  const { time, rec } = raw;
  if (!Number.isFinite(time) || time < trackLength / MAX_SPEED) return null;
  if (!Array.isArray(rec) || rec.length < 2 || rec.length > MAX_SAMPLES) return null;
  const expected = time / GHOST_DT;
  if (Math.abs(rec.length - expected) > Math.max(40, expected * 0.1)) return null;
  for (const s of rec) {
    if (!Array.isArray(s) || s.length !== 4 || !s.every(Number.isFinite)) return null;
    if (Math.abs(s[0]) > COORD_LIMIT || Math.abs(s[1]) > COORD_LIMIT) return null;
    if (Math.abs(s[2]) > COORD_LIMIT || Math.abs(s[3]) > 1) return null;
  }
  return { time, rec: rec.map((s) => s.slice()) };
}
