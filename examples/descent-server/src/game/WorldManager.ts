/**
 * World Manager
 *
 * Manages area generation and the world graph.
 * Triggers generation when player approaches unexplored exits.
 */
import * as THREE from "three";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  AreaData,
  Direction,
  PlayerState,
  GenerateAreaOutput,
  GenerationContext,
} from "../types/GameTypes.ts";

const GENERATION_DISTANCE = 50; // Units before reaching exit to trigger generation

export class WorldManager {
  private areas: Map<string, AreaData> = new Map();
  private generationQueue: Set<string> = new Set();
  private sessionId: string;
  private callServerTool: App["callServerTool"];
  private sendLog: App["sendLog"];
  private recentCombat = false;

  constructor(
    _scene: THREE.Scene,
    sessionId: string,
    callServerTool: App["callServerTool"],
    sendLog: App["sendLog"],
  ) {
    this.sessionId = sessionId;
    this.callServerTool = callServerTool;
    this.sendLog = sendLog;
  }

  addArea(area: AreaData): void {
    this.areas.set(area.id, area);
  }

  getArea(id: string): AreaData | undefined {
    return this.areas.get(id);
  }

  getCurrentArea(position: THREE.Vector3): AreaData | null {
    for (const area of this.areas.values()) {
      if (this.isPositionInArea(position, area)) {
        return area;
      }
    }
    return null;
  }

  private isPositionInArea(position: THREE.Vector3, area: AreaData): boolean {
    const dx = Math.abs(position.x - area.position.x);
    const dy = Math.abs(position.y - area.position.y);
    const dz = Math.abs(position.z - area.position.z);

    return (
      dx < area.dimensions.width / 2 + 5 &&
      dy < area.dimensions.height / 2 + 5 &&
      dz < area.dimensions.length / 2 + 5
    );
  }

  checkGenerationNeeded(
    playerPos: THREE.Vector3,
    playerDirection: THREE.Vector3,
    player: PlayerState,
  ): void {
    const currentArea = this.getCurrentArea(playerPos);
    if (!currentArea) return;

    // Check each exit
    for (const exit of currentArea.exits) {
      // Skip if already has a target
      if (exit.targetAreaId) continue;

      // Check if player is approaching this exit
      const exitPosition = this.getExitPosition(currentArea, exit.direction);
      const distanceToExit = playerPos.distanceTo(
        new THREE.Vector3(exitPosition.x, exitPosition.y, exitPosition.z),
      );

      // Also check if player is moving toward the exit
      const toExit = new THREE.Vector3(
        exitPosition.x - playerPos.x,
        exitPosition.y - playerPos.y,
        exitPosition.z - playerPos.z,
      ).normalize();

      const movingToward = playerDirection.dot(toExit) > 0.3;

      if (distanceToExit < GENERATION_DISTANCE && movingToward) {
        this.requestGeneration(currentArea, exit.direction, player);
      }
    }
  }

  private getExitPosition(
    area: AreaData,
    direction: Direction,
  ): { x: number; y: number; z: number } {
    const pos = area.position;
    const dims = area.dimensions;

    switch (direction) {
      case "north":
        return { x: pos.x, y: pos.y, z: pos.z - dims.length / 2 };
      case "south":
        return { x: pos.x, y: pos.y, z: pos.z + dims.length / 2 };
      case "east":
        return { x: pos.x + dims.width / 2, y: pos.y, z: pos.z };
      case "west":
        return { x: pos.x - dims.width / 2, y: pos.y, z: pos.z };
      case "up":
        return { x: pos.x, y: pos.y + dims.height / 2, z: pos.z };
      case "down":
        return { x: pos.x, y: pos.y - dims.height / 2, z: pos.z };
    }
  }

  private async requestGeneration(
    fromArea: AreaData,
    direction: Direction,
    player: PlayerState,
  ): Promise<void> {
    const key = `${fromArea.id}-${direction}`;
    if (this.generationQueue.has(key)) return;

    this.generationQueue.add(key);
    this.sendLog({
      level: "info",
      data: `Generating area ${direction} of ${fromArea.name || fromArea.id}`,
    });

    try {
      const context: GenerationContext = {
        playerHealth: player.health,
        recentCombat: this.recentCombat,
        explorationDepth: this.areas.size,
        visitedAreaTypes: [
          ...new Set([...this.areas.values()].map((a) => a.type)),
        ],
      };

      const result = await this.callServerTool({
        name: "generate_area",
        arguments: {
          sessionId: this.sessionId,
          fromAreaId: fromArea.id,
          direction,
          context,
        },
      });

      if (result.structuredContent) {
        const genResult =
          result.structuredContent as unknown as GenerateAreaOutput;

        // Add the new area
        this.addArea(genResult.area);

        // Update the exit in the source area
        const exit = fromArea.exits.find((e) => e.direction === direction);
        if (exit) {
          exit.targetAreaId = genResult.area.id;
        }

        // Dispatch event for rendering
        window.dispatchEvent(
          new CustomEvent("areaGenerated", { detail: genResult }),
        );
      }
    } catch (error) {
      this.sendLog({
        level: "error",
        data: `Failed to generate area: ${error}`,
      });
    } finally {
      this.generationQueue.delete(key);
    }
  }

  setRecentCombat(value: boolean): void {
    this.recentCombat = value;
  }

  getExplorationDepth(): number {
    return this.areas.size;
  }
}
