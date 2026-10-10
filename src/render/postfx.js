import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Action-camera lens: barrel ("fisheye") distortion, radial speed blur that
 * leaves the centre sharp, chromatic fringing at the edges, vignette and grain,
 * and in the rain, water beads on the lens.
 */
const ActionCamShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAspect: { value: 16 / 9 },
    uDistort: { value: 0.28 },
    uBlur: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAberration: { value: 0.004 },
    uVignette: { value: 0.35 },
    uTime: { value: 0 },
    uGrain: { value: 0.035 },
    uRain: { value: 0 },
    uSpeed: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAspect, uDistort, uBlur, uAberration, uVignette, uTime, uGrain, uRain, uSpeed;
    uniform vec2 uCenter;
    varying vec2 vUv;

    vec2 barrel(vec2 uv) {
      vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
      float r2 = dot(p, p);
      float corner = 0.25 * (uAspect * uAspect + 1.0);
      p *= (1.0 + uDistort * r2) / (1.0 + uDistort * corner);
      return p / vec2(uAspect, 1.0) + 0.5;
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 17.0) * 43758.5453); }
    float hash0(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.17))) * 15731.743); }

    // Water beads on the lens: one candidate drop per screen cell. Each lives
    // a random cycle, grows in, then is blown up and off the lens — faster
    // the quicker the kart goes, as the head-wind clears a real action cam.
    // Returns (UV shift the bead refracts through, bead mask, glint).
    vec4 lensDrops(vec2 uv) {
      vec2 p = (uv - 0.5) * vec2(uAspect, 1.0) * 7.0;
      vec2 cell = floor(p), f = fract(p);
      float h = hash0(cell);
      if (h > uRain * 0.55) return vec4(0.0);
      float life = fract(uTime * (0.06 + 0.12 * hash0(cell + 5.3)) * (1.0 + uSpeed * 0.15) + h * 7.0);
      // Centre, slide and radius are bounded so a bead never crosses its
      // cell edge (it would be cut off): it is gone by life 0.8, where
      // 0.62 + 0.8² * 25 * 0.012 + 0.2 ≈ 1.
      vec2 c = vec2(0.28 + 0.34 * hash0(cell + 1.7), 0.28 + 0.34 * hash0(cell + 9.1));
      c.y += life * life * min(uSpeed, 25.0) * 0.012;
      float r = (0.08 + 0.12 * hash0(cell + 3.9)) * smoothstep(0.0, 0.15, life);
      vec2 d = f - c;
      float m = smoothstep(r, r * 0.55, length(d)) * (1.0 - smoothstep(0.6, 0.8, life));
      // Specular glint up-left of centre, from the lamps above.
      float glint = smoothstep(r * 0.3, 0.0, length(d - vec2(-0.35, 0.4) * r)) * m;
      // A bead is a tiny inverted lens: it shows the scene flipped around its centre.
      return vec4(-d * m * 0.09, m, glint);
    }

    void main() {
      vec2 uv = barrel(vUv);
      vec4 drop = uRain > 0.0 ? lensDrops(vUv) : vec4(0.0);
      uv += drop.xy;
      vec2 toC = uv - uCenter;
      float edge = length(toC * vec2(uAspect, 1.0));
      // Blur grows towards the frame edges; the vanishing point stays crisp.
      float amt = uBlur * smoothstep(0.08, 0.75, edge);
      float ca = uAberration * edge * edge * 4.0;
      vec3 col = vec3(0.0);
      const int N = 10;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1);
        vec2 o = -toC * amt * t;
        col.r += texture2D(tDiffuse, uv + o + toC * ca).r;
        col.g += texture2D(tDiffuse, uv + o).g;
        col.b += texture2D(tDiffuse, uv + o - toC * ca).b;
      }
      col /= float(N);
      float vig = smoothstep(1.25, 0.25, length((vUv - 0.5) * vec2(uAspect, 1.0)));
      col *= mix(1.0 - uVignette, 1.0, vig);
      // Water scatters light, lifting the blacks inside a bead (otherwise a
      // bead over dark asphalt is invisible); the rim darkens and the glint
      // catches the lamps.
      float rim = drop.z * (1.0 - drop.z) * 4.0;
      col = mix(col, col * 1.15 + 0.035, drop.z * 0.7);
      col *= 1.0 - rim * 0.25;
      col += vec3(0.9, 0.92, 1.0) * drop.w * 0.35;
      col += (hash(vUv * 811.0) - 0.5) * uGrain * (0.6 + 0.4 * (1.0 - col));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, { bloom = true } = {}) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.75, 0.55, 0.92);
    this.bloom.enabled = bloom;
    this.composer.addPass(this.bloom);
    this.lens = new ShaderPass(ActionCamShader);
    this.composer.addPass(this.lens);
    this.composer.addPass(new OutputPass());
  }

  setCamera(camera) { this.renderPass.camera = camera; }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.lens.uniforms.uAspect.value = w / h;
  }

  /**
   * @param lens {distort, blur, center:Vector2, aberration, vignette, grain, rain?:0..1, speed?:m/s}
   */
  render(time, lens) {
    const u = this.lens.uniforms;
    u.uTime.value = time % 100;
    u.uDistort.value = lens.distort;
    u.uBlur.value = lens.blur;
    u.uAberration.value = lens.aberration;
    u.uVignette.value = lens.vignette;
    u.uGrain.value = lens.grain;
    u.uRain.value = lens.rain || 0;
    u.uSpeed.value = lens.speed || 0;
    if (lens.center) u.uCenter.value.copy(lens.center);
    this.composer.render();
  }
}
