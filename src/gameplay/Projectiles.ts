import * as THREE from 'three';
import { materials } from '../render/Materials';
import { dotTexture } from '../render/Textures';
import type { EffectsManager } from '../render/Effects';
import { BALANCE, FLOOR_Y } from '../utils/constants';
import type { HitResponse, Target } from './types';

export interface Orb {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  charged: boolean;
  life: number;
  alive: boolean;
  hitAny: boolean;
  hits: Set<Target>;
  bounces: number;
  age: number;
}

const tmpLocal = new THREE.Vector3();

/** Sphere vs target test. Box targets are tested in their own local frame. */
export function overlaps(t: Target, p: THREE.Vector3, r: number, pad: number) {
  if (t.shape === 'sphere') {
    const rr = t.half.x + r + pad;
    return t.wpos.distanceToSquared(p) < rr * rr;
  }
  tmpLocal.copy(p).applyMatrix4(t.inv);
  return Math.abs(tmpLocal.x) < t.half.x + r + pad && Math.abs(tmpLocal.y) < t.half.y + r + pad && Math.abs(tmpLocal.z) < t.half.z + r;
}

/**
 * Launches luminous orbs along the exact pointer ray and resolves collisions
 * with sub-stepping so fast orbs never tunnel through thin glass.
 */
export class ProjectileSystem {
  group = new THREE.Group();
  orbs: Orb[] = [];
  private pool: Orb[] = [];
  private geo = new THREE.SphereGeometry(1, 24, 18);
  /** Extra forgiveness added to target sizes (generous in early levels). */
  aimPad = 0.15;
  onMiss?: () => void;
  onFirstHit?: (o: Orb) => void;

  constructor(private fx: EffectsManager) {}

  private acquire(): Orb {
    const o = this.pool.pop();
    if (o) return o;
    const mesh = new THREE.Mesh(this.geo, materials.orbMat());
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: 0xa9e8ff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.add(glow);
    return { mesh, glow, pos: mesh.position, vel: new THREE.Vector3(), radius: 0.2, charged: false, life: 0, alive: false, hitAny: false, hits: new Set(), bounces: 0, age: 0 };
  }

  get activeCount() { return this.orbs.length; }

  fire(origin: THREE.Vector3, dir: THREE.Vector3, charged: boolean) {
    if (this.orbs.length >= BALANCE.maxProjectiles) this.kill(this.orbs[0], false);
    const o = this.acquire();
    o.radius = charged ? BALANCE.chargedRadius : BALANCE.projectileRadius;
    o.charged = charged;
    o.mesh.scale.setScalar(o.radius * 0.3);
    o.glow.scale.setScalar(charged ? 4.2 : 3.2);
    (o.glow.material as THREE.SpriteMaterial).color.set(charged ? 0xffe0a6 : 0xa9e8ff);
    o.pos.copy(origin).addScaledVector(dir, 1.4);
    o.age = 0;
    o.vel.copy(dir).multiplyScalar(charged ? BALANCE.chargedSpeed : BALANCE.projectileSpeed);
    o.life = BALANCE.projectileLife;
    o.alive = true; o.hitAny = false; o.hits.clear(); o.bounces = 0;
    this.group.add(o.mesh);
    this.orbs.push(o);
    // Launch pulse.
    this.fx.flash(o.pos, charged ? 0xffe0a6 : 0xbff0ff, charged ? 1.6 : 0.9, 0.18, true, 0.8);
    this.fx.emit({ pos: o.pos, count: charged ? 18 : 8, color: 0xffffff, color2: charged ? 0xffd38a : 0x9fe6ff, dir, spread: 0.6, speed: [2, 6], size: [0.04, 0.09], life: [0.15, 0.35] });
    return o;
  }

  private kill(o: Orb, notifyMiss = true) {
    if (!o.alive) return;
    o.alive = false;
    this.group.remove(o.mesh);
    const i = this.orbs.indexOf(o);
    if (i >= 0) this.orbs.splice(i, 1);
    this.pool.push(o);
    if (notifyMiss && !o.hitAny) this.onMiss?.();
  }

  private stepV = new THREE.Vector3(); private n = new THREE.Vector3();

  update(dt: number, targets: Target[], camZ: number) {
    for (let k = this.orbs.length - 1; k >= 0; k--) {
      const o = this.orbs[k];
      if (!o.alive) continue;
      o.life -= dt;
      if (o.life <= 0 || o.pos.z < camZ - 160) { this.kill(o); continue; }
      const dist = o.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.18));
      const sdt = dt / steps;
      outer: for (let s = 0; s < steps; s++) {
        if (o.bounces > 0) o.vel.y -= 18 * sdt; // after a bounce the orb becomes a physical ball
        o.pos.addScaledVector(o.vel, sdt);
        if (o.pos.y < FLOOR_Y + o.radius && o.vel.y < 0) {
          o.pos.y = FLOOR_Y + o.radius;
          o.vel.y *= -0.45; o.vel.x *= 0.8; o.vel.z *= 0.8;
          o.bounces++;
        }
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          if (!t.active || o.hits.has(t)) continue;
          if (Math.abs(t.wpos.z - o.pos.z) > 7) continue;
          if (!overlaps(t, o.pos, o.radius, this.aimPad)) continue;
          o.hits.add(t);
          const dir = this.stepV.copy(o.vel).normalize();
          const res: HitResponse = t.onHit({ point: o.pos.clone(), dir: dir.clone(), charged: o.charged });
          if (!o.hitAny) { o.hitAny = true; this.onFirstHit?.(o); }
          if (res === 'stop') { this.kill(o, false); break outer; }
          if (res === 'bounce') {
            // Reflect about the target's facing normal (local Z for boxes, radial for spheres).
            if (t.shape === 'box') this.n.set(0, 0, 1).transformDirection(t.obj.matrixWorld);
            else this.n.copy(o.pos).sub(t.wpos).normalize();
            const vn = o.vel.dot(this.n);
            if (vn < 0 || t.shape === 'box') o.vel.addScaledVector(this.n, -2 * vn);
            o.vel.multiplyScalar(0.35);
            o.vel.y += 2;
            o.bounces++;
            o.life = Math.min(o.life, 1.4);
          } else {
            o.vel.multiplyScalar(o.charged ? 0.95 : 0.85);
          }
        }
      }
      // Trail.
      this.fx.emit({ pos: o.pos, count: o.charged ? 3 : 2, color: o.charged ? 0xffe2a8 : 0xc9f1ff, speed: [0, 0.3], size: o.charged ? [0.12, 0.2] : [0.07, 0.12], life: [0.18, 0.32], drag: 4 });
      o.mesh.rotation.x += dt * 8;
      // Grow in over the first few metres so the orb never fills the screen at launch.
      o.age += dt;
      o.mesh.scale.setScalar(o.radius * Math.min(1, 0.3 + o.age * 9));
    }
  }

  clear() {
    for (const o of [...this.orbs]) this.kill(o, false);
  }
}
