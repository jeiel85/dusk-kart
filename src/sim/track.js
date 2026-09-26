import { clamp, wrapDelta } from './math.js';

/**
 * Original layout ("Lumen Park Circuit") – an outdoor rental-kart track that
 * runs alongside an evening funfair. Coordinates are metres on the X/Z plane;
 * the car travels in point order (east along the main straight first).
 */
export const TRACK_DEF = {
  name: 'Lumen Park Circuit',
  halfWidth: 4.5,
  apron: 1.1,
  curbWidth: 0.9,
  start: [-5, -61],
  points: [
    [-90, -60], [-20, -62], [50, -60],
    [85, -45], [95, -15], [80, 5], [55, 5],
    [40, 22], [52, 45], [85, 55], [100, 80],
    [82, 102], [50, 92], [20, 70], [-10, 75],
    [-30, 100], [-60, 106], [-90, 90], [-100, 60],
    [-80, 36], [-50, 30], [-40, 5], [-65, -15],
    [-96, -24], [-116, -38], [-112, -56],
  ],
};

function centripetal(p0, p1, p2, p3, t) {
  const d = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const mix = (a, b, ta, tb) => {
    const k = (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

export class Track {
  constructor(def = TRACK_DEF, spacing = 1) {
    this.def = def;
    this.name = def.name;
    this.halfWidth = def.halfWidth;
    this.curbWidth = def.curbWidth;
    this.barrier = def.halfWidth + def.apron;

    // Dense closed spline.
    const pts = def.points;
    const n = pts.length;
    const dense = [];
    const SUB = 40;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let k = 0; k < SUB; k++) dense.push(centripetal(p0, p1, p2, p3, k / SUB));
    }
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[dense.length];
    const count = Math.round(total / spacing);
    const ds = total / count;

    // Uniform resample, rotated so that index 0 lies on the start line.
    const raw = [];
    let j = 0;
    for (let i = 0; i < count; i++) {
      const s = i * ds;
      while (cum[j + 1] < s) j++;
      const a = dense[j], b = dense[(j + 1) % dense.length];
      const k = (s - cum[j]) / (cum[j + 1] - cum[j]);
      raw.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    }
    let startIdx = 0, best = Infinity;
    raw.forEach((p, i) => {
      const d = Math.hypot(p[0] - def.start[0], p[1] - def.start[1]);
      if (d < best) { best = d; startIdx = i; }
    });

    this.count = count;
    this.ds = ds;
    this.length = total;
    this.px = new Float64Array(count);
    this.pz = new Float64Array(count);
    this.tx = new Float64Array(count);
    this.tz = new Float64Array(count);
    this.nx = new Float64Array(count);
    this.nz = new Float64Array(count);
    this.k = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const p = raw[(i + startIdx) % count];
      this.px[i] = p[0];
      this.pz[i] = p[1];
    }
    for (let i = 0; i < count; i++) {
      const a = this.idx(i - 1), b = this.idx(i + 1);
      let tx = this.px[b] - this.px[a], tz = this.pz[b] - this.pz[a];
      const l = Math.hypot(tx, tz);
      tx /= l; tz /= l;
      this.tx[i] = tx; this.tz[i] = tz;
      // Right-hand normal for a heading of (sin θ, cos θ) is (-cos θ, sin θ).
      this.nx[i] = -tz; this.nz[i] = tx;
    }
    // Signed curvature, positive = left-hand bend.
    const rawK = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const a = this.idx(i - 1), b = this.idx(i + 1);
      const h0 = Math.atan2(this.tx[a], this.tz[a]);
      const h1 = Math.atan2(this.tx[b], this.tz[b]);
      rawK[i] = wrapDelta(h1 - h0, Math.PI * 2) / (2 * ds);
    }
    const W = 3;
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let o = -W; o <= W; o++) sum += rawK[this.idx(i + o)];
      this.k[i] = sum / (2 * W + 1);
    }

    // Curbs sit on the inside of a bend (plus a short run-out on the exit).
    this.curbL = new Uint8Array(count);
    this.curbR = new Uint8Array(count);
    const K_CURB = 1 / 45;
    for (let i = 0; i < count; i++) {
      const k = this.k[i];
      if (Math.abs(k) < K_CURB) continue;
      for (let o = -4; o <= 4; o++) {
        const m = this.idx(i + o);
        if (k > 0) this.curbL[m] = 1; else this.curbR[m] = 1;
      }
      // Exit curb on the outside, a little further down the road.
      for (let o = 6; o <= 16; o++) {
        const m = this.idx(i + o);
        if (k > 0) this.curbR[m] = 1; else this.curbL[m] = 1;
      }
    }
  }

  idx(i) {
    const n = this.count;
    return ((i % n) + n) % n;
  }

  /** Position/frame at arc length s (linear interpolation between samples). */
  frameAt(s, out = {}) {
    const f = ((s % this.length) + this.length) % this.length / this.ds;
    const i = Math.floor(f), t = f - i, j = this.idx(i + 1);
    out.x = this.px[i] + (this.px[j] - this.px[i]) * t;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    let tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz);
    tx /= l; tz /= l;
    out.tx = tx; out.tz = tz; out.nx = -tz; out.nz = tx;
    out.k = this.k[i] + (this.k[j] - this.k[i]) * t;
    out.i = i;
    return out;
  }

  /**
   * Nearest point on the centre line. `hint` limits the search to a window
   * around a previous result (karts move far less than a metre per step).
   * Returns lateral offset (positive = right of the direction of travel).
   */
  project(x, z, hint = -1, out = {}, window = 12) {
    let bestD = Infinity, bestI = 0, bestT = 0;
    const scan = (i) => {
      const j = this.idx(i + 1);
      const ax = this.px[i], az = this.pz[i];
      const dx = this.px[j] - ax, dz = this.pz[j] - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      const cx = ax + dx * t - x, cz = az + dz * t - z;
      const d = cx * cx + cz * cz;
      if (d < bestD) { bestD = d; bestI = i; bestT = t; }
    };
    if (hint < 0) {
      for (let i = 0; i < this.count; i++) scan(i);
    } else {
      for (let o = -window; o <= window; o++) scan(this.idx(hint + o));
    }
    const i = bestI, j = this.idx(i + 1), t = bestT;
    const cx = this.px[i] + (this.px[j] - this.px[i]) * t;
    const cz = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    let nx = this.nx[i] + (this.nx[j] - this.nx[i]) * t;
    let nz = this.nz[i] + (this.nz[j] - this.nz[i]) * t;
    const l = Math.hypot(nx, nz);
    nx /= l; nz /= l;
    out.i = i;
    out.s = (i + t) * this.ds;
    out.lateral = (x - cx) * nx + (z - cz) * nz;
    out.nx = nx; out.nz = nz;
    out.tx = nz; out.tz = -nx;
    out.curbL = this.curbL[i];
    out.curbR = this.curbR[i];
    return out;
  }

  /** Surface under a point with the given signed lateral offset. */
  surfaceAt(lateral, proj) {
    const a = Math.abs(lateral);
    if (a > this.halfWidth) return SURFACE.apron;
    if (a > this.halfWidth - this.curbWidth && (lateral < 0 ? proj.curbL : proj.curbR)) return SURFACE.curb;
    return SURFACE.asphalt;
  }
}

