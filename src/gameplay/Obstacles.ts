import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { materials } from '../render/Materials';
import { dotTexture, ringTexture } from '../render/Textures';
import { BALANCE, SCORE } from '../utils/constants';
import { clamp, easeOutBack, easeOutCubic, smoothstep } from '../utils/math';
import type { GameContext, HitInfo, HitResponse, Motion, ObjSpec, Target } from './types';

const THICK = 0.12;

function makeTarget(obj: THREE.Object3D, shape: 'box' | 'sphere', half: THREE.Vector3, onHit: (h: HitInfo) => HitResponse, opts: Partial<Target> = {}): Target {
  return { obj, shape, half, active: true, hazard: false, breakable: false, onHit, inv: new THREE.Matrix4(), wpos: new THREE.Vector3(), ...opts };
}

// ------------------------------------------------------------- shared geometry
const frameCache = new Map<string, THREE.BufferGeometry>();
/** Thin luminous border around a w x h pane (merged into a single geometry). */
function borderGeometry(w: number, h: number, e = 0.07, depth = THICK + 0.05) {
  const key = `${w.toFixed(2)}x${h.toFixed(2)}x${e}`;
  let g = frameCache.get(key);
  if (!g) {
    const parts = [
      new THREE.BoxGeometry(w + e, e, depth).translate(0, h / 2, 0),
      new THREE.BoxGeometry(w + e, e, depth).translate(0, -h / 2, 0),
      new THREE.BoxGeometry(e, h, depth).translate(w / 2, 0, 0),
      new THREE.BoxGeometry(e, h, depth).translate(-w / 2, 0, 0),
    ];
    g = mergeGeometries(parts)!;
    frameCache.set(key, g);
  }
  return g;
}
const boxCache = new Map<string, THREE.BoxGeometry>();
function paneGeometry(w: number, h: number) {
  const key = `${w.toFixed(2)}x${h.toFixed(2)}`;
  let g = boxCache.get(key);
  if (!g) { g = new THREE.BoxGeometry(w, h, THICK); boxCache.set(key, g); }
  return g;
}
const nodeGeo = new THREE.OctahedronGeometry(0.62, 0);
const nodeShellGeo = new THREE.IcosahedronGeometry(0.95, 1);
const ringGeo = new THREE.TorusGeometry(1.0, 0.05, 8, 48);

