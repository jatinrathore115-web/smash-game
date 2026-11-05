import type { LevelDef } from '../gameplay/types';

export const LEVEL_ONE: LevelDef = {
  id: 1, name: 'Peach Horizon', tagline: 'Warm, simple, welcoming', theme: 'peach',
  speed: 8.5, length: 490, charged: false, burst: false,
  intro: 'Your journey begins.',
  palette: {
    sky: [0xf4a9c0, 0xffe4cc, 0xffc2ac], sun: 0xfff0cf, fog: 0xffdccb,
    hemi: [0xfff3e8, 0xffb6a0], key: 0xfff2dc, accent: 0xffc982,
    glass: 0x6fdcef, reinforced: 0xb7a6ff, node: 0xff5f9e, dust: 0xfff3d6,
    swatch: [0xffb6a0, 0xff927d, 0xffe9c6, 0xf9b8ce, 0x86e5f2],
  },
  encounters: [
    { at: 48, hold: true, tutorial: true, hint: 'Tap to launch a light orb', objects: [{ kind: 'glass', pos: [0, 0.3, 0], size: [4.4, 3.4] }] },
    { at: 100, hold: true, tutorial: true, hint: 'Hit energy nodes to recharge', objects: [{ kind: 'node', pos: [0, 0.8, 0], scale: 1.45 }] },
    { at: 152, hold: true, tutorial: true, hint: 'Break the barrier to clear your path', objects: [{ kind: 'glass', pos: [0, 0, 0], size: [7.2, 4.8] }] },
    { at: 200, hint: 'Great! The path is yours.', objects: [
      { kind: 'glass', pos: [-3.3, 0.5, 0], size: [2.8, 2.8] },
      { kind: 'glass', pos: [3.3, 0.5, -5], size: [2.8, 2.8] },
      { kind: 'node', pos: [0, 2.6, -2.5] },
    ] },
    { at: 252, objects: [
      { kind: 'node', pos: [-5, 1.6, 5] }, { kind: 'node', pos: [5, 1.6, 5] },
      { kind: 'glass', pos: [0, 0, 0], size: [8.6, 5] },
    ] },
    { at: 306, cue: 'pulse', objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [3.2, 3.2] },
      { kind: 'glass', pos: [-3, 1.3, -6], size: [2.6, 2.6] },
      { kind: 'node', rare: true, pos: [2.8, 2.2, -10] },
    ] },
    { at: 360, objects: [
      { kind: 'glass', pos: [-3.5, -0.3, 0], size: [2.7, 3.2], tilt: 0.12 },
      { kind: 'glass', pos: [0, 0.4, -3], size: [2.8, 3.4] },
      { kind: 'glass', pos: [3.5, -0.3, 0], size: [2.7, 3.2], tilt: -0.12 },
      { kind: 'node', pos: [0, 3.1, -7] },
    ] },
    { at: 414, objects: [
      { kind: 'glass', pos: [0, 0, 0], size: [6.4, 4.6] },
      { kind: 'node', pos: [0, 0.2, -6] },
      { kind: 'glass', pos: [0, 0, -13], size: [6.4, 4.6] },
    ] },
    { at: 478, hold: true, hint: 'Strike the switch to open the gateway', objects: [{ kind: 'portal', pos: [0, 0.4, 0], switches: 1, mode: 'all', final: true }] },
  ],
};
