import { clamp, G, lerp, smoothstep, table } from './math.js';

/**
 * Rental-class 4-stroke kart (≈ 13 hp, centrifugal clutch, rear brake only,
 * solid rear axle, no suspension). Body frame: +u forward, +w to the right.
 * World frame: X/Z plane, heading θ with forward = (sin θ, cos θ).
 * Positive yaw rate turns the kart left; positive steer turns it right.
 */
export const KART_SPEC = {
  mass: 175, // kart + driver
  inertia: 72,
  cgHeight: 0.28,
  a: 0.58, // CG → front axle
  b: 0.47, // CG → rear axle
  trackF: 1.1,
  trackR: 1.24,
  wheelRF: 0.13,
  wheelRR: 0.14,
  mu: 1.25,
  // Rear tyres are much wider (11x7.1 vs 10x4.5): stiffer and a touch grippier.
  latBF: 13, latBR: 18, latC: 1.35, muRear: 1.05,
  lonB: 12, lonC: 1.6,
  scrubB: 5, scrubGain: 0.55, // solid-axle scrub (axle twist + tyre compliance)
  slideMu: 0.82, // locked-wheel friction as a fraction of peak
  gear: 4.0,
  efficiency: 0.9,
  idleRpm: 1900,
  clutchIn: 2500,
  clutchLock: 3300,
  governor: 6300,
  torque: [[1000, 9], [2000, 14], [3000, 18.5], [3800, 19.6], [4800, 18.6], [5600, 16.6], [6300, 14]],
  engineBrake: 55,
  brakeMax: 1500,
  cdA: 0.62,
  crr: 0.018,
  steerMax: 0.42,
  steerSpeedRef: 15,
  steerRate: 5.5,
  jack: 0.85,
  halfL: 0.93,
  halfW: 0.7,
  reverseForce: 320,
  reverseMax: 3,
};

const RHO = 1.2;
// Wheel layout: FL, FR, RL, RR  (along = +front, side = +right)
const WHEELS = (s) => [
  { along: s.a, side: -s.trackF / 2, front: true },
  { along: s.a, side: s.trackF / 2, front: true },
  { along: -s.b, side: -s.trackR / 2, front: false },
  { along: -s.b, side: s.trackR / 2, front: false },
];

const pac = (x, B, C) => Math.sin(C * Math.atan(B * x));
/** Smooth sign for friction-like forces so a stopped kart does not jitter. */
const ssign = (v, eps = 0.3) => clamp(v / eps, -1, 1);

