import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';

/**
 * Procedural rental kart + driver. Local frame: +Z forward, +Y up, +X left
 * (three.js convention for an object facing +Z). Ground at y = 0.
 */
const Y = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

// Shared geometry/materials across all karts.
let shared = null;
function getShared() {
  if (shared) return shared;
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xbfc5cc, metalness: 0.85, roughness: 0.3 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.7, roughness: 0.4 });
  const blackPlastic = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.55 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.85 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.7 });
  const engine = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.6, roughness: 0.45 });
  const exhaust = new THREE.MeshStandardMaterial({ color: 0x6e6258, metalness: 0.8, roughness: 0.35 });
  const hub = new THREE.MeshStandardMaterial({ map: T.wheelHubTexture(), roughness: 0.6 });

  function wheelGeo(r, w) {
    const g = new THREE.CylinderGeometry(r, r, w, 24, 1);
    g.rotateZ(Math.PI / 2);
    return g;
  }
  shared = {
    tyreMat, rimMat, frameMat, blackPlastic, glove, pants, shoe, engine, exhaust, hub,
    tyreF: wheelGeo(0.13, 0.12),
    tyreR: wheelGeo(0.14, 0.19),
    rimF: wheelGeo(0.075, 0.125),
    rimR: wheelGeo(0.08, 0.195),
  };
  return shared;
}

function tube(a, b, r, mat) {
  const d = tmpA.subVectors(b, a);
  const len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(Y, d.normalize());
  return m;
}

/** Orient a unit-length (along Y, centred) mesh between two points. */
function stretch(mesh, a, b) {
  const d = tmpB.subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(Y, d.multiplyScalar(1 / Math.max(len, 1e-6)));
  mesh.scale.set(1, len, 1);
}