function glowSprite(color: THREE.ColorRepresentation, size: number, opacity = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

// ------------------------------------------------------------------- Pane
interface PaneOpts { reinforced?: boolean; hp?: number; tint: number; edge: number; hazard?: boolean; onBreak?: () => void }

/**
 * A single breakable glass sheet. Used directly by panels and as blades,
 * windows and shields by composite obstacles.
 */
export class Pane {
  mesh: THREE.Mesh;
  edges: THREE.Mesh;
  edgeMat: THREE.MeshBasicMaterial;
  target: Target;
  hp: number; maxHp: number;
  alive = true;
  private overlay?: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mesh: THREE.Mesh };
  private flashT = 0;
  private edgeBase = new THREE.Color();

  constructor(private ctx: GameContext, parent: THREE.Object3D, public w: number, public h: number, private o: PaneOpts) {
    const mat = o.reinforced ? materials.reinforcedMat(o.tint) : materials.glassMat(o.tint);
    this.mesh = new THREE.Mesh(paneGeometry(w, h), mat);
    this.mesh.renderOrder = 3;
    this.edgeBase.set(o.edge);
    this.edgeMat = new THREE.MeshBasicMaterial({ color: this.edgeBase.clone() });
    this.edges = new THREE.Mesh(borderGeometry(w, h, o.reinforced ? 0.13 : 0.07), this.edgeMat);
    this.mesh.add(this.edges);
    parent.add(this.mesh);
    this.maxHp = this.hp = o.reinforced ? (o.hp ?? 3) : 1;
    this.target = makeTarget(this.mesh, 'box', new THREE.Vector3(w / 2, h / 2, THICK / 2 + 0.05), (hi) => this.hit(hi), {
      hazard: o.hazard ?? true, breakable: true, onPlayerHit: () => this.crash(),
    });
    ctx.register(this.target);
  }

  /** Approach highlight + hit flash. */
  update(dt: number, camDist: number) {
    if (!this.alive) return;
    const k = smoothstep(70, 18, camDist);
    this.flashT = Math.max(0, this.flashT - dt * 4);
    const pulse = 0.55 + 0.45 * Math.sin(this.ctx.time * 3.2);
    const i = 0.9 + k * (0.9 + pulse * 0.35) + this.flashT * 2.5;
    this.edgeMat.color.copy(this.edgeBase).multiplyScalar(i);
  }

  hit(h: HitInfo): HitResponse {
    if (!this.alive) return 'pass';
    const dmg = h.charged ? 3 : 1;
    this.hp -= dmg;
    if (this.hp > 0) {
      this.drawCrack(h.point);
      this.flashT = 1;
      this.ctx.audio.crack(this.pan());
      this.ctx.reward('crack', SCORE.crack, h.point);
      this.ctx.fx.flash(h.point, 0xffffff, 1.2, 0.18);
      this.ctx.fx.glint({ pos: h.point, count: 8, color: 0xffffff, speed: [1, 4], size: [0.2, 0.4], life: [0.2, 0.5] });
      return 'bounce';
    }
    this.shatter(h.point, h.dir, h.charged ? 1.6 : 1);
    this.ctx.reward(this.o.reinforced ? 'reinforced' : 'glass', this.o.reinforced ? SCORE.reinforced : SCORE.glass, h.point);
    return 'pass';
  }

  private pan() {
    const p = this.target.wpos.clone().project(this.ctx.camera);
    return clamp(p.x, -1, 1);
  }

  shatter(point: THREE.Vector3, dir: THREE.Vector3, power: number, crashed = false) {
    if (!this.alive) return;
    this.alive = false;
    this.target.active = false;
    const area = this.w * this.h;
    const pieces = area < 4 ? 10 : area < 14 ? 18 : 26;
    this.ctx.destruction.shatter({
      source: this.mesh, w: this.w, h: this.h, thickness: THICK, material: this.mesh.material as THREE.MeshPhysicalMaterial,
      impact: point, dir, power, pieces: this.o.reinforced ? pieces + 6 : pieces, tint: this.o.edge,
    });
    this.ctx.audio.shatter(Math.min(area / 10, 1.5), this.pan(), this.o.reinforced);
    this.ctx.shake(this.o.reinforced ? 0.12 : 0.05);
    this.mesh.visible = false;
    this.disposeOverlay();
    if (!crashed) this.o.onBreak?.();
  }

  /** The camera flies into intact glass. */
  crash() {
    const cam = this.ctx.camera.position.clone();
    this.shatter(cam.add(new THREE.Vector3(0, 0, -0.5)), new THREE.Vector3(0, 0, -1), 0.7, true);
  }

  private drawCrack(world: THREE.Vector3) {
    if (!this.overlay) {
      const scale = 72;
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(512, Math.round(this.w * scale)); canvas.height = Math.min(512, Math.round(this.h * scale));
      const g = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      mesh.position.z = THICK / 2 + 0.012;
      mesh.renderOrder = 4;
      this.mesh.add(mesh);
      this.overlay = { canvas, g, tex, mesh };
    }
    const { canvas, g, tex } = this.overlay;
    this.mesh.updateWorldMatrix(true, false);
    const local = world.clone().applyMatrix4(this.mesh.matrixWorld.clone().invert());
    const cx = (local.x / this.w + 0.5) * canvas.width, cy = (0.5 - local.y / this.h) * canvas.height;
    const R = Math.max(canvas.width, canvas.height) * (0.35 + 0.15 * (this.maxHp - this.hp));
    g.lineCap = 'round';
    g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 6;
    const branches = 7 + Math.floor(Math.random() * 4);
    for (let b = 0; b < branches; b++) {
      let a = (b / branches) * Math.PI * 2 + Math.random() * 0.5;
      let x = cx, y = cy;
      const len = R * (0.45 + Math.random() * 0.6);
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(x, y);
      const steps = 6;
      for (let s = 0; s < steps; s++) {
        a += (Math.random() - 0.5) * 0.6;
        x += Math.cos(a) * len / steps; y += Math.sin(a) * len / steps;
        g.lineTo(x, y);
        if (Math.random() < 0.25) {
          const ba = a + (Math.random() < 0.5 ? 0.7 : -0.7);
          g.moveTo(x, y); g.lineTo(x + Math.cos(ba) * len * 0.2, y + Math.sin(ba) * len * 0.2); g.moveTo(x, y);
        }
      }
      g.stroke();
    }
    g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,255,255,0.7)';
    for (const rr of [R * 0.12, R * 0.26]) {
      g.beginPath();
      const a0 = Math.random() * Math.PI * 2;
      for (let k = 0; k < 3; k++) { const s = a0 + k * 2.1; g.moveTo(cx + Math.cos(s) * rr, cy + Math.sin(s) * rr); g.arc(cx, cy, rr, s, s + 1.2); }
      g.stroke();
    }
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.12);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    tex.needsUpdate = true;
  }

  private disposeOverlay() {
    if (!this.overlay) return;
    this.overlay.mesh.geometry.dispose();
    (this.overlay.mesh.material as THREE.Material).dispose();
    this.overlay.tex.dispose();
    this.overlay = undefined;
  }

  dispose() {
    this.target.active = false;
    this.edgeMat.dispose();
    this.disposeOverlay();
    this.mesh.removeFromParent();
  }
}

// ------------------------------------------------------------------ Entity
export abstract class Entity {
  root = new THREE.Group();
  base = new THREE.Vector3();
  t = 0;
  /** Counts toward encounter-clear / hold release. */
  required = true;
  cleared = false;
  protected motion?: Motion;

  constructor(protected ctx: GameContext, spec: ObjSpec, worldZ: number) {
    this.base.set(spec.pos[0], spec.pos[1], worldZ + spec.pos[2]);
    this.root.position.copy(this.base);
    this.motion = spec.motion;
    ctx.scene.add(this.root);
  }

  get z() { return this.root.position.z; }

  protected applyMotion(dt: number) {
    const m = this.motion;
    if (!m) return;
    const t = this.t;
    switch (m.kind) {
      case 'slide': {
        const off = Math.sin(t * m.speed + (m.phase ?? 0)) * m.amp;
        this.root.position.copy(this.base);
        this.root.position[m.axis] += off;
        break;
      }
      case 'spin': this.root.rotation[m.axis] += m.speed * dt; break;
      case 'orbit': {
        const a = t * m.speed + (m.phase ?? 0);
        this.root.position.set(this.base.x + Math.cos(a) * m.radius, this.base.y + Math.sin(a) * m.radius, this.base.z);
        break;
      }
      case 'bob': this.root.position.y = this.base.y + Math.sin(t * m.speed + (m.phase ?? 0)) * m.amp; break;
    }
  }

  update(dt: number) {
    this.t += dt;
    this.applyMotion(dt);
  }

  dispose() {
    this.root.removeFromParent();
  }
}

// ------------------------------------------------------------- GlassPanel
export class GlassPanel extends Entity {
  pane: Pane;
  constructor(ctx: GameContext, spec: Extract<ObjSpec, { kind: 'glass' | 'reinforced' }>, worldZ: number) {
    super(ctx, spec, worldZ);
    const reinforced = spec.kind === 'reinforced';
    this.pane = new Pane(ctx, this.root, spec.size[0], spec.size[1], {
      reinforced, hp: reinforced ? spec.hp : 1,
      tint: reinforced ? ctx.palette.reinforced : ctx.palette.glass,
      edge: reinforced ? 0xffd27a : ctx.palette.glass,
      onBreak: () => { this.cleared = true; },
    });
    if (spec.tilt) this.root.rotation.z = spec.tilt;
  }
  update(dt: number) {
    super.update(dt);
    this.pane.update(dt, this.ctx.camera.position.z - this.root.position.z);
  }
  dispose() { this.pane.dispose(); super.dispose(); }
}

