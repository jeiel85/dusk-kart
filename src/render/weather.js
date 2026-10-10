import * as THREE from 'three';

const BOX = new THREE.Vector3(36, 16, 36); // rain volume kept centred on the camera (m)
const FALL = new THREE.Vector3(1.1, -10.5, 0.6); // drop velocity in the world, a little wind (m/s)
const DROPS = { low: 1400, medium: 2800, high: 4800 };

/**
 * Rain streaks as line segments animated entirely in the vertex shader.
 *
 * Input:  quality preset (sets the drop count).
 * Output: `mesh` to add to the scene, `update(dt, cameraWorldPos)` per frame,
 *         `visible` toggled by WeatherLook.
 * Why GPU-only: thousands of drops updated on the CPU and re-uploaded every
 * frame would cost more than the whole kart sim on a phone. Each drop is a
 * fixed random seed; its position is seed + FALL * time, wrapped into a box
 * around the camera, so the buffer never changes after creation.
 * Why the streak uses the camera velocity: an action cam at 20 m/s sees rain
 * slanting towards it, not falling straight down — that is what sells speed.
 */
export class Rain {
  constructor(quality = 'high') {
    const n = DROPS[quality] || DROPS.high;
    const pos = new Float32Array(n * 2 * 3);
    const end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uCamVel: { value: new THREE.Vector3() },
      uBox: { value: BOX.clone() },
      uFall: { value: FALL.clone() },
      uOpacity: { value: 0.32 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform float uTime;
        uniform vec3 uCam, uCamVel, uBox, uFall;
        varying float vFade;
        void main() {
          vec3 p = position * uBox + uFall * uTime;
          // Wrap the head into the box; the tail is derived from the head so a
          // streak is never split across the wrap seam.
          p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
          vec3 rel = uFall - uCamVel;
          p -= rel * 0.035 * aEnd;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          // Thin out near the box faces so its edges never show as a wall.
          vec3 q = abs(p - uCam) / (uBox * 0.5);
          vFade = (1.0 - aEnd * 0.85) * (1.0 - smoothstep(0.7, 1.0, max(q.x, q.z)));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(vec3(0.72, 0.78, 0.88), uOpacity * vFade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.LineSegments(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this._last = null;
  }

  /**
   * Input: frame dt (s), camera world position.
   * Why smoothed: camera shake would otherwise flick every streak's angle
   * frame to frame.
   */
  update(dt, camPos) {
    if (!this.mesh.visible) { this._last = null; return; }
    const u = this.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 1000;
    if (this._last && dt > 0) {
      const k = 1 - Math.exp(-dt * 8);
      const v = camPos.clone().sub(this._last).divideScalar(dt);
      // A camera cut or reset is a teleport, not a speed.
      if (v.lengthSq() < 40 * 40) u.uCamVel.value.lerp(v, k);
    } else {
      u.uCamVel.value.set(0, 0, 0);
    }
    this._last = (this._last || new THREE.Vector3()).copy(camPos);
    u.uCam.value.copy(camPos);
  }
}

/** Sky, fog and light levels per weather. Dry matches the original dusk scene. */
const LOOKS = {
  dry: {
    fog: 0x5a6384, fogDensity: 0.0026, hemi: 1.3, sun: 1.15, exposure: 1.05, overcast: 0,
    sky: { uTop: 0x0f2350, uMid: 0x3d5a8c, uHorizon: 0xe79a6e, uGlow: 0xff8a3d },
  },
  rain: {
    fog: 0x3e4554, fogDensity: 0.0068, hemi: 0.95, sun: 0.3, exposure: 1.0, overcast: 1,
    sky: { uTop: 0x141a27, uMid: 0x2a3142, uHorizon: 0x5d5a66, uGlow: 0x8a5a44 },
  },
};

/**
 * Switches the whole scene between weathers.
 *
 * Input:  the scene parts that change ({ scene, renderer, sky, hemi, sun, trackScene, rain }).
 * Output: apply(id) — idempotent, safe to call every time a race starts.
 * Why one place: a weather change touches fog, lights, sky, road materials
 * and the rain mesh; keeping them together means online races (host picks)
 * and local races (menu picks) can never end up half wet.
 */
export class WeatherLook {
  constructor(parts) {
    this.p = parts;
    this.id = null;
  }

  /** A course change builds a new track scene: give it the current wet state. */
  setTrackScene(trackScene) {
    this.p.trackScene = trackScene;
    trackScene.setWet(this.id === 'rain');
  }

  apply(id) {
    id = LOOKS[id] ? id : 'dry';
    if (this.id === id) return;
    this.id = id;
    const look = LOOKS[id];
    const { scene, renderer, sky, hemi, sun, trackScene, rain } = this.p;
    scene.fog.color.set(look.fog);
    scene.fog.density = look.fogDensity;
    hemi.intensity = look.hemi;
    sun.intensity = look.sun;
    renderer.toneMappingExposure = look.exposure;
    const u = sky.material.uniforms;
    for (const [k, c] of Object.entries(look.sky)) u[k].value.set(c);
    u.uOvercast.value = look.overcast;
    trackScene.setWet(this.id === 'rain');
    rain.mesh.visible = this.id === 'rain';
  }
}
