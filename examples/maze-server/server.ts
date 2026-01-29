/**
 * SimpleMaze MCP Server
 *
 * A minimal 2D maze game for testing the MCP Apps + LLM agent architecture.
 * Tools are designed to be called by an LLM that generates maze content.
 */

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { TILE_SIZE } from "./src/types.js";

// Define schemas separately for outputSchema.shape pattern
const EnemySchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  alive: z.boolean(),
});

const ExitsSchema = z.object({
  north: z.nullable(z.string()),
  south: z.nullable(z.string()),
  east: z.nullable(z.string()),
  west: z.nullable(z.string()),
});

const TileSchema = z.object({
  id: z.string(),
  walls: z.array(z.array(z.boolean())),
  enemies: z.array(EnemySchema),
  exits: ExitsSchema,
});

const PlayerSchema = z.object({
  x: z.number(),
  y: z.number(),
  health: z.number(),
  maxHealth: z.number(),
  direction: z.enum(["n", "s", "e", "w"]),
  kills: z.number(),
});

const StartMazeOutputSchema = z.object({
  sessionId: z.string(),
  tile: TileSchema,
  player: PlayerSchema,
  narrative: z.string(),
});

const GenerateTileOutputSchema = z.object({
  tile: TileSchema,
  narrative: z.string().optional(),
});

// In-memory session storage
const sessions = new Map<
  string,
  {
    currentTileId: string;
    tiles: Map<string, any>;
    player: any;
  }
>();

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// Generate a simple maze using a basic algorithm
// LLM can override this with more creative layouts
function generateBasicMaze(
  size: number,
  wallDensity: number = 0.25,
): boolean[][] {
  const walls: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    walls[y] = [];
    for (let x = 0; x < size; x++) {
      // Border walls
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) {
        walls[y][x] = true;
      } else {
        walls[y][x] = Math.random() < wallDensity;
      }
    }
  }

  // Clear exits in the middle of each edge
  const mid = Math.floor(size / 2);
  walls[0][mid] = false; // North exit
  walls[size - 1][mid] = false; // South exit
  walls[mid][0] = false; // West exit
  walls[mid][size - 1] = false; // East exit

  // Clear spawn area in center
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const y = mid + dy;
      const x = mid + dx;
      if (y > 0 && y < size - 1 && x > 0 && x < size - 1) {
        walls[y][x] = false;
      }
    }
  }

  return walls;
}

function generateEnemies(
  count: number,
  walls: boolean[][],
  size: number,
): any[] {
  const enemies = [];
  const mid = Math.floor(size / 2);

  for (let i = 0; i < count; i++) {
    let x, y;
    let attempts = 0;
    do {
      x = Math.floor(Math.random() * (size - 2)) + 1;
      y = Math.floor(Math.random() * (size - 2)) + 1;
      attempts++;
    } while (
      (walls[y][x] || (Math.abs(x - mid) < 5 && Math.abs(y - mid) < 5)) &&
      attempts < 100
    );

    if (attempts < 100) {
      enemies.push({
        id: `enemy-${generateId()}`,
        x,
        y,
        alive: true,
      });
    }
  }

  return enemies;
}

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const resourceUri = "ui://maze/mcp-app.html";

