import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cloudTexture } from './Textures';
import { FLOOR_Y } from '../utils/constants';
import { rng } from '../utils/math';
import type { Palette, ThemeId } from '../gameplay/types';

/** A built world: static architecture plus a per-frame animation hook. */
export interface World {
  group: THREE.Group;
  update(dt: number, time: number, camZ: number, pulse: number): void;
  dispose(): void;
}

const dummy = new THREE.Object3D();

/** Shared fog snippet for custom shaders (matches THREE.Fog linear fog). */
const fogUniforms = (p: Palette) => ({ uFogColor: { value: new THREE.Color(p.fog) }, uFogNear: { value: 30 }, uFogFar: { value: 175 } });
const fogFrag = /* glsl */ `
  uniform vec3 uFogColor; uniform float uFogNear, uFogFar; varying float vDepth;
  vec3 applyFog(vec3 c){ return mix(c, uFogColor, smoothstep(uFogNear, uFogFar, vDepth)); }`;

class Builder {
  group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  /** Glowing materials whose brightness follows the music pulse. */
  glow: { mat: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial; base: THREE.Color; key: 'color' | 'emissive' }[] = [];
  updaters: ((dt: number, time: number, camZ: number, pulse: number) => void)[] = [];

  track<T extends { dispose(): void }>(x: T) { this.disposables.push(x); return x; }

  std(color: number, o: THREE.MeshStandardMaterialParameters = {}) {
    return this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.05, ...o }));
  }
  emissive(color: number, intensity = 1.6, opacity = 1) {
    const base = new THREE.Color(color).multiplyScalar(intensity);
    const m = this.track(new THREE.MeshBasicMaterial({ color: base.clone(), transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
    this.glow.push({ mat: m, base, key: 'color' });
    return m;
  }
  instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[]) {
    this.track(geo);
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    this.group.add(im);
    return im;
  }
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material) {
    this.track(geo);
    const m = new THREE.Mesh(geo, mat);
    this.group.add(m);
    return m;
  }
  pulseGlow(pulse: number) {
    for (const g of this.glow) {
      const target = g.key === 'color' ? (g.mat as THREE.MeshBasicMaterial).color : (g.mat as THREE.MeshStandardMaterial).emissive;
      target.copy(g.base).multiplyScalar(1 + pulse * 0.35);
    }
  }
  world(): World {
    return {
      group: this.group,
      update: (dt, time, camZ, pulse) => { this.pulseGlow(pulse); for (const u of this.updaters) u(dt, time, camZ, pulse); },
      dispose: () => { for (const d of this.disposables) d.dispose(); this.group.removeFromParent(); },
    };
  }
}

const mat4 = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
  dummy.position.set(x, y, z); dummy.rotation.set(rx, ry, rz); dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  return dummy.matrix.clone();
};

/** Large ground plane that travels with the camera; the shader samples world space so the pattern stays put. */
function travellingFloor(b: Builder, p: Palette, y: number, frag: string, extra: Record<string, THREE.IUniform> = {}, width = 220, transparent = false) {
  const uniforms: Record<string, THREE.IUniform> = { uTime: { value: 0 }, uPulse: { value: 0 }, ...fogUniforms(p), ...extra };
  const mat = b.track(new THREE.ShaderMaterial({
    uniforms, transparent, depthWrite: !transparent,
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying float vDepth;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: fogFrag + frag,
  }));
  const m = b.mesh(new THREE.PlaneGeometry(width, 260, 1, 1).rotateX(-Math.PI / 2), mat);
  m.position.y = y;
  m.frustumCulled = false;
  b.updaters.push((_dt, time, camZ, pulse) => { m.position.z = camZ - 110; uniforms.uTime.value = time; uniforms.uPulse.value = pulse; });
  return m;
}

