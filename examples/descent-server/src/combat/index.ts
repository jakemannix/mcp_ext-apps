/**
 * Combat System Module - Descent Game
 *
 * Exports the CombatManager implementation and related types.
 */

// Main export: CombatManager implementation
export { Combat } from "./Combat.js";

// Re-export types from GameTypes for convenience
export type {
  CombatManager,
  EnemyType,
  AIState,
  AIBehavior,
  Enemy,
  DamageEvent,
  DamageResult,
  Projectile,
  HitResult,
  Weapon,
  WeaponType,
  DamageType,
  Vector3,
} from "../types/GameTypes.js";

// Export enemy stats and utilities
export { ENEMY_STATS, type EnemyStats, type CombatEnemy } from "./enemies.js";

// Export projectile utilities
export {
  WEAPON_STATS,
  WEAPON_DAMAGE_TYPES,
  type WeaponStats,
  type CombatProjectile,
} from "./projectiles.js";