export function createMazeServer(): McpServer {
  const server = new McpServer({
    name: "maze-server",
    version: "0.1.0",
  });

  // Register UI resource
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE, description: "SimpleMaze Game UI" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
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
    },
  );

  // Start maze tool - LLM generates starting tile
  registerAppTool(
    server,
    "start_maze",
    {
      title: "Start Maze Game",
      description: `Start a new maze exploration game. Generate a starting 64x64 tile with:
- Interesting wall patterns (not just random - consider corridors, rooms, obstacles)
- 3-8 enemies placed strategically
- A narrative describing the environment

The player starts in the center. The LLM should be creative with the layout.`,
      inputSchema: {
        difficulty: z
          .enum(["easy", "hard"])
          .default("easy")
          .describe(
            "Easy = fewer enemies, lower wall density. Hard = more enemies, complex maze",
          ),
      },
      outputSchema: StartMazeOutputSchema.shape,
      _meta: { ui: { resourceUri } },
    },
    async ({ difficulty }) => {
      const sessionId = `session-${generateId()}`;
      const tileId = `tile-${generateId()}`;

      const wallDensity = difficulty === "easy" ? 0.2 : 0.35;
      const enemyCount = difficulty === "easy" ? 4 : 8;

      const walls = generateBasicMaze(TILE_SIZE, wallDensity);
      const enemies = generateEnemies(enemyCount, walls, TILE_SIZE);

      const tile = {
        id: tileId,
        walls,
        enemies,
        exits: { north: null, south: null, east: null, west: null },
      };

      const player = {
        x: Math.floor(TILE_SIZE / 2),
        y: Math.floor(TILE_SIZE / 2),
        health: 5,
        maxHealth: 5,
        direction: "n" as const,
        kills: 0,
      };

      // Store session
      const tilesMap = new Map();
      tilesMap.set(tileId, tile);
      sessions.set(sessionId, {
        currentTileId: tileId,
        tiles: tilesMap,
        player,
      });

      const narrative =
        difficulty === "easy"
          ? "You enter a dimly lit maze. The walls are weathered stone, and you hear distant skittering sounds. Navigate carefully."
          : "The maze stretches before you, a labyrinth of twisting corridors. Multiple creatures lurk in the shadows. Stay alert.";

      return {
        content: [
          {
            type: "text",
            text: `Game started! ${difficulty} difficulty. ${enemies.length} enemies detected.\n\n${narrative}`,
          },
        ],
        structuredContent: {
          sessionId,
          tile,
          player,
          narrative,
        },
      };
    },
  );

  // Generate tile tool - called when player walks off edge
  registerAppTool(
    server,
    "generate_tile",
    {
      title: "Generate Adjacent Tile",
      description: `Generate a new 64x64 tile when the player moves to an unexplored area.

The LLM should create an interesting tile based on:
- The direction the player is coming from
- The player's current state (health, kills)
- Continuity with the exit they came through

Be creative with wall layouts - create rooms, corridors, or open areas.`,
      inputSchema: {
        sessionId: z.string(),
        fromTileId: z.string(),
        direction: z.enum(["north", "south", "east", "west"]),
        context: z.object({
          playerHealth: z.number(),
          playerKills: z.number(),
        }),
      },
      outputSchema: GenerateTileOutputSchema.shape,
      _meta: {
        ui: { visibility: ["app"] }, // App-only, View calls this directly
      },
    },
    async ({ sessionId, fromTileId, direction, context }) => {
      console.log(
        `[generate_tile] Called! direction=${direction} fromTile=${fromTileId} health=${context.playerHealth} kills=${context.playerKills}`,
      );

      const session = sessions.get(sessionId);
      if (!session) {
        console.log(`[generate_tile] ERROR: Session ${sessionId} not found`);
        return {
          content: [{ type: "text", text: "Session not found" }],
          isError: true,
        };
      }

      const tileId = `tile-${generateId()}`;
      console.log(`[generate_tile] Generating new tile: ${tileId}`);

      // Adjust difficulty based on player progress
      const wallDensity = 0.25 + context.playerKills * 0.01;
      const enemyCount = Math.min(3 + Math.floor(context.playerKills / 3), 10);

      const walls = generateBasicMaze(TILE_SIZE, Math.min(wallDensity, 0.4));
      const enemies = generateEnemies(enemyCount, walls, TILE_SIZE);

      // Set up exits - connect back to where we came from
      const oppositeDir: Record<string, "north" | "south" | "east" | "west"> = {
        north: "south",
        south: "north",
        east: "west",
        west: "east",
      };

      const exits: Record<string, string | null> = {
        north: null,
        south: null,
        east: null,
        west: null,
      };
      exits[oppositeDir[direction]] = fromTileId;

      const tile = {
        id: tileId,
        walls,
        enemies,
        exits,
      };

      // Update session
      session.tiles.set(tileId, tile);
      session.currentTileId = tileId;

      // Link the original tile to this one
      const fromTile = session.tiles.get(fromTileId);
      if (fromTile) {
        fromTile.exits[direction] = tileId;
      }

      const narratives = [
        "The corridor opens into a new chamber.",
        "You push deeper into the maze.",
        "The walls here are covered in strange markings.",
        "A cold draft suggests another exit nearby.",
        "The sounds of creatures grow louder.",
      ];
      const narrative =
        narratives[Math.floor(Math.random() * narratives.length)];

      return {
        content: [
          {
            type: "text",
            text: `Generated new tile: ${tileId} with ${enemies.length} enemies`,
          },
        ],
        structuredContent: {
          tile,
          narrative,
        },
      };
    },
  );

  return server;
}
