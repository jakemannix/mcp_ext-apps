/**
 * Combat Manager Implementation for Descent Game
 *
 * Implements the CombatManager interface from GameTypes.ts.
 * Handles enemy AI, projectile physics, damage processing, and collision detection.
 */

import type {
  CombatManager,
  EnemyType,
  AIBehavior,
  AIState,
  Enemy,
  Vector3,
  Weapon,
  Projectile,
  DamageEvent,
  DamageResult,
  HitResult,
} from "../types/GameTypes.js";

import {
  CombatEnemy,
  createEnemy as createEnemyInternal,
  ENEMY_STATS,
  vectorDistance,
  vectorNormalize,
  vectorSubtract,
  vectorAdd,
  vectorScale,
  shouldFlee,
  canFire,
  getEnemySpeed,
  getDetectionRange,
  getAttackRange,
  getEnemyArmor,
  getEnemyDamage,
} from "./enemies.js";

import {
  CombatProjectile,
  createProjectile as createProjectileInternal,
  createEnemyProjectile,
  updateProjectile,
  isProjectileExpired,
  checkProjectileCollision,
  CollisionTarget,
} from "./projectiles.js";

// =============================================================================
// Combat Manager Implementation
// =============================================================================

export class Combat implements CombatManager {
  private enemies: Map<string, CombatEnemy> = new Map();
  private projectiles: Map<string, CombatProjectile> = new Map();
  private currentTime: number = 0;
  private playerId: string = "player";
  private playerPosition: Vector3 = { x: 0, y: 0, z: 0 };
  private playerRadius: number = 1.0;

  constructor() {}

  /**
   * Set player info for collision detection
   */
  setPlayer(id: string, position: Vector3, radius: number = 1.0): void {
    this.playerId = id;
    this.playerPosition = position;
    this.playerRadius = radius;
  }

  // ===========================================================================
  // Enemy Management
  // ===========================================================================

  spawnEnemy(type: EnemyType, position: Vector3, behavior: AIBehavior): Enemy {
    const enemy = createEnemyInternal(type, position, behavior);
    this.enemies.set(enemy.id, enemy);
    return enemy;
  }

  updateEnemies(dt: number, playerPos: Vector3): void {
    this.currentTime += dt;
    this.playerPosition = playerPos;

    for (const enemy of this.enemies.values()) {
      if (enemy.aiState === "dead") continue;

      this.updateEnemyAI(enemy, dt, playerPos);
      this.updateEnemyMovement(enemy, dt);
      this.updateEnemyFiring(enemy, playerPos);
    }
  }

  getEnemies(): Enemy[] {
    return Array.from(this.enemies.values());
  }

  removeEnemy(enemyId: string): void {
    this.enemies.delete(enemyId);
  }

  // ===========================================================================
  // AI State Machine
  // ===========================================================================

  private updateEnemyAI(
    enemy: CombatEnemy,
    dt: number,
    playerPos: Vector3
  ): void {
    const distanceToPlayer = vectorDistance(enemy.position, playerPos);
    const detectionRange = getDetectionRange(enemy);
    const attackRange = getAttackRange(enemy);

    // Check for flee condition first
    if (shouldFlee(enemy)) {
      enemy.aiState = "flee";
      return;
    }

    switch (enemy.aiState) {
      case "idle":
        // Ambush enemies wait until player is very close
        if (enemy.behavior === "ambush" && distanceToPlayer < detectionRange * 0.5) {
          enemy.aiState = "attack";
          enemy.targetPosition = playerPos;
        } else if (distanceToPlayer < detectionRange) {
          enemy.aiState = "alert";
          enemy.alertTime = 0;
        }
        break;

      case "patrol":
        // Patrol enemies move along path, checking for player
        if (distanceToPlayer < detectionRange) {
          enemy.aiState = "alert";
          enemy.alertTime = 0;
        } else {
          this.updatePatrolBehavior(enemy, dt);
        }
        break;

      case "alert":
        // Brief pause when detecting player
        enemy.alertTime += dt;
        enemy.targetPosition = playerPos;
        if (enemy.alertTime > 0.5) {
          if (distanceToPlayer <= attackRange) {
            enemy.aiState = "attack";
          } else {
            enemy.aiState = "chase";
          }
        }
        break;

      case "chase":
        // Move towards player
        enemy.targetPosition = playerPos;
        if (distanceToPlayer <= attackRange) {
          enemy.aiState = "attack";
        } else if (distanceToPlayer > detectionRange * 1.5) {
          // Lost the player
          enemy.aiState = "patrol";
        }
        break;

      case "attack":
        // Stay and fire at player
        enemy.targetPosition = playerPos;
        enemy.fireAt = playerPos;
        if (distanceToPlayer > attackRange * 1.2) {
          enemy.aiState = "chase";
        }
        break;

      case "flee":
        // Move away from player
        const fleeDir = vectorNormalize(
          vectorSubtract(enemy.position, playerPos)
        );
        enemy.targetPosition = vectorAdd(
          enemy.position,
          vectorScale(fleeDir, 20)
        );
        break;
    }
  }