export class Kart {
  constructor(spec = KART_SPEC) {
    this.spec = spec;
    this.wheels = WHEELS(spec).map((w) => ({
      ...w,
      load: 0, slip: 0, sliding: false, surface: 0, spin: 0, lift: 0, x: 0, z: 0,
    }));
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.vx = 0; this.vz = 0; this.omega = 0;
    this.steer = 0; // road-wheel angle (rad)
    this.rpm = this.spec.idleRpm;
    this.ax = 0; this.ay = 0;
    this.reverse = false;
    this.reverseTimer = 0;
    this.impact = 0; // strongest collision impulse this frame (N·s)
    this.rumble = 0;
    this.drive = 0;
    this.throttle = 0;
    this.brake = 0;
    this.hint = -1;
    this.lateral = 0;
    this.s = 0;
    this.surfaceGrip = 1;
    this.prev = { x, z, heading };
    for (const w of this.wheels) { w.load = 0; w.slip = 0; w.sliding = false; w.spin = 0; w.lift = 0; }
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading); }

  savePrev() {
    this.prev.x = this.x; this.prev.z = this.z; this.prev.heading = this.heading;
  }

  maxSteer(speed) {
    const s = this.spec;
    return Math.max(0.09, s.steerMax / (1 + (speed / s.steerSpeedRef) ** 2));
  }

  /**
   * Road-wheel angle that a full steering input maps to. With the steer
   * limiter (0..1) a full keyboard press no longer means full lock: it is
   * capped to what the tyres can use at this speed (plus a small slip
   * margin) and to a turn rate a human can correct within their reaction
   * time (0.9 rad/s; the tightest hairpin needs ~0.75). Mashing a key then
   * neither scrubs the solid axle to a crawl nor swings the kart past the
   * apex before the player can react.
   */
  steerRange(speed, limiter = 0) {
    const full = this.maxSteer(speed);
    if (!limiter) return full;
    const s = this.spec;
    const L = s.a + s.b;
    const v = Math.max(speed, 0.5);
    const grip = (L * s.mu * 9.81 * 0.95) / (v * v) + 0.09;
    const yaw = Math.atan((L * 0.9) / v);
    const cap = Math.min(full, grip, yaw);
    return full + (cap - full) * limiter;
  }

  /**
   * @param input {steer:-1..1 (right +), throttle:0..1, brake:0..1}
   * @param assists {countersteer:bool, brakeAssist:bool}
   */
  step(input, dt, track, assists = {}) {
    const s = this.spec;
    const m = s.mass;
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    const fx = sin, fz = cos; // forward
    const rx = -cos, rz = sin; // right
    let u = this.vx * fx + this.vz * fz;
    let w = this.vx * rx + this.vz * rz;
    const speed = Math.hypot(u, w);

    // --- track / surface -------------------------------------------------
    const proj = track.project(this.x, this.z, this.hint, this._proj || (this._proj = {}));
    this.hint = proj.i;
    this.s = proj.s;
    this.lateral = proj.lateral;

    // --- driver controls -------------------------------------------------
    let throttle = clamp(input.throttle || 0, 0, 1);
    let brake = clamp(input.brake || 0, 0, 1);
    // Holding the brake at a standstill engages slow reverse — except when the
    // kart is being held on the grid (input.hold), which must stay put.
    if (!input.hold && !this.reverse && brake > 0.5 && throttle < 0.1 && Math.abs(u) < 0.4) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.6) this.reverse = true;
    } else if (!this.reverse) {
      this.reverseTimer = 0;
    }
    if (this.reverse && (input.hold || throttle > 0.1 || brake < 0.1)) { this.reverse = false; this.reverseTimer = 0; }

    let target = clamp(input.steer || 0, -1, 1) * this.steerRange(speed, assists.steerLimit || 0);
    if (assists.countersteer && speed > 4 && u > 0) {
      const beta = Math.atan2(w, Math.abs(u)); // body slip angle
      if (Math.abs(beta) > 0.06) target += clamp((beta - Math.sign(beta) * 0.06) * 0.9, -0.2, 0.2);
    }
    target = clamp(target, -s.steerMax, s.steerMax);
    const dSteer = s.steerRate * dt;
    this.steer += clamp(target - this.steer, -dSteer, dSteer);
    const delta = this.steer;

    // --- engine & clutch -------------------------------------------------
    const wheelRpm = (Math.abs(u) / s.wheelRR) * s.gear * 9.549;
    let drive = 0;
    if (this.reverse) {
      drive = u > -s.reverseMax ? -s.reverseForce * brake : 0;
      brake = 0;
      this.rpm = lerp(this.rpm, 3000, 1 - Math.exp(-dt * 4));
    } else {
      // Centrifugal clutch: while slipping, the engine sits at its stall speed
      // and the clutch passes the full engine torque; above clutchLock the
      // engine is tied to the rear axle.
      const locked = wheelRpm >= s.clutchLock;
      const stall = lerp(s.clutchIn, s.clutchLock + 150, throttle);
      const targetRpm = throttle > 0.02 ? Math.max(wheelRpm, stall) : Math.max(s.idleRpm, locked ? wheelRpm : 0);
      const rate = targetRpm > this.rpm ? 9000 : 6000;
      this.rpm += clamp(targetRpm - this.rpm, -rate * dt, rate * dt);
      if (locked) this.rpm = wheelRpm;
      const gov = clamp((s.governor + 250 - this.rpm) / 350, 0, 1);
      if (throttle > 0.02) {
        const tq = table(s.torque, locked ? wheelRpm : stall) * throttle * gov;
        drive = (tq * s.gear * s.efficiency * smoothstep(0.02, 0.1, throttle)) / s.wheelRR;
      } else if (wheelRpm > s.clutchIn) {
        drive = -s.engineBrake * smoothstep(s.clutchIn, s.clutchLock, wheelRpm) * ssign(u, 1);
      }
    }
    this.drive = drive;
    this.throttle = throttle;
    this.brake = brake;

    // --- vertical loads ---------------------------------------------------
    const L = s.a + s.b;
    const h = s.cgHeight;
    const mg = m * G;
    let fzF = (mg * s.b) / L - (m * this.ax * h) / L;
    let fzR = (mg * s.a) / L + (m * this.ax * h) / L;
    fzF = Math.max(fzF, 0.15 * mg); fzR = Math.max(fzR, 0.15 * mg);
    const latT = m * this.ay * h; // ay > 0 (right) loads the left wheels
    const dF = (latT * 0.42) / s.trackF;
    const dR = (latT * 0.58) / s.trackR;
    const loads = [fzF / 2 + dF, fzF / 2 - dF, fzR / 2 + dR, fzR / 2 - dR];
    // Caster jacking lifts the inside rear wheel as the front wheels turn.
    const jack = s.jack * clamp(Math.abs(delta) / 0.3, 0, 1) * (fzR / 2);
    if (delta > 0) { loads[3] -= jack; loads[0] += jack * 0.6; loads[2] += jack * 0.4; }
    else if (delta < 0) { loads[2] -= jack; loads[1] += jack * 0.6; loads[3] += jack * 0.4; }

    // --- tyre forces ------------------------------------------------------
    let Fu = 0, Fw = 0, Tz = 0;
    // Ackermann: the inside front wheel steers more than the outside one.
    const Lw = s.a + s.b;
    let stL = delta, stR = delta;
    if (Math.abs(delta) > 1e-4) {
      const R = Lw / Math.tan(Math.abs(delta));
      const dIn = Math.atan(Lw / Math.max(0.3, R - s.trackF / 2)) * Math.sign(delta);
      const dOut = Math.atan(Lw / (R + s.trackF / 2)) * Math.sign(delta);
      if (delta > 0) { stR = dIn; stL = dOut; } else { stL = dIn; stR = dOut; }
    }
    const uRef = Math.max(Math.abs(u), 2);
    // Solid rear axle: both wheels share one rotational speed. The axle is
    // held at the speed of whichever wheel carries more load, so a lifted
    // inside wheel scrubs freely - that is how a kart turns without a diff.
    const lRL = Math.max(0, loads[2]), lRR = Math.max(0, loads[3]);
    const axleU = (lRL * (u - (s.trackR / 2) * this.omega) + lRR * (u + (s.trackR / 2) * this.omega)) / Math.max(1, lRL + lRR);
    let rumble = 0, gripSum = 0;
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i];
      const fz = Math.max(0, loads[i]);
      wh.load = fz;
      wh.lift = clamp(1 - fz / (0.12 * mg), 0, 1);
      // Wheel offset from the kart centre, measured across the track.
      const ox = fx * wh.along + rx * wh.side, oz = fz * wh.along + rz * wh.side;
      wh.x = this.x + ox; wh.z = this.z + oz;
      const surf = track.surfaceAt(proj.lateral + ox * proj.nx + oz * proj.nz, proj);
      wh.surface = surf.id;
      rumble = Math.max(rumble, surf.rumble);
      gripSum += surf.grip;
      const mu = s.mu * surf.grip * (wh.front ? 1 : s.muRear);
      const fmax = mu * fz;

      // Contact-patch velocity in the body frame.
      const uw = u + wh.side * this.omega;
      const ww = w - wh.along * this.omega;
      let cu = uw, cw = ww;
      const dw = i === 0 ? stL : stR;
      const cd = Math.cos(dw), sd = Math.sin(dw);
      if (wh.front) { cu = uw * cd + ww * sd; cw = -uw * sd + ww * cd; }
      const alpha = Math.atan2(cw, Math.max(Math.abs(cu), 1.2));
      let fy = -fmax * pac(alpha, wh.front ? s.latBF : s.latBR, s.latC);
      let fxw = -s.crr * fz * ssign(cu); // rolling resistance
      let locked = false;
      if (!wh.front) {
        // Solid rear axle: both wheels turn at the axle speed, so in a turn
        // the inner wheel is driven and the outer one dragged.
        const kappa = (axleU - uw) / uRef;
        fxw += s.scrubGain * fmax * pac(kappa, s.scrubB, s.lonC);
        // Axle torque reaches the ground in proportion to each wheel's load.
        const share = (i === 2 ? lRL : lRR) / Math.max(1, lRL + lRR);
        fxw += drive * share;
        let bf = brake * s.brakeMax * share;
        if (assists.brakeAssist) bf = Math.min(bf, 0.93 * fmax);
        if (bf > fmax && Math.hypot(uw, ww) > 0.5) {
          locked = true;
        } else {
          fxw -= bf * ssign(uw, 0.4);
        }
      }
      let fu, fw;
      if (locked) {
        // Locked wheel slides: friction opposes the full slip velocity.
        const vmag = Math.hypot(uw, ww);
        const f = s.slideMu * fmax;
        fu = (-f * uw) / vmag; fw = (-f * ww) / vmag;
        wh.slip = vmag;
        wh.sliding = true;
      } else {
        fxw = clamp(fxw, -fmax, fmax);
        const ratio = fmax > 1e-3 ? fxw / fmax : 0;
        fy *= Math.sqrt(Math.max(0, 1 - ratio * ratio));
        if (wh.front) { fu = fxw * cd - fy * sd; fw = fxw * sd + fy * cd; }
        else { fu = fxw; fw = fy; }
        wh.slip = Math.abs(cw) * smoothstep(0.1, 0.22, Math.abs(alpha)) + Math.abs(ratio) * 0.6 * smoothstep(0.85, 1, Math.abs(ratio)) * Math.abs(cu) * 0.2;
        wh.sliding = Math.abs(alpha) > 0.16 || Math.abs(ratio) > 0.97;
      }
      wh.fu = fu; wh.fw = fw;
      Fu += fu; Fw += fw;
      Tz += wh.side * fu - wh.along * fw;
      const r = wh.front ? s.wheelRF : s.wheelRR;
      wh.spin += ((locked ? 0 : cu) / r) * dt;
    }
    this.surfaceGrip = gripSum / 4;
    this.rumble = rumble;

    // Stability assist (0..1): pulls the yaw rate toward what the steering
    // asks for (bounded by the grip limit) and damps sideways sliding. It
    // cures both spins and solid-axle push; off in the "real" mode.
    const stab = assists.stability || 0;
    if (stab > 0 && speed > 2.5 && !this.reverse) {
      const aMax = s.mu * G * 0.95;
      const rMax = aMax / speed;
      const rKin = clamp((-u * Math.tan(delta)) / L, -rMax, rMax);
      Tz += stab * s.inertia * 5 * (rKin - this.omega);
      const slipW = w - Math.sign(w) * Math.abs(u) * 0.05; // tolerate ~3° of body slip
      if (Math.sign(slipW) === Math.sign(w)) {
        const cap = 0.35 * mg * stab;
        Fw -= clamp(stab * m * 3.5 * slipW, -cap, cap);
      }
    }

    // Aero drag + apron dust drag.
    const drag = 0.5 * RHO * s.cdA * speed;
    Fu -= drag * u; Fw -= drag * w;
    if (rumble > 0.3 && this.surfaceGrip < 0.9) Fu -= 0.012 * mg * ssign(u);

    // --- integrate --------------------------------------------------------
    const Fx = fx * Fu + rx * Fw;
    const Fz = fz * Fu + rz * Fw;
    const oldVx = this.vx, oldVz = this.vz;
    this.vx += (Fx / m) * dt;
    this.vz += (Fz / m) * dt;
    this.omega += (Tz / s.inertia) * dt;
    // Static friction at a standstill.
    if (Math.hypot(this.vx, this.vz) < 0.08 && throttle < 0.02 && !this.reverse) {
      this.vx *= 0.8; this.vz *= 0.8; this.omega *= 0.8;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.heading += this.omega * dt;

    const axw = (this.vx - oldVx) / dt, azw = (this.vz - oldVz) / dt;
    const k = 1 - Math.exp(-dt * 14);
    this.ax += (axw * fx + azw * fz - this.ax) * k;
    this.ay += (axw * rx + azw * rz - this.ay) * k;

    this.collideTrack(track);
  }

  /** Resolve the four body corners against the tyre barriers. */
  collideTrack(track) {
    const s = this.spec;
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    const p = this._cp || (this._cp = {});
    for (let c = 0; c < 4; c++) {
      const al = c < 2 ? s.halfL : -s.halfL;
      const si = c % 2 === 0 ? -s.halfW : s.halfW;
      const ox = sin * al - cos * si;
      const oz = cos * al + sin * si;
      track.project(this.x + ox, this.z + oz, this.hint, p, 6);
      const pen = Math.abs(p.lateral) - track.barrier;
      if (pen <= 0) continue;
      const sg = Math.sign(p.lateral);
      const nx = -sg * p.nx, nz = -sg * p.nz; // back towards the track
      this.x += nx * pen; this.z += nz * pen;
      this.applyContact(ox, oz, nx, nz, 0.22, 0.32);
    }
  }

  /** Impulse against an immovable surface at world offset (ox, oz). */
  applyContact(ox, oz, nx, nz, e, muC) {
    const s = this.spec;
    const pvx = this.vx + this.omega * oz;
    const pvz = this.vz - this.omega * ox;
    const vn = pvx * nx + pvz * nz;
    if (vn >= 0) return;
    const rn = oz * nx - ox * nz;
    const j = (-(1 + e) * vn) / (1 / s.mass + (rn * rn) / s.inertia);
    this.vx += (j * nx) / s.mass; this.vz += (j * nz) / s.mass;
    this.omega += (j * rn) / s.inertia;
    const tx = -nz, tz = nx;
    const vt = pvx * tx + pvz * tz;
    const rt = oz * tx - ox * tz;
    let jt = -vt / (1 / s.mass + (rt * rt) / s.inertia);
    jt = clamp(jt, -muC * j, muC * j);
    this.vx += (jt * tx) / s.mass; this.vz += (jt * tz) / s.mass;
    this.omega += (jt * rt) / s.inertia;
    this.impact = Math.max(this.impact, j);
  }

  /** Visual chassis attitude from the filtered accelerations. */
  attitude() {
    const inside = this.wheels[2].lift > this.wheels[3].lift ? -1 : 1;
    const lift = Math.max(this.wheels[2].lift, this.wheels[3].lift);
    return {
      roll: clamp(this.ay * 0.0045, -0.06, 0.06) + inside * lift * 0.035,
      pitch: clamp(-this.ax * 0.0035, -0.03, 0.03),
      liftSide: inside,
      lift,
    };
  }
}

