import type * as THREE from 'three';
import type { EffectsManager } from '../render/Effects';
import type { DestructionSystem } from './Destruction';
import type { AudioManager } from '../audio/AudioManager';

export interface HitInfo {
  point: THREE.Vector3;
  dir: THREE.Vector3;
  charged: boolean;
  /** true when caused by a resonance wave rather than an orb */
  wave?: boolean;
}

/** What the orb does after touching a target. */
export type HitResponse = 'pass' | 'stop' | 'bounce';

/**
 * Anything an orb can collide with. Box targets are tested in the local
 * frame of `obj`, so moving/rotating parents work automatically.
 */
export interface Target {
  obj: THREE.Object3D;
  shape: 'box' | 'sphere';
  /** half extents for boxes; x = radius for spheres */
  half: THREE.Vector3;
  active: boolean;
  /** Intact hazards damage the player when the camera passes through them. */
  hazard: boolean;
  /** Can be shattered by a Resonance wave / pulse. */
  breakable: boolean;
  onHit(h: HitInfo): HitResponse;
  onPlayerHit?(): void;
  // cached per frame by the collision system
  inv: THREE.Matrix4;
  wpos: THREE.Vector3;
}

export type RewardKind = 'glass' | 'reinforced' | 'crack' | 'node' | 'rareNode' | 'resonance' | 'switch' | 'prism';

/** Services handed to obstacles. Keeps entities decoupled from the Game class. */
export interface GameContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  fx: EffectsManager;
  destruction: DestructionSystem;
  audio: AudioManager;
  time: number;
  register(t: Target): void;
  reward(kind: RewardKind, points: number, at: THREE.Vector3): void;
  addEnergy(amount: number, at: THREE.Vector3): void;
  /** Shatter every breakable target within radius of a point (Resonance pulse). */
  resonate(at: THREE.Vector3, radius: number, color: number): void;
  shake(amount: number): void;
  /** Short contextual instruction near the reticle. */
  hint(text: string, seconds?: number): void;
  palette: Palette;
  reducedMotion: boolean;
}

// ---------------------------------------------------------------- level data

export type Vec3 = [number, number, number];

export type Motion =
  | { kind: 'slide'; axis: 'x' | 'y'; amp: number; speed: number; phase?: number }
  | { kind: 'spin'; axis: 'x' | 'y' | 'z'; speed: number }
  | { kind: 'orbit'; radius: number; speed: number; phase?: number }
  | { kind: 'bob'; amp: number; speed: number; phase?: number };

interface Base { pos: Vec3; motion?: Motion }

export type ObjSpec =
  | (Base & { kind: 'glass'; size: [number, number]; tilt?: number })
  | (Base & { kind: 'reinforced'; size: [number, number]; hp?: number; tilt?: number })
  | (Base & { kind: 'node'; rare?: boolean; scale?: number })
  | (Base & { kind: 'resonance'; radius?: number })
  | (Base & { kind: 'rotor'; blades: number; length: number; width: number; speed: number; reinforced?: boolean })
  | (Base & { kind: 'frame'; size: [number, number]; window: [number, number]; glass?: boolean })
  | (Base & { kind: 'portal'; switches: number; mode: 'all' | 'sequence' | 'timed'; window?: number; radius?: number; final?: boolean })
  | (Base & { kind: 'prism' });

export interface Encounter {
  /** distance along the path (world z = -at) */
  at: number;
  objects: ObjSpec[];
  /** camera stops in front until every required object is cleared */
  hold?: boolean;
  /** contextual instruction shown when the encounter comes into view */
  hint?: string;
  /** tutorial: stop showing the hint once this encounter is cleared */
  tutorial?: boolean;
  /** env flourish triggered when encounter is cleared */
  cue?: 'pulse' | 'bloom';
}

export type ThemeId = 'peach' | 'aqua' | 'jade' | 'amethyst';

export interface Palette {
  sky: [number, number, number]; // top, mid(horizon), bottom
  sun: number;
  fog: number;
  hemi: [number, number];
  key: number;
  accent: number;
  glass: number;
  reinforced: number;
  node: number;
  dust: number;
  swatch: number[];
}

export interface LevelDef {
  id: number;
  name: string;
  tagline: string;
  theme: ThemeId;
  speed: number;
  length: number;
  palette: Palette;
  charged: boolean;
  burst: boolean;
  intro: string;
  encounters: Encounter[];
}
