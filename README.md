# LUMA RIFT

A first-person 3D glass-breaking adventure for the browser. You glide through four floating worlds of glass and light, launching luminous orbs to shatter barriers, recharge from energy crystals, and reopen the sealed pathways.

The game is built with TypeScript, Three.js (WebGL) and Vite. Every sound and all of the music are synthesized at runtime with the Web Audio API. No third-party audio, textures or models are used.

## Quick start

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + production bundle in dist/
npm run preview   # serve the production build
```

Requires a WebGL-capable browser. Desktop is the primary target; landscape tablets and phones are supported.

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Aim | Move the mouse (the reticle follows) | Tap where you want to fire |
| Launch an orb | Click, or press Space / Enter | Tap |
| Charged Shot (Level 3+) | Hold ~0.55 s, then release | Hold, then release |
| Resonance Burst (Level 2+) | E, Shift, F or right-click | Tap the BURST button |
| Pause | Esc or P | Pause button |
| Mute | M | Sound button |

## Levels

| # | World | New mechanics | Length |
| --- | --- | --- | --- |
| 1 | **Peach Horizon**: warm floating arches above the clouds | Interactive tutorial: shooting, energy nodes, barriers, a one-switch gateway | ~60 s |
| 2 | **Aqua Cascade**: crystal columns over rippling water | Sliding glass, moving targets, a two-part barrier, narrow framed windows, a two-switch portal, Resonance Burst | ~70 s |
| 3 | **Jade Spiral**: a rotating geometric garden | Rotating rotors, rising barriers, layered glass, reinforced glass with Charged Shot, Resonance Nodes, a sequenced three-switch portal | ~80 s |
| 4 | **Amethyst Nova**: a prism dimension | Everything combined, a timed switch gate, and the three-phase **Prism Core** finale | ~90 s+ |

Completing a level unlocks the next one. Progress, best scores, stars and settings are saved in `localStorage`.

## Gameplay systems

- **Energy.** You start with 32 (maximum 90). A standard shot costs 1 and a Charged Shot costs 3. Energy nodes give +5, and rare golden nodes give +8.
- **Integrity.** You have 3 points. Flying into intact glass costs 1 integrity and 3 energy, followed by a short invulnerability window. At 0 integrity the game is over.
- **Combo.** Every orb that hits something extends your combo. Each 4 consecutive hits raise the score multiplier, up to ×5. A miss resets it.
- **Pulse meter and Resonance Burst.** Ten hits fill the meter. Releasing it sends an energy wave forward that shatters every breakable object it reaches.
- **Glass types.**
  - Fragile glass breaks in one hit.
  - Reinforced glass (hexagon lattice with a gold frame) cracks visibly per hit. It needs 3 hits or one Charged Shot.
  - Resonance Nodes (tri-ring crystals) shatter everything around them.
- **Hold points.** The camera eases to a stop in front of tutorial targets, portals and the Prism Core until they are cleared. If you are out of energy there, a recharge crystal appears, so a level can never soft-lock.
- **Stars.** One star for clearing the level, one for 55%+ accuracy, and one for losing no integrity.

## Architecture

```
src/
  main.ts                 entry point, WebGL check
  core/
    Game.ts               state machine (menu/playing/paused/ending/result), main loop, scoring, collisions
    CameraController.ts   forward travel, eased starts/stops, sway, impulses
    Input.ts              pointer/touch/keyboard, letterbox-correct aim mapping
  render/
    Renderer.ts           WebGLRenderer + bloom composer, quality presets, auto-downgrade
    Environment.ts        procedural architecture for the four worlds (instanced meshes, custom shaders)
    Sky.ts                gradient sky dome with sun glow and music pulse
    Materials.ts          shared glass / reinforced / orb materials
    Textures.ts           procedural canvas textures (glass streaks, hex lattice, sprites)
    Effects.ts            pooled flashes, shockwaves; owns particle systems
    Particles.ts          GPU-drawn CPU-simulated particle pool, ambient dust
  gameplay/
    types.ts              level data schema, Target / GameContext contracts
    Obstacles.ts          Pane, GlassPanel, EnergyNode, ResonanceNode, Rotor, WindowFrame, Portal, PrismCore
    Projectiles.ts        orb pool, swept sub-stepped collision, bounce/pass responses
    Destruction.ts        Voronoi glass fracture, shard rigid-body motion, staged release
  levels/
    LevelOne..Four.ts     data-driven encounter lists
    LevelData.ts          level registry
    LevelRunner.ts        spawns encounters, hold points, hints, clear bonuses, anti-soft-lock assist
  audio/
    AudioManager.ts       procedural SFX (layered glass breaks, launches, chimes...) with reverb
    Music.ts              lookahead step sequencer: per-level ambient electronic songs, beat events
  ui/
    UI.ts, styles.css     HUD, menus, level select, settings, results, victory (1920x1080 layer scaled to the stage)
  utils/                  constants (balance), math helpers, storage
```

Key technical notes:

- **Strict 16:9.** The stage is letterboxed to 16:9 at any window size. The UI is authored at 1920×1080 and scaled uniformly. Pointer coordinates are mapped through the canvas rectangle, so aim stays exact.
- **Aiming.** Orbs travel along the exact camera ray under the pointer, with no gravity until they bounce.
- **Collision.** Box targets are tested in their own local frame, so sliding, rotating and orbiting obstacles collide correctly. Orbs are sub-stepped at 0.18 m so they never tunnel through thin glass. Player-vs-glass checks detect when the camera crosses each pane.
- **Glass fracture.** Each break clips a Voronoi diagram (seeds clustered at the impact point) against the pane and extrudes the cells into prisms. The shards receive impulses along the shot and outward in the glass plane, spin, fall under gravity, bounce once, and fade. Shards farther from the impact release slightly later, so cracks appear to propagate.
- **Performance.**
  - Most architecture uses `InstancedMesh` draws.
  - Materials are shared, and particle and flash pools are fixed-size.
  - The shard cap depends on the quality preset.
  - Distant obstacles are not updated.
  - Shaders are pre-compiled when a level loads.
  - Simulation time steps are clamped.
  - The game auto-pauses when the tab is hidden.
- **Quality presets** (Settings):
  - **High**: 4× MSAA and bloom, DPR up to 2.
  - **Balanced**: bloom, DPR 1.25.
  - **Performance**: direct render, DPR 1, fewer shards and particles.
  - If frame rate stays low, the game steps down a preset automatically.

## Accessibility and comfort

- Reduced-motion option: minimal sway and shake, and no UI animation.
- Volume sliders for master, music and effects, plus a mute toggle.
- Shape cues: reinforced glass shows a hexagon lattice with gold edges, energy nodes are octahedral crystals with a ring, and resonance nodes have three rings.
- No strobing. Screen shake is limited.
- Aim tolerance is generous in early levels.
- You can pause at any time.

## Originality

LUMA RIFT is inspired by the genre and feel of first-person glass-breaking games, but its name, worlds, architecture, level layouts, obstacle designs, mechanics (Charged Shot, Resonance Nodes, Resonance Burst, timed and sequenced portals, the Prism Core), UI, effects, sounds and music are all original. Everything is generated procedurally in code.

## Known limitations

- On integrated GPUs at 1080p, the High preset (4× MSAA plus bloom) can drop below 60 FPS. The game steps down to Balanced or Performance automatically, which ran at roughly 70 and 135 FPS respectively on an Intel UHD test machine.
- Shards are simplified rigid bodies (no shard-to-shard collision).
- The title font loads from Google Fonts. Offline, it falls back to the system UI font.
