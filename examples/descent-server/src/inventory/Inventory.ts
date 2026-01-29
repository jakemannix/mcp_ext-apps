/**
 * Inventory Manager Implementation for Descent Game
 *
 * Manages weapons, ammo, and power-ups for the player.
 */

import type {
  Weapon,
  WeaponType,
  AmmoType,
  InventoryPowerUpType,
  ActivePowerUp,
  InventoryData,
} from "../types/GameTypes.js";

import {
  WEAPON_DEFINITIONS,
  PRIMARY_WEAPONS,
  SECONDARY_WEAPONS,
  DEFAULT_AMMO,
  MAX_AMMO,
  isSecondaryWeapon,
} from "./weapons.js";

/**
 * Power-up durations in seconds
 */
const POWERUP_DURATIONS: Record<InventoryPowerUpType, number> = {
  quad_damage: 30,
  invulnerability: 20,
  cloak: 25,
};

/**
 * InventoryManager interface as specified in DESIGN.md
 */
export interface InventoryManager {
  // Weapon management
  getWeapons(): Weapon[];
  getCurrentPrimary(): Weapon;
  getCurrentSecondary(): Weapon | null;
  selectPrimary(index: number): void;
  selectSecondary(index: number): void;

  // Ammo
  getAmmo(type: AmmoType): number;
  useAmmo(type: AmmoType, amount: number): boolean;
  addAmmo(type: AmmoType, amount: number): void;

  // Power-ups
  activatePowerUp(type: InventoryPowerUpType): void;
  getActivePowerUps(): ActivePowerUp[];
  updatePowerUps(dt: number): void;
  hasPowerUp(type: InventoryPowerUpType): boolean;

  // Power-up queries (for Combat integration)
  getDamageMultiplier(): number;
  isInvulnerable(): boolean;
  isInvisible(): boolean;

  // Weapon unlocking
  unlockWeapon(type: WeaponType): void;
  hasWeapon(type: WeaponType): boolean;

  // Serialization
  serialize(): InventoryData;
  deserialize(data: InventoryData): void;
}

/**
 * Implementation of the InventoryManager
 */
export class Inventory implements InventoryManager {
  private unlockedWeapons: Set<WeaponType>;
  private currentPrimaryIndex: number;
  private currentSecondaryIndex: number;
  private ammo: Map<AmmoType, number>;
  private activePowerUps: ActivePowerUp[];

  constructor() {
    // Start with only the laser (always available)
    this.unlockedWeapons = new Set<WeaponType>(["laser"]);
    this.currentPrimaryIndex = 0;
    this.currentSecondaryIndex = -1; // No secondary by default
    this.ammo = new Map<AmmoType, number>();
    this.activePowerUps = [];

    // Initialize ammo counts to 0
    for (const [type, amount] of Object.entries(DEFAULT_AMMO)) {
      this.ammo.set(type as AmmoType, amount);
    }
  }

  // ===========================================================================
  // Weapon Management
  // ===========================================================================

  /**
   * Get all unlocked weapons as Weapon objects
   */
  getWeapons(): Weapon[] {
    return Array.from(this.unlockedWeapons).map(
      (type) => WEAPON_DEFINITIONS[type]
    );
  }

  /**
   * Get unlocked primary weapons in order
   */
  private getUnlockedPrimaries(): WeaponType[] {
    return PRIMARY_WEAPONS.filter((w) => this.unlockedWeapons.has(w));
  }

  /**
   * Get unlocked secondary weapons in order
   */
  private getUnlockedSecondaries(): WeaponType[] {
    return SECONDARY_WEAPONS.filter((w) => this.unlockedWeapons.has(w));
  }

  /**
   * Get the currently selected primary weapon
   */
  getCurrentPrimary(): Weapon {
    const primaries = this.getUnlockedPrimaries();
    const index = Math.min(this.currentPrimaryIndex, primaries.length - 1);
    const type = primaries[Math.max(0, index)] || "laser";
    return WEAPON_DEFINITIONS[type];
  }

  /**
   * Get the currently selected secondary weapon, or null if none available
   */
  getCurrentSecondary(): Weapon | null {
    const secondaries = this.getUnlockedSecondaries();
    if (secondaries.length === 0 || this.currentSecondaryIndex < 0) {
      return null;
    }
    const index = Math.min(this.currentSecondaryIndex, secondaries.length - 1);
    const type = secondaries[index];
    return type ? WEAPON_DEFINITIONS[type] : null;
  }

  /**
   * Select a primary weapon by index (among unlocked primaries)
   */
  selectPrimary(index: number): void {
    const primaries = this.getUnlockedPrimaries();
    if (index >= 0 && index < primaries.length) {
      this.currentPrimaryIndex = index;
    }
  }

  /**
   * Select a secondary weapon by index (among unlocked secondaries)
   * Pass -1 to deselect secondary
   */
  selectSecondary(index: number): void {
    const secondaries = this.getUnlockedSecondaries();
    if (index === -1 || (index >= 0 && index < secondaries.length)) {
      this.currentSecondaryIndex = index;
    }
  }