// --------------------------------------------------------------- EnergyNode
export class EnergyNode extends Entity {
  private crystal: THREE.Mesh;
  private shell: THREE.Mesh;
  private glow: THREE.Sprite;
  private ring: THREE.Mesh;
  private target: Target;
  private dying = -1;
  private rare: boolean;
  private color: THREE.Color;

  constructor(ctx: GameContext, spec: Extract<ObjSpec, { kind: 'node' }>, worldZ: number, opts: { required?: boolean } = {}) {
    super(ctx, spec, worldZ);
    this.rare = !!spec.rare;
    this.required = opts.required ?? true;
    const s = (spec.scale ?? 1) * (this.rare ? 1.15 : 1);
    this.color = new THREE.Color(this.rare ? 0xffc46b : ctx.palette.node);
    this.crystal = new THREE.Mesh(nodeGeo, new THREE.MeshStandardMaterial({
      color: this.color, emissive: this.color, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.2, flatShading: true,
    }));
    this.crystal.scale.set(s, s * 1.35, s);
    this.shell = new THREE.Mesh(nodeShellGeo, new THREE.MeshBasicMaterial({ color: this.color.clone().multiplyScalar(1.4), wireframe: true, transparent: true, opacity: 0.35 }));
    this.shell.scale.setScalar(s);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: this.color.clone().multiplyScalar(1.6), transparent: true, opacity: 0.8 }));
    this.ring.scale.setScalar(s * 1.25);
    this.glow = glowSprite(this.color, 3.2 * s, 0.55);
    this.root.add(this.crystal, this.shell, this.ring, this.glow);
    // Generous hit sphere: nodes are rewards, not precision tests.
    this.target = makeTarget(this.root, 'sphere', new THREE.Vector3(1.0 * s, 0, 0), (h) => this.hit(h), { breakable: true });
    ctx.register(this.target);
  }

  update(dt: number) {
    super.update(dt);
    if (this.dying >= 0) {
      this.dying += dt;
      const k = this.dying / 0.35;
      const sc = 1 + easeOutCubic(k) * 0.8;
      this.root.scale.setScalar(sc);
      (this.glow.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - k);
      (this.crystal.material as THREE.MeshStandardMaterial).opacity = 1 - k;
      (this.shell.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - k);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      if (k >= 1) this.root.visible = false;
      return;
    }
    const t = this.ctx.time;
    this.crystal.rotation.y += dt * 1.4;
    this.shell.rotation.y -= dt * 0.5; this.shell.rotation.x += dt * 0.3;
    this.ring.rotation.x = Math.PI / 2 + Math.sin(t * 1.3) * 0.4;
    this.ring.rotation.y = t * 0.8;
    const p = 1 + Math.sin(t * 4 + this.base.x) * 0.06;
    this.glow.scale.setScalar(3.2 * p * (this.rare ? 1.25 : 1));
  }

  hit(h: HitInfo): HitResponse {
    if (this.cleared) return 'pass';
    this.cleared = true;
    this.target.active = false;
    this.dying = 0;
    (this.crystal.material as THREE.MeshStandardMaterial).transparent = true;
    const pos = this.target.wpos.clone();
    const amount = this.rare ? BALANCE.rarePickup : BALANCE.commonPickup;
    this.ctx.addEnergy(amount, pos);
    this.ctx.reward(this.rare ? 'rareNode' : 'node', this.rare ? SCORE.rareNode : SCORE.node, pos);
    const p = pos.clone().project(this.ctx.camera);
    this.ctx.audio.energy(this.rare, p.x);
    this.ctx.fx.flash(pos, this.color, 4, 0.4);
    this.ctx.fx.flash(pos, 0xffffff, 3, 0.5, true);
    this.ctx.fx.emit({ pos, count: 40, color: this.color, color2: 0xffffff, speed: [2, 7], size: [0.08, 0.2], life: [0.6, 1.3], drag: 2, gravity: -1 });
    this.ctx.fx.glint({ pos, count: 10, color: 0xffffff, speed: [1, 3], size: [0.3, 0.6], life: [0.4, 0.9] });
    void h;
    return 'pass';
  }

  dispose() {
    this.target.active = false;
    for (const m of [this.crystal, this.shell, this.ring]) (m.material as THREE.Material).dispose();
    (this.glow.material as THREE.Material).dispose();
    super.dispose();
  }
}

// ------------------------------------------------------------ ResonanceNode
export class ResonanceNode extends Entity {
  private core: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private glow: THREE.Sprite;
  private halo: THREE.Sprite;
  private target: Target;
  private radius: number;
  private fade = -1;

