import { AIDriver } from './ai.js';
import { clamp } from './math.js';

/** Corner-speed factor the easy mode holds the kart to (1 = ideal line speed). */
export const EASY_PACE = 0.95;

/** Control modes offered to the player. */
export const DRIVE_MODES = ['easy', 'normal', 'real'];
export const DRIVE_MODE_LABELS = { easy: '쉬움', normal: '보통', real: '리얼' };

/** Physics-level assists passed to Kart.step for each mode. */
export const PHYSICS_ASSISTS = {
  easy: { countersteer: true, brakeAssist: true, steerLimit: 1, stability: 1 },
  normal: { countersteer: true, brakeAssist: true, steerLimit: 0.8, stability: 0.6 },
  real: { countersteer: false, brakeAssist: false, steerLimit: 0, stability: 0 },
};

/**
 * Driver-side help for the easy mode, applied to the player's raw input:
 *  - steering guidance toward the racing line (strong when hands are off
 *    the keys, gentle when the player is steering),
 *  - automatic lift/brake before corners the kart would not make,
 *  - a wall guard that nudges the kart back when it is heading into the
 *    barriers.
 * The player always keeps authority: a full opposite input still wins.
 */
export class DriveAssist {
  constructor(track, line) {
    this.track = track;
    this.pilot = new AIDriver(track, line, { pace: 1 });
    this.f = {};
  }

  apply(kart, input, mode) {
    if (mode !== 'easy') return input;
    const speed = kart.speed;
    const physics = PHYSICS_ASSISTS[mode];
    let { steer = 0, throttle = 0, brake = 0 } = input;

    // Steering guidance, expressed in the same units as the player's input.
    const range = kart.steerRange(speed, physics.steerLimit);
    const guide = clamp((this.pilot.pursuit(kart) * kart.maxSteer(speed)) / range, -1, 1);
    const hands = Math.abs(steer);
    const w = hands < 0.15 ? 0.7 : 0.35;
    steer += (guide - steer) * w;

    // Wall guard: look 0.6 s ahead across the track.
    const t = this.track;
    const p = t.frameAt(kart.s, this.f);
    const latVel = kart.vx * p.nx + kart.vz * p.nz;
    const ahead = kart.lateral + latVel * 0.6;
    const edge = t.halfWidth - 0.3;
    if (Math.abs(ahead) > edge && Math.sign(latVel) === Math.sign(ahead)) {
      steer -= Math.sign(ahead) * clamp((Math.abs(ahead) - edge) * 0.35, 0, 0.7);
    }

    // Corner speed: lift and brake early enough for the next bend. Kept a
    // little under the ideal (0.95x) so that holding the throttle alone gets
    // round safely but does not beat the AI field — winning is for "normal".
    if (!kart.reverse && throttle > 0) {
      const vT = this.pilot.targetSpeed(kart.s + 2 + speed * 0.3) * EASY_PACE;
      if (speed > vT + 0.2) throttle = Math.min(throttle, clamp(1 - (speed - vT) * 0.8, 0, 1));
      if (speed > vT + 1.0) brake = Math.max(brake, clamp((speed - vT) * 0.3, 0, 0.8));
    }
    return { ...input, steer: clamp(steer, -1, 1), throttle, brake };
  }
}
