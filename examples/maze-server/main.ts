/**
 * Entry point for the maze server.
 * Supports both HTTP and stdio transports.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import { createMazeServer } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "3002", 10);
const VERBOSE = process.env.VERBOSE === "true" || process.argv.includes("--verbose");

function log(...args: unknown[]) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}]`, ...args);
}

function logVerbose(...args: unknown[]) {
  if (VERBOSE) {
    log("[VERBOSE]", ...args);
  }
}

async function startStreamableHTTPServer(): Promise<void> {
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  // Request logging middleware
  app.use("/mcp", (req: Request, res: Response, next) => {
    const method = req.body?.method || "unknown";
    const id = req.body?.id;
    log(`[REQUEST] ${req.method} /mcp - method: ${method}, id: ${id}`);
    logVerbose("Request body:", JSON.stringify(req.body, null, 2));

    // Capture response
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      logVerbose("Response body:", JSON.stringify(body, null, 2));
      return originalJson(body);
    };

    next();
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createMazeServer();
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

  const httpServer = app.listen(PORT, (err) => {
    if (err) {
      console.error("Failed to start server:", err);
      process.exit(1);
    }
    log(`Maze server listening on http://localhost:${PORT}/mcp`);
    if (VERBOSE) {
      log("Verbose logging enabled");
    }
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdioServer(): Promise<void> {
  await createMazeServer().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer();
  } else {
    await startStreamableHTTPServer();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
