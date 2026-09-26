import { clamp } from './math.js';

/**
 * Digital (keyboard) steering → analog steer value. Pressing ramps in, so a
 * tap gives a small correction; releasing or reversing snaps back faster.
 */
export function rampSteer(current, target, dt, speed = 0) {
  const reversing = target !== 0 && current !== 0 && Math.sign(target) !== Math.sign(current);
  const rate = target === 0 ? 5.5 : reversing ? 7 : 2.6 + 1.2 / (1 + speed * 0.1);
  return current + clamp(target - current, -rate * dt, rate * dt);
}
