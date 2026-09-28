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
