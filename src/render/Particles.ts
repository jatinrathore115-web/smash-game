import * as THREE from 'three';

export interface EmitOptions {
  pos: THREE.Vector3;
  count: number;
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  speed?: [number, number];
  dir?: THREE.Vector3;       // bias direction
  spread?: number;           // 0 = along dir, 1+ = wide
  size?: [number, number];
  life?: [number, number];
  gravity?: number;
  drag?: number;
  posJitter?: number;
  shrink?: boolean;
}

const vert = /* glsl */ `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  varying float vAlpha; varying vec3 vColor; uniform float uScale;
  void main(){
    vAlpha = aAlpha; vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }`;
const frag = /* glsl */ `
  uniform sampler2D uMap; varying float vAlpha; varying vec3 vColor;
  void main(){
    if (vAlpha <= 0.0) discard;
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  }`;

/** Fixed-capacity CPU-simulated particle pool rendered in a single draw call. */
export class ParticleSystem {
  points: THREE.Points;
  private cap: number;
  private next = 0;
  private p: Float32Array; private v: Float32Array; private col: Float32Array;
  private size: Float32Array; private alpha: Float32Array;
  private life: Float32Array; private max: Float32Array; private s0: Float32Array;
  private grav: Float32Array; private drag: Float32Array; private shrink: Uint8Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  budget = 1;

  constructor(capacity: number, map: THREE.Texture, additive = true) {
    this.cap = capacity;
    this.p = new Float32Array(capacity * 3); this.v = new Float32Array(capacity * 3); this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity); this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity); this.max = new Float32Array(capacity); this.s0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity); this.drag = new Float32Array(capacity); this.shrink = new Uint8Array(capacity);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 500 } },
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewportHeight(h: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  private tmpC = new THREE.Color(); private tmpC2 = new THREE.Color(); private tmpV = new THREE.Vector3();
  emit(o: EmitOptions) {
    const n = Math.max(1, Math.round(o.count * this.budget));
    const c1 = this.tmpC.set(o.color), c2 = this.tmpC2.set(o.color2 ?? o.color);
    const [smin, smax] = o.speed ?? [1, 4];
    const [zmin, zmax] = o.size ?? [0.1, 0.25];
    const [lmin, lmax] = o.life ?? [0.5, 1.1];
    const spread = o.spread ?? 1;
    const jit = o.posJitter ?? 0;
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.cap;
      const v = this.tmpV.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (v.lengthSq() > 1) v.normalize();
      if (o.dir) v.multiplyScalar(spread).add(o.dir);
      if (v.lengthSq() < 1e-6) v.set(0, 1, 0);
      v.normalize();
      const sp = smin + Math.random() * (smax - smin);
      const j = i * 3;
      this.p[j] = o.pos.x + (Math.random() - 0.5) * jit;
      this.p[j + 1] = o.pos.y + (Math.random() - 0.5) * jit;
      this.p[j + 2] = o.pos.z + (Math.random() - 0.5) * jit;
      this.v[j] = v.x * sp; this.v[j + 1] = v.y * sp; this.v[j + 2] = v.z * sp;
      const m = Math.random();
      this.col[j] = c1.r + (c2.r - c1.r) * m; this.col[j + 1] = c1.g + (c2.g - c1.g) * m; this.col[j + 2] = c1.b + (c2.b - c1.b) * m;
      this.s0[i] = zmin + Math.random() * (zmax - zmin);
      this.size[i] = this.s0[i];
      this.max[i] = this.life[i] = lmin + Math.random() * (lmax - lmin);
      this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 1.2; this.shrink[i] = o.shrink === false ? 0 : 1;
      this.alpha[i] = 0;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(this.life[i] / this.max[i], 0);
      const d = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.v[j] *= d; this.v[j + 1] = this.v[j + 1] * d - this.grav[i] * dt; this.v[j + 2] *= d;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      this.alpha[i] = t < 0.4 ? t / 0.4 : Math.min(1, (1 - t) * 12);
      this.size[i] = this.shrink[i] ? this.s0[i] * (0.35 + 0.65 * t) : this.s0[i];
    }
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) this.geo.attributes[k].needsUpdate = true;
  }

  clear() { this.life.fill(0); this.alpha.fill(0); }
}

/** Slow drifting motes around the camera that communicate depth and speed. */
export class AmbientDust {
  points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  constructor(count: number, map: THREE.Texture) {
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 36;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 18;
      pos[i * 3 + 2] = -Math.random() * 90;
      seeds[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uColor: { value: new THREE.Color(0xffffff) }, uTime: { value: 0 }, uCamZ: { value: 0 }, uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime, uCamZ, uScale; varying float vA;
        void main(){
          vec3 p = position;
          p.z = uCamZ + 4.0 - mod(uCamZ - p.z, 90.0);  // wrap around the moving camera
          p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.6;
          p.y += sin(uTime * 0.23 + aSeed * 17.0) * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          float tw = 0.55 + 0.45 * sin(uTime * 1.3 + aSeed * 30.0);
          vA = smoothstep(90.0, 50.0, d) * smoothstep(0.8, 5.0, d) * tw;
          gl_PointSize = (0.06 + aSeed * 0.1) * uScale / max(d, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `uniform sampler2D uMap; uniform vec3 uColor; varying float vA;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * vA * 0.85); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }
  setColor(c: number) { (this.mat.uniforms.uColor.value as THREE.Color).set(c); }
  setViewportHeight(h: number, fovDeg: number) { this.mat.uniforms.uScale.value = h / (2 * Math.tan((fovDeg * Math.PI) / 360)); }
  update(time: number, camZ: number) { this.mat.uniforms.uTime.value = time; this.mat.uniforms.uCamZ.value = camZ; }
}
