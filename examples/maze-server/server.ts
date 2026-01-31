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

  // Generate tile tool - LLM provides creative tile definition
  registerAppTool(
    server,
    "generate_tile",
    {
      title: "Generate Adjacent Tile",
      description: `Create a new 64x64 tile when the player moves to an unexplored area.

YOU (the LLM) design the tile! Be creative with:
- Wall patterns: rooms, corridors, pillars, mazes, open areas
- Enemy placement: strategic positions, ambushes, guard posts
- Narrative: describe what the player sees/feels

IMPORTANT wall format: 64x64 boolean grid where true=wall, false=floor.
- Row 0 is NORTH edge, row 63 is SOUTH edge
- Column 0 is WEST edge, column 63 is EAST edge
- The entry point (opposite of direction traveled) MUST be clear (false)
- Example: if direction="north", player enters from SOUTH, so row 63 middle area must be clear

Tips for interesting layouts:
- Create rooms by making rectangular wall sections with gaps for doors
- Add pillars (small wall clusters) for cover
- Leave the center relatively open for combat
- Place enemies behind corners or in rooms`,
      inputSchema: {
        sessionId: z.string(),
        fromTileId: z.string(),
        direction: z.enum(["north", "south", "east", "west"]),
        context: z.object({
          playerHealth: z.number(),
          playerKills: z.number(),
        }),
        // LLM's creative payload
        tileDesign: z.object({
          walls: z.array(z.array(z.boolean())).describe(
            "64x64 grid of booleans. true=wall, false=floor. Row 0=north edge."
          ),
          enemies: z.array(z.object({
            x: z.number().describe("X position (0-63, 0=west)"),
            y: z.number().describe("Y position (0-63, 0=north)"),
          })).describe("Enemy positions. Place them strategically!"),
          narrative: z.string().describe("What the player sees as they enter this area"),
        }),
      },
      outputSchema: GenerateTileOutputSchema.shape,
      // Note: No visibility restriction - both model and app can call this tool
      _meta: {},
    },
    async ({ sessionId, fromTileId, direction, context, tileDesign }) => {
      console.log(
        `[generate_tile] Called! direction=${direction} fromTile=${fromTileId} health=${context.playerHealth} kills=${context.playerKills}`,
      );
      console.log(`[generate_tile] LLM provided: ${tileDesign.enemies.length} enemies, narrative: "${tileDesign.narrative.substring(0, 50)}..."`);

      const session = sessions.get(sessionId);
      if (!session) {
        console.log(`[generate_tile] ERROR: Session ${sessionId} not found`);
        return {
          content: [{ type: "text", text: "Session not found" }],
          isError: true,
        };
      }

      const tileId = `tile-${generateId()}`;
      console.log(`[generate_tile] Creating tile: ${tileId}`);

      // Validate and use LLM-provided walls, or fall back to generated
      let walls: boolean[][];
      if (tileDesign.walls && tileDesign.walls.length === TILE_SIZE) {
        walls = tileDesign.walls;
        console.log(`[generate_tile] Using LLM-designed walls`);
      } else {
        console.log(`[generate_tile] Invalid walls from LLM, using fallback`);
        walls = generateBasicMaze(TILE_SIZE, 0.25);
      }

      // Convert LLM enemy positions to full enemy objects
      const enemies = tileDesign.enemies.map((e, i) => ({
        id: `enemy-${generateId()}`,
        x: Math.max(1, Math.min(TILE_SIZE - 2, Math.floor(e.x))),
        y: Math.max(1, Math.min(TILE_SIZE - 2, Math.floor(e.y))),
        alive: true,
      }));

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

      // Ensure entry point is clear
      const mid = Math.floor(TILE_SIZE / 2);
      if (direction === "north") {
        // Entering from south, clear south edge
        for (let dx = -2; dx <= 2; dx++) {
          if (mid + dx >= 0 && mid + dx < TILE_SIZE) {
            walls[TILE_SIZE - 1][mid + dx] = false;
            walls[TILE_SIZE - 2][mid + dx] = false;
          }
        }
      } else if (direction === "south") {
        // Entering from north, clear north edge
        for (let dx = -2; dx <= 2; dx++) {
          if (mid + dx >= 0 && mid + dx < TILE_SIZE) {
            walls[0][mid + dx] = false;
            walls[1][mid + dx] = false;
          }
        }
      } else if (direction === "east") {
        // Entering from west, clear west edge
        for (let dy = -2; dy <= 2; dy++) {
          if (mid + dy >= 0 && mid + dy < TILE_SIZE) {
            walls[mid + dy][0] = false;
            walls[mid + dy][1] = false;
          }
        }
      } else if (direction === "west") {
        // Entering from east, clear east edge
        for (let dy = -2; dy <= 2; dy++) {
          if (mid + dy >= 0 && mid + dy < TILE_SIZE) {
            walls[mid + dy][TILE_SIZE - 1] = false;
            walls[mid + dy][TILE_SIZE - 2] = false;
          }
        }
      }

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

      return {
        content: [
          {
            type: "text",
            text: `Created tile ${tileId}: ${tileDesign.narrative}`,
          },
        ],
        structuredContent: {
          tile,
          narrative: tileDesign.narrative,
        },
      };
    },
  );

  return server;
}
