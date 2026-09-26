import { clamp, mulberry32, wrapDelta } from './math.js';

/**
 * Bot driver: pure-pursuit steering onto the racing line, a speed profile
 * with a per-bot pace factor, and overtaking/following racecraft. It produces
 * the same {steer, throttle, brake} input a human does, so bots obey the
 * exact same physics.
 */
export class AIDriver {
  constructor(track, line, { pace = 0.95, seed = 1, lineBias = 0 } = {}) {
    this.track = track;
    this.line = line;
    this.pace = pace;
    this.rand = mulberry32(seed);
    this.lineBias = lineBias;
    this.avoid = 0;
    this.stuck = 0;
    this.wobble = 0;
    this.f = {};
  }

  lineOffset(s) {
    const t = this.track;
    const f = ((s % t.length) + t.length) % t.length / t.ds;
    const i = Math.floor(f), j = t.idx(i + 1), k = f - i;
    return this.line.offset[i] * (1 - k) + this.line.offset[j] * k;
  }

  targetSpeed(s) {
    const t = this.track;
    const i = t.idx(Math.round(s / t.ds));
    return this.line.speed[i];
  }

  /** Pure-pursuit steer input (-1..1) toward the racing line (+ extra offset). */
  pursuit(kart, extraOffset = 0) {
    const t = this.track;
    const speed = kart.speed;
    const sin = Math.sin(kart.heading), cos = Math.cos(kart.heading);
    const look = 3.2 + speed * 0.32;
    const sT = kart.s + look;
    const f = t.frameAt(sT, this.f);
    const lim = t.halfWidth - 0.9;
    const off = clamp(this.lineOffset(sT) + extraOffset, -lim, lim);
    const tx = f.x + f.nx * off - kart.x;
    const tz = f.z + f.nz * off - kart.z;
    const along = tx * sin + tz * cos;
    const side = tx * -cos + tz * sin; // + right
    const d2 = Math.max(1, along * along + side * side);
    const curv = (2 * side) / d2;
    const L = kart.spec.a + kart.spec.b;
    return clamp(Math.atan(curv * L) / kart.maxSteer(speed), -1, 1);
  }

  /**
   * Racecraft against the kart we are closing on: pick the side with more
   * room beside it, commit to that side until we are past, and do not ram
   * it while there is no gap (follow at its speed instead).
   * Returns the lateral position to aim for (or null) and a speed cap.
   */
  traffic(kart, others) {
    const t = this.track;
    const room = t.halfWidth - 1.1;
    let target = null, cap = Infinity, best = Infinity;
    if (!this.passDir) this.passDir = new Map();
    for (const o of others) {
      if (o === kart) continue;
      const ds = wrapDelta(o.s - kart.s, t.length);
      if (ds < -2 || ds > 16) { this.passDir.delete(o); continue; }
      if (ds <= 0.5) continue;
      const dl = o.lateral - kart.lateral;
      if (Math.abs(dl) > 2.4) continue;
      const closing = kart.speed - o.speed;
      if (ds > 5 && closing < 0.2) continue; // not catching it
      if (ds >= best) continue;
      best = ds;
      let dir = this.passDir.get(o);
      if (dir === undefined) {
        // Prefer the inside of the next bend (a braking-zone pass); on a
        // straight take whichever side has more room.
        const k = t.frameAt(kart.s + 25, this.f).k;
        if (Math.abs(k) > 1 / 60) dir = k > 0 ? -1 : 1;
        else dir = room - o.lateral >= o.lateral + room ? 1 : -1;
        this.passDir.set(o, dir);
      }
      target = clamp(o.lateral + dir * 2.1, -room, room);
      // Directly behind with no gap alongside yet: follow instead of ramming.
      // A stopped or crawling kart (spun, recovering) is an obstacle to
      // steer around at walking pace, never a car to queue behind.
      const beside = Math.abs(target - o.lateral) >= 1.6;
      if (o.speed < 2.5) {
        if (ds < 3.5 && Math.abs(dl) < 1.1) cap = Math.min(cap, 2);
      } else if (ds < 4.5 && (Math.abs(dl) < 1.3 || !beside)) {
        cap = Math.max(0, o.speed + (ds - 2.4) * 1.2);
      }
    }
    return { target, cap };
  }

  update(kart, others, dt) {
    const speed = kart.speed;
    const tr = this.traffic(kart, others);
    const look = 3.2 + speed * 0.32;
    const want = tr.target === null ? 0 : tr.target - this.lineOffset(kart.s + look);
    this.avoid += clamp(want - this.avoid, -3 * dt, 3 * dt);
    this.wobble += (this.rand() - 0.5) * dt * 0.8 - this.wobble * dt * 0.5;

    // Held up behind a slower kart for a while: attack — push harder while
    // pulling alongside so small pace differences still turn into passes.
    const ideal = this.targetSpeed(kart.s + 2 + speed * 0.25);
    const heldUp = tr.cap < ideal * this.pace - 0.3;
    this.blocked = heldUp ? (this.blocked || 0) + dt : Math.max(0, (this.blocked || 0) - dt * 0.5);
    if (this.blocked > 1.5) { this.attack = 5; this.blocked = 0; }
    this.attack = Math.max(0, (this.attack || 0) - dt);
    const pace = this.pace * (this.attack > 0 && tr.target !== null ? 1.05 : 1);

    const steer = this.pursuit(kart, this.avoid + this.lineBias + this.wobble);
    const vT = Math.min(ideal * pace, tr.cap);
    const err = vT - speed;
    let throttle = 0, brake = 0;
    if (err < -0.6) brake = clamp(-err * 0.3, 0, 1);
    else throttle = clamp(0.35 + err * 0.6, 0, 1);

    // Recover from being stuck (usually nose-first into the tyres after a
    // spin): back out on opposite lock like a driver would; only ask for a
    // reset if that fails twice.
    const f = this.track.frameAt(kart.s, this.f);
    let hErr = Math.atan2(f.tx, f.tz) - kart.heading;
    hErr = Math.atan2(Math.sin(hErr), Math.cos(hErr));
    if (this.recover > 0) {
      this.recover -= dt;
      const aligned = Math.abs(hErr) < 0.5 && kart.forwardSpeed < -0.5 && this.recoverTurn;
      if (this.recover <= 0 || aligned) this.recover = 0;
      return { steer: this.recoverTurn ? Math.sign(hErr) : 0, throttle: 0, brake: 1, reset: false };
    }
    if (speed < 1 && throttle > 0.3) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 1.2 && (this.recoveries || 0) < 2) {
      // Facing the wrong way: reverse on opposite lock to swing round.
      // Pinned in a pile-up but pointing the right way: back straight off.
      this.stuck = 0;
      this.recoveries = (this.recoveries || 0) + 1;
      this.recoverTurn = Math.abs(hErr) > 0.6;
      this.recover = this.recoverTurn ? 2.2 : 1.4;
    }
    if (speed > 5) this.recoveries = 0;
    const wantsReset = this.stuck > 3;
    if (wantsReset) { this.stuck = 0; this.recoveries = 0; }
    return { steer, throttle, brake, reset: wantsReset };
  }
}
