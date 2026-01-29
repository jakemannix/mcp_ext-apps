/**
 * Weapon Definitions for Descent Game
 *
 * All weapon stats: damage, fire rate, ammo cost, projectile speed, etc.
 */

import type { Weapon, WeaponType } from "../types/GameTypes.js";

/**
 * Complete weapon definitions for all weapon types.
 * Stats are balanced for Descent-style gameplay.
 */
export const WEAPON_DEFINITIONS: Record<WeaponType, Weapon> = {
  // ==========================================================================
  // PRIMARY WEAPONS
  // ==========================================================================

  laser: {
    type: "laser",
    category: "primary",
    name: "Laser Cannon",
    damage: 8,
    fireRate: 6,           // 6 shots per second
    ammoType: null,        // Infinite ammo
    ammoPerShot: 0,
    projectileSpeed: 800,
    damageType: "energy",
  },

  vulcan: {
    type: "vulcan",
    category: "primary",
    name: "Vulcan Cannon",
    damage: 4,
    fireRate: 20,          // 20 shots per second (rapid fire)
    ammoType: "vulcan",
    ammoPerShot: 1,
    projectileSpeed: 1000,
    damageType: "kinetic",
  },

  plasma: {
    type: "plasma",
    category: "primary",
    name: "Plasma Cannon",
    damage: 25,
    fireRate: 2,           // 2 shots per second (slow but powerful)
    ammoType: "plasma",
    ammoPerShot: 1,
    projectileSpeed: 500,
    damageType: "energy",
  },

  fusion: {
    type: "fusion",
    category: "primary",
    name: "Fusion Cannon",
    damage: 50,            // Base damage, increases with charge
    fireRate: 1,           // Charge weapon, 1 shot per second max
    ammoType: "fusion",
    ammoPerShot: 2,
    projectileSpeed: 600,
    damageType: "energy",
  },

  // ==========================================================================
  // SECONDARY WEAPONS (Missiles)
  // ==========================================================================

  concussion: {
    type: "concussion",
    category: "secondary",
    name: "Concussion Missile",
    damage: 40,
    fireRate: 2,           // 2 missiles per second
    ammoType: "concussion",
    ammoPerShot: 1,
    projectileSpeed: 400,
    damageType: "explosive",
  },

  homing: {
    type: "homing",
    category: "secondary",
    name: "Homing Missile",
    damage: 35,
    fireRate: 1.5,         // 1.5 missiles per second
    ammoType: "homing",
    ammoPerShot: 1,
    projectileSpeed: 350,  // Slower but tracks
    damageType: "explosive",
  },

  smart: {
    type: "smart",
    category: "secondary",
    name: "Smart Missile",
    damage: 60,
    fireRate: 0.75,        // Slower fire rate, powerful
    ammoType: "smart",
    ammoPerShot: 1,
    projectileSpeed: 300,  // Slow but bounces and seeks
    damageType: "explosive",
  },
};

/**
 * Get all primary weapons in order
 */
export const PRIMARY_WEAPONS: WeaponType[] = ["laser", "vulcan", "plasma", "fusion"];

/**
 * Get all secondary weapons in order
 */
export const SECONDARY_WEAPONS: WeaponType[] = ["concussion", "homing", "smart"];

/**
 * Default ammo amounts when starting a new game
 */
export const DEFAULT_AMMO: Record<string, number> = {
  vulcan: 0,
  plasma: 0,
  fusion: 0,
  concussion: 0,
  homing: 0,
  smart: 0,
};

/**
 * Maximum ammo capacity for each type
 */
export const MAX_AMMO: Record<string, number> = {
  vulcan: 2000,
  plasma: 100,
  fusion: 50,
  concussion: 20,
  homing: 15,
  smart: 10,
};

/**
 * Ammo gained from pickups
 */
export const AMMO_PICKUP_AMOUNTS: Record<string, number> = {
  vulcan: 100,
  plasma: 10,
  fusion: 5,
  concussion: 4,
  homing: 3,
  smart: 2,
};

/**
 * Get weapon definition by type
 */
export function getWeaponDefinition(type: WeaponType): Weapon {
  return WEAPON_DEFINITIONS[type];
}

/**
 * Check if a weapon type is a primary weapon
 */
export function isPrimaryWeapon(type: WeaponType): boolean {
  return PRIMARY_WEAPONS.includes(type);
}

/**
 * Check if a weapon type is a secondary weapon
 */
export function isSecondaryWeapon(type: WeaponType): boolean {
  return SECONDARY_WEAPONS.includes(type);
}
