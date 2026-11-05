import type { LevelDef } from '../gameplay/types';

const PI = Math.PI;

export const LEVEL_TWO: LevelDef = {
  id: 2, name: 'Aqua Cascade', tagline: 'Cool, flowing, dynamic', theme: 'aqua',
  speed: 9.5, length: 640, charged: false, burst: true,
  intro: 'Glass in motion — time your shots.',
  palette: {
    sky: [0x5ec3ea, 0xd4f7ff, 0x9fe4ee], sun: 0xfff4e0, fog: 0xc4eff9,
    hemi: [0xeefcff, 0x5fc8d8], key: 0xffffff, accent: 0x78f0d6,
    glass: 0x8aa8ff, reinforced: 0xc4a8ff, node: 0xff8a5c, dust: 0xe8fdff,
    swatch: [0x64daf5, 0x83e9ff, 0x78f0d6, 0xc8f3ff, 0xffbb92],
  },
  encounters: [
    { at: 60, hint: 'Moving glass — time your shot', objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [3.2, 3.4], motion: { kind: 'slide', axis: 'x', amp: 3.2, speed: 1.1 } },
      { kind: 'node', pos: [0, 2.8, -4] },
    ] },
    { at: 118, objects: [
      { kind: 'node', pos: [0, 1.9, 0], motion: { kind: 'slide', axis: 'x', amp: 3, speed: 1.3 } },
      { kind: 'node', pos: [0, -1, -6], motion: { kind: 'slide', axis: 'x', amp: 3, speed: 1.3, phase: PI } },
      { kind: 'glass', pos: [-4.6, 0.6, -3], size: [2.4, 2.6] },
      { kind: 'glass', pos: [4.6, 0.6, -3], size: [2.4, 2.6] },
    ] },
    { at: 176, objects: [
      { kind: 'glass', pos: [-2.6, 0.4, 0], size: [2.6, 3] },
      { kind: 'glass', pos: [2.6, 0.4, -7], size: [2.6, 3] },
      { kind: 'glass', pos: [0, 0, -14], size: [3.4, 3.4] },
      { kind: 'node', rare: true, pos: [0, 2.8, -18] },
    ] },
    { at: 238, hint: 'Two-part barrier — break both halves', objects: [
      { kind: 'glass', pos: [-3.3, 0, 0], size: [3.4, 4.4], motion: { kind: 'slide', axis: 'x', amp: 1.6, speed: 1.2, phase: 0 } },
      { kind: 'glass', pos: [3.3, 0, 0], size: [3.4, 4.4], motion: { kind: 'slide', axis: 'x', amp: 1.6, speed: 1.2, phase: PI } },
      { kind: 'node', pos: [0, 3.2, -4] },
    ] },
    { at: 298, hint: 'Narrow opening — aim true', objects: [
      { kind: 'node', pos: [-4.2, 3.2, 5] }, { kind: 'node', pos: [4.2, 3.2, 5] },
      { kind: 'frame', pos: [0, 0, 0], size: [16, 10], window: [2.8, 2.8], glass: true },
    ] },
    { at: 360, cue: 'pulse', objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [3, 3.4], motion: { kind: 'slide', axis: 'x', amp: 3.6, speed: 1.6 } },
      { kind: 'node', rare: true, pos: [0, 3, -4], motion: { kind: 'slide', axis: 'x', amp: 2, speed: 1 } },
      { kind: 'glass', pos: [0, 0, -8], size: [3, 3.4], motion: { kind: 'slide', axis: 'x', amp: 3.6, speed: 1.6, phase: 1.7 } },
    ] },
    { at: 428, objects: [
      { kind: 'node', pos: [0, 2.2, 6], motion: { kind: 'slide', axis: 'x', amp: 2.6, speed: 1.4 } },
      { kind: 'frame', pos: [0, 0, 0], size: [16, 10], window: [3, 3], glass: true },
      { kind: 'glass', pos: [0, 0, -8], size: [3, 3], motion: { kind: 'slide', axis: 'x', amp: 2.2, speed: 1.2 } },
    ] },
    { at: 492, objects: [
      { kind: 'node', pos: [-3, 1, 0], motion: { kind: 'bob', amp: 0.8, speed: 2 } },
      { kind: 'node', pos: [3, 1, -3], motion: { kind: 'bob', amp: 0.8, speed: 2, phase: 1.5 } },
      { kind: 'node', pos: [0, 2.6, -6], motion: { kind: 'slide', axis: 'x', amp: 2.4, speed: 1.5 } },
      { kind: 'node', rare: true, pos: [0, -1, -10] },
    ] },
    { at: 552, objects: [
      { kind: 'glass', pos: [-2.2, 0, 0], size: [2.6, 3.6], motion: { kind: 'slide', axis: 'x', amp: 2.2, speed: 1.3 } },
      { kind: 'glass', pos: [2.2, 0, -4], size: [2.6, 3.6], motion: { kind: 'slide', axis: 'x', amp: 2.2, speed: 1.3, phase: PI } },
      { kind: 'glass', pos: [0, 0, -9], size: [4, 3.6] },
    ] },
    { at: 625, hold: true, hint: 'Energy-gated portal — light both switches', objects: [{ kind: 'portal', pos: [0, 0.4, 0], switches: 2, mode: 'all', final: true }] },
  ],
};
