import { clamp, mulberry32 } from './sim/math.js';

const BASE_RPM = 3000;

/**
 * One engine cycle of a single-cylinder 4-stroke at BASE_RPM: a combustion
 * thump (decaying low resonance + filtered noise burst) followed by the
 * quieter exhaust/valve chatter. Several slightly different cycles are
 * concatenated so the loop does not sound synthetic.
 */
function engineBuffer(ctx) {
  const sr = ctx.sampleRate;
  const cycle = 120 / BASE_RPM; // two revolutions per firing
  const cycles = 8;
  const len = Math.floor(sr * cycle * cycles);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const rand = mulberry32(77);
  const cl = Math.floor(sr * cycle);
  let lp = 0;
  for (let c = 0; c < cycles; c++) {
    const amp = 0.85 + rand() * 0.3;
    const f1 = 95 + rand() * 20, f2 = 190 + rand() * 40;
    for (let i = 0; i < cl; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 55);
      const n = rand() * 2 - 1;
      lp += (n - lp) * 0.25;
      let v = amp * env * (Math.sin(2 * Math.PI * f1 * t) * 0.9 + Math.sin(2 * Math.PI * f2 * t) * 0.35 + lp * 1.3);
      // Valve / exhaust chatter half-way through the cycle.
      const t2 = t - cycle * 0.5;
      if (t2 > 0) v += Math.exp(-t2 * 90) * (lp * 0.35 + Math.sin(2 * Math.PI * 420 * t2) * 0.08);
      d[c * cl + i] = v;
    }
  }
  // Normalise.
  let m = 0;
  for (let i = 0; i < len; i++) m = Math.max(m, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] /= m;
  return buf;
}

function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rand = mulberry32(3);
  for (let i = 0; i < len; i++) d[i] = rand() * 2 - 1;
  return buf;
}