// ======================================================================= PEACH
function peach(p: Palette, L: number): World {
  const b = new Builder();
  const r = rng(11);
  // Floating walkway tiles under the path.
  const tiles: THREE.Matrix4[] = [], tileCol: THREE.Color[] = [];
  const cream = new THREE.Color(0xffe9c6), peachC = new THREE.Color(0xffc9b4), pink = new THREE.Color(0xf9c8d6);
  for (let z = 10; z > -L; z -= 3.1) {
    for (const x of [-4.4, -2.2, 0, 2.2, 4.4]) {
      if (Math.abs(x) > 3 && r() < 0.55) continue;
      if (r() < 0.12) continue;
      tiles.push(mat4(x + (r() - 0.5) * 0.3, FLOOR_Y - 0.25 - r() * 0.35 - Math.abs(x) * 0.08, z + (r() - 0.5) * 0.5, 1.95, 0.32, 2.7));
      tileCol.push([cream, peachC, pink][Math.floor(r() * 3)].clone());
    }
  }
  b.instanced(new THREE.BoxGeometry(1, 1, 1), b.std(0xffffff, { roughness: 0.75 }), tiles, tileCol);
  // Glowing seams beneath the walkway edges.
  const seams: THREE.Matrix4[] = [];
  for (let z = 0; z > -L; z -= 40) for (const x of [-5.8, 5.8]) seams.push(mat4(x, FLOOR_Y - 0.55, z - 20, 0.08, 0.08, 38));
  b.instanced(new THREE.BoxGeometry(1, 1, 1), b.emissive(0xffd39b, 1.8), seams);

  // Grand arches: coral half-rings with a golden inner line. Spacing varies for rhythm.
  const arches: THREE.Matrix4[] = [], archCol: THREE.Color[] = [], inner: THREE.Matrix4[] = [], feet: THREE.Matrix4[] = [];
  let z = -6, i = 0;
  while (z > -L - 40) {
    const s = 1 + (i % 3 === 0 ? 0.22 : 0) + (r() - 0.5) * 0.08;
    arches.push(mat4(0, FLOOR_Y - 0.6, z, s, s, s));
    archCol.push(new THREE.Color(i % 2 ? 0xff927d : 0xffb6a0));
    inner.push(mat4(0, FLOOR_Y - 0.6, z + 0.55, s * 0.9, s * 0.9, s));
    for (const x of [-9.4 * s, 9.4 * s]) feet.push(mat4(x, FLOOR_Y - 1.6, z, 2.2, 2.4, 2.2));
    if (i % 3 === 0) { arches.push(mat4(0, FLOOR_Y - 0.6, z - 2.2, s * 1.08, s * 1.08, s)); archCol.push(new THREE.Color(0xffe0d2)); }
    z -= 22 + r() * 8; i++;
  }
  b.instanced(new THREE.TorusGeometry(9.4, 0.62, 14, 56, Math.PI), b.std(0xffffff, { roughness: 0.5 }), arches, archCol);
  b.instanced(new THREE.TorusGeometry(9.4, 0.07, 6, 64, Math.PI), b.emissive(0xffd39b, 1.9), inner);
  b.instanced(new THREE.BoxGeometry(1, 1, 1), b.std(0xffe9c6), feet);

  // Floating platforms and terraces on both sides.
  const plats: THREE.Matrix4[] = [], platCol: THREE.Color[] = [];
  for (let k = 0; k < L / 5; k++) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (15 + r() * 28), y = -12 + r() * 20, zz = 20 - r() * (L + 80);
    const w = 3 + r() * 9, h = 0.8 + r() * 2.2, d = 3 + r() * 9;
    plats.push(mat4(x, y, zz, w, h, d, 0, r() * 0.6, 0));
    platCol.push([cream, peachC, pink, new THREE.Color(0xffd9c4)][Math.floor(r() * 4)].clone());
    if (r() < 0.4) { plats.push(mat4(x, y + h / 2 + 1.2, zz, w * 0.3, 2.4, d * 0.3)); platCol.push(cream.clone()); }
  }
  b.instanced(new THREE.BoxGeometry(1, 1, 1), b.std(0xffffff, { roughness: 0.8 }), plats, platCol);
  // Distant monolith silhouettes.
  const mono: THREE.Matrix4[] = [];
  for (let k = 0; k < L / 30; k++) { const side = k % 2 ? 1 : -1; mono.push(mat4(side * (70 + r() * 40), -20 + r() * 10, -k * 30 - r() * 20, 6 + r() * 6, 50 + r() * 40, 6 + r() * 6)); }
  b.instanced(new THREE.BoxGeometry(1, 1, 1), b.std(0xffcdbb, { roughness: 1 }), mono);
  // Soft cloud banks below and beyond.
  const clouds: THREE.Matrix4[] = [];
  for (let k = 0; k < L / 7; k++) {
    const side = r() < 0.5 ? -1 : 1;
    clouds.push(mat4(side * (8 + r() * 50), -9 - r() * 8, 10 - r() * (L + 80), 30 + r() * 25, 12 + r() * 8, 1));
  }
  const cloudMat = b.track(new THREE.MeshBasicMaterial({ map: cloudTexture(), color: 0xfff1ea, transparent: true, opacity: 0.75, depthWrite: false }));
  const cl = b.instanced(new THREE.PlaneGeometry(1, 1), cloudMat, clouds);
  cl.renderOrder = -1;
  return b.world();
}