export class KartModel {
  constructor({ color = '#2f6bff', number = 12, suit = '#c9202a', helmet = '#f2f2f2' } = {}) {
    const S = getShared();
    this.root = new THREE.Group(); // position/heading
    this.body = new THREE.Group(); // roll/pitch
    this.root.add(this.body);
    const team = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 });
    this.teamMat = team;

    // --- chassis frame (low, mostly hidden) ---
    const fm = S.frameMat;
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    const rails = [
      [P(0.28, 0.06, 0.62), P(0.3, 0.06, -0.62)], [P(-0.28, 0.06, 0.62), P(-0.3, 0.06, -0.62)],
      [P(0.3, 0.06, -0.62), P(-0.3, 0.06, -0.62)], [P(0.28, 0.06, 0.62), P(-0.28, 0.06, 0.62)],
      [P(0.28, 0.06, 0.55), P(0.52, 0.12, 0.58)], [P(-0.28, 0.06, 0.55), P(-0.52, 0.12, 0.58)],
      [P(0.3, 0.07, -0.5), P(0.6, 0.14, -0.5)], [P(-0.3, 0.07, -0.5), P(-0.6, 0.14, -0.5)],
    ];
    for (const [a, b] of rails) this.body.add(tube(a, b, 0.016, fm));
    // Rear axle.
    this.body.add(tube(P(0.66, 0.14, -0.47), P(-0.66, 0.14, -0.47), 0.02, S.rimMat));
    // Floor tray.
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.9), S.blackPlastic);
    tray.position.set(0, 0.07, 0.2);
    this.body.add(tray);

    // --- bodywork ---
    // Nose cone.
    const noseShape = new THREE.Shape();
    noseShape.moveTo(-0.62, 0); noseShape.lineTo(0.62, 0); noseShape.quadraticCurveTo(0.66, 0.15, 0.4, 0.2);
    noseShape.lineTo(-0.4, 0.2); noseShape.quadraticCurveTo(-0.66, 0.15, -0.62, 0);
    const nose = new THREE.Mesh(new THREE.ExtrudeGeometry(noseShape, { depth: 0.26, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.05, bevelSegments: 3 }), team);
    nose.position.set(0, 0.06, 0.7);
    nose.castShadow = true;
    this.body.add(nose);
    const noseStripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.36), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }));
    noseStripe.position.set(0, 0.275, 0.83);
    this.body.add(noseStripe);
    // Front panel with the race number (double sided -> mirrored from the seat, like the real thing).
    const panelTex = T.numberPanelTexture(number, color);
    const panel = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.02, 2, 0.01), new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.4 }));
    panel.position.set(0, 0.3, 0.52);
    panel.rotation.x = -0.35;
    this.body.add(panel);
    // Side pods.
    const podTex = T.sidePodTexture(number, color);
    for (const sx of [-1, 1]) {
      const pod = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.2, 0.86, 3, 0.07), new THREE.MeshStandardMaterial({ map: podTex, roughness: 0.4 }));
      pod.position.set(sx * 0.6, 0.18, 0.02);
      pod.castShadow = true;
      this.body.add(pod);
    }
    // Rear bumper.
    const bumper = new THREE.Mesh(new RoundedBoxGeometry(1.25, 0.16, 0.16, 2, 0.06), S.blackPlastic);
    bumper.position.set(0, 0.2, -0.88);
    bumper.castShadow = true;
    this.body.add(bumper);

    // Engine (right side, behind the seat) with exhaust.
    const eng = new THREE.Group();
    eng.position.set(-0.36, 0.12, -0.36);
    const block = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.24, 0.24, 2, 0.03), S.engine);
    block.position.y = 0.15;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 10), S.engine);
    head.rotation.z = Math.PI / 2;
    head.position.set(0.02, 0.32, 0);
    const tank = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.12, 0.2, 2, 0.04), new THREE.MeshStandardMaterial({ color: 0xc92222, roughness: 0.4 }));
    tank.position.set(0, 0.36, -0.14);
    const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), S.exhaust);
    exh.rotation.x = Math.PI / 2;
    exh.position.set(-0.14, 0.18, -0.2);
    eng.add(block, head, tank, exh);
    eng.traverse((o) => { o.castShadow = true; });
    this.body.add(eng);

    // Seat.
    const seatShape = new THREE.Shape();
    seatShape.moveTo(-0.2, 0); seatShape.lineTo(0.2, 0); seatShape.lineTo(0.22, 0.4); seatShape.lineTo(-0.22, 0.4); seatShape.closePath();
    const seat = new THREE.Mesh(new THREE.ExtrudeGeometry(seatShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03 }), S.blackPlastic);
    seat.position.set(0, 0.1, -0.48);
    seat.rotation.x = -0.45;
    this.body.add(seat);
    const seatBase = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.06, 0.3, 2, 0.02), S.blackPlastic);
    seatBase.position.set(0, 0.1, -0.3);
    this.body.add(seatBase);

    // --- steering ---
    this.column = tube(P(0, 0.12, 0.5), P(0, 0.46, 0.12), 0.014, fm);
    this.body.add(this.column);
    this.wheelPivot = new THREE.Group();
    this.wheelPivot.position.set(0, 0.46, 0.12);
    // Face tilted ~25° back towards the driver (normal points up/back).
    this.wheelPivot.rotation.set(-0.43, Math.PI, 0, 'YXZ');
    this.body.add(this.wheelPivot);
    this.steeringWheel = new THREE.Group();
    this.wheelPivot.add(this.steeringWheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 10, 40), S.blackPlastic);
    rim.scale.set(1.08, 0.86, 1);
    const hubPlate = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.13, 0.02, 2, 0.015), [S.blackPlastic, S.blackPlastic, S.blackPlastic, S.blackPlastic, S.hub, S.blackPlastic]);
    hubPlate.position.z = 0.012;
    for (const a of [Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.13, 0.012), S.blackPlastic);
      spoke.position.set(Math.sin(a) * 0.08, Math.cos(a) * 0.07, 0);
      spoke.rotation.z = -a;
      this.steeringWheel.add(spoke);
    }
    this.steeringWheel.add(rim, hubPlate);
    // Grip markers (hand targets) on the rim at "quarter to three". The pivot
    // is turned 180° about Y, so the driver's left hand sits at local -X.
    this.gripL = new THREE.Object3D();
    this.gripR = new THREE.Object3D();
    this.gripL.position.set(-0.152, 0.035, 0.02);
    this.gripR.position.set(0.152, 0.035, 0.02);
    this.steeringWheel.add(this.gripL, this.gripR);

    // Pedals.
    for (const sx of [-0.1, 0.1]) {
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.02), S.rimMat);
      pedal.position.set(sx, 0.14, 0.64);
      pedal.rotation.x = -0.4;
      this.body.add(pedal);
    }

    // --- wheels ---
    this.wheels = [];
    const mk = (x, z, front) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, front ? 0.13 : 0.14, z);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(front ? S.tyreF : S.tyreR, S.tyreMat);
      const rimM = new THREE.Mesh(front ? S.rimF : S.rimR, S.rimMat);
      tyre.castShadow = true;
      spin.add(tyre, rimM);
      // A spoke-ish marker so rotation is visible.
      const mark = new THREE.Mesh(new THREE.BoxGeometry(front ? 0.13 : 0.2, 0.02, 0.1), S.frameMat);
      spin.add(mark);
      pivot.add(spin);
      this.root.add(pivot); // wheels do not roll with the chassis
      return { pivot, spin, front, baseY: pivot.position.y };
    };
    // Physics wheel order: FL, FR, RL, RR (left = +X here because +Z is forward).
    this.wheels.push(mk(0.55, 0.58, true), mk(-0.55, 0.58, true), mk(0.62, -0.47, false), mk(-0.62, -0.47, false));
    // Front stub axles / spindles.
    for (const sx of [1, -1]) this.body.add(tube(P(sx * 0.3, 0.12, 0.58), P(sx * 0.5, 0.13, 0.58), 0.018, fm));

    // --- driver ---
    this.driver = new THREE.Group();
    this.body.add(this.driver);
    const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.75 });
    const vestMat = new THREE.MeshStandardMaterial({ color: 0x131417, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.34, 6, 12), vestMat);
    torso.scale.set(1.15, 1, 0.75);
    torso.position.set(0, 0.42, -0.36);
    torso.rotation.x = -0.3;
    torso.castShadow = true;
    this.driver.add(torso);
    this.torso = torso;
    // Legs to the pedals.
    const hip = [P(0.1, 0.16, -0.24), P(-0.1, 0.16, -0.24)];
    const knee = [P(0.18, 0.32, 0.2), P(-0.18, 0.32, 0.2)];
    const foot = [P(0.1, 0.16, 0.6), P(-0.1, 0.16, 0.6)];
    for (let k = 0; k < 2; k++) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 4, 8), S.pants);
      thigh.position.copy(hip[k]).lerp(knee[k], 0.5);
      thigh.castShadow = true;
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.34, 4, 8), S.pants);
      shin.position.copy(knee[k]).lerp(foot[k], 0.5);
      shin.quaternion.setFromUnitVectors(Y, tmpC.subVectors(foot[k], knee[k]).normalize());
      thigh.quaternion.setFromUnitVectors(Y, tmpC.subVectors(knee[k], hip[k]).normalize());
      const boot = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.1, 0.2, 2, 0.03), S.shoe);
      boot.position.copy(foot[k]).add(P(0, 0.02, 0.06));
      this.driver.add(thigh, shin, boot);
    }
    // Head + helmet (hidden in the helmet-cam view).
    this.head = new THREE.Group();
    this.head.position.set(0, 0.88, -0.47);
    const helmetMat = new THREE.MeshStandardMaterial({ color: helmet, roughness: 0.25, metalness: 0.1 });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), helmetMat);
    shell.scale.set(1, 1.05, 1.12);
    shell.castShadow = true;
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 10, -0.9, 1.8, 1.1, 0.7), new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.05, metalness: 0.9 }));
    visor.scale.set(1, 1.05, 1.12);
    visor.rotation.y = 0;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.012, 6, 30, Math.PI), team);
    stripe.rotation.y = Math.PI / 2;
    stripe.scale.set(1, 1.05, 1.12);
    this.head.add(shell, visor, stripe);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), vestMat);
    neck.position.set(0, 0.74, -0.46);
    this.driver.add(this.head, neck);
    this.neck = neck;

    // Arms: unit-length capsules stretched by IK every frame.
    const mkSeg = (r, mat) => {
      const g = new THREE.CapsuleGeometry(r, 1, 4, 10);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      this.driver.add(m);
      return m;
    };
    this.arms = [0, 1].map((k) => ({
      side: k === 0 ? 1 : -1,
      shoulder: P(k === 0 ? 0.2 : -0.2, 0.64, -0.4),
      upper: mkSeg(0.055, suitMat),
      lower: mkSeg(0.048, suitMat),
      hand: (() => {
        const h = new THREE.Mesh(new RoundedBoxGeometry(0.095, 0.13, 0.1, 2, 0.035), S.glove);
        h.castShadow = true;
        this.driver.add(h);
        return h;
      })(),
      cuff: (() => {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.05, 0.07, 10), S.glove);
        this.driver.add(c);
        return c;
      })(),
    }));

    // Helmet-cam mount point: just above the driver's eyes.
    this.camMount = new THREE.Object3D();
    this.camMount.position.set(0, 0.93, -0.3);
    this.body.add(this.camMount);

    this._inv = new THREE.Matrix4();
  }

  setFirstPerson(on) {
    this.head.visible = !on;
    this.neck.visible = !on;
  }

  /** Two-bone IK keeps the gloves glued to the rim as the wheel turns. */
  solveArms() {
    this.body.updateMatrixWorld(true);
    this._inv.copy(this.driver.matrixWorld).invert();
    const L1 = 0.29, L2 = 0.3;
    for (const arm of this.arms) {
      const grip = arm.side > 0 ? this.gripL : this.gripR;
      const H = grip.getWorldPosition(tmpA).applyMatrix4(this._inv).clone();
      const S = arm.shoulder;
      const d = tmpB.subVectors(H, S);
      let len = d.length();
      const dir = d.clone().multiplyScalar(1 / len);
      len = Math.min(len, (L1 + L2) * 0.995);
      const a = (L1 * L1 - L2 * L2 + len * len) / (2 * len);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      // Elbows point outwards and down.
      const pole = new THREE.Vector3(arm.side * 1, -0.8, -0.2);
      pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      const E = S.clone().addScaledVector(dir, a).addScaledVector(pole, h);
      const handPos = S.clone().addScaledVector(dir, len);
      stretch(arm.upper, S, E);
      arm.upper.scale.y = L1 / 1.11;
      // Sleeve stops at the wrist; the glove wraps the rim.
      const fore = E.distanceTo(handPos);
      const wrist = E.clone().lerp(handPos, Math.max(0.3, (fore - 0.1) / fore));
      stretch(arm.lower, E, wrist);
      arm.lower.scale.y = Math.max(0.15, fore - 0.1) / 1.1;
      arm.hand.position.copy(handPos);
      arm.hand.quaternion.copy(arm.lower.quaternion);
      arm.cuff.position.copy(wrist);
      arm.cuff.quaternion.copy(arm.lower.quaternion);
    }
  }

  /**
   * @param pose {x, z, heading, steer (road wheel rad), wheelSpin[4], roll, pitch, lift, liftSide}
   */
  update(pose) {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = pose.heading;
    this.body.rotation.set(pose.pitch || 0, 0, -(pose.roll || 0), 'YXZ');
    this.body.position.y = (pose.bump || 0);
    // Steering wheel turns ~3x the road-wheel angle (quick kart steering).
    this.steeringWheel.rotation.z = -(pose.steer || 0) * 3.0;
    const spins = pose.wheelSpin || [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k];
      w.spin.rotation.x = spins[k];
      if (w.front) w.pivot.rotation.y = -(pose.steer || 0) * (k === 0 ? (pose.steer > 0 ? 0.85 : 1.1) : (pose.steer > 0 ? 1.1 : 0.85));
      // Visible inside-rear wheel lift.
      if (!w.front) {
        const isInside = (k === 3 && pose.liftSide > 0) || (k === 2 && pose.liftSide < 0);
        w.pivot.position.y = w.baseY + (isInside ? (pose.lift || 0) * 0.04 : 0);
      }
    }
    this.solveArms();
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry && !Object.values(getShared()).includes(o.geometry)) o.geometry.dispose();
    });
  }
}
