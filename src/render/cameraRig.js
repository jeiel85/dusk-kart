import * as THREE from 'three';
import { clamp, lerp } from '../sim/math.js';

export const CAMERA_MODES = ['helmet', 'chase', 'far'];
export const CAMERA_LABELS = { helmet: '헬멧 액션캠', chase: '3인칭 체이스', far: '3인칭 원거리' };

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/**
 * Helmet-mounted action cam (wide, head moves with G-forces and vibration)
 * plus two chase cameras.
 */
export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(90, aspect, 0.05, 2000);
    this.mode = 'helmet';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.shake = 0;
    this.t = 0;
    this.headRoll = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.fovBase = { helmet: 92, chase: 68, far: 60 };
    this.snap = true;
  }

  setMode(mode) {
    this.mode = mode;
    this.snap = true;
  }

  /**
   * @param model KartModel of the followed kart
   * @param kart  physics state (speed, ay, ax, omega, rumble, impact)
   */
  update(dt, model, kart, heading) {
    const cam = this.camera;
    this.t += dt;
    const speed = kart.speed;
    // Impacts kick the camera, rumble strips buzz it.
    this.shake = Math.max(this.shake * Math.exp(-dt * 6), Math.min(1, (kart.impact || 0) / 2500));

    if (this.mode === 'helmet') {
      model.setFirstPerson(true);
      model.body.updateMatrixWorld(true);
      model.camMount.getWorldPosition(tmp);
      // Head tilts with lateral G and looks slightly into the corner.
      const targetRoll = clamp(-kart.ay * 0.012, -0.14, 0.14);
      const targetYaw = clamp(-kart.steer * 0.55 + kart.omega * 0.05, -0.28, 0.28);
      const targetPitch = clamp(kart.ax * 0.006, -0.05, 0.05);
      const k = 1 - Math.exp(-dt * 5);
      this.headRoll += (targetRoll - this.headRoll) * k;
      this.headYaw += (targetYaw - this.headYaw) * (1 - Math.exp(-dt * 3.5));
      this.headPitch += (targetPitch - this.headPitch) * k;
      // Vibration: engine buzz + road texture + curbs.
      const t = this.t;
      const buzz = 0.0012 + speed * 0.00009 + kart.rumble * 0.006 + this.shake * 0.03;
      const vx = (Math.sin(t * 71.3) + Math.sin(t * 43.1 + 1.3) * 0.6) * buzz;
      const vy = (Math.sin(t * 83.7 + 0.4) + Math.sin(t * 29.3) * 0.7) * buzz;
      cam.position.copy(tmp);
      model.body.getWorldQuaternion(cam.quaternion);
      // Look forward (+Z of the kart) and a little down at the wheel.
      cam.rotateY(Math.PI + this.headYaw);
      cam.rotateX(-0.36 - this.headPitch + vy * 2);
      cam.rotateZ(this.headRoll + vx * 2);
      cam.position.y += vy;
      cam.fov = this.fovBase.helmet;
    } else {
      model.setFirstPerson(false);
      const far = this.mode === 'far';
      const dist = far ? 7.5 : 3.6;
      const height = far ? 3.2 : 1.55;
      // Follow the direction of travel a bit when sliding, heading otherwise.
      const vx = kart.vx, vz = kart.vz;
      let dirAng = heading;
      if (speed > 3) {
        const velAng = Math.atan2(vx, vz);
        let d = velAng - heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        dirAng = heading + d * 0.5;
      }
      const target = tmp.set(kart.x - Math.sin(dirAng) * dist, height, kart.z - Math.cos(dirAng) * dist);
      const look = tmp2.set(kart.x + Math.sin(heading) * 2.5, 0.55, kart.z + Math.cos(heading) * 2.5);
      if (this.snap) { this.pos.copy(target); this.look.copy(look); }
      const kp = 1 - Math.exp(-dt * (far ? 4 : 6.5));
      this.pos.lerp(target, kp);
      this.look.lerp(look, 1 - Math.exp(-dt * 12));
      cam.position.copy(this.pos);
      cam.position.y += Math.sin(this.t * 40) * this.shake * 0.05;
      cam.lookAt(this.look);
      cam.fov = this.fovBase[this.mode] + clamp(speed * 0.45, 0, 11);
    }
    this.snap = false;
    cam.updateProjectionMatrix();
  }

  /** Lens settings for the post pass, driven by speed. */
  lens(kart, settings) {
    const speed = kart.speed;
    const helmet = this.mode === 'helmet';
    const blur = settings.motionBlur * clamp((speed - 6) / 18, 0, 1) * (helmet ? 0.085 : 0.045);
    return {
      distort: settings.lensDistortion ? (helmet ? 0.34 : 0.1) : 0,
      blur,
      aberration: helmet ? 0.0035 : 0.0015,
      vignette: helmet ? 0.42 : 0.25,
      grain: helmet ? 0.04 : 0.02,
      center: this._center(),
    };
  }

  _center() {
    // The vanishing point: project a point far ahead of the camera.
    const cam = this.camera;
    cam.getWorldDirection(tmp);
    tmp.y = 0;
    tmp.normalize().multiplyScalar(100).add(cam.position);
    tmp.project(cam);
    return new THREE.Vector2(clamp(tmp.x * 0.5 + 0.5, 0.2, 0.8), clamp(tmp.y * 0.5 + 0.5, 0.25, 0.8));
  }
}

export { lerp };