  private updatePatrolBehavior(enemy: CombatEnemy, dt: number): void {
    // Simple patrol: move in a small circle if no path defined
    if (!enemy.patrolPath || enemy.patrolPath.length === 0) {
      const angle = this.currentTime * 0.5;
      enemy.targetPosition = {
        x: enemy.position.x + Math.cos(angle) * 5,
        y: enemy.position.y,
        z: enemy.position.z + Math.sin(angle) * 5,
      };
    } else {
      // Follow patrol path
      const target = enemy.patrolPath[enemy.patrolIndex];
      enemy.targetPosition = target;
      if (vectorDistance(enemy.position, target) < 1) {
        enemy.patrolIndex = (enemy.patrolIndex + 1) % enemy.patrolPath.length;
      }
    }
  }

  private updateEnemyMovement(enemy: CombatEnemy, dt: number): void {
    // Turrets don't move
    if (enemy.type === "turret") return;
    if (enemy.aiState === "dead" || enemy.aiState === "idle") return;

    if (!enemy.targetPosition) return;

    const direction = vectorNormalize(
      vectorSubtract(enemy.targetPosition, enemy.position)
    );
    const speed = getEnemySpeed(enemy);
    const movement = vectorScale(direction, speed * dt);

    enemy.position = vectorAdd(enemy.position, movement);
    enemy.velocity = vectorScale(direction, speed);

    // Update rotation to face movement direction
    if (direction.x !== 0 || direction.z !== 0) {
      enemy.rotation.y = Math.atan2(direction.x, direction.z);
    }
  }

  private updateEnemyFiring(enemy: CombatEnemy, playerPos: Vector3): void {
    if (enemy.aiState !== "attack") return;
    if (!canFire(enemy, this.currentTime)) return;

    // Fire at player
    const direction = vectorNormalize(
      vectorSubtract(playerPos, enemy.position)
    );
    const damage = getEnemyDamage(enemy);

    const projectile = createEnemyProjectile(
      enemy.id,
      enemy.position,
      direction,
      damage
    );

    this.projectiles.set(projectile.id, projectile);
    enemy.lastFireTime = this.currentTime;
    enemy.fireAt = playerPos;
  }

  // ===========================================================================
  // Damage Processing
  // ===========================================================================

  applyDamage(event: DamageEvent): DamageResult {
    let actualDamage = event.amount;
    let shieldDamage = 0;
    let healthDamage = 0;
    let killed = false;

    // Find target
    const enemy = this.enemies.get(event.targetId);
    if (enemy) {
      // Apply armor reduction for enemies
      const armor = getEnemyArmor(enemy);
      actualDamage = Math.round(event.amount * (1 - armor));

      // Enemies don't have shields, direct health damage
      healthDamage = actualDamage;
      enemy.health -= healthDamage;

      if (enemy.health <= 0) {
        enemy.health = 0;
        enemy.aiState = "dead";
        killed = true;
      }
    }

    // Note: Player damage is handled by the game engine, not combat system
    // This returns damage calculation for the game engine to apply to player

    return {
      actualDamage,
      killed,
      shieldDamage,
      healthDamage,
    };
  }

