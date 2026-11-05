import { createEntity, EnergyNode, Portal, PrismCore, type Entity } from '../gameplay/Obstacles';
import type { Encounter, GameContext, LevelDef } from '../gameplay/types';
import { BALANCE, SCORE } from '../utils/constants';

interface LiveEncounter {
  def: Encounter;
  z: number;
  entities: Entity[];
  hintShown: boolean;
  passed: boolean;
  bonusGiven: boolean;
}

/** Instantiates a level's encounters and drives hold points, hints and completion. */
export class LevelRunner {
  encounters: LiveEncounter[] = [];
  entities: Entity[] = [];
  finalEntity: Portal | PrismCore | null = null;
  finalZ = 0;
  private assist: EnergyNode | null = null;
  private assistCooldown = 0;
  holdTime = 0;
  onEncounterCleared?: (e: Encounter) => void;

  constructor(private ctx: GameContext, public def: LevelDef) {
    for (const enc of def.encounters) {
      const z = -enc.at;
      const live: LiveEncounter = { def: enc, z, entities: [], hintShown: false, passed: false, bonusGiven: false };
      for (const spec of enc.objects) {
        const e = createEntity(ctx, spec, z);
        live.entities.push(e);
        this.entities.push(e);
        if ((e instanceof Portal && e.final) || e instanceof PrismCore) { this.finalEntity = e; this.finalZ = e.z; }
      }
      this.encounters.push(live);
    }
  }

  private isCleared(e: LiveEncounter) {
    return e.entities.every((x) => !x.required || x.cleared);
  }

  /** Where the camera must stop (world z), or null when the way is clear. */
  holdPoint(camZ: number): number | null {
    for (const e of this.encounters) {
      if (!e.def.hold || this.isCleared(e)) continue;
      const stop = e.z + (e.entities.some((x) => x instanceof PrismCore) ? 19 : e.entities.some((x) => x instanceof Portal) ? 13 : 14);
      if (camZ > e.z - 1) return stop;
    }
    return null;
  }

  update(dt: number, camZ: number, energy: number, orbsInFlight: number, holding: boolean) {
    for (const ent of this.entities) {
      // Only animate what is near; far objects are frozen and fogged out.
      const d = camZ - ent.z;
      if (d > -12 && d < 200) ent.update(dt);
      else if (d <= -12 && ent.root.visible) ent.root.visible = false;
    }
    if (this.assist) this.assist.update(dt);

    for (const e of this.encounters) {
      const dist = camZ - e.z;
      if (!e.hintShown && e.def.hint && dist < (e.def.hold ? 46 : 40) && dist > 0) {
        this.ctx.hint(e.def.hint, e.def.hold ? 0 : 3.2);
        e.hintShown = true;
      }
      const cleared = this.isCleared(e);
      if (cleared && !e.bonusGiven && e.entities.some((x) => x.required)) {
        e.bonusGiven = true;
        if (e.def.hold && e.def.hint) this.ctx.hint('', 0);
        const pos = e.entities[0].root.position.clone();
        this.ctx.reward('switch', SCORE.encounterClear, pos);
        this.onEncounterCleared?.(e.def);
      }
      if (!e.passed && camZ < e.z - 2) e.passed = true;
    }

    // Anti soft-lock: if the player is stopped at a hold point without energy, offer a recharge crystal.
    this.holdTime = holding ? this.holdTime + dt : 0;
    this.assistCooldown -= dt;
    if (holding && energy < BALANCE.chargedCost && orbsInFlight === 0 && (!this.assist || this.assist.cleared) && this.assistCooldown <= 0) {
      this.assist?.dispose();
      const x = (Math.random() < 0.5 ? -1 : 1) * (4.6 + Math.random() * 0.8);
      this.assist = new EnergyNode(this.ctx, { kind: 'node', rare: true, scale: 0.8, pos: [x, -0.8 + Math.random() * 0.8, 0], motion: { kind: 'bob', amp: 0.3, speed: 2 } }, camZ - 10, { required: false });
      this.assistCooldown = 2.5;
      this.ctx.hint('A recharge crystal appeared — strike it', 2.5);
    }
  }

  /** 0..1 progress for the HUD. */
  progress(camZ: number) {
    return Math.min(1, Math.max(0, -camZ / Math.max(1, -this.finalZ)));
  }

  dispose() {
    for (const e of this.entities) e.dispose();
    this.assist?.dispose();
    this.entities.length = 0;
    this.encounters.length = 0;
  }
}
