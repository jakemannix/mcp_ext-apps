/**
 * MCP Aggregator Server - Federates multiple MCP servers into one.
 *
 * This server connects to multiple backend MCP servers and exposes all their
 * tools and resources through a single unified interface. Tools and resources
 * are namespaced by server name to avoid collisions.
 *
 * Configuration:
 *   BACKEND_SERVERS: JSON array of server URLs
 *   PORT: Port to listen on (default: 3100)
 *
 * Example:
 *   BACKEND_SERVERS='["http://localhost:3102/mcp","http://localhost:3103/mcp"]' \
 *   PORT=3100 bun examples/aggregator-server/server.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolResult,
  ReadResourceResult,
  Resource,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import cors from "cors";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

const log = {
  info: console.log.bind(console, "[AGGREGATOR]"),
  warn: console.warn.bind(console, "[AGGREGATOR]"),
  error: console.error.bind(console, "[AGGREGATOR]"),
};

interface BackendServer {
  name: string;
  url: string;
  client: Client;
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
}

// Global state
let backends: BackendServer[] = [];
let backendsPromise: Promise<void> | null = null;

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function connectToBackend(url: string): Promise<BackendServer | null> {
  const maxRetries = 15;
  const baseDelay = 500;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = new Client({ name: "MCP Aggregator", version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(url)));

      const name = client.getServerVersion()?.name ?? new URL(url).hostname;
      const toolsList = await client.listTools();
      const tools = new Map(toolsList.tools.map((t) => [t.name, t]));

      let resources = new Map<string, Resource>();
      try {
        const resourcesList = await client.listResources();
        resources = new Map(resourcesList.resources.map((r) => [r.uri, r]));
      } catch {
        // Server may not support resources
      }

      log.info(
        `Connected to ${name}: ${tools.size} tools, ${resources.size} resources`,
      );
      return { name, url, client, tools, resources };
    } catch {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, baseDelay * attempt));
      }
    }
  }
  log.warn(`Failed to connect to ${url} after ${maxRetries} attempts`);
  return null;
}

function getBackendUrls(): string[] {
  if (process.env.BACKEND_SERVERS) {
    return JSON.parse(process.env.BACKEND_SERVERS);
  }
  // Default for testing: connect to basic-server-react
  return ["http://localhost:3102/mcp"];
}

function startBackendDiscovery(): void {
  if (!backendsPromise) {
    backendsPromise = (async () => {
      const urls = getBackendUrls();
      log.info(`Discovering ${urls.length} backend servers...`);
      const results = await Promise.all(urls.map(connectToBackend));
      backends = results.filter((b): b is BackendServer => b !== null);
      log.info(`Connected to ${backends.length}/${urls.length} backends`);
    })();
  }
}

function prefixUri(prefix: string, uri: string): string {
  return uri.startsWith("ui://")
    ? `ui://${prefix}/${uri.slice(5)}`
    : `${prefix}/${uri}`;
}

function rewriteMeta(prefix: string, meta: Tool["_meta"]): Tool["_meta"] {
  if (!meta) return undefined;
  const result = { ...meta };
  // Rewrite ui.resourceUri
  const ui = result.ui as { resourceUri?: string } | undefined;
  if (ui?.resourceUri)
    result.ui = { ...ui, resourceUri: prefixUri(prefix, ui.resourceUri) };
  // Rewrite legacy flat key
  if (result["ui/resourceUri"])
    result["ui/resourceUri"] = prefixUri(prefix, result["ui/resourceUri"] as string);
  // Rewrite OpenAI outputTemplate key
  if (result["openai/outputTemplate"])
    result["openai/outputTemplate"] = prefixUri(prefix, result["openai/outputTemplate"] as string);
  return result;
}

async function createServerAsync(): Promise<McpServer> {
  await backendsPromise;

  const server = new McpServer({ name: "MCP Aggregator", version: "1.0.0" });

  for (const backend of backends) {
    const prefix = sanitizeName(backend.name);

    for (const [name, tool] of Array.from(backend.tools.entries())) {
      server.registerTool(
        `${prefix}/${name}`,
        {
          title: tool.title ?? name,
          description: `[${backend.name}] ${tool.description ?? ""}`.trim(),
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
          _meta: rewriteMeta(prefix, tool._meta),
        },
        async (args): Promise<CallToolResult> => {
          log.info(`Forwarding: ${prefix}/${name}`);
          return (await backend.client.callTool({
            name,
            arguments: args,
          })) as CallToolResult;
        },
      );
    }

    for (const [uri, resource] of Array.from(backend.resources.entries())) {
      server.registerResource(
        `[${backend.name}] ${resource.name}`,
        prefixUri(prefix, uri),
        {
          description: resource.description,
          mimeType: resource.mimeType,
          annotations: resource.annotations,
          _meta: rewriteMeta(prefix, resource._meta),
        },
        async (): Promise<ReadResourceResult> => {
          log.info(`Forwarding resource: ${prefix}/${uri}`);
          const result = await backend.client.readResource({ uri });
          return {
            contents: result.contents.map((c) => ({
              ...c,
              uri: prefixUri(prefix, c.uri),
            })),
          };
        },
      );
    }
  }

  const toolCount = backends.reduce((n, b) => n + b.tools.size, 0);
  const resourceCount = backends.reduce((n, b) => n + b.resources.size, 0);
  log.info(`Session ready: ${toolCount} tools, ${resourceCount} resources`);

  return server;
}

type Transport = StreamableHTTPServerTransport | SSEServerTransport;
interface Session {
  transport: Transport;
  server: McpServer;
}

async function startHttpServer(port: number): Promise<void> {
  const sessions = new Map<string, Session>();
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors({ exposedHeaders: ["mcp-session-id"] }));

  app.all("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let session = sessionId ? sessions.get(sessionId) : undefined;

      if (
        session &&
        !(session.transport instanceof StreamableHTTPServerTransport)
      ) {
        return res
          .status(400)
          .json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Session uses different transport",
            },
            id: null,
          });
      }

      if (!session) {
        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          return res
            .status(400)
            .json({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Bad request: not initialized" },
              id: null,
            });
        }

        const serverInstance = await createServerAsync();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) =>
            sessions.set(id, { transport, server: serverInstance }),
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await serverInstance.connect(transport);
        session = { transport, server: serverInstance };
      }

      await (session.transport as StreamableHTTPServerTransport).handleRequest(
        req,
        res,
        req.body,
      );
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res
          .status(500)
          .json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
      }
    }
  });

  app.get("/sse", async (_req: Request, res: Response) => {
    try {
      const serverInstance = await createServerAsync();
      const transport = new SSEServerTransport("/messages", res);
      sessions.set(transport.sessionId, { transport, server: serverInstance });
      res.on("close", () => sessions.delete(transport.sessionId));
      await serverInstance.connect(transport);
    } catch (error) {
      console.error("SSE error:", error);
      if (!res.headersSent) res.status(500).end();
    }
  });

  app.post("/messages", async (req: Request, res: Response) => {
    try {
      const session = sessions.get(req.query.sessionId as string);
      if (!session || !(session.transport instanceof SSEServerTransport)) {
        return res
          .status(404)
          .json({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found" },
            id: null,
          });
      }
      await session.transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error("Message error:", error);
      if (!res.headersSent) {
        res
          .status(500)
          .json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
      }
    }
  });

  return new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port);
    httpServer.on("listening", () => {
      log.info(`Listening on http://localhost:${port}/mcp`);
      resolve();
    });
    httpServer.on("error", reject);

    const shutdown = () => {
      log.info("Shutting down...");
      sessions.forEach((s) => s.transport.close().catch(() => {}));
      httpServer.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

async function main() {
  startBackendDiscovery();

  if (process.argv.includes("--stdio")) {
    const server = await createServerAsync();
    await server.connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3100", 10);
    await startHttpServer(port);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
