/**
 * Projectile Physics for Descent Combat System
 *
 * Handles projectile creation, physics, and collision detection.
 * Uses types from GameTypes.ts (canonical source).
 */

import type {
  Vector3,
  Weapon,
  WeaponType,
  DamageType,
  Projectile,
  HitResult,
} from "../types/GameTypes.js";
import { vectorAdd, vectorScale, vectorNormalize, vectorDistance } from "./enemies.js";

// =============================================================================
// Extended Projectile Type (internal use with homing tracking)
// =============================================================================

export interface CombatProjectile extends Projectile {
  direction: Vector3;
  radius: number;
  maxLifetime: number;
  homing: boolean;
  homingStrength: number;
  targetId?: string;
}

// =============================================================================
// Weapon Stats (extended from base Weapon for projectile physics)
// =============================================================================

export interface WeaponStats {
  projectileSpeed: number;
  projectileRadius: number;
  lifetime: number;
  homing: boolean;
  homingStrength: number;
}

export const WEAPON_STATS: Record<WeaponType, WeaponStats> = {
  laser: {
    projectileSpeed: 50,
    projectileRadius: 0.2,
    lifetime: 2,
    homing: false,
    homingStrength: 0,
  },
  vulcan: {
    projectileSpeed: 60,
    projectileRadius: 0.1,
    lifetime: 1.5,
    homing: false,
    homingStrength: 0,
  },
  plasma: {
    projectileSpeed: 35,
    projectileRadius: 0.4,
    lifetime: 3,
    homing: false,
    homingStrength: 0,
  },
  fusion: {
    projectileSpeed: 30,
    projectileRadius: 0.6,
    lifetime: 4,
    homing: false,
    homingStrength: 0,
  },
  concussion: {
    projectileSpeed: 25,
    projectileRadius: 0.5,
    lifetime: 5,
    homing: false,
    homingStrength: 0,
  },
  homing: {
    projectileSpeed: 20,
    projectileRadius: 0.5,
    lifetime: 8,
    homing: true,
    homingStrength: 3,
  },
  smart: {
    projectileSpeed: 15,
    projectileRadius: 0.6,
    lifetime: 10,
    homing: true,
    homingStrength: 5,
  },
};

// Damage type mapping for weapons
export const WEAPON_DAMAGE_TYPES: Record<WeaponType, DamageType> = {
  laser: "energy",
  vulcan: "kinetic",
  plasma: "energy",
  fusion: "energy",
  concussion: "explosive",
  homing: "explosive",
  smart: "explosive",
};

// =============================================================================
// Projectile Factory
// =============================================================================

let projectileIdCounter = 0;

export function createProjectile(
  weapon: Weapon,
  ownerId: string,
  origin: Vector3,
  direction: Vector3,
  targetId?: string
): CombatProjectile {
  const stats = WEAPON_STATS[weapon.type];
  const normalizedDir = vectorNormalize(direction);

  return {
    id: `proj-${++projectileIdCounter}`,
    weaponType: weapon.type,
    ownerId,
    position: { ...origin },
    rotation: { x: 0, y: 0, z: 0 },
    velocity: vectorScale(normalizedDir, stats.projectileSpeed),
    damage: weapon.damage,
    damageType: WEAPON_DAMAGE_TYPES[weapon.type],
    lifetime: stats.lifetime,
    speed: stats.projectileSpeed,
    direction: normalizedDir,
    radius: stats.projectileRadius,
    maxLifetime: stats.lifetime,
    homing: stats.homing,
    homingStrength: stats.homingStrength,
    targetId,
  };
}

// Create a simple enemy projectile (enemies use basic laser-like shots)
export function createEnemyProjectile(
  enemyId: string,
  origin: Vector3,
  direction: Vector3,
  damage: number
): CombatProjectile {
  const normalizedDir = vectorNormalize(direction);

  return {
    id: `proj-${++projectileIdCounter}`,
    weaponType: "laser",
    ownerId: enemyId,
    position: { ...origin },
    rotation: { x: 0, y: 0, z: 0 },
    velocity: vectorScale(normalizedDir, 25), // Enemy projectile speed
    damage,
    damageType: "energy",
    lifetime: 3,
    speed: 25,
    direction: normalizedDir,
    radius: 0.3,
    maxLifetime: 3,
    homing: false,
    homingStrength: 0,
  };
}

// =============================================================================
// Projectile Physics
// =============================================================================

export function updateProjectile(
  projectile: CombatProjectile,
  dt: number,
  targetPosition?: Vector3
): void {
  // Decrease lifetime
  projectile.lifetime -= dt;

  // Apply homing behavior if applicable
  if (projectile.homing && targetPosition) {
    const toTarget = vectorNormalize({
      x: targetPosition.x - projectile.position.x,
      y: targetPosition.y - projectile.position.y,
      z: targetPosition.z - projectile.position.z,
    });

    // Gradually turn towards target
    const turnAmount = projectile.homingStrength * dt;
    projectile.direction = vectorNormalize({
      x: projectile.direction.x + toTarget.x * turnAmount,
      y: projectile.direction.y + toTarget.y * turnAmount,
      z: projectile.direction.z + toTarget.z * turnAmount,
    });

    // Update velocity based on new direction
    projectile.velocity = vectorScale(projectile.direction, projectile.speed);
  }

  // Move projectile
  projectile.position = vectorAdd(
    projectile.position,
    vectorScale(projectile.velocity, dt)
  );
}

export function isProjectileExpired(projectile: CombatProjectile): boolean {
  return projectile.lifetime <= 0;
}

// =============================================================================
// Collision Detection
// =============================================================================

export interface CollisionTarget {
  id: string;
  type: "player" | "enemy";
  position: Vector3;
  radius: number;
}

export function checkProjectileCollision(
  projectile: CombatProjectile,
  targets: CollisionTarget[]
): HitResult | null {
  for (const target of targets) {
    // Don't hit the source
    if (target.id === projectile.ownerId) continue;

    // Sphere-sphere collision
    const distance = vectorDistance(projectile.position, target.position);
    const collisionDistance = projectile.radius + target.radius;

    if (distance <= collisionDistance) {
      return {
        projectileId: projectile.id,
        targetId: target.id,
        targetType: target.type,
        position: { ...projectile.position },
        damage: projectile.damage,
      };
    }
  }

  return null;
}
