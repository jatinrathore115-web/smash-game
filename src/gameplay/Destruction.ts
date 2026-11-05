import * as THREE from 'three';
import { FLOOR_Y } from '../utils/constants';
import type { EffectsManager } from '../render/Effects';

type P2 = [number, number];

/** Clip a convex polygon by the half-plane { p : (p - m) . n <= 0 }. */
function clip(poly: P2[], mx: number, my: number, nx: number, ny: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = (a[0] - mx) * nx + (a[1] - my) * ny;
    const db = (b[0] - mx) * nx + (b[1] - my) * ny;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * Voronoi fracture of a w x h rectangle. Seeds cluster around the impact point,
 * producing small shards at the hit and larger plates toward the edges, like real glass.
 */
export function fracture(w: number, h: number, ix: number, iy: number, n: number): P2[][] {
  const seeds: P2[] = [];
  const hw = w / 2, hh = h / 2;
  const near = Math.round(n * 0.55);
  const rad = Math.min(w, h) * 0.32;
  for (let i = 0; i < n; i++) {
    if (i < near) {
      const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.8) * rad;
      seeds.push([THREE.MathUtils.clamp(ix + Math.cos(a) * r, -hw * 0.98, hw * 0.98), THREE.MathUtils.clamp(iy + Math.sin(a) * r, -hh * 0.98, hh * 0.98)]);
    } else seeds.push([(Math.random() - 0.5) * w * 0.98, (Math.random() - 0.5) * h * 0.98]);
  }
  const rect: P2[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const cells: P2[][] = [];
  for (let i = 0; i < seeds.length; i++) {
    let poly = rect;
    const [sx, sy] = seeds[i];
    for (let j = 0; j < seeds.length && poly.length > 2; j++) {
      if (i === j) continue;
      const [tx, ty] = seeds[j];
      poly = clip(poly, (sx + tx) / 2, (sy + ty) / 2, tx - sx, ty - sy);
    }
    if (poly.length > 2) cells.push(poly);
  }
  return cells;
}

/** Build a thin prism mesh from a convex polygon, centred on its centroid. */
function prismGeometry(poly: P2[], cx: number, cy: number, t: number, shrink: number) {
  const n = poly.length;
  const pts = poly.map(([x, y]) => [(x - cx) * shrink, (y - cy) * shrink]);
  const pos: number[] = [], uv: number[] = [];
  const hz = t / 2;
  for (let i = 1; i < n - 1; i++) {
    pos.push(pts[0][0], pts[0][1], hz, pts[i][0], pts[i][1], hz, pts[i + 1][0], pts[i + 1][1], hz);
    pos.push(pts[0][0], pts[0][1], -hz, pts[i + 1][0], pts[i + 1][1], -hz, pts[i][0], pts[i][1], -hz);
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    pos.push(a[0], a[1], hz, a[0], a[1], -hz, b[0], b[1], -hz);
    pos.push(a[0], a[1], hz, b[0], b[1], -hz, b[0], b[1], hz);
  }
  for (let i = 0; i < pos.length; i += 3) uv.push((pos[i] + cx) * 0.25 + 0.5, (pos[i + 1] + cy) * 0.25 + 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

interface Shard {
  mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3;
  life: number; max: number; delay: number; scale: number; batch: Batch; bounced: boolean;
}
interface Batch { mat: THREE.Material & { opacity: number }; age: number; live: number; baseOpacity: number }

export interface ShatterRequest {
  /** The object whose local XY plane is the glass surface (its world matrix is used). */
  source: THREE.Object3D;
  w: number; h: number; thickness: number;
  material: THREE.Material & { opacity: number };
  impact: THREE.Vector3;      // world space
  dir: THREE.Vector3;         // world-space travel direction of the impacting thing
  power?: number;             // 1 = standard orb
  pieces: number;
  tint: THREE.ColorRepresentation;
}

/** Spawns and simulates glass shards with simplified rigid-body motion. */
export class DestructionSystem {
  group = new THREE.Group();
  private shards: Shard[] = [];
  maxShards = 320;
  fragmentScale = 1;
  constructor(private fx: EffectsManager) {}

  private tmpM = new THREE.Matrix4(); private tmpInv = new THREE.Matrix4();
  private tmpV = new THREE.Vector3(); private tmpQ = new THREE.Quaternion(); private tmpS = new THREE.Vector3();
  private tmpP = new THREE.Vector3();

  shatter(r: ShatterRequest) {
    const power = r.power ?? 1;
    r.source.updateWorldMatrix(true, false);
    this.tmpM.copy(r.source.matrixWorld);
    this.tmpInv.copy(this.tmpM).invert();
    const local = this.tmpV.copy(r.impact).applyMatrix4(this.tmpInv);
    const ix = THREE.MathUtils.clamp(local.x, -r.w / 2, r.w / 2), iy = THREE.MathUtils.clamp(local.y, -r.h / 2, r.h / 2);
    const count = Math.max(6, Math.round(r.pieces * this.fragmentScale));
    const cells = fracture(r.w, r.h, ix, iy, count);

    const mat = r.material.clone() as THREE.Material & { opacity: number };
    mat.transparent = true;
    const batch: Batch = { mat, age: 0, live: 0, baseOpacity: Math.min(0.85, (r.material.opacity ?? 0.5) + 0.12) };
    mat.opacity = batch.baseOpacity;

    const worldQ = this.tmpQ; const worldS = this.tmpS;
    this.tmpM.decompose(this.tmpP, worldQ, worldS);
    const diag = Math.hypot(r.w, r.h);
    const planeX = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQ);
    const planeY = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQ);

    for (const cell of cells) {
      let cx = 0, cy = 0;
      for (const [x, y] of cell) { cx += x; cy += y; }
      cx /= cell.length; cy /= cell.length;
      const geo = prismGeometry(cell, cx, cy, r.thickness, 0.965);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      mesh.position.set(cx, cy, 0).applyMatrix4(this.tmpM);
      mesh.quaternion.copy(worldQ);
      mesh.scale.copy(worldS);
      const dx = cx - ix, dy = cy - iy;
      const dist = Math.hypot(dx, dy);
      const fall = 1 - Math.min(dist / diag, 1);
      // Impulse: along the shot, outward in the glass plane, plus a little lift.
      const vel = r.dir.clone().multiplyScalar((4 + fall * 10) * power * (0.6 + Math.random() * 0.6));
      const rx = dist > 1e-4 ? dx / dist : Math.random() - 0.5, ry = dist > 1e-4 ? dy / dist : Math.random() - 0.5;
      vel.addScaledVector(planeX, rx * (1.5 + fall * 5) * (0.7 + Math.random() * 0.6));
      vel.addScaledVector(planeY, ry * (1.5 + fall * 5) * (0.7 + Math.random() * 0.6) + 1.2);
      const spin = new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10).multiplyScalar(0.5 + fall);
      const max = 1.5 + Math.random() * 1.1;
      // Staged release: cracks propagate outward from the impact.
      const delay = (dist / diag) * 0.16 * (0.7 + Math.random() * 0.6);
      this.shards.push({ mesh, vel, spin, life: max, max, delay, scale: 1, batch, bounced: false });
      batch.live++;
      this.group.add(mesh);
    }
    this.trim();

    // Light: flash, ring, sparkles and fine dust.
    this.fx.flash(r.impact, 0xffffff, 1.6 + power * 0.8, 0.22, false, 0.9);
    this.fx.flash(r.impact, r.tint, 2.2 + power * 1.5, 0.45, true, 0.8);
    this.fx.glint({ pos: r.impact, count: 14 + 6 * power, color: 0xffffff, color2: r.tint, speed: [2, 9], spread: 1.4, dir: r.dir, size: [0.25, 0.6], life: [0.35, 0.9], drag: 2.4, posJitter: Math.min(r.w, 2) });
    this.fx.emit({ pos: r.impact, count: 26 + 10 * power, color: r.tint, color2: 0xffffff, speed: [1.5, 8], spread: 1.6, dir: r.dir, size: [0.05, 0.14], life: [0.6, 1.4], gravity: 4, drag: 1.6, posJitter: r.w * 0.6 });
  }

  private trim() {
    while (this.shards.length > this.maxShards) {
      const s = this.shards.shift()!;
      this.disposeShard(s);
    }
  }

  private disposeShard(s: Shard) {
    this.group.remove(s.mesh);
    s.mesh.geometry.dispose();
    if (--s.batch.live <= 0) s.batch.mat.dispose();
  }

  private e = new THREE.Euler(); private q = new THREE.Quaternion();
  update(dt: number) {
    const batches = new Set<Batch>();
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      batches.add(s.batch);
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.life -= dt;
      if (s.life <= 0) { this.disposeShard(s); this.shards.splice(i, 1); continue; }
      s.vel.y -= 13 * dt;
      s.vel.multiplyScalar(Math.exp(-0.5 * dt));
      s.mesh.position.addScaledVector(s.vel, dt);
      if (!s.bounced && s.mesh.position.y < FLOOR_Y + 0.1 && s.vel.y < 0) {
        s.bounced = true; s.vel.y *= -0.32; s.vel.x *= 0.6; s.vel.z *= 0.6; s.spin.multiplyScalar(0.5);
      }
      this.e.set(s.spin.x * dt, s.spin.y * dt, s.spin.z * dt);
      s.mesh.quaternion.multiply(this.q.setFromEuler(this.e));
      const k = s.life / s.max;
      if (k < 0.3) { const sc = Math.max(k / 0.3, 0.01); s.mesh.scale.setScalar(sc); }
    }
    for (const b of batches) {
      b.age += dt;
      b.mat.opacity = b.baseOpacity * Math.max(0, 1 - Math.max(0, b.age - 1.0) / 1.4);
    }
  }

  clear() {
    for (const s of this.shards) this.disposeShard(s);
    this.shards.length = 0;
  }
}