  /**
   * Unlock a new weapon
   */
  unlockWeapon(type: WeaponType): void {
    this.unlockedWeapons.add(type);

    // If this is the first secondary, auto-select it
    if (isSecondaryWeapon(type) && this.currentSecondaryIndex === -1) {
      this.currentSecondaryIndex = 0;
    }
  }

  /**
   * Check if a weapon is unlocked
   */
  hasWeapon(type: WeaponType): boolean {
    return this.unlockedWeapons.has(type);
  }

  // ===========================================================================
  // Ammo Management
  // ===========================================================================

  /**
   * Get current ammo count for a type
   */
  getAmmo(type: AmmoType): number {
    return this.ammo.get(type) ?? 0;
  }

  /**
   * Use ammo. Returns false if insufficient ammo.
   */
  useAmmo(type: AmmoType, amount: number): boolean {
    const current = this.getAmmo(type);
    if (current < amount) {
      return false;
    }
    this.ammo.set(type, current - amount);
    return true;
  }

  /**
   * Add ammo, respecting maximum capacity
   */
  addAmmo(type: AmmoType, amount: number): void {
    const current = this.getAmmo(type);
    const max = MAX_AMMO[type] ?? 999;
    this.ammo.set(type, Math.min(current + amount, max));
  }

  // ===========================================================================
  // Power-Up Management
  // ===========================================================================

  /**
   * Activate a power-up. If already active, refresh duration.
   */
  activatePowerUp(type: InventoryPowerUpType): void {
    const duration = POWERUP_DURATIONS[type];

    // Check if already active
    const existing = this.activePowerUps.find((p) => p.type === type);
    if (existing) {
      // Refresh to full duration
      existing.remainingTime = duration;
      existing.totalDuration = duration;
    } else {
      // Add new power-up
      this.activePowerUps.push({
        type,
        remainingTime: duration,
        totalDuration: duration,
      });
    }
  }

  /**
   * Get all currently active power-ups
   */
  getActivePowerUps(): ActivePowerUp[] {
    return [...this.activePowerUps];
  }

  /**
   * Update power-up durations, removing expired ones
   */
  updatePowerUps(dt: number): void {
    for (const powerUp of this.activePowerUps) {
      powerUp.remainingTime -= dt;
    }

    // Remove expired power-ups
    this.activePowerUps = this.activePowerUps.filter(
      (p) => p.remainingTime > 0
    );
  }

  /**
   * Check if a specific power-up is active
   */
  hasPowerUp(type: InventoryPowerUpType): boolean {
    return this.activePowerUps.some((p) => p.type === type);
  }

  /**
   * Get damage multiplier based on active power-ups.
   * Returns 4 if quad_damage is active, otherwise 1.
   */
  getDamageMultiplier(): number {
    return this.hasPowerUp("quad_damage") ? 4 : 1;
  }

  /**
   * Check if player is currently invulnerable.
   */
  isInvulnerable(): boolean {
    return this.hasPowerUp("invulnerability");
  }

  /**
   * Check if player is currently invisible (cloaked).
   */
  isInvisible(): boolean {
    return this.hasPowerUp("cloak");
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  /**
   * Serialize inventory state for storage
   */
  serialize(): InventoryData {
    const ammoRecord: Record<AmmoType, number> = {
      vulcan: this.getAmmo("vulcan"),
      plasma: this.getAmmo("plasma"),
      fusion: this.getAmmo("fusion"),
      concussion: this.getAmmo("concussion"),
      homing: this.getAmmo("homing"),
      smart: this.getAmmo("smart"),
    };

    return {
      unlockedWeapons: Array.from(this.unlockedWeapons),
      currentPrimaryIndex: this.currentPrimaryIndex,
      currentSecondaryIndex: this.currentSecondaryIndex,
      ammo: ammoRecord,
      activePowerUps: this.activePowerUps.map((p) => ({ ...p })),
    };
  }

  /**
   * Deserialize inventory state from storage
   */
  deserialize(data: InventoryData): void {
    // Restore unlocked weapons
    this.unlockedWeapons = new Set<WeaponType>(data.unlockedWeapons);

    // Ensure laser is always available
    this.unlockedWeapons.add("laser");

    // Restore selected weapons
    this.currentPrimaryIndex = data.currentPrimaryIndex;
    this.currentSecondaryIndex = data.currentSecondaryIndex;

    // Restore ammo
    for (const [type, amount] of Object.entries(data.ammo)) {
      this.ammo.set(type as AmmoType, amount);
    }

    // Restore active power-ups
    this.activePowerUps = data.activePowerUps.map((p) => ({ ...p }));
  }
}

/**
 * Create a new inventory with default state
 */
export function createInventory(): InventoryManager {
  return new Inventory();
}

/**
 * Create an inventory from saved data
 */
export function loadInventory(data: InventoryData): InventoryManager {
  const inventory = new Inventory();
  inventory.deserialize(data);
  return inventory;
}
