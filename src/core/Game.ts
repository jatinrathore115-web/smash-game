import * as THREE from 'three';
import { Renderer, QUALITY } from '../render/Renderer';
import { Sky } from '../render/Sky';
import { EffectsManager } from '../render/Effects';
import { materials } from '../render/Materials';
import { buildWorld, type World } from '../render/Environment';
import { DestructionSystem } from '../gameplay/Destruction';
import { ProjectileSystem } from '../gameplay/Projectiles';
import type { GameContext, LevelDef, Palette, RewardKind, Target } from '../gameplay/types';
import { LevelRunner } from '../levels/LevelRunner';
import { LEVELS } from '../levels/LevelData';
import { AudioManager } from '../audio/AudioManager';
import type { SongId } from '../audio/Music';
import { UI } from '../ui/UI';
import { InputManager } from './Input';
import { CameraController } from './CameraController';
import { BALANCE, SCORE, DESIGN_W, DESIGN_H, ASPECT } from '../utils/constants';
import { storage, type Settings } from '../utils/storage';
import { clamp } from '../utils/math';

type Mode = 'menu' | 'playing' | 'paused' | 'ending' | 'result';

interface Stats {
  energy: number; integrity: number; score: number; combo: number;
  shots: number; hitShots: number; destroyed: number; pulse: number;
  invuln: number; damaged: boolean; missStreak: number;
}

const freshStats = (): Stats => ({
  energy: BALANCE.startEnergy, integrity: BALANCE.integrity, score: 0, combo: 0,
  shots: 0, hitShots: 0, destroyed: 0, pulse: 0, invuln: 0, damaged: false, missStreak: 0,
});

