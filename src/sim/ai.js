import { clamp, mulberry32, wrapDelta } from './math.js';

/**
 * Bot driver: pure-pursuit steering onto the racing line, a speed profile
 * with a per-bot pace factor, and simple side-by-side avoidance. It produces
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

  update(kart, others, dt) {
    const t = this.track;
    const speed = kart.speed;
    const sin = Math.sin(kart.heading), cos = Math.cos(kart.heading);

    // Avoid karts directly ahead by shifting the target line sideways.
    let want = 0;
    for (const o of others) {
      if (o === kart) continue;
      const ds = wrapDelta(o.s - kart.s, t.length);
      if (ds < 0.5 || ds > 9) continue;
      const dl = o.lateral - kart.lateral;
      if (Math.abs(dl) > 1.8) continue;
      const room = t.halfWidth - 1.2;
      const goRight = o.lateral < 0 ? kart.lateral + 1.6 < room : kart.lateral - 1.6 < -room;
      want = goRight ? 1.9 : -1.9;
    }
    this.avoid += clamp(want - this.avoid, -2.5 * dt, 2.5 * dt);
    this.wobble += (this.rand() - 0.5) * dt * 0.8 - this.wobble * dt * 0.5;

    const look = 3.2 + speed * 0.32;
    const sT = kart.s + look;
    const f = t.frameAt(sT, this.f);
    const lim = t.halfWidth - 0.9;
    const off = clamp(this.lineOffset(sT) + this.avoid + this.lineBias + this.wobble, -lim, lim);
    const tx = f.x + f.nx * off - kart.x;
    const tz = f.z + f.nz * off - kart.z;
    const along = tx * sin + tz * cos;
    const side = tx * -cos + tz * sin; // + right
    const d2 = Math.max(1, along * along + side * side);
    const curv = (2 * side) / d2;
    const L = kart.spec.a + kart.spec.b;
    const delta = Math.atan(curv * L);
    let steer = clamp(delta / kart.maxSteer(speed), -1, 1);

    const vT = this.targetSpeed(kart.s + 2 + speed * 0.25) * this.pace;
    const err = vT - speed;
    let throttle = 0, brake = 0;
    if (err < -0.6) brake = clamp(-err * 0.3, 0, 1);
    else throttle = clamp(0.35 + err * 0.6, 0, 1);

    // Recover from being stuck against a barrier.
    if (speed < 1 && throttle > 0.3) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    const wantsReset = this.stuck > 3;
    if (wantsReset) this.stuck = 0;
    return { steer, throttle, brake, reset: wantsReset };
  }
}