export const SURFACE = {
  asphalt: { id: 0, grip: 1.0, rumble: 0, drag: 0 },
  curb: { id: 1, grip: 0.9, rumble: 1, drag: 0 },
  apron: { id: 2, grip: 0.84, rumble: 0.35, drag: 0.012 },
};

/**
 * Minimum-curvature racing line (lateral offsets per sample) and the matching
 * speed profile. Used by the AI, the minimap and the painted rubber line.
 */
export function computeRacingLine(track, { margin = 1.3, mu = 1.02, vMax = 23, brake = 4.6 } = {}) {
  const n = track.count;
  const lim = track.halfWidth - margin;
  const e = new Float64Array(n);
  const X = (i) => track.px[i] + track.nx[i] * e[i];
  const Z = (i) => track.pz[i] + track.nz[i] * e[i];
  for (let it = 0; it < 2500; it++) {
    for (let i = 0; i < n; i++) {
      const a = track.idx(i - 1), b = track.idx(i + 1);
      const mx = (X(a) + X(b)) / 2 - track.px[i];
      const mz = (Z(a) + Z(b)) / 2 - track.pz[i];
      e[i] = clamp(mx * track.nx[i] + mz * track.nz[i], -lim, lim);
    }
  }
  // Curvature of the line from the circumscribed circle of three points.
  const kappa = new Float64Array(n);
  const step = 3;
  for (let i = 0; i < n; i++) {
    const a = track.idx(i - step), b = track.idx(i + step);
    const ax = X(a), az = Z(a), bx = X(i), bz = Z(i), cx = X(b), cz = Z(b);
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const la = Math.hypot(bx - ax, bz - az), lb = Math.hypot(cx - bx, cz - bz), lc = Math.hypot(cx - ax, cz - az);
    kappa[i] = (2 * cross) / (la * lb * lc);
  }
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.min(vMax, Math.sqrt((mu * 9.81) / Math.max(1e-4, Math.abs(kappa[i]))));
  // Braking pass (run twice around the loop so it wraps correctly).
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const nx = track.idx(i + 1);
      v[i] = Math.min(v[i], Math.sqrt(v[nx] * v[nx] + 2 * brake * track.ds));
    }
  }
  return { offset: e, speed: v, kappa };
}
