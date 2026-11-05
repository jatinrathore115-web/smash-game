import type { LevelDef } from '../gameplay/types';

const PI = Math.PI;

export const LEVEL_FOUR: LevelDef = {
  id: 4, name: 'Amethyst Nova', tagline: 'Spectacular, complex, rewarding', theme: 'amethyst',
  speed: 11, length: 900, charged: true, burst: true,
  intro: 'Restore the Prism Core.',
  palette: {
    sky: [0x8a6fe6, 0xf3e0ff, 0xc4a6f4], sun: 0xffe2b8, fog: 0xe4d0fa,
    hemi: [0xf7eeff, 0xaf94f6], key: 0xfff0e0, accent: 0xf6a7db,
    glass: 0x6fdcff, reinforced: 0xf6a7db, node: 0x4ff0b8, dust: 0xfff2dc,
    swatch: [0xaf94f6, 0xd6b7ff, 0xf6a7db, 0xffd39b, 0x8deaff],
  },
  encounters: [
    { at: 62, objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [3, 3.4], motion: { kind: 'slide', axis: 'x', amp: 3, speed: 1.4 } },
      { kind: 'rotor', pos: [0, -2.2, -11], blades: 4, length: 3.4, width: 1, speed: 1.1 },
    ] },
    { at: 124, objects: [
      { kind: 'resonance', pos: [-3.6, 2.6, 3], radius: 7.5 },
      { kind: 'node', pos: [3.6, 2.4, 3] },
      { kind: 'reinforced', pos: [0, 0, 0], size: [5, 4] },
    ] },
    { at: 186, hold: true, hint: 'Timed switches — strike both before they fade', objects: [
      { kind: 'portal', pos: [0, 0.4, 0], switches: 2, mode: 'timed', window: 4.5 },
    ] },
    { at: 246, objects: [
      { kind: 'node', pos: [0, 0.5, 0], motion: { kind: 'orbit', radius: 3, speed: 1.2 } },
      { kind: 'node', rare: true, pos: [0, 0.5, -4], motion: { kind: 'orbit', radius: 3, speed: 1.2, phase: PI } },
      { kind: 'glass', pos: [0, 0, -10], size: [3.4, 3], motion: { kind: 'slide', axis: 'y', amp: 2.2, speed: 1.3 } },
    ] },
    { at: 306, objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [3.4, 3.4], motion: { kind: 'slide', axis: 'x', amp: 3, speed: 1.5 } },
      { kind: 'reinforced', pos: [0, 0, -3], size: [4, 3.6] },
      { kind: 'node', pos: [-4, 2.8, -1] },
      { kind: 'node', rare: true, pos: [4, 2.8, 4] },
    ] },
    { at: 368, objects: [
      { kind: 'rotor', pos: [0, -2.2, 0], blades: 4, length: 3.4, width: 1, speed: 1.2 },
      { kind: 'rotor', pos: [0, 2.2, -6], blades: 4, length: 3.4, width: 1, speed: -1.2 },
      { kind: 'node', pos: [4.4, 0, -3] },
      { kind: 'node', pos: [-4.4, 2.6, 3] },
    ] },
    { at: 430, cue: 'pulse', objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [6, 2.4], motion: { kind: 'slide', axis: 'y', amp: 2.6, speed: 1.5 } },
      { kind: 'reinforced', pos: [0, 0, -8], size: [3.6, 3.6], motion: { kind: 'slide', axis: 'x', amp: 2, speed: 0.9 } },
      { kind: 'node', rare: true, pos: [-4.2, 2.6, -4] },
    ] },
    { at: 492, hint: 'Find the resonance', objects: [
      { kind: 'resonance', pos: [0, 3.2, 2], radius: 10 },
      { kind: 'glass', pos: [-2.6, -0.6, 0], size: [2.4, 2.8] },
      { kind: 'glass', pos: [0, -0.6, -1], size: [2.4, 2.8] },
      { kind: 'glass', pos: [2.6, -0.6, 0], size: [2.4, 2.8] },
      { kind: 'glass', pos: [-2.6, 2.2, -2], size: [2.4, 2.4] },
      { kind: 'glass', pos: [2.6, 2.2, -2], size: [2.4, 2.4] },
      { kind: 'reinforced', pos: [0, 0, -4], size: [3.2, 3.2] },
    ] },
    { at: 552, objects: [
      { kind: 'node', pos: [-3, 1.2, 0], motion: { kind: 'bob', amp: 0.7, speed: 2 } },
      { kind: 'node', pos: [3, 1.2, -3], motion: { kind: 'bob', amp: 0.7, speed: 2, phase: 1.4 } },
      { kind: 'node', rare: true, pos: [0, 2.8, -7] },
      { kind: 'node', pos: [0, -1, -11], motion: { kind: 'slide', axis: 'x', amp: 2.5, speed: 1.4 } },
    ] },
    { at: 612, objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [3, 3.4], motion: { kind: 'slide', axis: 'x', amp: 3.4, speed: 1.6 } },
      { kind: 'glass', pos: [0, 0, -7], size: [3, 3.4], motion: { kind: 'slide', axis: 'x', amp: 3.4, speed: 1.6, phase: 2 } },
      { kind: 'glass', pos: [0, 0, -14], size: [3, 3.4], motion: { kind: 'slide', axis: 'x', amp: 3.4, speed: 1.6, phase: 4 } },
      { kind: 'node', rare: true, pos: [0, 3.2, -4] },
    ] },
    { at: 680, objects: [
      { kind: 'resonance', pos: [-3.8, 2.6, 4], radius: 8.5 },
      { kind: 'reinforced', pos: [0, 0, 0], size: [4.4, 3.6] },
      { kind: 'reinforced', pos: [0, 0, -2], size: [4.4, 3.6] },
      { kind: 'node', rare: true, pos: [3.8, 2.4, -4] },
    ] },
    { at: 748, objects: [
      { kind: 'glass', pos: [0, 0, 6], size: [3, 3], motion: { kind: 'slide', axis: 'x', amp: 3, speed: 1.4 } },
      { kind: 'frame', pos: [0, 0, 0], size: [18, 11], window: [3.2, 3.2], glass: true },
      { kind: 'node', pos: [0, 0, -5] },
    ] },
    { at: 840, hold: true, hint: 'The Prism Core — awaken its three guardian nodes', objects: [{ kind: 'prism', pos: [0, 1.5, 0] }] },
  ],
};
