import * as THREE from 'three';
import { ParticleSystem, AmbientDust, type EmitOptions } from './Particles';
import { dotTexture, glintTexture, ringTexture } from './Textures';

interface Flash { sprite: THREE.Sprite; t: number; dur: number; s0: number; s1: number; a0: number; active: boolean }
interface Wave { mesh: THREE.Mesh; t: number; dur: number; r0: number; r1: number; active: boolean }

/**
 * Visual effects manager: sparks/dust, refractive glints, impact flashes,
 * expanding rings and resonance shockwaves. Everything is pooled.
 */
export class EffectsManager {
  group = new THREE.Group();
  sparks: ParticleSystem;
  glints: ParticleSystem;
  dust: AmbientDust;
  private flashes: Flash[] = [];
  private waves: Wave[] = [];

  constructor() {
    this.sparks = new ParticleSystem(2200, dotTexture());
    this.glints = new ParticleSystem(500, glintTexture());
    this.dust = new AmbientDust(420, dotTexture());
    this.group.add(this.sparks.points, this.glints.points, this.dust.points);
    for (let i = 0; i < 28; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      sprite.visible = false; sprite.renderOrder = 6;
      this.group.add(sprite);
      this.flashes.push({ sprite, t: 0, dur: 1, s0: 1, s1: 1, a0: 1, active: false });
    }
    const ringGeo = new THREE.RingGeometry(0.9, 1, 96);
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      mesh.visible = false; mesh.renderOrder = 6;
      this.group.add(mesh);
      this.waves.push({ mesh, t: 0, dur: 1, r0: 1, r1: 2, active: false });
    }
  }

  setBudget(b: number) { this.sparks.budget = b; this.glints.budget = b; }
  setViewportHeight(h: number, fov: number) {
    this.sparks.setViewportHeight(h, fov); this.glints.setViewportHeight(h, fov); this.dust.setViewportHeight(h, fov);
  }

  emit(o: EmitOptions) { this.sparks.emit(o); }
  glint(o: EmitOptions) { this.glints.emit(o); }

  flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, size: number, dur = 0.25, ring = false, opacity = 1) {
    let f = this.flashes.find((x) => !x.active);
    if (!f) f = this.flashes.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    f.active = true; f.t = 0; f.dur = dur;
    f.s0 = ring ? size * 0.2 : size; f.s1 = ring ? size : size * 1.6; f.a0 = opacity;
    const m = f.sprite.material as THREE.SpriteMaterial;
    m.map = ring ? ringTexture() : dotTexture();
    m.color.set(color);
    m.opacity = opacity;
    f.sprite.scale.set(f.s0, f.s0, 1);
    f.sprite.position.copy(pos);
    f.sprite.visible = true;
  }

  /** Planar shockwave ring perpendicular to the travel axis. */
  wave(pos: THREE.Vector3, color: THREE.ColorRepresentation, r0: number, r1: number, dur: number) {
    const w = this.waves.find((x) => !x.active) || this.waves[0];
    w.active = true; w.t = 0; w.dur = dur; w.r0 = r0; w.r1 = r1;
    (w.mesh.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(1.5);
    w.mesh.position.copy(pos);
    w.mesh.scale.set(r0, r0, 1);
    w.mesh.visible = true;
  }

  update(dt: number, time: number, camZ: number) {
    this.sparks.update(dt);
    this.glints.update(dt);
    this.dust.update(time, camZ);
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) { f.active = false; f.sprite.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      const s = f.s0 + (f.s1 - f.s0) * e;
      f.sprite.scale.set(s, s, 1);
      (f.sprite.material as THREE.SpriteMaterial).opacity = f.a0 * (1 - k) * (1 - k);
    }
    for (const w of this.waves) {
      if (!w.active) continue;
      w.t += dt;
      const k = w.t / w.dur;
      if (k >= 1) { w.active = false; w.mesh.visible = false; continue; }
      const r = w.r0 + (w.r1 - w.r0) * (1 - Math.pow(1 - k, 2));
      w.mesh.scale.set(r, r, 1);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
    }
  }

  clear() {
    this.sparks.clear(); this.glints.clear();
    for (const f of this.flashes) { f.active = false; f.sprite.visible = false; }
    for (const w of this.waves) { w.active = false; w.mesh.visible = false; }
  }
}