const CIRCLES = [0.48, -0.45];
const RADIUS = 0.62;

/**
 * Kart-vs-kart contact using two circles per kart. `b` may be a kinematic
 * proxy for a network kart (bDynamic = false), in which case only `a` reacts.
 */
export function collideKarts(a, b, bDynamic = true) {
  const sa = Math.sin(a.heading), ca = Math.cos(a.heading);
  const sb = Math.sin(b.heading), cb = Math.cos(b.heading);
  const dx0 = a.x - b.x, dz0 = a.z - b.z;
  if (dx0 * dx0 + dz0 * dz0 > 9) return 0;
  let hit = 0;
  for (const oa of CIRCLES) {
    for (const ob of CIRCLES) {
      const ax = a.x + sa * oa, az = a.z + ca * oa;
      const bx = b.x + sb * ob, bz = b.z + cb * ob;
      let nx = ax - bx, nz = az - bz;
      const d = Math.hypot(nx, nz);
      const pen = 2 * RADIUS - d;
      if (pen <= 0 || d < 1e-5) continue;
      nx /= d; nz /= d;
      // Contact point halfway between the circle centres.
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const rax = cx - a.x, raz = cz - a.z;
      const rbx = cx - b.x, rbz = cz - b.z;
      const vax = a.vx + a.omega * raz, vaz = a.vz - a.omega * rax;
      const vbx = b.vx + b.omega * rbz, vbz = b.vz - b.omega * rbx;
      const vn = (vax - vbx) * nx + (vaz - vbz) * nz;
      // Each side removes half the overlap (a network peer corrects its own half).
      a.x += nx * pen * 0.5; a.z += nz * pen * 0.5;
      if (bDynamic) { b.x -= nx * pen * 0.5; b.z -= nz * pen * 0.5; }
      if (vn >= 0) continue;
      const ma = a.spec.mass, ia = a.spec.inertia;
      const mb = b.spec ? b.spec.mass : ma, ib = b.spec ? b.spec.inertia : ia;
      const rna = raz * nx - rax * nz;
      const rnb = rbz * nx - rbx * nz;
      const e = 0.35;
      const j = (-(1 + e) * vn) / (1 / ma + (rna * rna) / ia + 1 / mb + (rnb * rnb) / ib);
      a.vx += (j * nx) / ma; a.vz += (j * nz) / ma; a.omega += (j * rna) / ia;
      a.impact = Math.max(a.impact || 0, j);
      if (bDynamic) {
        b.vx -= (j * nx) / mb; b.vz -= (j * nz) / mb; b.omega -= (j * rnb) / ib;
        b.impact = Math.max(b.impact || 0, j);
      }
      hit = Math.max(hit, j);
    }
  }
  return hit;
}