// ======================================================================== AQUA
function aqua(p: Palette, L: number): World {
  const b = new Builder();
  const r = rng(23);
  travellingFloor(b, p, FLOOR_Y - 0.35, /* glsl */ `
    uniform float uTime, uPulse; varying vec3 vWorld;
    float wave(vec2 q){ return sin(q.x*0.9 + uTime*0.8) * cos(q.y*0.7 - uTime*0.6) + sin((q.x+q.y)*0.45 + uTime*0.5); }
    void main(){
      vec2 q = vWorld.xz;
      float w = wave(q) + 0.5 * wave(q * 2.3 + 4.0);
      float caustic = pow(1.0 - abs(sin(w * 2.2)), 6.0);
      vec3 deep = vec3(0.30, 0.74, 0.86), shallow = vec3(0.62, 0.93, 0.97);
      float lane = smoothstep(9.0, 2.0, abs(vWorld.x));
      vec3 c = mix(deep, shallow, 0.35 + 0.35 * lane);
      c += vec3(0.75, 1.0, 1.0) * caustic * (0.28 + 0.12 * uPulse);
      gl_FragColor = vec4(applyFog(c), 1.0);
      #include <colorspace_fragment>
    }`);

  // Translucent hexagonal columns with luminous cores.
  const cols: THREE.Matrix4[] = [], cores: THREE.Matrix4[] = [];
  for (let z = 0; z > -L - 40; z -= 8.5) {
    for (const side of [-1, 1]) {
      if (r() < 0.2) continue;
      const x = side * (7.8 + r() * 3.5), h = 10 + r() * 22, rad = 0.7 + r() * 0.6;
      const y = FLOOR_Y - 1 + h / 2 + (r() < 0.3 ? 3 + r() * 4 : 0);
      cols.push(mat4(x, y, z + r() * 3, rad, h, rad));
      cores.push(mat4(x, y, z + r() * 3, rad * 0.16, h * 1.0, rad * 0.16));
    }
  }
  const colMat = b.track(new THREE.MeshPhysicalMaterial({ color: 0x8be6f4, roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.5, emissive: 0x64daf5, emissiveIntensity: 0.18, clearcoat: 1, flatShading: true }));
  b.instanced(new THREE.CylinderGeometry(1, 1, 1, 6), colMat, cols);
  b.instanced(new THREE.CylinderGeometry(1, 1, 1, 6), b.emissive(0xc8f3ff, 1.5), cores);

  // Tall curved shells sweeping overhead (partial cylinders).
  const shells: THREE.Matrix4[] = [];
  for (let z = -10, k = 0; z > -L - 40; z -= 34, k++) {
    const side = k % 2 ? 1 : -1;
    shells.push(mat4(0, 2, z, 1, 1, 1, Math.PI / 2, 0, side * 0.35));
  }
  const shellMat = b.track(new THREE.MeshStandardMaterial({ color: 0xc8f3ff, roughness: 0.3, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, emissive: 0x78f0d6, emissiveIntensity: 0.15 }));
  b.instanced(new THREE.CylinderGeometry(15, 15, 5, 40, 1, true, Math.PI * 0.15, Math.PI * 0.7), shellMat, shells);
  b.instanced(new THREE.TorusGeometry(15, 0.07, 6, 64, Math.PI * 0.7).rotateX(Math.PI / 2).rotateY(Math.PI * 0.35), b.emissive(0x78f0d6, 1.7), shells);

  // Crystal ribbons flowing overhead along the route.
  const ribbonCols = [0x64daf5, 0x78f0d6, 0xffbb92];
  for (let k = 0; k < 3; k++) {
    for (let start = 20; start > -L - 60; start -= 160) {
      const pts: THREE.Vector3[] = [];
      for (let zz = start; zz >= start - 170; zz -= 10) pts.push(new THREE.Vector3(Math.sin(zz * 0.03 + k * 2) * (5 + k * 1.5), 7 + k * 1.2 + Math.sin(zz * 0.05 + k) * 1.5, zz));
      const curve = new THREE.CatmullRomCurve3(pts);
      b.mesh(new THREE.TubeGeometry(curve, 120, 0.09 + k * 0.03, 6, false), b.emissive(ribbonCols[k], 1.5));
    }
  }
  // Floating crystal shards.
  const shards: THREE.Matrix4[] = [], shardCol: THREE.Color[] = [];
  for (let k = 0; k < L / 4; k++) {
    const side = r() < 0.5 ? -1 : 1;
    shards.push(mat4(side * (12 + r() * 30), -6 + r() * 22, 10 - r() * (L + 60), 0.8 + r() * 2.5, 2 + r() * 5, 0.8 + r() * 2.5, r(), r(), r()));
    shardCol.push(new THREE.Color([0x83e9ff, 0x78f0d6, 0xc8f3ff, 0xffbb92][Math.floor(r() * 4)]));
  }
  b.instanced(new THREE.OctahedronGeometry(1, 0), b.std(0xffffff, { flatShading: true, roughness: 0.2, transparent: true, opacity: 0.8, emissive: 0x2aa0c0, emissiveIntensity: 0.15 }), shards, shardCol);
  // Far cascades: glowing vertical light sheets in the distance.
  const falls: THREE.Matrix4[] = [];
  for (let k = 0; k < L / 40; k++) { const side = k % 2 ? 1 : -1; falls.push(mat4(side * (40 + r() * 20), 6, -k * 40 - 20, 6 + r() * 6, 40, 1)); }
  const fallMat = b.track(new THREE.MeshBasicMaterial({ color: 0xd8fbff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  b.instanced(new THREE.PlaneGeometry(1, 1), fallMat, falls);
  return b.world();
}

// ======================================================================== JADE
class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private z0: number, private len: number, private radius: number, private pitch: number, private phase: number) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    const z = this.z0 - t * this.len;
    const a = (z / this.pitch) * Math.PI * 2 + this.phase;
    return target.set(Math.cos(a) * this.radius, 1 + Math.sin(a) * this.radius * 0.75, z);
  }
}