  constructor(ctx: GameContext, spec: Extract<ObjSpec, { kind: 'resonance' }>, worldZ: number) {
    super(ctx, spec, worldZ);
    this.radius = spec.radius ?? 9;
    const c = new THREE.Color(0xf4e9ff);
    this.core = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xd7b8ff, emissiveIntensity: 1.4, flatShading: true, roughness: 0.2 }));
    this.root.add(this.core);
    const cols = [0xff9ad5, 0x8deaff, 0xffd39b];
    cols.forEach((col, i) => {
      const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.6), transparent: true, opacity: 0.9 }));
      r.scale.setScalar(0.95 + i * 0.28);
      this.rings.push(r); this.root.add(r);
    });
    this.glow = glowSprite(c, 4, 0.6);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0xe6d2ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.halo.scale.setScalar(4.5);
    this.root.add(this.glow, this.halo);
    this.target = makeTarget(this.root, 'sphere', new THREE.Vector3(1.05, 0, 0), (h) => this.hit(h));
    ctx.register(this.target);
  }

  update(dt: number) {
    super.update(dt);
    const t = this.ctx.time;
    if (this.fade >= 0) {
      this.fade += dt;
      const k = Math.min(this.fade / 0.6, 1);
      this.root.scale.setScalar(1 + k * 1.5);
      for (const r of this.rings) (r.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      (this.glow.material as THREE.SpriteMaterial).opacity = 0.6 * (1 - k);
      (this.halo.material as THREE.SpriteMaterial).opacity = 0.5 * (1 - k);
      this.core.visible = k < 0.3;
      if (k >= 1) this.root.visible = false;
      return;
    }
    this.core.rotation.x += dt * 0.9; this.core.rotation.y += dt * 1.3;
    this.rings.forEach((r, i) => { r.rotation.x = t * (0.7 + i * 0.35) + i; r.rotation.y = t * (0.5 - i * 0.3); });
    const p = 0.5 + 0.5 * Math.sin(t * 3);
    this.halo.scale.setScalar(4 + p * 1.2);
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.25 + p * 0.35;
  }

  hit(_h: HitInfo): HitResponse {
    if (this.cleared) return 'pass';
    this.cleared = true;
    this.target.active = false;
    this.fade = 0;
    const pos = this.target.wpos.clone();
    this.ctx.reward('resonance', SCORE.resonance, pos);
    this.ctx.resonate(pos, this.radius, 0xd8b8ff);
    return 'pass';
  }

  dispose() {
    this.target.active = false;
    (this.core.material as THREE.Material).dispose(); this.core.geometry.dispose();
    for (const r of this.rings) (r.material as THREE.Material).dispose();
    (this.glow.material as THREE.Material).dispose(); (this.halo.material as THREE.Material).dispose();
    super.dispose();
  }
}

// -------------------------------------------------------------------- Rotor
/** Rotating glass structure: N blades on a hub. Blades sweep across the path. */
export class Rotor extends Entity {
  private spinner = new THREE.Group();
  private panes: Pane[] = [];
  private speed: number;
  private hub: THREE.Mesh;

  constructor(ctx: GameContext, spec: Extract<ObjSpec, { kind: 'rotor' }>, worldZ: number) {
    super(ctx, spec, worldZ);
    this.speed = spec.speed;
    this.root.add(this.spinner);
    this.hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.5, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: ctx.palette.accent, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.4 }));
    this.root.add(this.hub);
    for (let i = 0; i < spec.blades; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / spec.blades) * Math.PI * 2;
      this.spinner.add(arm);
      const pane = new Pane(ctx, arm, spec.length, spec.width, {
        reinforced: spec.reinforced, tint: spec.reinforced ? ctx.palette.reinforced : ctx.palette.glass,
        edge: spec.reinforced ? 0xffd27a : ctx.palette.accent,
        onBreak: () => { if (this.panes.every((p) => !p.alive)) this.cleared = true; },
      });
      pane.mesh.position.x = spec.length / 2 + 0.55;
      this.panes.push(pane);
    }
  }
  update(dt: number) {
    super.update(dt);
    this.spinner.rotation.z += this.speed * dt;
    const d = this.ctx.camera.position.z - this.root.position.z;
    for (const p of this.panes) p.update(dt, d);
  }
  dispose() {
    for (const p of this.panes) p.dispose();
    this.hub.geometry.dispose(); (this.hub.material as THREE.Material).dispose();
    super.dispose();
  }
}

// -------------------------------------------------------------------- Frame
/** Solid architectural frame with a narrow window, optionally glazed. Orbs bounce off the frame. */
export class WindowFrame extends Entity {
  private pane?: Pane;
  private meshes: THREE.Mesh[] = [];
  constructor(ctx: GameContext, spec: Extract<ObjSpec, { kind: 'frame' }>, worldZ: number) {
    super(ctx, spec, worldZ);
    const [W, H] = spec.size, [ww, wh] = spec.window;
    const mat = new THREE.MeshStandardMaterial({ color: ctx.palette.swatch[3] ?? 0xffffff, roughness: 0.55, metalness: 0.1, emissive: ctx.palette.accent, emissiveIntensity: 0.05 });
    const d = 0.9;
    const sideW = (W - ww) / 2, capH = (H - wh) / 2;
    const parts: [number, number, number, number][] = [
      [-(ww / 2 + sideW / 2), 0, sideW, H], [ww / 2 + sideW / 2, 0, sideW, H],
      [0, wh / 2 + capH / 2, ww, capH], [0, -(wh / 2 + capH / 2), ww, capH],
    ];
    for (const [x, y, w, h] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, 0);
      this.root.add(m);
      this.meshes.push(m);
      ctx.register(makeTarget(m, 'box', new THREE.Vector3(w / 2, h / 2, d / 2), (hi) => {
        ctx.audio.thud(); ctx.fx.emit({ pos: hi.point, count: 10, color: 0xffffff, speed: [1, 3], size: [0.05, 0.1], life: [0.2, 0.5] });
        return 'bounce';
      }, { hazard: false }));
    }
    const trim = new THREE.Mesh(borderGeometry(ww, wh, 0.12, d + 0.04), materials.edge(ctx.palette.accent, 1.8));
    this.root.add(trim);
    if (spec.glass) {
      this.pane = new Pane(ctx, this.root, ww, wh, { tint: ctx.palette.glass, edge: ctx.palette.glass, onBreak: () => { this.cleared = true; } });
    } else { this.required = false; this.cleared = true; }
  }
  update(dt: number) {
    super.update(dt);
    this.pane?.update(dt, this.ctx.camera.position.z - this.root.position.z);
  }
  dispose() {
    this.pane?.dispose();
    for (const m of this.meshes) m.geometry.dispose();
    (this.meshes[0]?.material as THREE.Material | undefined)?.dispose();
    super.dispose();
  }
}

