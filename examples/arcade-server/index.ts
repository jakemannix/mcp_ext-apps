#!/usr/bin/env node

/**
 * Arcade MCP Server - Entry Point
 *
 * Sets up HTTP transport with Express and serves the modified emulation script.
 */

import cors from "cors";
import express from "express";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, getGameHtmlForId } from "./server.js";
import { getCachedEmulationScript } from "./game-processor.js";

const DEFAULT_PORT = 3002;

async function main() {
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Serve the modified emulation script (import() rewritten to loadScript()).
  // <script src> is not subject to CORS, so this works from srcdoc iframes.
  app.get("/scripts/emulation.js", (_req: Request, res: Response) => {
    const script = getCachedEmulationScript();
    if (!script) {
      res.status(404).send("// No script cached. Load a game first.");
      return;
    }
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "no-cache");
    res.send(script);
  });

  // Serve game HTML by ID. Awaits any in-flight processGameEmbed() for that
  // game, so the view's fetch naturally blocks until processing completes.
  app.get("/game-html/:gameId", async (req: Request, res: Response) => {
    const gameId = req.params.gameId as string;
    try {
      const html = await getGameHtmlForId(gameId);
      if (!html) {
        res.status(404).send("Game not found. Call get_game_by_id first.");
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "no-cache");
      res.send(html);
    } catch (error) {
      res
        .status(500)
        .send(
          `Failed to load game: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  });

  // MCP endpoint - stateless transport (new server per request)
  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createServer(port);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, () => {
    console.log(`Arcade MCP Server listening on http://localhost:${port}/mcp`);
  });
  httpServer.setMaxListeners(20);

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
