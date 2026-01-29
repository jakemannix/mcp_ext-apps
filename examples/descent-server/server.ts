/**
 * Descent MCP Server
 *
 * Provides tools for an LLM-generated Descent-style 6DOF shooter.
 * The LLM generates the map in real-time as the player explores.
 */
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  AreaData,
  Direction,
  Enemy,
  Theme,
  Difficulty,
  PlayerState,
  PickupItem,
  GenerationContext,
  Session,
} from "./src/types/GameTypes.js";
import {
  getOppositeDirection,
  createDefaultPlayer,
} from "./src/types/GameTypes.js";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// =============================================================================
// Session Management (in-memory for Phase 1, Storage system will replace)
// =============================================================================

interface GameSession extends Session {
  areas: Map<string, AreaData>;
  enemies: Map<string, Enemy>;
  player: PlayerState;
  visitedAreaTypes: string[];
  recentCombat: boolean;
}

const sessions = new Map<string, GameSession>();

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// =============================================================================
// Zod Schemas
// =============================================================================

const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const DirectionSchema = z.enum([
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
]);

const ThemeSchema = z.enum([
  "alien_hive",
  "space_station",
  "ancient_ruins",
  "procedural_mix",
]);

const DifficultySchema = z.enum(["easy", "normal", "hard"]);

const AreaTypeSchema = z.enum([
  "corridor",
  "room",
  "junction",
  "shaft",
  "cavern",
]);

const AreaShapeSchema = z.enum([
  "box",
  "cylinder",
  "L-shaped",
  "T-junction",
  "cross",
]);

const HazardTypeSchema = z.enum(["lava", "radiation", "forceField", "darkness"]);

const ExitTypeSchema = z.enum(["open", "door", "locked", "destroyed"]);

const ExitSchema = z.object({
  direction: DirectionSchema,
  type: ExitTypeSchema,
  targetAreaId: z.string().nullable(),
});

const AreaDataSchema = z.object({
  id: z.string(),
  type: AreaTypeSchema,
  name: z.string().optional(),
  shape: AreaShapeSchema,
  dimensions: z.object({
    width: z.number(),
    height: z.number(),
    length: z.number(),
  }),
  position: Vector3Schema,
  theme: ThemeSchema,
  hazards: z.array(HazardTypeSchema).optional(),
  exits: z.array(ExitSchema),
});

const AmmoTypeSchema = z.enum(["vulcan", "plasma", "fusion", "concussion", "homing", "smart"]);

const WeaponSchema = z.object({
  type: z.enum(["laser", "vulcan", "plasma", "fusion", "concussion", "homing", "smart"]),
  level: z.number(),
  damage: z.number(),
  fireRate: z.number(),
  ammoType: AmmoTypeSchema.nullable(),
});

const ActivePowerUpSchema = z.object({
  type: z.enum(["quad_damage", "invulnerability", "cloak"]),
  remainingTime: z.number(),
});

const InventoryDataSchema = z.object({
  weapons: z.array(WeaponSchema),
  primaryIndex: z.number(),
  secondaryIndex: z.number().nullable(),
  ammo: z.record(AmmoTypeSchema, z.number()),
  powerUps: z.array(ActivePowerUpSchema),
});

const PlayerStateSchema = z.object({
  position: Vector3Schema,
  rotation: Vector3Schema,
  velocity: Vector3Schema,
  health: z.number(),
  maxHealth: z.number(),
  shields: z.number(),
  maxShields: z.number(),
  inventory: InventoryDataSchema,
  score: z.number(),
});

const EnemyTypeSchema = z.enum(["drone", "turret", "heavy", "cloaker", "boss"]);
const AIStateSchema = z.enum(["idle", "patrol", "alert", "chase", "attack", "flee", "dead"]);
const AIBehaviorSchema = z.enum(["patrol", "guard", "ambush", "swarm"]);

const EnemySchema = z.object({
  id: z.string(),
  type: EnemyTypeSchema,
  position: Vector3Schema,
  rotation: Vector3Schema,
  velocity: Vector3Schema,
  health: z.number(),
  maxHealth: z.number(),
  aiState: AIStateSchema,
  behavior: AIBehaviorSchema,
  targetPosition: Vector3Schema.optional(),
  fireAt: Vector3Schema.optional(),
});