// ------------------------------------------------------------------- Switch
const badgeCache = new Map<number, THREE.CanvasTexture>();
/** Round numbered badge used to show the order of sequenced switches. */
function badgeTexture(n: number) {
  let t = badgeCache.get(n);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(40,24,80,0.78)';
    g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
    g.lineWidth = 7; g.strokeStyle = '#ffffff'; g.stroke();
    g.fillStyle = '#ffffff'; g.font = '700 74px Outfit, Segoe UI, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 64, 70);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    badgeCache.set(n, t);
  }
  return t;
}

/**
 * A portal switch crystal with three unmistakable states:
 * waiting (dim slate, small), armed (bright, pulsing, large halo), lit (solid gold).
 */
class Switch {
  root = new THREE.Group();
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  ring: THREE.Mesh;
  badge?: THREE.Sprite;
  target: Target;
  lit = false;
  armed = true;
  rewarded = false;
  private mat: THREE.MeshStandardMaterial;
  private armedColor = new THREE.Color();
  constructor(ctx: GameContext, parent: THREE.Object3D, onHit: (s: Switch, h: HitInfo) => HitResponse, order?: number) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: ctx.palette.node, emissiveIntensity: 0.6, flatShading: true, roughness: 0.3 });
    this.mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), this.mat);
    this.mesh.scale.y = 1.3;
    this.glow = glowSprite(ctx.palette.node, 2.6, 0.5);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.ring.scale.setScalar(0.95);
    this.root.add(this.mesh, this.glow, this.ring);
    if (order !== undefined) {
      this.badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(order), transparent: true, depthWrite: false }));
      this.badge.scale.setScalar(0.95);
      this.badge.position.set(0, 1.35, 0.2);
      this.badge.renderOrder = 7;
      this.root.add(this.badge);
    }
    parent.add(this.root);
    this.target = makeTarget(this.root, 'sphere', new THREE.Vector3(1.0, 0, 0), (h) => onHit(this, h));
    ctx.register(this.target);
  }
  setState(lit: boolean, armed: boolean, color: number, litColor: number) {
    this.lit = lit; this.armed = armed;
    this.armedColor.set(color);
    const glowM = this.glow.material as THREE.SpriteMaterial;
    const ringM = this.ring.material as THREE.MeshBasicMaterial;
    if (lit) {
      this.mat.color.set(0xffe9a8); this.mat.emissive.set(litColor); this.mat.emissiveIntensity = 2.2;
      glowM.color.set(litColor); glowM.opacity = 0.95;
      ringM.color.set(litColor).multiplyScalar(2); ringM.opacity = 0.95;
    } else if (armed) {
      this.mat.color.set(0xffffff); this.mat.emissive.set(color); this.mat.emissiveIntensity = 1.4;
      glowM.color.set(color); glowM.opacity = 0.8;
      ringM.color.set(0xffffff).multiplyScalar(1.6); ringM.opacity = 0.95;
    } else {
      // Waiting: clearly switched off.
      this.mat.color.set(0x6d6488); this.mat.emissive.set(0x2a2440); this.mat.emissiveIntensity = 0.2;
      glowM.opacity = 0;
      ringM.color.set(0x8a82a6); ringM.opacity = 0.35;
    }
    if (this.badge) (this.badge.material as THREE.SpriteMaterial).opacity = lit ? 0.5 : armed ? 1 : 0.85;
  }
  update(dt: number, t: number, timer: number) {
    this.mesh.rotation.y += dt * (this.lit ? 4 : this.armed ? 2 : 0.4);
    this.ring.rotation.z = t;
    const waiting = !this.lit && !this.armed;
    let s: number;
    if (timer >= 0) s = 0.6 + timer * 0.8; // timed mode: the ring shrinks to show the remaining window
    else if (this.armed && !this.lit) s = 1.05 + Math.sin(t * 5) * 0.15;
    else s = waiting ? 0.8 : 0.95;
    this.ring.scale.setScalar(s);
    if (this.armed && !this.lit) {
      (this.glow.material as THREE.SpriteMaterial).opacity = 0.6 + 0.3 * Math.sin(t * 5);
      this.glow.scale.setScalar(2.8 + Math.sin(t * 5) * 0.5);
    }
    this.root.scale.setScalar(waiting ? 0.85 : 1);
  }
  dispose() {
    this.target.active = false;
    this.mesh.geometry.dispose(); this.mat.dispose();
    (this.glow.material as THREE.Material).dispose(); (this.ring.material as THREE.Material).dispose();
    if (this.badge) (this.badge.material as THREE.Material).dispose();
  }
}

// ------------------------------------------------------------------- Portal
export class Portal extends Entity {
  final: boolean;
  open = false;
  private switches: Switch[] = [];
  private petals: THREE.Mesh[] = [];
  private frame: THREE.Mesh;
  private inner: THREE.Mesh;
  private light: THREE.Sprite;
  private openT = -1;
  private mode: 'all' | 'sequence' | 'timed';
  private window: number;
  private timer = -1;
  private radius: number;
  private petalMat: THREE.MeshPhysicalMaterial;
  private seqIndex = 0;
  private outer: THREE.Mesh;

