/**
 * Entry point for running the MCP server.
 * Run with: npx mcp-pdf-server
 * Or: node dist/index.js [--stdio] [pdf-urls...]
 */

import fs from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import {
  createServer,
  isArxivUrl,
  isFileUrl,
  normalizeArxivUrl,
  pathToFileUrl,
  fileUrlToPath,
  allowedLocalFiles,
  allowedRemoteOrigins,
  DEFAULT_PDF,
} from "./server.js";

export interface ServerOptions {
  port: number;
  name?: string;
}

/**
 * Starts an MCP server with Streamable HTTP transport in stateless mode.
 */
export async function startServer(
  createServer: () => McpServer,
  options: ServerOptions,
): Promise<void> {
  const { port, name = "MCP Server" } = options;

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
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

  const httpServer = app.listen(port, (err) => {
    if (err) {
      console.error("Failed to start server:", err);
      process.exit(1);
    }
    console.log(`${name} listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function parseArgs(): { urls: string[]; stdio: boolean } {
  const args = process.argv.slice(2);
  const urls: string[] = [];
  let stdio = false;

  for (const arg of args) {
    if (arg === "--stdio") {
      stdio = true;
    } else if (!arg.startsWith("-")) {
      // Convert local paths to file:// URLs, normalize arxiv URLs
      let url = arg;
      if (
        !arg.startsWith("http://") &&
        !arg.startsWith("https://") &&
        !arg.startsWith("file://")
      ) {
        url = pathToFileUrl(arg);
      } else if (isArxivUrl(arg)) {
        url = normalizeArxivUrl(arg);
      }
      urls.push(url);
    }
  }

  return { urls: urls.length > 0 ? urls : [DEFAULT_PDF], stdio };
}

async function main() {
  const { urls, stdio } = parseArgs();

  // Register local files in whitelist
  for (const url of urls) {
    if (isFileUrl(url)) {
      const filePath = fileUrlToPath(url);
      if (fs.existsSync(filePath)) {
        allowedLocalFiles.add(filePath);
        console.error(`[pdf-server] Registered local file: ${filePath}`);
      } else {
        console.error(`[pdf-server] Warning: File not found: ${filePath}`);
      }
    }
  }

  console.error(`[pdf-server] Ready (${urls.length} URL(s) configured)`);
  console.error(
    `[pdf-server] Allowed origins: ${[...allowedRemoteOrigins].join(", ")}`,
  );

  if (stdio) {
    await createServer().connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3120", 10);
    await startServer(createServer, { port, name: "PDF Server" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
