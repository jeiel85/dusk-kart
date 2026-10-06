/**
 * Dynamic resolution: scales the render resolution below the quality
 * preset's pixel ratio while the frame rate stays low, and back up once it
 * recovers. The preset stays the ceiling; only resolution changes, so the
 * look is the same and nothing has to reload.
 */
export class ResolutionGovernor {
  constructor({ min = 0.6, step = 0.15, low = 45, high = 57, downAfter = 2, upAfter = 6 } = {}) {
    Object.assign(this, { min, step, low, high, downAfter, upAfter });
    this.scale = 1;
    this.frames = 0;
    this.time = 0;
    this.slow = 0;
    this.fast = 0;
  }

  /**
   * Feed one frame's duration (s). Returns the new scale when it changes,
   * otherwise null. Frame rate is judged over one-second windows.
   */
  sample(dt) {
    // Hitches and hidden tabs say nothing about steady-state speed.
    if (!(dt > 0) || dt > 0.25) { this.frames = 0; this.time = 0; return null; }
    this.frames++;
    this.time += dt;
    if (this.time < 1) return null;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    if (fps < this.low) { this.slow++; this.fast = 0; } else if (fps > this.high) { this.fast++; this.slow = 0; } else { this.slow = 0; this.fast = 0; }
    let next = this.scale;
    if (this.slow >= this.downAfter) next = Math.max(this.min, this.scale - this.step);
    else if (this.fast >= this.upAfter) next = Math.min(1, this.scale + this.step / 2);
    if (next === this.scale) return null;
    this.slow = 0;
    this.fast = 0;
    this.scale = next;
    return next;
  }
}

export const QUALITY_STEPS = ['low', 'medium', 'high'];

/**
 * Automatic quality preset (phones by default). A preset rebuilds the scene,
 * so it only changes on the next load: this watches the current one and gives
 * at most one verdict per page load.
 * - Up one step after `window` seconds of driving at `fast`+ fps without the
 *   resolution governor ever stepping down — the device has headroom.
 * - Down one step as soon as the governor has had to drop the resolution
 *   twice (scale <= 0.7), and the ceiling comes down with it so the next
 *   load doesn't climb straight back to a preset that struggled.
 */
export class QualityTuner {
  constructor(quality, ceiling = 'high', { window = 20, fast = 57, struggling = 0.7 } = {}) {
    Object.assign(this, { quality, ceiling, window, fast, struggling });
    this.time = 0;
    this.frames = 0;
    this.minScale = 1;
    this.done = false;
  }

  /**
   * @param dt frame duration (s)
   * @param driving true while a race is actually being driven (not paused, visible)
   * @param scale the resolution governor's current scale
   * @returns {{quality: string, ceiling: string} | null} the next load's preset, once
   */
  sample(dt, driving, scale) {
    if (this.done || !driving || !(dt > 0) || dt > 0.25) return null;
    const i = QUALITY_STEPS.indexOf(this.quality);
    this.minScale = Math.min(this.minScale, scale);
    if (this.minScale <= this.struggling + 1e-9) {
      this.done = true;
      if (i <= 0) return null;
      const lower = QUALITY_STEPS[i - 1];
      return { quality: lower, ceiling: lower };
    }
    this.time += dt;
    this.frames++;
    if (this.time < this.window) return null;
    this.done = true;
    const fps = this.frames / this.time;
    if (this.minScale < 1 || fps < this.fast || i >= QUALITY_STEPS.indexOf(this.ceiling)) return null;
    return { quality: QUALITY_STEPS[i + 1], ceiling: this.ceiling };
  }
}