  /**
   * Calculate damage to player (shields first, then health)
   * Returns how much to subtract from shields and health
   */
  calculatePlayerDamage(
    amount: number,
    currentShields: number
  ): { shieldDamage: number; healthDamage: number } {
    let shieldDamage = Math.min(amount, currentShields);
    let healthDamage = amount - shieldDamage;

    return { shieldDamage, healthDamage };
  }

  // ===========================================================================
  // Projectile Management
  // ===========================================================================

  fireWeapon(weapon: Weapon, origin: Vector3, direction: Vector3): Projectile {
    const projectile = createProjectileInternal(
      weapon,
      this.playerId,
      origin,
      direction
    );

    this.projectiles.set(projectile.id, projectile);
    return projectile;
  }

  updateProjectiles(dt: number): void {
    const toRemove: string[] = [];

    for (const projectile of this.projectiles.values()) {
      // Get target position for homing missiles
      let targetPos: Vector3 | undefined;
      if (projectile.homing && projectile.targetId) {
        const target = this.enemies.get(projectile.targetId);
        if (target && target.aiState !== "dead") {
          targetPos = target.position;
        }
      } else if (projectile.homing && projectile.ownerId === this.playerId) {
        // Player homing missiles target nearest enemy
        targetPos = this.findNearestEnemy(projectile.position)?.position;
      } else if (projectile.homing) {
        // Enemy homing missiles target player
        targetPos = this.playerPosition;
      }

      updateProjectile(projectile, dt, targetPos);

      if (isProjectileExpired(projectile)) {
        toRemove.push(projectile.id);
      }
    }

    for (const id of toRemove) {
      this.projectiles.delete(id);
    }
  }

  getProjectiles(): Projectile[] {
    return Array.from(this.projectiles.values());
  }

  removeProjectile(projectileId: string): void {
    this.projectiles.delete(projectileId);
  }

  // ===========================================================================
  // Collision Queries
  // ===========================================================================

  checkHit(projectile: Projectile): HitResult | null {
    const combatProjectile = this.projectiles.get(projectile.id);
    if (!combatProjectile) return null;

    // Build collision targets list
    const targets: CollisionTarget[] = [];

    // Add player as target (for enemy projectiles)
    if (combatProjectile.ownerId !== this.playerId) {
      targets.push({
        id: this.playerId,
        type: "player",
        position: this.playerPosition,
        radius: this.playerRadius,
      });
    }

    // Add enemies as targets (for player projectiles)
    for (const enemy of this.enemies.values()) {
      if (enemy.aiState === "dead") continue;
      if (enemy.id === combatProjectile.ownerId) continue;

      targets.push({
        id: enemy.id,
        type: "enemy",
        position: enemy.position,
        radius: this.getEnemyRadius(enemy.type),
      });
    }

    return checkProjectileCollision(combatProjectile, targets);
  }

  /**
   * Check all projectiles for hits and return results
   */
  checkAllHits(): HitResult[] {
    const hits: HitResult[] = [];

    for (const projectile of this.projectiles.values()) {
      const hit = this.checkHit(projectile);
      if (hit) {
        hits.push(hit);
        // Remove projectile on hit
        this.projectiles.delete(projectile.id);
      }
    }

    return hits;
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  private findNearestEnemy(position: Vector3): CombatEnemy | null {
    let nearest: CombatEnemy | null = null;
    let nearestDist = Infinity;

    for (const enemy of this.enemies.values()) {
      if (enemy.aiState === "dead") continue;

      const dist = vectorDistance(position, enemy.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = enemy;
      }
    }

    return nearest;
  }

  private getEnemyRadius(type: EnemyType): number {
    switch (type) {
      case "drone":
        return 0.8;
      case "turret":
        return 1.0;
      case "heavy":
        return 1.5;
      case "cloaker":
        return 0.7;
      case "boss":
        return 2.5;
      default:
        return 1.0;
    }
  }

  /**
   * Clear all enemies and projectiles (for room transitions, etc.)
   */
  clear(): void {
    this.enemies.clear();
    this.projectiles.clear();
  }

  /**
   * Get count of alive enemies
   */
  getAliveEnemyCount(): number {
    let count = 0;
    for (const enemy of this.enemies.values()) {
      if (enemy.aiState !== "dead") count++;
    }
    return count;
  }
}
