/** Design resolution of the 16:9 stage. */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;
export const ASPECT = DESIGN_W / DESIGN_H;

export const BALANCE = {
  startEnergy: 32,
  maxEnergy: 90,
  integrity: 3,
  shotCost: 1,
  chargedCost: 3,
  commonPickup: 5,
  rarePickup: 8,
  collisionEnergyPenalty: 3,
  invulnerableTime: 1.4,
  pulseHitsToFill: 10,
  chargeTime: 0.55,
  holdReserve: 6,
  holdRegenInterval: 0.6,
  tapMaxTime: 0.22,
  maxProjectiles: 24,
  projectileSpeed: 68,
  chargedSpeed: 74,
  projectileRadius: 0.22,
  chargedRadius: 0.42,
  projectileLife: 2.6,
  comboStep: 4,
  comboMaxMult: 5,
};

export const SCORE = {
  glass: 100,
  reinforced: 250,
  crack: 20,
  node: 120,
  rareNode: 200,
  resonance: 300,
  switch: 150,
  encounterClear: 200,
  levelFinish: 1000,
  perIntegrity: 500,
  perEnergy: 10,
  prismPhase: 800,
};

/** World layout: the path runs along -Z, the camera eye sits at y = 0. */
export const FLOOR_Y = -3.2;
