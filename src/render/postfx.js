import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Action-camera lens: barrel ("fisheye") distortion, radial speed blur that
 * leaves the centre sharp, chromatic fringing at the edges, vignette and grain.
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
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAspect, uDistort, uBlur, uAberration, uVignette, uTime, uGrain;
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

    void main() {
      vec2 uv = barrel(vUv);
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
   * @param lens {distort, blur, center:Vector2, aberration, vignette}
   */
  render(time, lens) {
    const u = this.lens.uniforms;
    u.uTime.value = time % 100;
    u.uDistort.value = lens.distort;
    u.uBlur.value = lens.blur;
    u.uAberration.value = lens.aberration;
    u.uVignette.value = lens.vignette;
    u.uGrain.value = lens.grain;
    if (lens.center) u.uCenter.value.copy(lens.center);
    this.composer.render();
  }
}
