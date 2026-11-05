import type { LevelDef } from '../gameplay/types';
import { LEVEL_ONE } from './LevelOne';
import { LEVEL_TWO } from './LevelTwo';
import { LEVEL_THREE } from './LevelThree';
import { LEVEL_FOUR } from './LevelFour';

/**
 * The four handcrafted levels, in order. Encounter `at` is the distance along the path;
 * object `pos` is [x, y, dz] relative to the encounter (negative dz = further away).
 * The camera eye travels along x = 0, y = 0, so anything covering that point is a hazard.
 */
export const LEVELS: LevelDef[] = [LEVEL_ONE, LEVEL_TWO, LEVEL_THREE, LEVEL_FOUR];
