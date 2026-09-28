/**
 * Network helpers that do not depend on the WebRTC stack, so the menu can
 * load without it and the plausibility checks run under `node --test`.
 *
 * Online races have no server: every peer reports its own kart. These checks
 * cannot stop a modified client that fakes a consistent, physically possible
 * drive, but they reject what a tampered or buggy peer can send cheaply —
 * off-circuit positions, impossible speeds, progress jumps and finish times
 * shorter than the race has been running.
 */
export const now = () => performance.timeOrigin + performance.now();

export function randomRoomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint32Array(5);
  crypto.getRandomValues(buf);
  for (const v of buf) s += abc[v % abc.length];
  return s;
}

/** [t, x, z, heading, vx, vz, omega, steer, rpm, throttle, progress, lapFlags, s, lateral] */
export const SNAP_LEN = 14;
/** Progress value a peer sends while it is not in a race. */
export const NO_PROGRESS = -1e6;
/** Well above a rental kart's ~25 m/s top speed, to leave room for contact impulses. */
export const MAX_SPEED = 32;

/** Track-derived limits for {@link sanitizeSnapshot}. */
export function snapshotLimits(track) {
  const scratch = {};
  return {
    length: track.length,
    barrier: track.barrier,
    project: (x, z) => track.project(x, z, -1, scratch),
  };
}

/**
 * Validate a remote kart snapshot. Returns a clean copy — with the arc
 * position and lateral offset recomputed from the reported position rather
 * than trusted — or null if the snapshot must be dropped.
 */
export function sanitizeSnapshot(s, lim) {
  if (!Array.isArray(s) || s.length < SNAP_LEN) return null;
  const a = s.slice(0, SNAP_LEN);
  if (!a.every(Number.isFinite)) return null;
  const [, x, z, heading, vx, vz, omega, steer, rpm, throttle, progress, flags] = a;
  if (Math.hypot(vx, vz) > MAX_SPEED || Math.abs(omega) > 20 || Math.abs(heading) > 1e4) return null;
  if (Math.abs(steer) > 1 || rpm < 0 || rpm > 12000 || throttle < 0 || throttle > 1) return null;
  if (!Number.isInteger(flags) || flags < 0 || flags > 3) return null;
  if (progress !== NO_PROGRESS && (progress < -lim.length || progress > lim.length * 11)) return null;
  const p = lim.project(x, z);
  // Karts are pushed back inside the tyre wall, so anything beyond it is forged.
  if (Math.abs(p.lateral) > lim.barrier + 0.6) return null;
  a[12] = p.s;
  a[13] = p.lateral;
  return a;
}

/**
 * Caps how fast a peer's reported race progress may grow, measured on the
 * receiver's clock. Progress may always go down (reversing, a new race).
 */
export class ProgressGuard {
  constructor(maxSpeed = MAX_SPEED, slack = 4) {
    this.maxSpeed = maxSpeed;
    this.slack = slack;
    this.value = null;
    this.t = 0;
    this.violations = 0;
  }

  /** @param progress reported progress (m) @param tMs local receive time (ms) */
  accept(progress, tMs) {
    const prev = this.value;
    const dt = Math.max(0, (tMs - this.t) / 1000);
    this.t = tMs;
    if (progress === NO_PROGRESS || prev === null) {
      // First sight of a peer (it may already be mid-race when we join).
      this.value = progress;
      return progress;
    }
    // Leaving the lobby for a race: karts start on the grid, behind the line.
    const cap = prev === NO_PROGRESS ? this.slack : prev + this.maxSpeed * dt + this.slack;
    if (progress > cap) this.violations++;
    this.value = Math.min(progress, cap);
    return this.value;
  }
}

/** Shortest possible race: every lap at the validation speed limit. */
export function minRaceTime(laps, length) {
  return (laps * length) / MAX_SPEED;
}

/**
 * Whether a peer's finish time is believable.
 * @param elapsed seconds since the shared start signal when the claim arrived
 * @param tolerance allowance for latency and clock-sync error (s)
 */
export function finishClaimPlausible({ time, laps, length, elapsed, tolerance = 1.5 }) {
  if (!Number.isFinite(time) || time < minRaceTime(laps, length)) return false;
  // Race time runs on the shared wall clock, so a finish cannot predate the
  // moment it was announced by more than the network delay.
  if (Number.isFinite(elapsed) && time < elapsed - tolerance) return false;
  return true;
}
