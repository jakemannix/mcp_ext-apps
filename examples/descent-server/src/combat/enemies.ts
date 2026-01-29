/**
 * Enemy Definitions for Descent Combat System
 *
 * Defines enemy stats, behaviors, and AI parameters.
 * Uses types from GameTypes.ts (canonical source).
 */

import type {
  EnemyType,
  AIState,
  AIBehavior,
  Enemy,
  Vector3,
} from "../types/GameTypes.js";

// =============================================================================
// Enemy Stats Configuration
// =============================================================================

export interface EnemyStats {
  health: number;
  damage: number;
  speed: number;
  fireRate: number; // Shots per second
  detectionRange: number;
  attackRange: number;
  projectileSpeed: number;
  armor: number; // Damage reduction percentage (0-1)
}

export const ENEMY_STATS: Record<EnemyType, EnemyStats> = {
  drone: {
    health: 30,
    damage: 5,
    speed: 8,
    fireRate: 2,
    detectionRange: 25,
    attackRange: 15,
    projectileSpeed: 20,
    armor: 0,
  },
  turret: {
    health: 50,
    damage: 15,
    speed: 0, // Stationary
    fireRate: 1.5,
    detectionRange: 40,
    attackRange: 35,
    projectileSpeed: 25,
    armor: 0.2,
  },
  heavy: {
    health: 150,
    damage: 25,
    speed: 3,
    fireRate: 0.5,
    detectionRange: 30,
    attackRange: 20,
    projectileSpeed: 15,
    armor: 0.4,
  },
  cloaker: {
    health: 40,
    damage: 20,
    speed: 10,
    fireRate: 1,
    detectionRange: 15, // Short range - ambush predator
    attackRange: 10,
    projectileSpeed: 18,
    armor: 0,
  },
  boss: {
    health: 500,
    damage: 40,
    speed: 5,
    fireRate: 3,
    detectionRange: 50,
    attackRange: 40,
    projectileSpeed: 22,
    armor: 0.3,
  },
};

// =============================================================================
// Extended Enemy Type (internal use with additional tracking fields)
// =============================================================================

export interface CombatEnemy extends Enemy {
  lastFireTime: number;
  alertTime: number; // Time spent in alert state
  patrolPath?: Vector3[];
  patrolIndex: number;
}

// =============================================================================
// Enemy Factory
// =============================================================================

let enemyIdCounter = 0;

export function createEnemy(
  type: EnemyType,
  position: Vector3,
  behavior: AIBehavior
): CombatEnemy {
  const stats = ENEMY_STATS[type];

  return {
    id: `enemy-${++enemyIdCounter}`,
    type,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    health: stats.health,
    maxHealth: stats.health,
    aiState: behavior === "ambush" ? "idle" : "patrol",
    behavior,
    lastFireTime: 0,
    alertTime: 0,
    patrolIndex: 0,
  };
}

// =============================================================================
// Vector Utility Functions
// =============================================================================

export function vectorDistance(a: Vector3, b: Vector3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function vectorNormalize(v: Vector3): Vector3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function vectorSubtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vectorAdd(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vectorScale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vectorLength(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// =============================================================================
// AI Utility Functions
// =============================================================================

export function shouldFlee(enemy: CombatEnemy): boolean {
  // Flee when health below 20% (except turrets which can't move)
  if (enemy.type === "turret") return false;
  return enemy.health < enemy.maxHealth * 0.2;
}

export function canFire(enemy: CombatEnemy, currentTime: number): boolean {
  const stats = ENEMY_STATS[enemy.type];
  const fireInterval = 1 / stats.fireRate;
  return currentTime - enemy.lastFireTime >= fireInterval;
}

export function getEnemySpeed(enemy: CombatEnemy): number {
  return ENEMY_STATS[enemy.type].speed;
}

export function getEnemyDamage(enemy: CombatEnemy): number {
  return ENEMY_STATS[enemy.type].damage;
}

export function getDetectionRange(enemy: CombatEnemy): number {
  return ENEMY_STATS[enemy.type].detectionRange;
}

export function getAttackRange(enemy: CombatEnemy): number {
  return ENEMY_STATS[enemy.type].attackRange;
}

export function getEnemyArmor(enemy: CombatEnemy): number {
  return ENEMY_STATS[enemy.type].armor;
}
