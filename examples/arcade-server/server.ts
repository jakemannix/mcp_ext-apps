/**
 * Arcade MCP Server
 *
 * MCP server for browsing and playing arcade games from archive.org.
 * Fetches game HTML server-side and serves it as an inline MCP App resource.
 */

import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { processGameEmbed } from "./game-processor.js";
import { searchArchiveOrgGames } from "./search.js";

const GAME_VIEWER_RESOURCE_URI = "ui://arcade/game-viewer";

// Cache for the last processed game HTML
let cachedGameHtml: string | null = null;

/**
 * Validates an archive.org game identifier.
 */
function validateGameId(gameId: string): boolean {
  return (
    gameId.length > 0 &&
    !gameId.includes("/") &&
    !gameId.includes("?") &&
    !gameId.includes("#") &&
    !gameId.includes("..")
  );
}

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(port: number): McpServer {
  const server = new McpServer({
    name: "arcade-mcp-server",
    version: "1.0.0",
  });

  // Tool: Search for arcade games (no UI)
  server.registerTool(
    "search_games",
    {
      description:
        "Searches archive.org for arcade games matching the search term. Returns a list of game identifiers and titles sorted by relevance.",
      inputSchema: z.object({
        searchTerm: z
          .string()
          .describe('The game name or search term (e.g., "doom", "pacman", "mario").'),
        maxResults: z
          .number()
          .optional()
          .default(10)
          .describe("Maximum number of results to return (default: 10, max: 50)"),
      }) as any,
    },
    async (args: any): Promise<CallToolResult> => {
      const { searchTerm, maxResults } = args;
      if (!searchTerm || searchTerm.trim().length === 0) {
        return {
          content: [{ type: "text", text: "Error: Search term cannot be empty." }],
          isError: true,
        };
      }

      const limit = Math.min(Math.max(maxResults || 10, 1), 50);

      try {
        const games = await searchArchiveOrgGames(searchTerm.trim(), limit);

        if (games.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No arcade games found for "${searchTerm}". Try a different search term.`,
              },
            ],
          };
        }

        const gameData = games.map((game) => ({
          identifier: game.identifier,
          title: game.title,
          description: game.description || null,
          year: game.year || null,
          creator: game.creator || null,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { total: games.length, searchTerm, games: gameData },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error searching for games: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Tool: Load and play a specific game (with UI)
  server.registerTool(
    "get_game_by_id",
    {
      title: "Play Arcade Game",
      description:
        "Loads and displays a playable arcade game from archive.org by its identifier.",
      inputSchema: z.object({
        gameId: z
          .string()
          .describe('The archive.org identifier (e.g., "arcade_20pacgal", "msdos_doom_1993").'),
      }) as any,
      _meta: {
        ui: { resourceUri: GAME_VIEWER_RESOURCE_URI },
      },
    },
    async (args: any): Promise<CallToolResult> => {
      const { gameId } = args;
      if (!gameId || !validateGameId(gameId)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Invalid game ID "${gameId}". Must be a non-empty identifier without path separators.`,
            },
          ],
          isError: true,
        };
      }

      try {
        const html = await processGameEmbed(gameId, port);
        cachedGameHtml = html;

        return {
          content: [
            { type: "text", text: `Loading arcade game: ${gameId}` },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error loading game: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Resource: Serves the processed game HTML with CSP configuration
  server.registerResource(
    GAME_VIEWER_RESOURCE_URI,
    GAME_VIEWER_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          csp: {
            resourceDomains: [
              "https://archive.org",
              "https://*.archive.org",
              `http://localhost:${port}`,
            ],
            connectDomains: [
              "https://archive.org",
              "https://*.archive.org",
              `http://localhost:${port}`,
            ],
            baseUriDomains: ["https://archive.org"],
          },
        },
      },
    },
    async (): Promise<ReadResourceResult> => {
      const html =
        cachedGameHtml ||
        `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#111;color:#0f0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh">
<div>No game loaded. Use get_game_by_id first.</div>
</body></html>`;

      return {
        contents: [
          { uri: GAME_VIEWER_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
