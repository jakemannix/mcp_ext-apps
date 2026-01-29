/**
 * Descent Game - Shared Type Definitions
 *
 * CANONICAL SOURCE: All polecats must import types from this file.
 * See DESIGN.md for integration specifications.
 */

// =============================================================================
// Core Data Types
// =============================================================================

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Entity {
  id: string;
  position: Vector3;
  rotation: Vector3; // Euler angles in radians
  velocity: Vector3;
}

// =============================================================================
// Game Configuration Types
// =============================================================================

export type Theme =
  | "alien_hive"
  | "space_station"
  | "ancient_ruins"
  | "procedural_mix";
export type Difficulty = "easy" | "normal" | "hard";
export type Direction = "north" | "south" | "east" | "west" | "up" | "down";

// =============================================================================
// Area Types
// =============================================================================

export type AreaType = "corridor" | "room" | "junction" | "shaft" | "cavern";
export type AreaShape =
  | "box"
  | "cylinder"
  | "L-shaped"
  | "T-junction"
  | "cross";
export type HazardType = "lava" | "radiation" | "forceField" | "darkness";
export type ExitType = "open" | "door" | "locked" | "destroyed";

export interface Exit {
  direction: Direction;
  type: ExitType;
  targetAreaId: string | null; // null = unexplored
}

export interface AreaData {
  id: string;
  type: AreaType;
  name?: string;
  shape: AreaShape;
  dimensions: { width: number; height: number; length: number };
  position: Vector3;
  theme: Theme;
  hazards?: HazardType[];
  exits: Exit[];
}

// =============================================================================
// Weapon & Inventory Types (for Inventory System - slit)
// =============================================================================

export type WeaponType =
  | "laser" // Primary, infinite ammo
  | "vulcan" // Primary, rapid fire
  | "plasma" // Primary, high damage
  | "fusion" // Primary, charge shot
  | "concussion" // Secondary, dumb missile
  | "homing" // Secondary, tracking missile
  | "smart"; // Secondary, bouncing missile

export type AmmoType =
  | "vulcan"
  | "plasma"
  | "fusion"
  | "concussion"
  | "homing"
  | "smart";

export type PowerUpType = "quad_damage" | "invulnerability" | "cloak";

export interface Weapon {
  type: WeaponType;
  level: number; // upgrade level
  damage: number;
  fireRate: number; // shots per second
  ammoType: AmmoType | null; // null for laser (infinite)
}

export interface ActivePowerUp {
  type: PowerUpType;
  remainingTime: number; // seconds
}

export interface InventoryData {
  weapons: Weapon[];
  primaryIndex: number;
  secondaryIndex: number | null;
  ammo: Record<AmmoType, number>;
  powerUps: ActivePowerUp[];
}

// =============================================================================
// Enemy & Combat Types (for Combat System - rictus)
// =============================================================================

export type EnemyType = "drone" | "turret" | "heavy" | "cloaker" | "boss";

export type AIState =
  | "idle"
  | "patrol"
  | "alert"
  | "chase"
  | "attack"
  | "flee"
  | "dead";

export type AIBehavior = "patrol" | "guard" | "ambush" | "swarm";

export interface Enemy extends Entity {
  type: EnemyType;
  health: number;
  maxHealth: number;
  aiState: AIState;
  behavior: AIBehavior;
  targetPosition?: Vector3;
  fireAt?: Vector3;
}

export type DamageType = "kinetic" | "energy" | "explosive";

export interface DamageEvent {
  source: "player" | "enemy" | "hazard";
  sourceId: string;
  targetId: string;
  amount: number;
  type: DamageType;
  position: Vector3;
}

export interface DamageResult {
  actualDamage: number; // After shields/armor
  killed: boolean;
  shieldDamage: number;
  healthDamage: number;
}

export interface Projectile extends Entity {
  weaponType: WeaponType;
  ownerId: string;
  damage: number;
  damageType: DamageType;
  lifetime: number; // remaining seconds
  speed: number;
}

export interface HitResult {
  projectileId: string;
  targetId: string;
  targetType: "player" | "enemy" | "wall";
  position: Vector3;
  damage: number;
}

// =============================================================================
// Player State
// =============================================================================

export interface PlayerState {
  position: Vector3;
  rotation: Vector3;
  velocity: Vector3;
  health: number;
  maxHealth: number;
  shields: number;
  maxShields: number;
  inventory: InventoryData;
  score: number;
}

// =============================================================================
// Session Types (for Storage System - nux)
// =============================================================================

export interface Session {
  id: string;
  theme: Theme;
  difficulty: Difficulty;
  createdAt: number;
  lastPlayed: number;
  score: number;
  explorationDepth: number;
}