function jade(p: Palette, L: number): World {
  const b = new Builder();
  const r = rng(37);
  travellingFloor(b, p, FLOOR_Y - 0.3, /* glsl */ `
    uniform float uTime, uPulse; varying vec3 vWorld;
    void main(){
      vec2 g = abs(fract(vWorld.xz / 2.0) - 0.5) / fwidth(vWorld.xz / 2.0);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      vec2 G = abs(fract(vWorld.xz / 10.0) - 0.5) / fwidth(vWorld.xz / 10.0);
      float major = 1.0 - min(min(G.x, G.y), 1.0);
      float lane = smoothstep(12.0, 3.0, abs(vWorld.x));
      vec3 base = mix(vec3(0.42, 0.80, 0.66), vec3(0.62, 0.92, 0.80), lane);
      float scan = smoothstep(0.0, 1.0, sin(vWorld.z * 0.15 + uTime * 2.0) * 0.5 + 0.5);
      vec3 c = base + vec3(0.85, 1.0, 0.75) * (line * 0.25 + major * (0.45 + 0.25 * uPulse)) * (0.6 + 0.4 * scan);
      gl_FragColor = vec4(applyFog(c), 1.0);
      #include <colorspace_fragment>
    }`);

  // Double helix spiral frames around the route (chunked for culling).
  for (const [phase, col] of [[0, 0x38cfa5], [Math.PI, 0xd9ffaf]] as [number, number][]) {
    for (let z0 = 20; z0 > -L - 60; z0 -= 120) {
      b.mesh(new THREE.TubeGeometry(new HelixCurve(z0, 122, 9.5, 46, phase), 220, 0.16, 6, false), b.emissive(col, 1.4));
    }
  }
  // Lattice side walls.
  const walls: THREE.Matrix4[] = [];
  for (let z = 0; z > -L - 40; z -= 18) for (const side of [-1, 1]) if (r() < 0.75) walls.push(mat4(side * (13 + r() * 3), 3 + r() * 4, z, 1, 1, 1, 0, side * (0.3 + r() * 0.3), 0));
  const wallMat = b.track(new THREE.MeshStandardMaterial({ color: 0xb5f4d9, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, emissive: 0x38cfa5, emissiveIntensity: 0.12 }));
  b.instanced(new THREE.PlaneGeometry(12, 14), wallMat, walls);
  const wallWire = b.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x88e7bf).multiplyScalar(1.3), wireframe: true, transparent: true, opacity: 0.5 }));
  b.instanced(new THREE.PlaneGeometry(12, 14, 6, 7), wallWire, walls);

  // Suspended glowing rings that tilt and turn.
  const rings: THREE.Mesh[] = [];
  const ringGeo = b.track(new THREE.TorusGeometry(7, 0.18, 8, 72));
  const ringMats = [b.emissive(0x38cfa5, 1.6), b.emissive(0xffc982, 1.6)];
  for (let z = -14, k = 0; z > -L - 40; z -= 26, k++) {
    const m = new THREE.Mesh(ringGeo, ringMats[k % 2]);
    m.position.set(0, 1, z);
    m.userData.s = (k % 2 ? 1 : -1) * (0.3 + r() * 0.3);
    b.group.add(m);
    rings.push(m);
  }
  // Rotating floating polyhedra.
  const geos = [new THREE.IcosahedronGeometry(1, 0), new THREE.OctahedronGeometry(1, 0), new THREE.DodecahedronGeometry(1, 0)];
  const polys: { im: THREE.InstancedMesh; items: { pos: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; s: number }[] }[] = [];
  const pmat = b.std(0xffffff, { flatShading: true, roughness: 0.35, metalness: 0.1, emissive: 0x115a46, emissiveIntensity: 0.2 });
  geos.forEach((g, gi) => {
    const items = [];
    const n = Math.round(L / 18);
    for (let k = 0; k < n; k++) {
      const side = r() < 0.5 ? -1 : 1;
      items.push({ pos: new THREE.Vector3(side * (11 + r() * 26), -4 + r() * 20, 10 - r() * (L + 60)), rot: new THREE.Euler(r() * 3, r() * 3, r() * 3), spin: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5), s: 1 + r() * 3.2 });
    }
    const im = b.instanced(g, pmat, items.map((it) => mat4(it.pos.x, it.pos.y, it.pos.z, it.s, it.s, it.s)), items.map(() => new THREE.Color([0x88e7bf, 0x38cfa5, 0xd9ffaf, 0xb5f4d9][Math.floor(r() * 4)])));
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    polys.push({ im, items });
    void gi;
  });
  // Floating shattered fragments of green architecture (static, layered depth).
  const frag: THREE.Matrix4[] = [];
  for (let k = 0; k < L / 6; k++) { const side = r() < 0.5 ? -1 : 1; frag.push(mat4(side * (18 + r() * 40), -10 + r() * 30, 10 - r() * (L + 60), 2 + r() * 6, 2 + r() * 6, 2 + r() * 6, r(), r(), r())); }
  b.instanced(new THREE.BoxGeometry(1, 1, 1), b.std(0x9fe8c8, { roughness: 0.8 }), frag);

  b.updaters.push((dt, time, camZ) => {
    for (const m of rings) {
      if (Math.abs(m.position.z - camZ) > 160) continue;
      m.rotation.x = Math.sin(time * 0.4 + m.position.z) * 0.25;
      m.rotation.z += m.userData.s * dt;
    }
    for (const p of polys) {
      let dirty = false;
      p.items.forEach((it, i) => {
        if (it.pos.z > camZ + 20 || it.pos.z < camZ - 190) return;
        it.rot.x += it.spin.x * dt; it.rot.y += it.spin.y * dt;
        dummy.position.copy(it.pos); dummy.position.y += Math.sin(time * 0.5 + i) * 0.4;
        dummy.rotation.copy(it.rot); dummy.scale.setScalar(it.s); dummy.updateMatrix();
        p.im.setMatrixAt(i, dummy.matrix); dirty = true;
      });
      if (dirty) p.im.instanceMatrix.needsUpdate = true;
    }
  });
  return b.world();
}