const PickupItemSchema = z.object({
  id: z.string(),
  type: z.enum(["health", "shield", "ammo", "weapon", "powerup", "key"]),
  position: Vector3Schema,
  value: z.number().optional(),
  weaponType: z.enum(["laser", "vulcan", "plasma", "fusion", "concussion", "homing", "smart"]).optional(),
  ammoType: AmmoTypeSchema.optional(),
  powerUpType: z.enum(["quad_damage", "invulnerability", "cloak"]).optional(),
});

const GenerationContextSchema = z.object({
  playerHealth: z.number(),
  recentCombat: z.boolean(),
  explorationDepth: z.number(),
  visitedAreaTypes: z.array(z.string()),
});

// Output schemas
const StartGameOutputSchema = z.object({
  sessionId: z.string(),
  startingArea: AreaDataSchema,
  player: PlayerStateSchema,
  narrative: z.string(),
});

const GenerateAreaOutputSchema = z.object({
  area: AreaDataSchema,
  enemies: z.array(EnemySchema),
  powerUps: z.array(PickupItemSchema),
  narrative: z.string().optional(),
  connections: z.array(DirectionSchema),
});

// =============================================================================
// Default Area Generation
// =============================================================================

function getThemeVisualTheme(theme: Theme): Theme {
  if (theme === "procedural_mix") {
    const themes: Theme[] = ["alien_hive", "space_station", "ancient_ruins"];
    return themes[Math.floor(Math.random() * themes.length)];
  }
  return theme;
}

function generateDefaultStartingArea(theme: Theme): AreaData {
  const areaId = `area-${generateId()}`;
  return {
    id: areaId,
    type: "room",
    name: getStartingRoomName(theme),
    shape: "box",
    dimensions: { width: 30, height: 15, length: 30 },
    position: { x: 0, y: 0, z: 0 },
    theme: getThemeVisualTheme(theme),
    exits: [
      { direction: "north", type: "open", targetAreaId: null },
      { direction: "east", type: "door", targetAreaId: null },
      { direction: "south", type: "open", targetAreaId: null },
    ],
  };
}

function getStartingRoomName(theme: Theme): string {
  switch (theme) {
    case "alien_hive":
      return "Hive Entrance";
    case "space_station":
      return "Docking Bay";
    case "ancient_ruins":
      return "Temple Entrance";
    case "procedural_mix":
      return "Unknown Chamber";
  }
}

function getStartingNarrative(theme: Theme): string {
  switch (theme) {
    case "alien_hive":
      return "You descend into the pulsing organic corridors of the alien hive. The walls seem to breathe around you, and distant chittering echoes through the tunnels. Your mission: destroy the hive core.";
    case "space_station":
      return "Emergency lights flicker as you enter the abandoned station. Something went wrong here - the crew is gone, but the automated defenses remain active. Find out what happened.";
    case "ancient_ruins":
      return "Ancient symbols glow faintly on the stone walls as you enter the forgotten temple. Legends speak of powerful artifacts within, guarded by mechanisms that have outlasted civilizations.";
    case "procedural_mix":
      return "You enter an impossible space where reality itself seems unstable. Organic growths merge with ancient stonework and high technology. Whatever created this place defies understanding.";
  }
}

