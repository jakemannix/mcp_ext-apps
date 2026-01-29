/**
 * Game Types for Descent MCP-Apps Game
 *
 * These types define the data structures used for LLM-generated world content.
 */

// =============================================================================
// Basic Types
// =============================================================================

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export type Direction = "north" | "south" | "east" | "west" | "up" | "down";

export type GameTheme =
  | "alien_hive"
  | "space_station"
  | "ancient_ruins"
  | "procedural_mix";

export type Difficulty = "easy" | "normal" | "hard";

export type AreaType =
  | "corridor"
  | "room"
  | "junction"
  | "shaft"
  | "cavern";

export type AreaShape =
  | "box"
  | "cylinder"
  | "L-shaped"
  | "T-junction"
  | "cross";

export type VisualTheme =
  | "industrial"
  | "organic"
  | "tech"
  | "ancient"
  | "corrupted";

export type Hazard = "lava" | "radiation" | "forceField" | "darkness";

export type ExitType = "open" | "door" | "locked" | "destroyed";

// =============================================================================
// Area Data
// =============================================================================

export interface AreaExit {
  direction: Direction;
  type: ExitType;
  targetAreaId: string | null; // null = unexplored
}

export interface AreaData {
  id: string;
  type: AreaType;
  name?: string; // "Reactor Core", "Abandoned Barracks"

  // Geometry (simple enough for LLM to generate)
  shape: AreaShape;
  dimensions: {
    width: number;
    height: number;
    length: number;
  };
  position: Vector3; // Relative to connection point

  // Visual theme
  theme: VisualTheme;
  hazards?: Hazard[];

  // Connections (which directions lead somewhere)
  exits: AreaExit[];
}

// =============================================================================
// Weapon & Inventory Types
// =============================================================================

export type WeaponType =
  | "laser"       // Primary, infinite ammo
  | "vulcan"      // Primary, rapid fire
  | "plasma"      // Primary, high damage
  | "fusion"      // Primary, charge shot
  | "concussion"  // Secondary, dumb missile
  | "homing"      // Secondary, tracking missile
  | "smart";      // Secondary, bouncing missile

export type WeaponCategory = "primary" | "secondary";

export type AmmoType = "vulcan" | "plasma" | "fusion" | "concussion" | "homing" | "smart";

export type DamageType = "kinetic" | "energy" | "explosive";

export interface Weapon {
  type: WeaponType;
  category: WeaponCategory;
  name: string;
  damage: number;
  fireRate: number;      // shots per second
  ammoType: AmmoType | null;  // null for infinite ammo weapons (laser)
  ammoPerShot: number;
  projectileSpeed: number;
  damageType: DamageType;
}

export type InventoryPowerUpType = "quad_damage" | "invulnerability" | "cloak";

export interface ActivePowerUp {
  type: InventoryPowerUpType;
  remainingTime: number;  // seconds
  totalDuration: number;  // original duration
}

export interface InventoryData {
  unlockedWeapons: WeaponType[];
  currentPrimaryIndex: number;
  currentSecondaryIndex: number;
  ammo: Record<AmmoType, number>;
  activePowerUps: ActivePowerUp[];
}

// =============================================================================
// Entities
// =============================================================================

export interface PlayerState {
  position: Vector3;
  rotation: Vector3; // Euler angles
  velocity: Vector3;
  health: number;
  maxHealth: number;
  shields: number;
  maxShields: number;
  currentAreaId: string;
  inventory: InventoryData;
  score: number;
}

export type EnemyType =
  | "drone"
  | "turret"
  | "hunter"
  | "bomber"
  | "boss";

export type AIState = "idle" | "patrol" | "alert" | "chase" | "attack" | "flee" | "dead";

export interface Enemy {
  id: string;
  type: EnemyType;
  position: Vector3;
  rotation: Vector3;
  velocity: Vector3;
  health: number;
  maxHealth: number;
  aiState: AIState;
  behavior: "patrol" | "guard" | "chase" | "ambush";
  targetPosition?: Vector3;
  fireAt?: Vector3;
}

export type PickupPowerUpType =
  | "health"
  | "shield"
  | "ammo"
  | "weapon_upgrade"
  | "key";

export interface PowerUp {
  id: string;
  type: PickupPowerUpType;
  position: Vector3;
  value?: number;
  weaponType?: WeaponType;  // for weapon_upgrade pickups
  ammoType?: AmmoType;      // for ammo pickups
}

// =============================================================================
// Combat Types
// =============================================================================

export interface DamageEvent {
  source: "player" | "enemy" | "hazard";
  sourceId: string;
  targetId: string;
  amount: number;
  type: DamageType;
  position: Vector3;
}

export interface DamageResult {
  actualDamage: number;  // After shields/armor
  killed: boolean;
  shieldDamage: number;
  healthDamage: number;
}

export interface Projectile {
  id: string;
  weaponType: WeaponType;
  position: Vector3;
  velocity: Vector3;
  damage: number;
  damageType: DamageType;
  ownerId: string;
  isPlayerOwned: boolean;
}

export interface HitResult {
  projectileId: string;
  targetId: string;
  targetType: "player" | "enemy" | "wall";
  position: Vector3;
  damage: number;
}

// =============================================================================
// Tool Inputs/Outputs
// =============================================================================

export interface StartGameInput {
  theme?: GameTheme;
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
  powerUps: PowerUp[];
  narrative?: string;
  connections: Direction[]; // Which directions have more unexplored
}

// =============================================================================
// Session State (Server-side)
// =============================================================================

export interface GameSession {
  id: string;
  theme: GameTheme;
  difficulty: Difficulty;
  areas: Map<string, AreaData>;
  enemies: Map<string, Enemy>;
  powerUps: Map<string, PowerUp>;
  player: PlayerState;
  explorationDepth: number;
  visitedAreaTypes: string[];
  recentCombat: boolean;
  createdAt: Date;
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
