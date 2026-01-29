# Descent Game - Shared Design Specification

> **All polecats must reference this document for interface consistency.**
> Mayor reviews for design coherence.

## Core Data Types

All systems must use these shared types defined in `src/types/GameTypes.ts`:

### Vector3
```typescript
interface Vector3 {
  x: number;
  y: number;
  z: number;
}
```

### Entity Base
```typescript
interface Entity {
  id: string;
  position: Vector3;
  rotation: Vector3;  // Euler angles in radians
  velocity: Vector3;
}
```

---

## System Interfaces

### 1. Storage System (hq-8aai: nux)

**Must provide:**
```typescript
interface GameStorage {
  // Session management
  createSession(theme: Theme, difficulty: Difficulty): Promise<Session>;
  loadSession(sessionId: string): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;

  // Area persistence (don't regenerate visited areas)
  saveArea(sessionId: string, area: AreaData): Promise<void>;
  getArea(sessionId: string, areaId: string): Promise<AreaData | null>;
  getAreasForSession(sessionId: string): Promise<AreaData[]>;

  // Player state
  savePlayerState(sessionId: string, state: PlayerState): Promise<void>;
  loadPlayerState(sessionId: string): Promise<PlayerState | null>;
}
```

**Session type:**
```typescript
interface Session {
  id: string;
  theme: Theme;
  difficulty: Difficulty;
  createdAt: number;
  lastPlayed: number;
  score: number;
  explorationDepth: number;
}
```

### 2. Inventory System (hq-srvg: slit)

**Must provide:**
```typescript
interface InventoryManager {
  // Weapon management
  getWeapons(): Weapon[];
  getCurrentPrimary(): Weapon;
  getCurrentSecondary(): Weapon | null;
  selectPrimary(index: number): void;
  selectSecondary(index: number): void;

  // Ammo
  getAmmo(type: AmmoType): number;
  useAmmo(type: AmmoType, amount: number): boolean;  // returns false if insufficient
  addAmmo(type: AmmoType, amount: number): void;

  // Power-ups
  activatePowerUp(type: PowerUpType): void;
  getActivePowerUps(): ActivePowerUp[];
  updatePowerUps(dt: number): void;  // tick down durations

  // Serialization (for storage)
  serialize(): InventoryData;
  deserialize(data: InventoryData): void;
}
```

**Weapon types (canonical list):**
```typescript
type WeaponType =
  | 'laser'           // Primary, infinite ammo
  | 'vulcan'          // Primary, rapid fire
  | 'plasma'          // Primary, high damage
  | 'fusion'          // Primary, charge shot
  | 'concussion'      // Secondary, dumb missile
  | 'homing'          // Secondary, tracking missile
  | 'smart';          // Secondary, bouncing missile

type AmmoType = 'vulcan' | 'plasma' | 'fusion' | 'concussion' | 'homing' | 'smart';

type PowerUpType = 'quad_damage' | 'invulnerability' | 'cloak';
```

### 3. Combat System (hq-kroq: rictus)

**Must provide:**
```typescript
interface CombatManager {
  // Enemy management
  spawnEnemy(type: EnemyType, position: Vector3, behavior: AIBehavior): Enemy;
  updateEnemies(dt: number, playerPos: Vector3): void;
  getEnemies(): Enemy[];

  // Damage processing
  applyDamage(event: DamageEvent): DamageResult;

  // Projectile management
  fireWeapon(weapon: Weapon, origin: Vector3, direction: Vector3): Projectile;
  updateProjectiles(dt: number): void;
  getProjectiles(): Projectile[];

  // Collision queries
  checkHit(projectile: Projectile): HitResult | null;
}
```

**Enemy types (canonical list):**
```typescript
type EnemyType = 'drone' | 'turret' | 'heavy' | 'cloaker' | 'boss';

type AIState = 'idle' | 'patrol' | 'alert' | 'chase' | 'attack' | 'flee' | 'dead';

interface Enemy extends Entity {
  type: EnemyType;
  health: number;
  maxHealth: number;
  aiState: AIState;
  targetPosition?: Vector3;
  fireAt?: Vector3;
}
```

**Damage event:**
```typescript
interface DamageEvent {
  source: 'player' | 'enemy' | 'hazard';
  sourceId: string;
  targetId: string;
  amount: number;
  type: 'kinetic' | 'energy' | 'explosive';
  position: Vector3;
}

interface DamageResult {
  actualDamage: number;  // After shields/armor
  killed: boolean;
  shieldDamage: number;
  healthDamage: number;
}
```

### 4. Core Game (hq-50db: furiosa)

**Integrates all systems. Must define:**
```typescript
interface PlayerState {
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

interface AreaData {
  id: string;
  type: 'corridor' | 'room' | 'junction' | 'shaft' | 'cavern';
  name?: string;
  shape: 'box' | 'cylinder' | 'L-shaped' | 'T-junction' | 'cross';
  dimensions: { width: number; height: number; length: number };
  position: Vector3;
  theme: Theme;
  hazards?: HazardType[];
  exits: Exit[];
}

type Theme = 'alien_hive' | 'space_station' | 'ancient_ruins' | 'procedural_mix';
type Difficulty = 'easy' | 'normal' | 'hard';
type HazardType = 'lava' | 'radiation' | 'forceField' | 'darkness';
```

---

## Integration Points

### Storage ↔ Core
- Core calls `storage.savePlayerState()` periodically and on events
- Core calls `storage.saveArea()` when new area generated
- Core calls `storage.loadSession()` on game resume

### Inventory ↔ Core
- Core owns InventoryManager instance
- Core calls `inventory.useAmmo()` when firing
- Core calls `inventory.activatePowerUp()` on pickup
- Core serializes inventory via `inventory.serialize()` for storage

### Combat ↔ Core
- Core owns CombatManager instance
- Core calls `combat.spawnEnemy()` when generate_area returns enemies
- Core calls `combat.fireWeapon()` on player fire input
- Core calls `combat.updateEnemies()` and `combat.updateProjectiles()` each frame
- Core processes `combat.checkHit()` results

### Combat ↔ Inventory
- Combat queries current weapon from Inventory for damage values
- Combat calls `inventory.useAmmo()` when firing

---

## File Organization

```
src/
├── types/
│   └── GameTypes.ts      # ALL shared types (this spec)
├── storage/
│   ├── index.ts          # exports GameStorage
│   └── SqliteStorage.ts  # implementation
├── inventory/
│   ├── index.ts          # exports InventoryManager
│   ├── Inventory.ts      # implementation
│   └── weapons.ts        # weapon definitions
├── combat/
│   ├── index.ts          # exports CombatManager
│   ├── Combat.ts         # implementation
│   ├── enemies.ts        # enemy definitions
│   └── projectiles.ts    # projectile physics
└── game/
    ├── GameEngine.ts     # main loop, integrates all
    ├── WorldManager.ts   # area generation
    └── ...
```

---

## Coordination Rules

1. **Types first**: Create `src/types/GameTypes.ts` with all shared types before implementing
2. **Interface compliance**: Implementations must match interfaces exactly
3. **No cross-imports**: Systems import only from `types/` and their own directory
4. **Integration in Core**: Only GameEngine imports from multiple systems

---

*Last updated by Mayor. Polecats: reference this before implementing.*