/** Top-level orchestrator: owns the scene, systems, state machine and main loop. */
export class Game {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: Renderer;
  sky = new Sky();
  hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.4);
  key = new THREE.DirectionalLight(0xffffff, 1.8);
  accentA = new THREE.PointLight(0xffffff, 60, 45, 2);
  accentB = new THREE.PointLight(0xffffff, 40, 45, 2);
  fx = new EffectsManager();
  destruction: DestructionSystem;
  projectiles: ProjectileSystem;
  cam: CameraController;
  audio = new AudioManager();
  ui: UI;
  input: InputManager;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;

  mode: Mode = 'menu';
  private prevMode: Mode = 'menu';
  level: LevelDef = LEVELS[0];
  world: World | null = null;
  runner: LevelRunner | null = null;
  targets: Target[] = [];
  stats = freshStats();
  time = 0;
  levelTime = 0;
  private last = performance.now();
  private beatPulse = 0;
  private pendingWave: { t: Target; delay: number; dir: THREE.Vector3 }[] = [];
  private burstWave: { front: number; t: number; mesh: THREE.Mesh } | null = null;
  private burstMesh: THREE.Mesh;
  private endT = 0;
  private charging = false;
  private chargeReadyPlayed = false;
  private burstHintShown = false;
  private chargeHintShown = false;
  private hintIdleShown = false;
  private regenT = 0;
  private startTimer: number | null = null;
  private regenHintShown = false;
  private stage: HTMLElement;
  private shown = { energy: -1, integrity: -1, pulse: -1, combo: -1, progress: -1 };
  private raycaster = new THREE.Raycaster();
  private tmpV = new THREE.Vector3(); private tmpV2 = new THREE.Vector3();
  ctx: GameContext;

  constructor(stage: HTMLElement, canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.stage = stage;
    this.camera = new THREE.PerspectiveCamera(68, ASPECT, 0.1, 600);
    this.renderer = new Renderer(canvas, this.scene, this.camera);
    this.pmrem = new THREE.PMREMGenerator(this.renderer.renderer);
    this.cam = new CameraController(this.camera);
    this.destruction = new DestructionSystem(this.fx);
    this.projectiles = new ProjectileSystem(this.fx);

    this.scene.add(this.sky.mesh, this.hemi, this.key, this.key.target, this.accentA, this.accentB, this.fx.group, this.destruction.group, this.projectiles.group);
    this.scene.fog = new THREE.Fog(0xffffff, 30, 175);

    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf6c7ff).multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.burstMesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 96), ringMat);
    this.burstMesh.visible = false;
    this.scene.add(this.burstMesh);

    const self = this;
    this.ctx = {
      scene: this.scene, camera: this.camera, fx: this.fx, destruction: this.destruction, audio: this.audio,
      get time() { return self.levelTime; },
      get palette() { return self.level.palette; },
      get reducedMotion() { return storage.settings.reducedMotion; },
      register: (t) => { this.targets.push(t); },
      reward: (k, p, at) => this.reward(k, p, at),
      addEnergy: (n, at) => this.addEnergy(n, at),
      resonate: (at, r, c) => this.resonate(at, r, c),
      shake: (a) => this.cam.shake(a),
      hint: (t, s) => this.ui.hint(t, s),
    };

    this.projectiles.onMiss = () => this.onMiss();
    this.projectiles.onFirstHit = () => this.onShotHit();

    this.ui = new UI(uiRoot, {
      play: (id) => this.startLevel(id),
      resume: () => this.resume(),
      restart: () => this.startLevel(this.level.id),
      toMenu: () => this.toMenu(),
      back: () => (this.mode === 'menu' ? this.ui.showMenu(storage.data.unlocked) : this.toMenu()),
      next: () => this.startLevel(Math.min(4, this.level.id + 1, storage.data.unlocked)),
      burst: () => this.tryBurst(),
      pause: () => this.pause(),
      toggleSound: () => this.toggleSound(),
      settingsChanged: (s) => this.applySettings(s),
      click: () => { this.audio.unlock(); this.audio.ui('click'); },
    });
    this.input = new InputManager(stage, canvas, {
      press: () => this.onPress(),
      release: (held) => this.onRelease(held),
      burst: () => this.tryBurst(),
      pause: () => (this.mode === 'paused' ? this.resume() : this.pause()),
      mute: () => this.toggleSound(),
      anyGesture: () => this.audio.unlock(),
      cancelled: () => { this.audio.chargeEnd(); this.charging = false; },
    });

    this.renderer.onAutoDowngrade = (q) => { storage.settings.quality = q; storage.save(); this.applyQuality(); };
    this.applySettings(storage.settings);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (this.mode === 'playing') this.pause(); this.audio.suspend(); }
      else this.audio.resume();
    });

    this.toMenu();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ----------------------------------------------------------------- setup
  private resize() {
    const { h } = this.ui.layout(this.stage);
    this.renderer.resize(this.stage.clientWidth, this.stage.clientHeight);
    this.camera.aspect = ASPECT;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.renderer.getPixelRatio();
    this.fx.setViewportHeight(h * dpr, this.camera.fov);
  }

  private applyQuality() {
    const q = storage.settings.quality;
    this.renderer.setQuality(q);
    const p = QUALITY[q];
    this.destruction.maxShards = p.maxFragments;
    this.destruction.fragmentScale = p.fragments;
    this.fx.setBudget(p.particles);
    this.resize();
  }

  private applySettings(s: Settings) {
    storage.save();
    this.audio.setVolumes(s);
    this.cam.reducedMotion = s.reducedMotion;
    if (s.quality !== this.renderer.quality) this.applyQuality();
    this.ui.syncSettings();
  }

  private toggleSound() {
    storage.settings.muted = !storage.settings.muted;
    this.applySettings(storage.settings);
  }

  /** Atmosphere, lights and reflection environment for a palette. */
  private applyPalette(p: Palette) {
    this.sky.set({ top: p.sky[0], mid: p.sky[1], bottom: p.sky[2], sun: p.sun, sunDir: new THREE.Vector3(0.15, 0.22, -1) });
    (this.scene.fog as THREE.Fog).color.set(p.fog);
    this.hemi.color.set(p.hemi[0]); this.hemi.groundColor.set(p.hemi[1]);
    this.key.color.set(p.key);
    this.accentA.color.set(p.accent);
    this.accentB.color.set(p.swatch[4] ?? p.accent);
    this.fx.dust.setColor(p.dust);
    this.stage.style.background = '#' + p.fog.toString(16).padStart(6, '0');
    // Reflection probe: the sky plus a few bright cards so glass and orbs catch highlights.
    const envScene = new THREE.Scene();
    const s = new Sky();
    s.set({ top: p.sky[0], mid: p.sky[1], bottom: p.sky[2], sun: p.sun, sunDir: new THREE.Vector3(0.3, 0.5, -1) });
    envScene.add(s.mesh);
    const card = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.2), side: THREE.DoubleSide });
    const cardGeo = new THREE.PlaneGeometry(60, 18);
    for (const [x, y, z, ry] of [[0, 120, -200, 0], [-220, 60, 0, Math.PI / 2], [220, 40, -60, -Math.PI / 2], [0, 200, 0, 0]] as number[][]) {
      const m = new THREE.Mesh(cardGeo, card);
      m.position.set(x, y, z); m.rotation.y = ry; if (y > 150) m.rotation.x = Math.PI / 2;
      envScene.add(m);
    }
    const accent = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.accent).multiplyScalar(1.5) }));
    accent.position.set(160, -40, -160);
    envScene.add(accent);
    const rt = this.pmrem.fromScene(envScene, 0.035);
    this.envRT?.dispose();
    this.envRT = rt;
    materials.setEnv(rt.texture);
    s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose();
    cardGeo.dispose(); card.dispose(); accent.geometry.dispose(); (accent.material as THREE.Material).dispose();
  }

  private loadWorld(def: LevelDef) {
    this.world?.dispose();
    this.level = def;
    this.applyPalette(def.palette);
    this.world = buildWorld(def.theme, def.palette, def.length);
    this.scene.add(this.world.group);
  }

  private clearLevel() {
    this.runner?.dispose();
    this.runner = null;
    this.targets.length = 0;
    this.pendingWave.length = 0;
    this.burstWave = null;
    this.burstMesh.visible = false;
    this.projectiles.clear();
    this.destruction.clear();
    this.fx.clear();
    this.audio.chargeEnd();
    this.charging = false;
  }

  // ----------------------------------------------------------------- flow
  toMenu() {
    if (this.startTimer !== null) { clearTimeout(this.startTimer); this.startTimer = null; }
    this.clearLevel();
    const showcase = LEVELS[Math.min(storage.data.unlocked, 4) - 1];
    this.loadWorld(showcase);
    this.cam.reset(4.5, 0);
    this.mode = 'menu';
    this.input.enabled = false;
    this.input.cancel();
    this.audio.setDuck(1);
    this.audio.playSong('menu');
    this.ui.showHud(false);
    this.ui.hint('', 0);
    this.ui.setMenuMode(true);
    this.ui.fade(false);
    this.ui.showMenu(storage.data.unlocked);
  }

  startLevel(id: number) {
    if (this.startTimer !== null) return; // a level is already starting
    const def = LEVELS[clamp(id, 1, 4) - 1];
    this.audio.unlock();
    this.ui.hideScreens();
    this.input.enabled = false;
    this.input.cancel();
    this.ui.fade(true, '#ffffff', 350);
    this.startTimer = window.setTimeout(() => {
      this.startTimer = null;
      this.clearLevel();
      this.loadWorld(def);
      this.runner = new LevelRunner(this.ctx, def);
      // Pre-compile every material now so the first shatter or crack never hitches.
      this.renderer.renderer.compile(this.scene, this.camera);
      this.runner.onEncounterCleared = (e) => {
        if (e.cue === 'pulse') this.beatPulse = 1.5;
      };
      this.stats = freshStats();
      this.shown = { energy: -1, integrity: -1, pulse: -1, combo: -1, progress: -1 };
      this.levelTime = 0;
      this.hintIdleShown = false;
      this.regenT = 0;
      this.regenHintShown = false;
      this.chargeHintShown = false;
      this.burstHintShown = false;
      this.projectiles.aimPad = [0.35, 0.22, 0.15, 0.12][def.id - 1];
      this.cam.reset(def.speed, 0);
      this.mode = 'playing';
      this.input.enabled = true;
      this.input.cancel();
      this.audio.setDuck(1);
      this.audio.playSong(def.theme as SongId);
      this.ui.hideScreens();
      this.ui.setMenuMode(false);
      this.ui.setLevel(def.id, def.name, def.burst);
      this.ui.setCombo(1);
      this.ui.showHud(true);
      this.ui.fade(false, '#ffffff', 900);
      this.ui.hint('', 0);
      this.ui.comboPop(`LEVEL ${def.id} · ${def.name.toUpperCase()}`);
      setTimeout(() => { if (this.mode === 'playing' && this.levelTime < 4) this.ui.hint(def.intro, 3); }, 900);
    }, 360);
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.prevMode = this.mode;
    this.mode = 'paused';
    this.input.enabled = false;
    this.input.cancel();
    this.audio.chargeEnd();
    this.charging = false;
    this.audio.setDuck(0.35);
    this.ui.syncSettings();
    this.ui.show('pause');
    this.ui.setMenuMode(true);
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.mode = this.prevMode;
    this.input.enabled = true;
    this.audio.setDuck(1);
    this.ui.hideScreens();
    this.ui.setMenuMode(false);
    this.last = performance.now();
  }

  // ----------------------------------------------------------------- shooting
  private onPress() {
    if (this.mode !== 'playing') return;
    if (!this.level.charged) this.fire(false);
    else this.chargeReadyPlayed = false;
  }

  private onRelease(held: number) {
    if (this.mode !== 'playing') return;
    if (this.charging) { this.audio.chargeEnd(); this.charging = false; }
    if (!this.level.charged) return;
    this.fire(held >= BALANCE.chargeTime);
  }

  private fire(charged: boolean) {
    const s = this.stats;
    if (charged && s.energy < BALANCE.chargedCost) charged = false;
    const cost = charged ? BALANCE.chargedCost : BALANCE.shotCost;
    if (s.energy < cost) {
      this.audio.damageWarn();
      this.ui.hint('Out of energy — strike crystals to recharge', 2);
      return;
    }
    s.energy -= cost;
    s.shots++;
    this.raycaster.setFromCamera(new THREE.Vector2(this.input.ndc.x, this.input.ndc.y), this.camera);
    const dir = this.raycaster.ray.direction.clone();
    this.projectiles.fire(this.camera.position, dir, charged);
    const pan = clamp(this.input.ndc.x, -1, 1);
    if (charged) { this.audio.chargedLaunch(pan); this.cam.impulse(0.35); this.cam.shake(0.05); }
    else { this.audio.launch(pan); this.cam.impulse(0.08); }
    this.ui.fireReticle();
  }

  private onShotHit() {
    const s = this.stats;
    s.hitShots++;
    s.missStreak = 0;
    const before = this.multiplier();
    s.combo++;
    const after = this.multiplier();
    if (after > before) { this.ui.comboPop(`COMBO ×${after}`); this.audio.switchOn(after - 1); }
    if (this.level.burst && s.pulse < BALANCE.pulseHitsToFill) {
      s.pulse++;
      if (s.pulse >= BALANCE.pulseHitsToFill && !this.burstHintShown) {
        this.burstHintShown = true;
        this.ui.hint('Pulse charged! Press E, right-click or tap BURST', 3.5);
        this.audio.chargeReady();
      }
    }
  }

  private onMiss() {
    this.stats.combo = 0;
    this.stats.missStreak++;
    if (this.stats.missStreak >= 4 && this.cam.speed < 0.5) {
      this.ui.hint('Place the reticle right over the glowing target', 3);
      this.stats.missStreak = 0;
    }
  }

  private multiplier() {
    return Math.min(BALANCE.comboMaxMult, 1 + Math.floor(this.stats.combo / BALANCE.comboStep));
  }

  private toScreen(p: THREE.Vector3) {
    const v = this.tmpV2.copy(p).project(this.camera);
    return { x: (v.x + 1) / 2 * DESIGN_W, y: (1 - v.y) / 2 * DESIGN_H, behind: v.z > 1 };
  }

  private reward(kind: RewardKind, points: number, at: THREE.Vector3) {
    if (this.mode !== 'playing' && this.mode !== 'ending') return;
    const mult = this.multiplier();
    const pts = points * mult;
    this.stats.score += pts;
    if (kind === 'glass' || kind === 'reinforced') this.stats.destroyed++;
    const sp = this.toScreen(at);
    if (!sp.behind) this.ui.popup(sp.x, sp.y - 30, `+${pts}`, pts >= 500 ? 'big' : '');
  }

  private addEnergy(n: number, at: THREE.Vector3) {
    this.stats.energy = Math.min(BALANCE.maxEnergy, this.stats.energy + n);
    const sp = this.toScreen(at);
    if (!sp.behind) { this.ui.energyMotes(sp.x, sp.y, n); this.ui.popup(sp.x, sp.y + 30, `+${n} energy`, 'energy'); }
    setTimeout(() => this.ui.setEnergy(this.stats.energy, true), 550);
    this.shown.energy = this.stats.energy;
  }

  private resonate(at: THREE.Vector3, radius: number, color: number) {
    this.fx.wave(at, color, 0.5, radius * 1.15, 0.8);
    this.fx.flash(at, 0xffffff, 6, 0.4);
    this.fx.emit({ pos: at, count: 70, color, color2: 0xffffff, speed: [4, 12], size: [0.08, 0.2], life: [0.6, 1.2], drag: 1.8 });
    this.audio.resonance(clamp(this.toScreen(at).x / DESIGN_W * 2 - 1, -1, 1));
    this.cam.shake(0.12);
    this.beatPulse = 1.4;
    for (const t of this.targets) {
      if (!t.active || !t.breakable) continue;
      const d = t.wpos.distanceTo(at);
      if (d > radius) continue;
      this.pendingWave.push({ t, delay: d / 30, dir: t.wpos.clone().sub(at).normalize() });
    }
  }

  private tryBurst() {
    if (this.mode !== 'playing' || !this.level.burst) return;
    if (this.stats.pulse < BALANCE.pulseHitsToFill) {
      if (this.stats.pulse > 0) this.ui.hint('Land consecutive hits to fill the Pulse meter', 2);
      return;
    }
    this.stats.pulse = 0;
    this.burstWave = { front: this.cam.z - 1, t: 0, mesh: this.burstMesh };
    this.burstMesh.visible = true;
    this.audio.burst();
    this.cam.shake(0.2);
    this.beatPulse = 2;
    this.fx.flash(this.tmpV.set(0, 0, this.cam.z - 3), 0xf6c7ff, 8, 0.5);
  }

  // ----------------------------------------------------------------- per-frame gameplay
  private refreshTargets() {
    const cz = this.cam.z;
    for (const t of this.targets) {
      if (!t.active) continue;
      t.obj.getWorldPosition(t.wpos);
      // Orbs reach ~160 m ahead, so every box target in that range needs a current inverse matrix.
      if (t.shape === 'box' && t.wpos.z < cz + 20 && t.wpos.z > cz - 175) t.inv.copy(t.obj.matrixWorld).invert();
    }
  }

  private playerCollisions(dt: number) {
    const s = this.stats;
    s.invuln = Math.max(0, s.invuln - dt);
    const cp = this.camera.position;
    const prev = this.tmpV.set(cp.x, cp.y, this.cam.prevZ);
    for (const t of this.targets) {
      if (!t.active || !t.hazard || t.shape !== 'box') continue;
      if (Math.abs(t.wpos.z - cp.z) > 6) continue;
      const a = cp.clone().applyMatrix4(t.inv);
      const b = prev.clone().applyMatrix4(t.inv);
      const crossed = (a.z > 0) !== (b.z > 0) || Math.abs(a.z) < t.half.z + 0.25;
      if (!crossed) continue;
      if (Math.abs(a.x) > t.half.x + 0.12 || Math.abs(a.y) > t.half.y + 0.12) continue;
      t.onPlayerHit?.();
      t.active = false;
      if (s.invuln > 0) continue;
      s.integrity--;
      s.damaged = true;
      s.combo = 0;
      s.energy = Math.max(0, s.energy - BALANCE.collisionEnergyPenalty);
      s.invuln = BALANCE.invulnerableTime;
      this.audio.collision();
      this.cam.shake(0.45);
      this.cam.impulse(0.6);
      this.ui.damage();
      this.ui.setIntegrity(s.integrity, true);
      this.shown.integrity = s.integrity;
      if (s.integrity <= 0) { this.gameOver('Your integrity was depleted.'); return; }
      this.ui.hint(s.integrity === 1 ? 'Integrity critical — clear the glass ahead!' : 'Impact! Break glass before you reach it', 2.2);
    }
  }

  private updateWaves(dt: number) {
    for (let i = this.pendingWave.length - 1; i >= 0; i--) {
      const w = this.pendingWave[i];
      w.delay -= dt;
      if (w.delay > 0) continue;
      this.pendingWave.splice(i, 1);
      if (w.t.active) w.t.onHit({ point: w.t.wpos.clone(), dir: w.dir, charged: true, wave: true });
    }
    const bw = this.burstWave;
    if (bw) {
      bw.t += dt;
      const prevFront = bw.front;
      bw.front -= (60 + bw.t * 30) * dt;
      const k = bw.t / 0.95;
      const m = bw.mesh;
      m.position.set(0, 0.4, bw.front);
      const r = 2 + k * 9;
      m.scale.set(r, r, 1);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.min(k, 1) * Math.PI) * 0.9;
      this.fx.emit({ pos: this.tmpV.set((Math.random() - 0.5) * r * 1.6, 0.4 + (Math.random() - 0.5) * r * 1.2, bw.front), count: 6, color: 0xf6c7ff, color2: 0xffffff, speed: [0.5, 2], size: [0.1, 0.22], life: [0.3, 0.7] });
      for (const t of this.targets) {
        if (!t.active || !t.breakable) continue;
        if (t.wpos.z > prevFront || t.wpos.z <= bw.front) continue;
        if (Math.abs(t.wpos.x) > 10 || Math.abs(t.wpos.y) > 8) continue;
        t.onHit({ point: t.wpos.clone(), dir: new THREE.Vector3(0, 0, -1), charged: true, wave: true });
      }
      if (k >= 1) { this.burstWave = null; m.visible = false; }
    }
  }

  private stepPlaying(dt: number) {
    const runner = this.runner!;
    this.levelTime += dt;
    const ending = this.mode === 'ending';
    const hold = ending ? null : runner.holdPoint(this.cam.z);
    this.cam.update(dt, this.time, hold);
    const holding = hold !== null && this.cam.speed < 0.5;
    runner.update(dt, this.cam.z, this.stats.energy, this.projectiles.activeCount, holding);
    // While stopped at a gate, energy trickles back up to a small reserve so a gate can never be a dead end.
    if (holding && this.stats.energy < BALANCE.holdReserve) {
      this.regenT += dt;
      if (this.regenT >= BALANCE.holdRegenInterval) {
        this.regenT = 0;
        this.stats.energy++;
        this.ui.setEnergy(this.stats.energy, true);
        this.shown.energy = this.stats.energy;
        if (!this.regenHintShown) { this.regenHintShown = true; this.ui.hint('Energy recharges while you are stopped at a gate', 3); }
      }
    } else this.regenT = 0;
    this.scene.updateMatrixWorld();
    this.refreshTargets();
    this.projectiles.update(dt, this.targets, this.cam.z);
    this.updateWaves(dt);
    if (!ending) this.playerCollisions(dt);
    if (this.mode !== 'playing' && this.mode !== 'ending') return;

    // Charging feedback.
    const held = this.input.heldTime();
    let charge = -1;
    if (this.level.charged && this.input.pressing && held > BALANCE.tapMaxTime && !ending) {
      charge = clamp((held - BALANCE.tapMaxTime) / (BALANCE.chargeTime - BALANCE.tapMaxTime), 0, 1);
      if (!this.charging) { this.charging = true; this.audio.chargeStart(); }
      if (charge >= 1 && !this.chargeReadyPlayed) { this.chargeReadyPlayed = true; this.audio.chargeReady(); }
    }
    this.ui.setReticle(this.input.design.x, this.input.design.y, this.input.hasPointer && !ending, charge);

    // Idle tutorial nudge.
    if (holding && runner.holdTime > 6 && this.stats.shots === 0 && !this.hintIdleShown) {
      this.hintIdleShown = true;
      this.ui.hint(this.input.isTouch ? 'Tap directly on the glass to fire' : 'Click on the glass to fire a light orb', 4);
    }
    if (this.level.charged && !this.chargeHintShown && this.levelTime > 4.5) {
      this.chargeHintShown = true;
      this.ui.hint('Hold, then release to fire a Charged Shot', 3);
    }

    // End of level: camera flies through the open gateway.
    const fin = runner.finalEntity;
    if (!ending && fin && fin.cleared && this.cam.z < runner.finalZ + 6) this.beginEnding();
    if (ending) {
      this.endT += dt;
      this.cam.boost = Math.min(18, this.cam.boost + dt * 20);
      if (this.endT > 0.5 && this.endT - dt <= 0.5) this.ui.fade(true, this.level.id === 4 ? '#fff4e2' : '#ffffff', 900);
      if (this.endT > 1.6) { this.finishLevel(); return; }
    }
    this.syncHud();
  }

  private beginEnding() {
    this.mode = 'ending';
    this.endT = 0;
    this.input.enabled = false;
    this.input.cancel();
    this.audio.chargeEnd();
    this.charging = false;
    this.ui.hint('', 0);
    if (this.level.id === 4) this.audio.victory(); else this.audio.levelComplete();
  }

  private finishLevel() {
    const s = this.stats;
    s.score += SCORE.levelFinish + s.integrity * SCORE.perIntegrity + s.energy * SCORE.perEnergy;
    const accuracy = s.shots ? s.hitShots / s.shots : 0;
    const stars = 1 + (accuracy >= 0.55 ? 1 : 0) + (!s.damaged ? 1 : 0);
    const best = storage.record(this.level.id).best;
    storage.completeLevel(this.level.id, s.score, stars);
    this.clearLevel();
    this.mode = 'result';
    this.cam.reset(3, this.cam.z);
    this.cam.update(0, this.time, null);
    this.ui.showHud(false);
    this.ui.setMenuMode(true);
    this.ui.fade(false, '#ffffff', 1200);
    if (this.level.id === 4) {
      this.audio.playSong('victory');
      this.ui.showVictory(s.score);
      this.fx.emit({ pos: this.tmpV.set(0, 2, this.cam.z - 20), count: 200, color: 0xffd39b, color2: 0xf6a7db, speed: [3, 12], size: [0.12, 0.3], life: [1.5, 3], gravity: 1 });
    } else {
      this.ui.showComplete({ level: this.level.id, score: s.score, accuracy, destroyed: s.destroyed, stars, integrityLost: s.damaged, best });
    }
  }

  private gameOver(reason: string) {
    this.mode = 'result';
    this.input.enabled = false;
    this.input.cancel();
    this.audio.chargeEnd();
    this.audio.gameOver();
    this.audio.setDuck(0.4);
    this.ui.showHud(false);
    this.ui.hint('', 0);
    this.ui.setMenuMode(true);
    this.cam.reset(0, this.cam.z);
    this.ui.showGameOver(this.stats.score, reason);
  }

  private syncHud() {
    const s = this.stats, sh = this.shown;
    if (s.energy !== sh.energy) { this.ui.setEnergy(s.energy); sh.energy = s.energy; }
    if (s.integrity !== sh.integrity) { this.ui.setIntegrity(s.integrity); sh.integrity = s.integrity; }
    const mult = this.multiplier();
    if (mult !== sh.combo) { this.ui.setCombo(mult); sh.combo = mult; }
    if (s.pulse !== sh.pulse) { this.ui.setPulse(s.pulse / BALANCE.pulseHitsToFill, s.pulse >= BALANCE.pulseHitsToFill); sh.pulse = s.pulse; }
    const p = Math.round(this.runner!.progress(this.cam.z) * 200) / 200;
    if (p !== sh.progress) { this.ui.setProgress(p); sh.progress = p; }
    this.ui.setScore(s.score);
  }

  // ----------------------------------------------------------------- loop
  private loop(now: number) {
    requestAnimationFrame((t) => this.loop(t));
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(Math.max(raw, 0), 1 / 20);
    if (this.mode !== 'paused') this.renderer.monitor(raw);

    if (this.mode !== 'paused') {
      this.time += dt;
      const beats = this.audio.consumeBeats();
      if (beats > 0) this.beatPulse = Math.max(this.beatPulse, storage.settings.reducedMotion ? 0.4 : 1);
      this.beatPulse = Math.max(0, this.beatPulse - dt * 3.2);

      if (this.mode === 'menu' || this.mode === 'result') {
        this.cam.update(dt, this.time, null);
        if (this.cam.z < -this.level.length - 60) this.cam.reset(this.mode === 'menu' ? 4.5 : 3, 0);
      } else if (this.mode === 'playing' || this.mode === 'ending') {
        this.stepPlaying(dt);
      }
      const camZ = this.camera.position.z;
      this.key.position.set(8, 16, camZ + 6);
      this.key.target.position.set(0, 0, camZ - 20);
      this.accentA.position.set(-6, 3, camZ - 16);
      this.accentB.position.set(6, 2, camZ - 30);
      this.sky.update(this.camera.position, this.time, this.beatPulse);
      this.world?.update(dt, this.time, camZ, this.beatPulse);
      this.fx.update(dt, this.time, camZ);
      this.destruction.update(dt);
      if (this.mode === 'result' || this.mode === 'menu') this.projectiles.update(dt, [], camZ);
    }
    this.ui.tick(dt);
    this.renderer.render(dt);
  }
}