// ==================================================================== AMETHYST
function amethyst(p: Palette, L: number, arenaZ: number): World {
  const b = new Builder();
  const r = rng(53);
  // Golden pathway with flowing chevrons over a lavender void floor.
  travellingFloor(b, p, FLOOR_Y - 0.3, /* glsl */ `
    uniform float uTime, uPulse; varying vec3 vWorld;
    void main(){
      float x = abs(vWorld.x);
      float path = smoothstep(2.6, 2.3, x);
      float edge = smoothstep(0.18, 0.0, abs(x - 2.45));
      float chev = smoothstep(0.4, 0.5, fract((vWorld.z + x * 0.8) * 0.18 + uTime * 0.6)) * smoothstep(0.75, 0.6, fract((vWorld.z + x * 0.8) * 0.18 + uTime * 0.6));
      vec3 floorC = mix(vec3(0.62, 0.52, 0.90), vec3(0.78, 0.66, 0.98), smoothstep(30.0, 0.0, x));
      vec2 g = abs(fract(vWorld.xz / 6.0) - 0.5) / fwidth(vWorld.xz / 6.0);
      floorC += vec3(0.9, 0.75, 1.0) * (1.0 - min(min(g.x, g.y), 1.0)) * 0.12;
      vec3 gold = vec3(1.0, 0.86, 0.6);
      vec3 c = mix(floorC, gold * 0.95, path * 0.85) + gold * chev * path * 0.35 + vec3(1.0, 0.9, 0.7) * edge * (1.2 + uPulse * 0.6);
      gl_FragColor = vec4(applyFog(c), 1.0);
      #include <colorspace_fragment>
    }`);

  // Large faceted crystal formations, rising from below and hanging from above.
  const crystals: THREE.Matrix4[] = [], ccol: THREE.Color[] = [];
  const palette = [0xaf94f6, 0xd6b7ff, 0xf6a7db, 0x9c7cf0, 0xffd39b];
  for (let k = 0; k < L / 3.2; k++) {
    const side = r() < 0.5 ? -1 : 1;
    const up = r() < 0.7;
    const x = side * (9 + r() * 34), h = 6 + r() * 22, w = 1.5 + r() * 3.5;
    const y = up ? FLOOR_Y - 2 + h / 2 * 0.8 : 18 + r() * 10 - h / 2;
    crystals.push(mat4(x, y, 10 - r() * (L + 60), w, h, w, (r() - 0.5) * 0.4, r() * 3, side * (0.1 + r() * 0.3) + (up ? 0 : Math.PI)));
    ccol.push(new THREE.Color(palette[Math.floor(r() * palette.length)]));
  }
  const crystalGeo = new THREE.CylinderGeometry(0, 0.5, 1, 5, 1);
  const crystalBase = new THREE.CylinderGeometry(0.5, 0.35, 0.3, 5, 1).translate(0, -0.65, 0);
  b.track(crystalBase);
  b.instanced(mergeGeometries([crystalGeo, crystalBase])!, b.std(0xffffff, { flatShading: true, roughness: 0.25, metalness: 0.2, emissive: 0x6a3fc0, emissiveIntensity: 0.18 }), crystals, ccol);
  b.track(crystalGeo);

  // Floating light bridges crossing overhead.
  const bridges: THREE.Matrix4[] = [], bridgeCol: THREE.Color[] = [];
  for (let z = -20; z > -L - 40; z -= 30 + r() * 12) {
    bridges.push(mat4(0, 8 + r() * 4, z, 46, 0.18, 0.9, 0, (r() - 0.5) * 0.5, (r() - 0.5) * 0.25));
    bridgeCol.push(new THREE.Color(r() < 0.5 ? 0xffd39b : 0x8deaff).multiplyScalar(1.7));
  }
  const bm = b.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  b.instanced(new THREE.BoxGeometry(1, 1, 1), bm, bridges, bridgeCol);

  // Prism archways: triangular frames that slowly turn.
  const triGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const R = 10.5;
    for (let i = 0; i < 3; i++) {
      const a0 = Math.PI / 2 + (i / 3) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / 3;
      const p0 = new THREE.Vector2(Math.cos(a0) * R, Math.sin(a0) * R), p1 = new THREE.Vector2(Math.cos(a1) * R, Math.sin(a1) * R);
      const len = p0.distanceTo(p1);
      const g = new THREE.BoxGeometry(len, 0.55, 0.55);
      g.rotateZ(Math.atan2(p1.y - p0.y, p1.x - p0.x));
      g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, 0);
      parts.push(g);
    }
    return b.track(mergeGeometries(parts)!);
  })();
  const triEdge = b.track(new THREE.TorusGeometry(10.9, 0.05, 4, 3));
  const prisms: THREE.Group[] = [];
  const triMat = b.std(0xf2e6ff, { roughness: 0.3, metalness: 0.3, emissive: 0xaf94f6, emissiveIntensity: 0.35, flatShading: true });
  const triGlow = [b.emissive(0xf6a7db, 1.8), b.emissive(0x8deaff, 1.8)];
  for (let z = -8, k = 0; z > -L - 40; z -= 28, k++) {
    if (Math.abs(z - arenaZ) < 45) continue; // keep the Prism Core arena clear
    const g = new THREE.Group();
    g.position.set(0, 1.4, z);
    g.add(new THREE.Mesh(triGeo, triMat));
    const e = new THREE.Mesh(triEdge, triGlow[k % 2]);
    e.rotation.z = Math.PI / 2;
    e.position.z = 0.4;
    g.add(e);
    g.rotation.z = k * 0.35;
    g.userData.s = (k % 2 ? 1 : -1) * 0.12;
    b.group.add(g);
    prisms.push(g);
  }
  // Energy streams: particles flowing along spiralling lanes.
  const N = 900;
  const seeds = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { seeds[i * 3] = r(); seeds[i * 3 + 1] = r(); seeds[i * 3 + 2] = Math.floor(r() * 4); }
  const sg = b.track(new THREE.BufferGeometry());
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const sUni = { uTime: { value: 0 }, uCamZ: { value: 0 }, uScale: { value: 600 } };
  const sm = b.track(new THREE.ShaderMaterial({
    uniforms: sUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aSeed; uniform float uTime, uCamZ, uScale; varying vec3 vC; varying float vA;
      void main(){
        float lane = aSeed.z;
        float z = uCamZ + 10.0 - mod(aSeed.x * 180.0 + uTime * (14.0 + lane * 3.0), 180.0);
        float a = z * 0.06 + lane * 1.5708 + uTime * 0.2;
        float rad = 12.0 + lane * 2.0 + aSeed.y * 1.5;
        vec3 p = vec3(cos(a) * rad, 2.0 + sin(a) * rad * 0.55, z);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vC = lane < 1.0 ? vec3(1.0, 0.83, 0.6) : lane < 2.0 ? vec3(0.55, 0.92, 1.0) : lane < 3.0 ? vec3(0.96, 0.65, 0.86) : vec3(0.85, 0.72, 1.0);
        vA = smoothstep(170.0, 120.0, -mv.z) * smoothstep(1.0, 6.0, -mv.z);
        gl_PointSize = (0.12 + aSeed.y * 0.12) * uScale / max(-mv.z, 0.1);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `varying vec3 vC; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * 1.4, a * vA); }`,
  }));
  const streams = new THREE.Points(sg, sm);
  streams.frustumCulled = false;
  b.group.add(streams);

  b.updaters.push((dt, time, camZ) => {
    for (const g of prisms) if (Math.abs(g.position.z - camZ) < 170) g.rotation.z += g.userData.s * dt;
    sUni.uTime.value = time; sUni.uCamZ.value = camZ;
  });
  return b.world();
}

export function buildWorld(theme: ThemeId, palette: Palette, length: number): World {
  const L = length + 120;
  switch (theme) {
    case 'peach': return peach(palette, L);
    case 'aqua': return aqua(palette, L);
    case 'jade': return jade(palette, L);
    case 'amethyst': return amethyst(palette, L, -(length - 60));
  }
}
