/**
 * Inventory System for Descent Game
 *
 * Exports the InventoryManager interface and implementation.
 */

// Main inventory manager
export {
  type InventoryManager,
  Inventory,
  createInventory,
  loadInventory,
} from "./Inventory.js";

// Weapon definitions and utilities
export {
  WEAPON_DEFINITIONS,
  PRIMARY_WEAPONS,
  SECONDARY_WEAPONS,
  DEFAULT_AMMO,
  MAX_AMMO,
  AMMO_PICKUP_AMOUNTS,
  getWeaponDefinition,
  isPrimaryWeapon,
  isSecondaryWeapon,
} from "./weapons.js";

// Re-export relevant types from GameTypes for convenience
export type {
  Weapon,
  WeaponType,
  WeaponCategory,
  AmmoType,
  DamageType,
  InventoryPowerUpType,
  ActivePowerUp,
  InventoryData,
} from "../types/GameTypes.js";