// =============================================================================
// Tool Input/Output Types (for MCP Server)
// =============================================================================

export interface StartGameInput {
  theme?: Theme;
  difficulty?: Difficulty;
}

export interface StartGameOutput {
  sessionId: string;
  startingArea: AreaData;
  player: PlayerState;
  narrative: string;
}

export interface GenerationContext {
  playerHealth: number;
  recentCombat: boolean;
  explorationDepth: number;
  visitedAreaTypes: string[];
}

export interface GenerateAreaInput {
  sessionId: string;
  fromAreaId: string;
  direction: Direction;
  context: GenerationContext;
}

export interface GenerateAreaOutput {
  area: AreaData;
  enemies: Enemy[];
  powerUps: PickupItem[];
  narrative?: string;
  connections: Direction[];
}

export interface PickupItem {
  id: string;
  type: "health" | "shield" | "ammo" | "weapon" | "powerup" | "key";
  position: Vector3;
  value?: number;
  weaponType?: WeaponType;
  ammoType?: AmmoType;
  powerUpType?: PowerUpType;
}

// =============================================================================
// System Interfaces (for cross-system integration)
// =============================================================================

/**
 * Storage System Interface (implemented by nux)
 */
export interface GameStorage {
  createSession(theme: Theme, difficulty: Difficulty): Promise<Session>;
  loadSession(sessionId: string): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;

  saveArea(sessionId: string, area: AreaData): Promise<void>;
  getArea(sessionId: string, areaId: string): Promise<AreaData | null>;
  getAreasForSession(sessionId: string): Promise<AreaData[]>;

  savePlayerState(sessionId: string, state: PlayerState): Promise<void>;
  loadPlayerState(sessionId: string): Promise<PlayerState | null>;
}

/**
 * Inventory System Interface (implemented by slit)
 */
export interface InventoryManager {
  getWeapons(): Weapon[];
  getCurrentPrimary(): Weapon;
  getCurrentSecondary(): Weapon | null;
  selectPrimary(index: number): void;
  selectSecondary(index: number): void;

  getAmmo(type: AmmoType): number;
  useAmmo(type: AmmoType, amount: number): boolean;
  addAmmo(type: AmmoType, amount: number): void;

  activatePowerUp(type: PowerUpType): void;
  getActivePowerUps(): ActivePowerUp[];
  updatePowerUps(dt: number): void;

  serialize(): InventoryData;
  deserialize(data: InventoryData): void;
}

/**
 * Combat System Interface (implemented by rictus)
 */
export interface CombatManager {
  spawnEnemy(type: EnemyType, position: Vector3, behavior: AIBehavior): Enemy;
  updateEnemies(dt: number, playerPos: Vector3): void;
  getEnemies(): Enemy[];

  applyDamage(event: DamageEvent): DamageResult;

  fireWeapon(weapon: Weapon, origin: Vector3, direction: Vector3): Projectile;
  updateProjectiles(dt: number): void;
  getProjectiles(): Projectile[];

  checkHit(projectile: Projectile): HitResult | null;
}

// =============================================================================
// Direction Utilities
// =============================================================================

export const DIRECTION_VECTORS: Record<Direction, Vector3> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
};

export const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  up: "down",
  down: "up",
};

export function getDirectionVector(direction: Direction): Vector3 {
  return DIRECTION_VECTORS[direction];
}

export function getOppositeDirection(direction: Direction): Direction {
  return OPPOSITE_DIRECTION[direction];
}

// =============================================================================
// Default Values
// =============================================================================

export function createDefaultInventory(): InventoryData {
  return {
    weapons: [
      { type: "laser", level: 1, damage: 10, fireRate: 5, ammoType: null },
    ],
    primaryIndex: 0,
    secondaryIndex: null,
    ammo: {
      vulcan: 0,
      plasma: 0,
      fusion: 0,
      concussion: 0,
      homing: 0,
      smart: 0,
    },
    powerUps: [],
  };
}

export function createDefaultPlayer(
  startPosition: Vector3,
  difficulty: Difficulty,
): PlayerState {
  const healthMultiplier =
    difficulty === "easy" ? 1.5 : difficulty === "hard" ? 0.75 : 1;
  return {
    position: startPosition,
    rotation: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    health: Math.round(100 * healthMultiplier),
    maxHealth: Math.round(100 * healthMultiplier),
    shields: Math.round(100 * healthMultiplier),
    maxShields: Math.round(100 * healthMultiplier),
    inventory: createDefaultInventory(),
    score: 0,
  };
}