  constructor(ctx: GameContext, spec: Extract<ObjSpec, { kind: 'portal' }>, worldZ: number) {
    super(ctx, spec, worldZ);
    this.final = !!spec.final;
    this.mode = spec.mode;
    this.window = spec.window ?? 5;
    const R = this.radius = spec.radius ?? 3.6;
    const accent = ctx.palette.accent;
    this.frame = new THREE.Mesh(new THREE.TorusGeometry(R, 0.32, 10, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: accent, emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.3, flatShading: true }));
    this.frame.rotation.z = Math.PI / 6;
    const outer = this.outer = new THREE.Mesh(new THREE.TorusGeometry(R + 0.75, 0.06, 6, 6), materials.edge(accent, 2));
    outer.rotation.z = Math.PI / 6;
    this.root.add(this.frame, outer);
    // Hexagonal glass iris built from six triangular petals.
    this.petalMat = materials.glassMat(ctx.palette.glass).clone();
    this.petalMat.opacity = 0.55;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2 + Math.PI / 6 + Math.PI / 6, a1 = a0 + Math.PI / 3;
      const r = R * 0.98;
      const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(Math.cos(a0) * r, Math.sin(a0) * r), new THREE.Vector2(Math.cos(a1) * r, Math.sin(a1) * r)]);
      const geo = new THREE.ShapeGeometry(shape);
      const petal = new THREE.Mesh(geo, this.petalMat);
      petal.userData.dir = new THREE.Vector3(Math.cos(a0 + Math.PI / 6), Math.sin(a0 + Math.PI / 6), 0);
      petal.renderOrder = 3;
      this.petals.push(petal);
      this.root.add(petal);
    }
    this.inner = new THREE.Mesh(new THREE.CircleGeometry(R * 0.96, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.inner.rotation.z = Math.PI / 6;
    this.inner.position.z = -0.1;
    this.light = glowSprite(0xffffff, R * 3, 0);
    this.light.position.z = -0.4;
    this.root.add(this.inner, this.light);

    const n = spec.switches;
    for (let i = 0; i < n; i++) {
      // Keep switches clear of the floor: one on top, two on the sides, three as a triangle.
      const a = n === 2 ? i * Math.PI : Math.PI / 2 + (i / n) * Math.PI * 2;
      const sw = new Switch(ctx, this.root, (s, h) => this.onSwitch(s, h), this.mode === 'sequence' ? i + 1 : undefined);
      sw.root.position.set(Math.cos(a) * (R + 0.75), Math.sin(a) * (R + 0.75), 0.3);
      this.switches.push(sw);
    }
    this.refresh();
  }

  private refresh() {
    const c = this.ctx.palette.node, lit = 0xfff1b8;
    this.switches.forEach((s, i) => {
      const armed = this.mode === 'sequence' ? i === this.seqIndex : true;
      s.setState(s.lit, armed && !s.lit, c, lit);
    });
  }

  private onSwitch(s: Switch, h: HitInfo): HitResponse {
    if (this.open || s.lit) return 'pass';
    if (this.mode === 'sequence' && this.switches.indexOf(s) !== this.seqIndex) {
      this.ctx.audio.thud();
      this.ctx.fx.flash(h.point, 0xffffff, 0.8, 0.15);
      this.ctx.hint(`Hit switch ${this.seqIndex + 1} first — the glowing one`, 2.2);
      return 'bounce';
    }
    s.lit = true;
    s.target.active = false;
    this.seqIndex++;
    if (this.mode === 'timed' && this.timer < 0) this.timer = this.window;
    const lit = this.switches.filter((x) => x.lit).length;
    this.ctx.audio.switchOn(lit - 1);
    if (!s.rewarded) { s.rewarded = true; this.ctx.reward('switch', SCORE.switch, h.point); }
    const pos = s.target.wpos.clone();
    this.ctx.fx.flash(pos, 0xfff1b8, 3, 0.4);
    this.ctx.fx.flash(pos, 0xffffff, 2.4, 0.5, true);
    this.ctx.fx.emit({ pos, count: 24, color: 0xfff1b8, speed: [1, 5], size: [0.06, 0.16], life: [0.5, 1] });
    if (lit === this.switches.length) this.openPortal();
    this.refresh();
    return 'pass';
  }

  private openPortal() {
    this.open = true;
    this.cleared = true;
    this.timer = -1;
    this.openT = 0;
    this.ctx.audio.portal();
    this.ctx.shake(0.08);
    const p = this.root.position.clone();
    this.ctx.fx.wave(p, this.ctx.palette.accent, 1, this.radius * 2.6, 1.2);
    this.ctx.fx.emit({ pos: p, count: 80, color: 0xffffff, color2: this.ctx.palette.accent, speed: [3, 10], size: [0.08, 0.2], life: [0.8, 1.6], posJitter: 2 });
  }

  update(dt: number) {
    super.update(dt);
    const t = this.ctx.time;
    this.frame.rotation.z = Math.PI / 6 + Math.sin(t * 0.5) * 0.03;
    if (this.timer >= 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        // Window missed: reset switches with a gentle cue.
        this.timer = -1;
        for (const s of this.switches) { s.lit = false; s.target.active = true; }
        this.seqIndex = 0;
        this.ctx.audio.ui('back');
        this.ctx.hint('Too slow — strike all switches together', 2);
        this.refresh();
      }
    }
    const tk = this.timer >= 0 ? this.timer / this.window : -1;
    for (const s of this.switches) s.update(dt, t, s.lit ? -1 : tk);
    if (this.openT >= 0) {
      this.openT += dt;
      const k = easeOutCubic(this.openT / 1.4);
      for (const p of this.petals) {
        const d = p.userData.dir as THREE.Vector3;
        p.position.set(d.x * k * this.radius * 1.1, d.y * k * this.radius * 1.1, k * 0.5);
        p.rotation.z = k * 0.4;
      }
      this.petalMat.opacity = 0.55 * (1 - k);
      (this.inner.material as THREE.MeshBasicMaterial).opacity = Math.min(1, this.openT * 2) * (0.35 + 0.1 * Math.sin(t * 4));
      (this.light.material as THREE.SpriteMaterial).opacity = Math.min(1, this.openT) * 0.8;
      (this.frame.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + Math.min(this.openT, 1) * 1.2;
    }
  }

  dispose() {
    for (const s of this.switches) s.dispose();
    for (const p of this.petals) p.geometry.dispose();
    this.petalMat.dispose();
    this.frame.geometry.dispose(); (this.frame.material as THREE.Material).dispose();
    this.outer.geometry.dispose();
    this.inner.geometry.dispose(); (this.inner.material as THREE.Material).dispose();
    (this.light.material as THREE.Material).dispose();
    super.dispose();
  }
}

// --------------------------------------------------------------- PrismCore
/**
 * Final encounter: a floating prism core guarded by three energy nodes.
 * Phase 1: orbiting node. Phase 2: node behind a sliding glass shield.
 * Phase 3: node sealed in reinforced glass (charged shot recommended).
 * Each activation transforms the core; the third opens it into a gateway.
 */