function shaper(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

class EngineVoice {
  constructor(ctx, buffer, dest, gain = 1) {
    this.ctx = ctx;
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1.2;
    this.shape = ctx.createWaveShaper();
    this.shape.curve = shaper(2.2);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.base = gain;
    this.src.connect(this.shape).connect(this.filter).connect(this.gain).connect(dest);
    this.src.start(0, Math.random() * 0.3);
  }

  set(rpm, throttle, now) {
    const rate = clamp(rpm / BASE_RPM, 0.45, 2.4);
    this.src.playbackRate.setTargetAtTime(rate, now, 0.03);
    this.filter.frequency.setTargetAtTime(500 + throttle * 2600 + rpm * 0.25, now, 0.05);
    this.gain.gain.setTargetAtTime(this.base * (0.35 + throttle * 0.65) * (0.6 + rate * 0.25), now, 0.05);
  }

  stop() {
    try { this.src.stop(); } catch { /* already stopped */ }
    this.gain.disconnect();
  }
}

export class KartAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
    this.remote = new Map();
    this.wet = false;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.engineBuf = engineBuffer(ctx);
    this.noiseBuf = noiseBuffer(ctx);
    this.engine = new EngineVoice(ctx, this.engineBuf, this.master, 0.55);

    const loopNoise = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start(0, Math.random());
      return { f, g };
    };
    this.wind = loopNoise('lowpass', 700, 0.5);
    this.road = loopNoise('lowpass', 160, 0.8);
    this.scrub = loopNoise('bandpass', 900, 2.5);
    this.curb = loopNoise('bandpass', 120, 3);
    // Rain on the helmet and track, plus the hiss of tyres through standing water.
    this.rain = loopNoise('bandpass', 2600, 0.35);
    this.spray = loopNoise('highpass', 1800, 0.6);
    this.setWet(this.wet);
    // Curb rattle: an LFO chopping the curb noise.
    this.curbLfo = ctx.createOscillator();
    this.curbLfo.type = 'square';
    this.curbLfo.frequency.value = 20;
    this.curbDepth = ctx.createGain();
    this.curbDepth.gain.value = 0;
    this.curbLfo.connect(this.curbDepth).connect(this.curb.g.gain);
    this.curbLfo.start();

    this.remoteBus = ctx.createGain();
    this.remoteBus.gain.value = 0.9;
    this.remoteBus.connect(this.master);
  }

  /**
   * Input: true in the rain. Why stored: the AudioContext only exists after
   * the first user gesture, so the menu can pick rain before start() runs.
   */
  setWet(wet) {
    this.wet = wet;
    if (this.rain) this.rain.g.gain.setTargetAtTime(wet ? 0.11 : 0, this.ctx.currentTime, 0.4);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  /** Per-frame update for the player's kart. */
  update(kart) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const speed = kart.speed;
    this.engine.set(kart.rpm, kart.throttle, now);
    this.wind.g.gain.setTargetAtTime(clamp(speed * speed * 0.00016, 0, 0.3), now, 0.1);
    this.wind.f.frequency.setTargetAtTime(400 + speed * 45, now, 0.1);
    this.road.g.gain.setTargetAtTime(clamp(speed * 0.012, 0, 0.3), now, 0.05);
    this.spray.g.gain.setTargetAtTime(this.wet ? clamp(speed * 0.008, 0, 0.18) : 0, now, 0.08);
    let slip = 0;
    for (const w of kart.wheels) slip = Math.max(slip, w.sliding ? w.slip : 0);
    this.scrub.g.gain.setTargetAtTime(clamp((slip - 0.8) * 0.06, 0, 0.22), now, 0.04);
    this.scrub.f.frequency.setTargetAtTime(700 + clamp(slip, 0, 6) * 90, now, 0.05);
    const onCurb = kart.wheels.some((w) => w.surface === 1) && speed > 2;
    this.curbDepth.gain.setTargetAtTime(onCurb ? 0.35 : 0, now, 0.02);
    this.curbLfo.frequency.setTargetAtTime(clamp(speed / 1.2, 4, 40), now, 0.05);
    if (kart.impact > 400) this.thud(clamp(kart.impact / 3000, 0.1, 1));
  }

  thud(strength) {
    const ctx = this.ctx;
    if (!ctx || (this._lastThud && ctx.currentTime - this._lastThud < 0.12)) return;
    this._lastThud = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.9 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }

  beep(freq = 660, dur = 0.18, vol = 0.25) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Positional engine sounds for the nearest other karts. */
  updateOthers(listener, others) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const l = ctx.listener;
    const { position: p, forward: f } = listener;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, now, 0.02); l.positionY.setTargetAtTime(p.y, now, 0.02); l.positionZ.setTargetAtTime(p.z, now, 0.02);
      l.forwardX.setTargetAtTime(f.x, now, 0.02); l.forwardY.setTargetAtTime(f.y, now, 0.02); l.forwardZ.setTargetAtTime(f.z, now, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
    const nearest = others
      .map((o) => ({ o, d: Math.hypot(o.x - p.x, o.z - p.z) }))
      .filter((e) => e.d < 90)
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
    const keep = new Set(nearest.map((e) => e.o.id));
    for (const [id, v] of this.remote) {
      if (!keep.has(id)) { v.voice.stop(); v.panner.disconnect(); this.remote.delete(id); }
    }
    for (const { o } of nearest) {
      let v = this.remote.get(o.id);
      if (!v) {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 3;
        panner.rolloffFactor = 1.4;
        panner.connect(this.remoteBus);
        v = { panner, voice: new EngineVoice(ctx, this.engineBuf, panner, 0.4) };
        this.remote.set(o.id, v);
      }
      if (v.panner.positionX) {
        v.panner.positionX.setTargetAtTime(o.x, now, 0.03);
        v.panner.positionY.setTargetAtTime(0.4, now, 0.03);
        v.panner.positionZ.setTargetAtTime(o.z, now, 0.03);
      } else {
        v.panner.setPosition(o.x, 0.4, o.z);
      }
      v.voice.set(o.rpm, o.throttle, now);
    }
  }

  stopOthers() {
    for (const v of this.remote.values()) { v.voice.stop(); v.panner.disconnect(); }
    this.remote.clear();
  }
}
