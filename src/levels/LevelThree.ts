import type { LevelDef } from '../gameplay/types';

const PI = Math.PI;

export const LEVEL_THREE: LevelDef = {
  id: 3, name: 'Jade Spiral', tagline: 'Kinetic, geometric, precise', theme: 'jade',
  speed: 10.5, length: 790, charged: true, burst: true,
  intro: 'New: hold to charge, release to fire.',
  palette: {
    sky: [0x6fd6b6, 0xe6ffe9, 0xa4eacb], sun: 0xfff3c4, fog: 0xd0f6e0,
    hemi: [0xf2fff6, 0x38cfa5], key: 0xfffbe8, accent: 0xffc982,
    glass: 0x7fc6ff, reinforced: 0xc9b6ff, node: 0xff6fb0, dust: 0xf3ffe0,
    swatch: [0x88e7bf, 0x38cfa5, 0xd9ffaf, 0xb5f4d9, 0xffc982],
  },
  encounters: [
    { at: 62, hint: 'Rotating glass — clear the blades in your way', objects: [
      { kind: 'rotor', pos: [0, -2.2, 0], blades: 4, length: 3.4, width: 1.1, speed: 0.9 },
      { kind: 'node', pos: [3.6, 2.4, -3] },
    ] },
    { at: 120, hint: 'Rising barrier — watch its rhythm', objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [6, 2.6], motion: { kind: 'slide', axis: 'y', amp: 2.6, speed: 1.2 } },
      { kind: 'node', pos: [-4, 2, -3] },
    ] },
    { at: 176, hint: 'Layered glass — fire twice', objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [5, 4] },
      { kind: 'glass', pos: [0, 0, -1.8], size: [5, 4] },
      { kind: 'node', pos: [0, 3.2, -6] },
    ] },
    { at: 236, hold: true, hint: 'Reinforced glass — hold, then release for a Charged Shot', objects: [
      { kind: 'node', rare: true, pos: [-4.2, 2.2, 4] },
      { kind: 'reinforced', pos: [0, 0, 0], size: [4.6, 3.8] },
    ] },
    { at: 296, hint: 'Small targets — steady aim', objects: [
      { kind: 'node', scale: 0.65, pos: [-2.6, 2.1, 0] },
      { kind: 'node', scale: 0.65, pos: [2.6, -1, -3] },
      { kind: 'glass', pos: [0, 0.5, -6], size: [1.8, 1.8] },
      { kind: 'glass', pos: [0, -0.2, -12], size: [2.2, 2.2] },
    ] },
    { at: 356, hint: 'Resonance node — one strike shatters everything nearby', objects: [
      { kind: 'resonance', pos: [0, 2.8, 4], radius: 9 },
      { kind: 'glass', pos: [-2.5, -0.2, 0], size: [2.6, 3.2] },
      { kind: 'glass', pos: [2.5, -0.2, 0], size: [2.6, 3.2] },
      { kind: 'glass', pos: [0, -0.4, -2], size: [3, 3.2] },
      { kind: 'glass', pos: [0, 2.6, -1], size: [5, 1.6] },
    ] },
    { at: 416, cue: 'pulse', objects: [
      { kind: 'node', pos: [-3, 1, 0], motion: { kind: 'bob', amp: 0.6, speed: 2 } },
      { kind: 'node', pos: [3, 1, -4], motion: { kind: 'bob', amp: 0.6, speed: 2, phase: 2 } },
      { kind: 'node', rare: true, pos: [0, 2.6, -9] },
    ] },
    { at: 476, objects: [
      { kind: 'rotor', pos: [0, 2.2, 0], blades: 3, length: 3.6, width: 1.2, speed: -1.1 },
      { kind: 'reinforced', pos: [-4.4, -1, -6], size: [2.6, 2.6] },
      { kind: 'node', pos: [4, -1, -6] },
    ] },
    { at: 540, objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [6, 2.4], motion: { kind: 'slide', axis: 'y', amp: 2.6, speed: 1.4 } },
      { kind: 'glass', pos: [0, 0, -7], size: [6, 2.4], motion: { kind: 'slide', axis: 'y', amp: 2.6, speed: 1.4, phase: PI } },
      { kind: 'node', pos: [4.2, 2.6, -4] },
    ] },
    { at: 604, objects: [
      { kind: 'resonance', pos: [3.6, 2.6, 3], radius: 7.5 },
      { kind: 'reinforced', pos: [0, 0, 0], size: [4.2, 3.6] },
      { kind: 'glass', pos: [0, 0, -2], size: [4.2, 3.6] },
      { kind: 'node', rare: true, pos: [-3.8, 2.4, -5] },
    ] },
    { at: 668, objects: [
      { kind: 'rotor', pos: [0, -2.2, 0], blades: 4, length: 3.4, width: 1.0, speed: 1.3 },
      { kind: 'glass', pos: [0, 0, -7], size: [3.4, 3.4], motion: { kind: 'slide', axis: 'x', amp: 2.6, speed: 1.3 } },
    ] },
    { at: 770, hold: true, hint: 'Multi-step portal — light the switches in order: 1 → 2 → 3', objects: [{ kind: 'portal', pos: [0, 0.4, 0], switches: 3, mode: 'sequence', final: true }] },
  ],
};
