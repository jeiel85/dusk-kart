import * as THREE from 'three';

/** Ring buffer of tyre-mark quads laid down while a tyre slides. */
export class SkidMarks {
  constructor(alphaMap, max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    this.uv = new Float32Array(max * 4 * 2);
    const idx = new Uint32Array(max * 6);
    for (let k = 0; k < max; k++) {
      const v = k * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], k * 6);
      this.uv.set([0, 0, 1, 0, 0, 1, 1, 1], k * 8);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      uniforms: { uMap: { value: alphaMap } },
      vertexShader: `attribute float aAlpha; varying float vA; varying vec2 vUv;
        void main(){ vA = aAlpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA; varying vec2 vUv;
        void main(){ float a = texture2D(uMap, vec2(vUv.x, vUv.y * 0.3)).r; gl_FragColor = vec4(0.02,0.02,0.02, vA * (0.35 + 0.65 * a)); }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.next = 0;
    this.last = new Map(); // key -> {x,z}
  }

  /** Add a segment for wheel `key` if it is sliding, otherwise break the trail. */
  add(key, x, z, dirX, dirZ, width, strength) {
    const prev = this.last.get(key);
    if (strength <= 0.02) { this.last.delete(key); return; }
    if (!prev) { this.last.set(key, { x, z }); return; }
    const dx = x - prev.x, dz = z - prev.z;
    if (dx * dx + dz * dz < 0.09) return; // lay a quad every ~30 cm
    const len = Math.hypot(dx, dz);
    const nx = -dz / len * width / 2, nz = dx / len * width / 2;
    const k = this.next;
    const y = 0.012;
    this.pos.set([
      prev.x + nx, y, prev.z + nz, prev.x - nx, y, prev.z - nz,
      x + nx, y, z + nz, x - nx, y, z - nz,
    ], k * 12);
    const a = Math.min(0.75, strength);
    this.alpha.set([a, a, a, a], k * 4);
    this.next = (k + 1) % this.max;
    prev.x = x; prev.z = z;
    // Upload only the quad just written, not the whole ring buffer.
    const pos = this.geo.attributes.position, al = this.geo.attributes.aAlpha;
    pos.addUpdateRange(k * 12, 12);
    pos.needsUpdate = true;
    al.addUpdateRange(k * 4, 4);
    al.needsUpdate = true;
  }

  clear() {
    this.alpha.fill(0);
    const al = this.geo.attributes.aAlpha;
    al.clearUpdateRanges(); // no ranges = upload the whole buffer
    al.needsUpdate = true;
    this.last.clear();
  }
}