export class PrismCore extends Entity {
  phase = 0;
  open = false;
  final = true;
  private core: THREE.Group;
  private facets: THREE.Mesh[] = [];
  private coreMat: THREE.MeshStandardMaterial;
  private edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0xffd39b).multiplyScalar(1.8), transparent: true });
  private rings: THREE.Mesh[] = [];
  private nodes: { root: THREE.Group; mesh: THREE.Mesh; glow: THREE.Sprite; halo: THREE.Sprite; target: Target; appear: number; color: number }[] = [];
  private shield?: Pane;
  private cage?: Pane;
  private shieldHolder = new THREE.Group();
  private cageHolder = new THREE.Group();
  private gate: THREE.Mesh;
  private gateGlow: THREE.Sprite;
  private openT = -1;
  private halo: THREE.Sprite;
  private spin = 0.25;
  private colors = [0xaf94f6, 0xf6a7db, 0xffd39b, 0x8deaff];

  constructor(ctx: GameContext, spec: Extract<ObjSpec, { kind: 'prism' }>, worldZ: number) {
    super(ctx, spec, worldZ);
    this.core = new THREE.Group();
    this.root.add(this.core);
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x4a2fb8, emissive: 0x6a46e0, emissiveIntensity: 0.35, flatShading: true, roughness: 0.15, metalness: 0.6, envMapIntensity: 1.8 });
    // Core = 8 tetrahedral facets of an octahedron that can split apart.
    const R = 2.6;
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) for (let sz = -1; sz <= 1; sz += 2) {
      const a = axes[0].clone().multiplyScalar(sx * R), b = axes[1].clone().multiplyScalar(sy * R * 1.35), c = axes[2].clone().multiplyScalar(sz * R);
      const g = new THREE.BufferGeometry();
      const o = new THREE.Vector3();
      const verts = [o, a, b, o, b, c, o, c, a, a, c, b];
      const flip = sx * sy * sz < 0;
      const pos: number[] = [];
      for (let i = 0; i < verts.length; i += 3) {
        const tri = flip ? [verts[i], verts[i + 2], verts[i + 1]] : [verts[i], verts[i + 1], verts[i + 2]];
        for (const v of tri) pos.push(v.x, v.y, v.z);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.coreMat);
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), this.edgeMat));
      m.userData.dir = new THREE.Vector3(sx, sy, sz).normalize();
      this.facets.push(m);
      this.core.add(m);
    }
    const shellWire = new THREE.Mesh(new THREE.OctahedronGeometry(R * 1.45, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd6b7ff).multiplyScalar(1.3), wireframe: true, transparent: true, opacity: 0.35 }));
    shellWire.scale.y = 1.25;
    this.core.add(shellWire);
    this.rings.push(shellWire);
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(R * (1.9 + i * 0.5), 0.09, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.colors[i + 1]).multiplyScalar(1.6), transparent: true, opacity: 0.22 }));
      this.root.add(r);
      this.rings.push(r);
    }
    this.gate = new THREE.Mesh(new THREE.CircleGeometry(R * 1.6, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.gate.position.z = -0.5;
    this.gateGlow = glowSprite(0xfff1d6, R * 7, 0);
    this.gateGlow.position.z = -1;
    this.halo = glowSprite(0xb48cff, R * 6, 0.55);
    this.halo.position.z = -2;
    this.root.add(this.gate, this.gateGlow, this.halo);

    // Three guardian nodes.
    for (let i = 0; i < 3; i++) {
      const root = new THREE.Group();
      const color = this.colors[i + 1];
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.6, flatShading: true }));
      mesh.scale.y = 1.4;
      const glow = glowSprite(color, 4.2, 0.85);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(3);
      root.add(mesh, glow, halo);
      root.scale.setScalar(0.001);
      root.visible = false;
      this.root.add(root);
      const target = makeTarget(root, 'sphere', new THREE.Vector3(1.0, 0, 0), (h) => this.onNode(i, h));
      target.active = false;
      ctx.register(target);
      this.nodes.push({ root, mesh, glow, halo, target, appear: -1, color });
    }
    this.root.add(this.shieldHolder, this.cageHolder);
    this.showNode(0);
  }

  private showNode(i: number) {
    const n = this.nodes[i];
    n.root.visible = true;
    n.appear = 0;
    n.target.active = true;
    if (i === 1) {
      this.shield = new Pane(this.ctx, this.shieldHolder, 3.2, 3.2, { tint: this.ctx.palette.glass, edge: 0x8deaff, hazard: false });
      this.shield.mesh.position.set(0, 0, 1.4);
    }
    if (i === 2) {
      this.cage = new Pane(this.ctx, this.cageHolder, 3, 3, { reinforced: true, hp: 3, tint: this.ctx.palette.reinforced, edge: 0xffd27a, hazard: false });
      this.cage.mesh.position.set(0, 0, 1.4);
      this.ctx.hint('Sealed in reinforced glass — hold to charge a shot', 3.5);
    }
  }

  private onNode(i: number, h: HitInfo): HitResponse {
    if (i !== this.phase) return 'pass';
    const n = this.nodes[i];
    n.target.active = false;
    const pos = n.target.wpos.clone();
    this.ctx.reward('prism', SCORE.prismPhase, pos);
    this.ctx.audio.resonance();
    this.ctx.audio.switchOn(i);
    this.ctx.shake(0.15);
    this.ctx.fx.flash(pos, n.color, 5, 0.5);
    this.ctx.fx.wave(this.root.position.clone(), n.color, 2, 14, 1.1);
    this.ctx.fx.emit({ pos, count: 60, color: n.color, color2: 0xffffff, speed: [3, 9], size: [0.08, 0.22], life: [0.7, 1.4] });
    // Energy beam to the core: a burst of particles flowing inward.
    const core = this.root.position.clone();
    const dir = core.clone().sub(pos).normalize();
    this.ctx.fx.emit({ pos, count: 50, color: 0xffffff, color2: n.color, dir, spread: 0.15, speed: [8, 14], size: [0.1, 0.2], life: [0.3, 0.5], drag: 0.2 });
    n.root.visible = false;
    if (this.shield && i === 1) { this.shield.dispose(); this.shield = undefined; }
    if (this.cage && i === 2) { this.cage.dispose(); this.cage = undefined; }
    // Transform the core.
    this.phase++;
    this.coreMat.emissive.set(this.colors[Math.min(this.phase, 3)]);
    this.coreMat.emissiveIntensity = 0.3 + this.phase * 0.3;
    (this.halo.material as THREE.SpriteMaterial).color.set(this.colors[Math.min(this.phase, 3)]);
    this.spin = 0.25 + this.phase * 0.45;
    (this.rings[this.phase].material as THREE.MeshBasicMaterial).opacity = 0.85;
    // Outer facets peel open a little more each phase.
    if (this.phase < 3) {
      this.ctx.hint(['', 'The core stirs — find the next node', 'One more — the core is opening'][this.phase], 2.6);
      this.nextShow = 0.9;
    } else {
      this.open = true;
      this.cleared = true;
      this.openT = 0;
      this.ctx.audio.portal();
      this.ctx.audio.burst();
      this.ctx.fx.emit({ pos: core, count: 160, color: 0xffffff, color2: 0xffd39b, speed: [4, 14], size: [0.1, 0.3], life: [1, 2], posJitter: 3 });
    }
    void h;
    return 'pass';
  }

  private nextShow = -1;

  update(dt: number) {
    super.update(dt);
    const t = this.ctx.time;
    if (this.nextShow > 0) { this.nextShow -= dt; if (this.nextShow <= 0) this.showNode(this.phase); }
    this.core.rotation.y += dt * this.spin;
    this.core.rotation.x = Math.sin(t * 0.4) * 0.15;
    (this.halo.material as THREE.SpriteMaterial).opacity = (0.45 + 0.15 * Math.sin(t * 2.2)) * (this.openT >= 0 ? 0.3 : 1);
    this.rings[0].rotation.y -= dt * 0.3;
    for (let i = 1; i < this.rings.length; i++) {
      this.rings[i].rotation.x = Math.sin(t * 0.6 + i) * 0.6;
      this.rings[i].rotation.y = t * 0.4 * (i % 2 ? 1 : -1);
    }
    const spread = this.phase * 0.35 + (this.openT >= 0 ? easeOutCubic(this.openT / 2) * 6 : 0);
    for (const f of this.facets) {
      const d = f.userData.dir as THREE.Vector3;
      f.position.copy(d).multiplyScalar(spread);
    }
    // Guardian node motion.
    this.nodes.forEach((n, i) => {
      if (!n.root.visible) return;
      if (n.appear >= 0) {
        n.appear += dt;
        n.root.scale.setScalar(Math.max(0.001, easeOutBack(n.appear / 0.7)));
        if (n.appear > 0.7) n.appear = -1;
      }
      n.mesh.rotation.y += dt * 2;
      const a = t * (i === 0 ? 0.55 : 0.35) + i * 2.1;
      if (i === 0) n.root.position.set(Math.cos(a) * 5.2, Math.sin(a) * 3.2, 1.2);
      else if (i === 1) n.root.position.set(Math.sin(t * 0.7) * 4.2, 2.6, 1.0);
      else n.root.position.set(0, -3.4, 1.0);
    });
    if (this.shield) {
      // Shield slides back and forth in front of node 2; it can be broken or timed.
      const nx = this.nodes[1].root.position.x;
      this.shieldHolder.position.set(nx + Math.sin(t * 1.6) * 2.4, 2.6, 0);
      this.shield.update(dt, 20);
    }
    if (this.cage) { this.cageHolder.position.set(0, -3.4, 0); this.cage.update(dt, 20); }
    if (this.openT >= 0) {
      this.openT += dt;
      const k = clamp(this.openT / 1.6, 0, 1);
      this.coreMat.opacity = 1 - k;
      this.edgeMat.opacity = 1 - k;
      this.coreMat.transparent = true;
      (this.gate.material as THREE.MeshBasicMaterial).opacity = k * (0.55 + 0.1 * Math.sin(t * 5));
      (this.gateGlow.material as THREE.SpriteMaterial).opacity = k * 0.9;
      this.gate.scale.setScalar(0.4 + easeOutBack(k) * 0.6);
    }
  }

  dispose() {
    this.shield?.dispose(); this.cage?.dispose();
    for (const f of this.facets) { f.geometry.dispose(); (f.children[0] as THREE.LineSegments).geometry.dispose(); }
    this.edgeMat.dispose();
    this.coreMat.dispose();
    for (const r of this.rings) { r.geometry.dispose(); (r.material as THREE.Material).dispose(); }
    for (const n of this.nodes) { n.target.active = false; n.mesh.geometry.dispose(); (n.mesh.material as THREE.Material).dispose(); (n.glow.material as THREE.Material).dispose(); (n.halo.material as THREE.Material).dispose(); }
    this.gate.geometry.dispose(); (this.gate.material as THREE.Material).dispose();
    (this.gateGlow.material as THREE.Material).dispose();
    (this.halo.material as THREE.Material).dispose();
    super.dispose();
  }
}

export function createEntity(ctx: GameContext, spec: ObjSpec, worldZ: number): Entity {
  switch (spec.kind) {
    case 'glass': case 'reinforced': return new GlassPanel(ctx, spec, worldZ);
    case 'node': return new EnergyNode(ctx, spec, worldZ);
    case 'resonance': return new ResonanceNode(ctx, spec, worldZ);
    case 'rotor': return new Rotor(ctx, spec, worldZ);
    case 'frame': return new WindowFrame(ctx, spec, worldZ);
    case 'portal': return new Portal(ctx, spec, worldZ);
    case 'prism': return new PrismCore(ctx, spec, worldZ);
  }
}