function generateDefaultArea(
  fromArea: AreaData,
  direction: Direction,
  context: GenerationContext,
  theme: Theme
): { area: AreaData; enemies: Enemy[]; powerUps: PickupItem[] } {
  const areaId = `area-${generateId()}`;
  const oppositeDir = getOppositeDirection(direction);

  // Vary area type based on exploration depth
  const areaTypes: AreaData["type"][] = ["corridor", "room", "junction", "shaft", "cavern"];
  const type = areaTypes[Math.floor(Math.random() * areaTypes.length)];

  // Generate dimensions based on type
  const dims = getDefaultDimensions(type);

  // Calculate position relative to from area
  const position = calculateAreaPosition(fromArea, direction, dims);

  // Generate exits (always include the entrance, plus some random exits)
  const exits: AreaData["exits"] = [
    { direction: oppositeDir, type: "open", targetAreaId: fromArea.id },
  ];

  // Add some random unexplored exits
  const possibleExits: Direction[] = ["north", "south", "east", "west", "up", "down"];
  const numExits = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < numExits; i++) {
    const exitDir = possibleExits[Math.floor(Math.random() * possibleExits.length)];
    if (!exits.find((e) => e.direction === exitDir)) {
      exits.push({ direction: exitDir, type: "open", targetAreaId: null });
    }
  }

  const area: AreaData = {
    id: areaId,
    type,
    name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${generateId().substring(0, 4)}`,
    shape: "box",
    dimensions: dims,
    position,
    theme: getThemeVisualTheme(theme),
    exits,
  };

  // Generate enemies based on context
  const enemies: Enemy[] = [];
  if (context.explorationDepth > 2 && Math.random() > 0.5) {
    enemies.push({
      id: `enemy-${generateId()}`,
      type: "drone",
      position: {
        x: position.x + Math.random() * dims.width - dims.width / 2,
        y: position.y + dims.height / 2,
        z: position.z + Math.random() * dims.length - dims.length / 2,
      },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      health: 30,
      maxHealth: 30,
      aiState: "patrol",
      behavior: "patrol",
    });
  }

  // Generate power-ups if player is low on health
  const powerUps: PickupItem[] = [];
  if (context.playerHealth < 50 && Math.random() > 0.6) {
    powerUps.push({
      id: `pickup-${generateId()}`,
      type: "health",
      position: {
        x: position.x,
        y: position.y + 1,
        z: position.z,
      },
      value: 25,
    });
  }

  return { area, enemies, powerUps };
}

function getDefaultDimensions(type: AreaData["type"]): { width: number; height: number; length: number } {
  switch (type) {
    case "corridor":
      return { width: 8, height: 8, length: 40 };
    case "room":
      return { width: 25, height: 12, length: 25 };
    case "junction":
      return { width: 15, height: 10, length: 15 };
    case "shaft":
      return { width: 10, height: 50, length: 10 };
    case "cavern":
      return { width: 40, height: 20, length: 40 };
  }
}

function calculateAreaPosition(
  fromArea: AreaData,
  direction: Direction,
  dims: { width: number; height: number; length: number }
): { x: number; y: number; z: number } {
  const fromDims = fromArea.dimensions;
  const fromPos = fromArea.position;

  switch (direction) {
    case "north":
      return {
        x: fromPos.x,
        y: fromPos.y,
        z: fromPos.z - fromDims.length / 2 - dims.length / 2,
      };
    case "south":
      return {
        x: fromPos.x,
        y: fromPos.y,
        z: fromPos.z + fromDims.length / 2 + dims.length / 2,
      };
    case "east":
      return {
        x: fromPos.x + fromDims.width / 2 + dims.width / 2,
        y: fromPos.y,
        z: fromPos.z,
      };
    case "west":
      return {
        x: fromPos.x - fromDims.width / 2 - dims.width / 2,
        y: fromPos.y,
        z: fromPos.z,
      };
    case "up":
      return {
        x: fromPos.x,
        y: fromPos.y + fromDims.height / 2 + dims.height / 2,
        z: fromPos.z,
      };
    case "down":
      return {
        x: fromPos.x,
        y: fromPos.y - fromDims.height / 2 - dims.height / 2,
        z: fromPos.z,
      };
  }
}

// =============================================================================
// Server Setup
// =============================================================================

const resourceUri = "ui://descent/mcp-app.html";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Descent Server",
    version: "1.0.0",
  });

  // Tool 1: start_game (Model-Visible, Has UI)
  registerAppTool(
    server,
    "start_game",
    {
      title: "Start Descent Game",
      description: `Start a new Descent-style 6DOF shooter game with LLM-generated levels.

The LLM should generate an interesting starting room based on the theme. Return:
- A starting area with appropriate geometry and exits
- Initial player state
- Atmospheric narrative text to set the mood

Themes:
- alien_hive: Organic corridors, pulsing walls, insectoid enemies
- space_station: Industrial metal, flickering lights, robotic enemies
- ancient_ruins: Stone temples, mystical hazards, guardian automatons
- procedural_mix: Blend of all themes, reality-warping spaces`,
      inputSchema: {
        theme: ThemeSchema.default("alien_hive").describe(
          "The visual theme for the generated world"
        ),
        difficulty: DifficultySchema.default("normal").describe(
          "Game difficulty level"
        ),
      },
      outputSchema: StartGameOutputSchema.shape,
      _meta: { ui: { resourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const theme = (args.theme as Theme) || "alien_hive";
      const difficulty = (args.difficulty as Difficulty) || "normal";

      const sessionId = `session-${generateId()}`;
      const startingArea = generateDefaultStartingArea(theme);
      const narrative = getStartingNarrative(theme);
      const player = createDefaultPlayer({ x: 0, y: 5, z: 0 }, difficulty);
      player.position = { x: 0, y: 5, z: 0 };

      // Create session
      const session: GameSession = {
        id: sessionId,
        theme,
        difficulty,
        createdAt: Date.now(),
        lastPlayed: Date.now(),
        score: 0,
        explorationDepth: 0,
        areas: new Map([[startingArea.id, startingArea]]),
        enemies: new Map(),
        player,
        visitedAreaTypes: [startingArea.type],
        recentCombat: false,
      };
      sessions.set(sessionId, session);

      const result = {
        sessionId,
        startingArea,
        player,
        narrative,
      };

      return {
        content: [
          {
            type: "text",
            text: `Game started! Theme: ${theme}, Difficulty: ${difficulty}\n\n${narrative}`,
          },
        ],
        structuredContent: result,
      };
    }
  );

  // Tool 2: generate_area (Model-Visible, App-Only)
  registerAppTool(
    server,
    "generate_area",
    {
      title: "Generate New Area",
      description: `Generate a new area when the player approaches an unexplored exit.

The LLM should generate contextually appropriate content based on:
- Where the player is coming from (fromAreaId)
- The direction they're heading
- Player context (health, recent combat, exploration depth)

Generate interesting, varied areas that fit the game's theme.`,
      inputSchema: {
        sessionId: z.string().describe("The game session ID"),
        fromAreaId: z.string().describe("ID of the area player is coming from"),
        direction: DirectionSchema.describe("Direction player is heading"),
        context: GenerationContextSchema.describe(
          "Current game context for generation"
        ),
      },
      outputSchema: GenerateAreaOutputSchema.shape,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const sessionId = args.sessionId as string;
      const fromAreaId = args.fromAreaId as string;
      const direction = args.direction as Direction;
      const context = args.context as GenerationContext;

      const session = sessions.get(sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: "Session not found" }],
          isError: true,
        };
      }

      const fromArea = session.areas.get(fromAreaId);
      if (!fromArea) {
        return {
          content: [{ type: "text", text: "Source area not found" }],
          isError: true,
        };
      }

      // Generate the new area
      const { area, enemies, powerUps } = generateDefaultArea(
        fromArea,
        direction,
        context,
        session.theme
      );

      // Update the source area's exit to point to new area
      const exit = fromArea.exits.find((e) => e.direction === direction);
      if (exit) {
        exit.targetAreaId = area.id;
      }

      // Add to session
      session.areas.set(area.id, area);
      enemies.forEach((e) => session.enemies.set(e.id, e));
      session.explorationDepth++;
      if (!session.visitedAreaTypes.includes(area.type)) {
        session.visitedAreaTypes.push(area.type);
      }

      // Determine which exits are unexplored
      const connections = area.exits
        .filter((e) => e.targetAreaId === null)
        .map((e) => e.direction);

      const result = {
        area,
        enemies,
        powerUps,
        narrative:
          enemies.length > 0
            ? "Movement detected ahead. Hostiles present."
            : undefined,
        connections,
      };

      return {
        content: [
          {
            type: "text",
            text: `Generated ${area.type}: ${area.name || area.id}`,
          },
        ],
        structuredContent: result,
      };
    }
  );

  // Tool 3: sync_state (App-Only, Hidden from Model)
  registerAppTool(
    server,
    "sync_state",
    {
      title: "Sync Game State",
      description: "Sync player state and get enemy updates (app-only)",
      inputSchema: {
        sessionId: z.string(),
        playerState: PlayerStateSchema,
        timestamp: z.number(),
      },
      outputSchema: z.object({
        enemyUpdates: z.array(EnemySchema),
        events: z.array(z.string()),
      }).shape,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const sessionId = args.sessionId as string;
      const playerState = args.playerState as PlayerState;

      const session = sessions.get(sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: "Session not found" }],
          isError: true,
        };
      }

      // Update player state
      session.player = playerState;
      session.lastPlayed = Date.now();

      // Get enemies in nearby areas
      const enemyUpdates: Enemy[] = [];
      const events: string[] = [];

      session.enemies.forEach((enemy) => {
        if (enemy.health > 0) {
          enemyUpdates.push(enemy);
        }
      });

      return {
        content: [{ type: "text", text: "State synced" }],
        structuredContent: { enemyUpdates, events },
      };
    }
  );

  // Resource registration
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE, description: "Descent Game UI" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8"
      );

      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    }
  );

  return server;
}
