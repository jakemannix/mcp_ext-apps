/**
 * MCP Server for managing virtual desktops using LinuxServer webtop containers.
 *
 * Tools:
 * - ListDesktops: List all virtual desktop containers
 * - CreateDesktop: Create a new virtual desktop
 * - ViewDesktop: View a virtual desktop (has MCP App UI)
 * - ShutdownDesktop: Stop and remove a virtual desktop
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "@modelcontextprotocol/ext-apps/server";
import { startServer } from "./server-utils.js";
import {
  listDesktops,
  createDesktop,
  getDesktop,
  shutdownDesktop,
  checkDocker,
  getPortConfig,
  DESKTOP_VARIANTS,
  DEFAULT_VARIANT,
  DEFAULT_RESOLUTION,
  DEFAULT_COMMANDS,
  type DesktopInfo,
  type DesktopVariant,
} from "./src/docker.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");

// ============================================================================
// Schemas
// ============================================================================

const ResolutionSchema = z.object({
  width: z.number().min(640).max(3840).describe("Width in pixels"),
  height: z.number().min(480).max(2160).describe("Height in pixels"),
});

const MountSchema = z.object({
  hostPath: z.string().describe("Path on the host machine"),
  containerPath: z.string().describe("Path inside the container"),
  readonly: z.boolean().optional().describe("Mount as read-only"),
});

const CreateDesktopInputSchema = z.object({
  name: z.string().describe("Name for the desktop (will be sanitized and prefixed with 'vd-')"),
  variant: z
    .enum(DESKTOP_VARIANTS)
    .optional()
    .describe(`Desktop variant (default: ${DEFAULT_VARIANT}). Options: xfce (lightweight), webtop-ubuntu-xfce, webtop-alpine-xfce`),
  resolution: ResolutionSchema.optional().describe(
    `Initial resolution (default: ${DEFAULT_RESOLUTION.width}x${DEFAULT_RESOLUTION.height})`,
  ),
  commands: z
    .array(z.string())
    .optional()
    .describe(`Commands to run on startup (default: ${DEFAULT_COMMANDS.join(", ")})`),
  mounts: z.array(MountSchema).optional().describe("Additional volume mounts"),
});

const ViewDesktopInputSchema = z.object({
  name: z.string().describe("Name of the desktop to view"),
});

const ShutdownDesktopInputSchema = z.object({
  name: z.string().describe("Name of the desktop to shutdown"),
  cleanup: z
    .boolean()
    .optional()
    .describe("Delete the desktop's data directory (default: false, preserves data)"),
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format desktop info for display.
 */
function formatDesktopInfo(desktop: DesktopInfo): string {
  const lines = [
    `Name: ${desktop.name}`,
    `Status: ${desktop.status}`,
    `Container ID: ${desktop.containerId}`,
    `Variant: ${desktop.variant}`,
    `Resolution: ${desktop.resolution.width}x${desktop.resolution.height}`,
    `Commands: ${desktop.commands.join(", ")}`,
  ];

  if (desktop.port) {
    lines.push(`Port: ${desktop.port}`);
    lines.push(`URL: http://localhost:${desktop.port}`);
  }

  lines.push(`Created: ${desktop.createdAt}`);

  return lines.join("\n");
}

// ============================================================================
// Server
// ============================================================================

/**
 * Creates a new MCP server instance with virtual desktop tools.
 */
export function createVirtualDesktopServer(): McpServer {
  const server = new McpServer({
    name: "Virtual Desktop Server",
    version: "0.1.0",
  });

  // ==================== ListDesktops ====================
  server.tool(
    "list-desktops",
    "List all virtual desktop containers",
    {},
    async (): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktops = await listDesktops();

      if (desktops.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No virtual desktops found. Use create-desktop to create one.",
            },
          ],
        };
      }

      const text = desktops
        .map((d, i) => `[${i + 1}] ${formatDesktopInfo(d)}`)
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${desktops.length} virtual desktop(s):\n\n${text}`,
          },
        ],
      };
    },
  );

  // ==================== CreateDesktop ====================
  server.tool(
    "create-desktop",
    "Create a new virtual desktop container",
    CreateDesktopInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      try {
        const result = await createDesktop({
          name: args.name,
          variant: args.variant,
          resolution: args.resolution,
          commands: args.commands,
          mounts: args.mounts,
        });

        return {
          content: [
            {
              type: "text",
              text: [
                `Virtual desktop created successfully!`,
                ``,
                `Name: ${result.name}`,
                `Container ID: ${result.containerId}`,
                `Port: ${result.port}`,
                `URL: ${result.url}`,
                ``,
                `The desktop is starting up. Use view-desktop to connect.`,
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to create desktop: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // ==================== ViewDesktop ====================
  const viewDesktopResourceUri = "ui://view-desktop/mcp-app.html";

  registerAppTool(
    server,
    "view-desktop",
    {
      title: "View Desktop",
      description: "View and interact with a virtual desktop",
      inputSchema: ViewDesktopInputSchema.shape,
      _meta: { [RESOURCE_URI_META_KEY]: viewDesktopResourceUri },
    },
    async (args: { name: string }): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}). Please start it first.`,
            },
          ],
        };
      }

      if (!desktop.port) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" does not have a port assigned. This may indicate a configuration issue.`,
            },
          ],
        };
      }

      const url = `http://localhost:${desktop.port}`;
      const wsUrl = `ws://localhost:${desktop.port}/websockify`;
      const portConfig = getPortConfig(desktop.variant as DesktopVariant);

      return {
        content: [
          {
            type: "text",
            text: [
              `Desktop "${desktop.name}" is ready.`,
              ``,
              `Open in browser: ${url}`,
              `WebSocket URL: ${wsUrl}`,
              ``,
              `Status: ${desktop.status}`,
              `Variant: ${desktop.variant}`,
              `Resolution: ${desktop.resolution.width}x${desktop.resolution.height}`,
            ].join("\n"),
          },
        ],
        // Pass structured data to the MCP App
        structuredContent: {
          name: desktop.name,
          url,
          wsUrl,
          resolution: desktop.resolution,
          variant: desktop.variant,
          password: portConfig.password,
        },
        _meta: {},
      };
    },
  );

  // CSP configuration for the MCP App
  const viewDesktopCsp = {
    // Allow loading noVNC library from jsdelivr CDN
    resourceDomains: ["https://cdn.jsdelivr.net"],
    // Allow WebSocket connections to localhost for VNC
    connectDomains: ["ws://localhost:*", "wss://localhost:*"],
  };

  registerAppResource(
    server,
    viewDesktopResourceUri,
    viewDesktopResourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Virtual Desktop Viewer",
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          {
            uri: viewDesktopResourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            // CSP must be in content._meta for hosts to read it
            _meta: {
              ui: {
                csp: viewDesktopCsp,
              },
            },
          },
        ],
      };
    },
  );

  // ==================== ShutdownDesktop ====================
  server.tool(
    "shutdown-desktop",
    "Stop and remove a virtual desktop container",
    ShutdownDesktopInputSchema.shape,
    async (args): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      const success = await shutdownDesktop(args.name, args.cleanup ?? false);

      if (success) {
        const cleanupMessage = args.cleanup
          ? " Data directory has been deleted."
          : " Data directory has been preserved.";

        return {
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" has been shut down and removed.${cleanupMessage}`,
            },
          ],
        };
      } else {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to shutdown desktop "${args.name}". Check Docker logs for details.`,
            },
          ],
        };
      }
    },
  );

  // ==================== OpenHomeFolder ====================
  const OpenHomeFolderInputSchema = z.object({
    name: z.string().describe("Name of the desktop"),
  });

  registerAppTool(
    server,
    "open-home-folder",
    {
      title: "Open Home Folder",
      description: "Open the home folder in the desktop's file manager",
      inputSchema: OpenHomeFolderInputSchema.shape,
      _meta: {
        ui: {
          visibility: ["apps"],
        },
      },
    },
    async (args: { name: string }): Promise<CallToolResult> => {
      const dockerAvailable = await checkDocker();
      if (!dockerAvailable) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Docker is not available. Please ensure Docker is installed and running.",
            },
          ],
        };
      }

      const desktop = await getDesktop(args.name);

      if (!desktop) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" not found. Use list-desktops to see available desktops.`,
            },
          ],
        };
      }

      if (desktop.status !== "running") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Desktop "${args.name}" is not running (status: ${desktop.status}).`,
            },
          ],
        };
      }

      try {
        // Run file manager in the container
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        // Use thunar (XFCE file manager) or xdg-open as fallback
        await execAsync(`docker exec ${args.name} bash -c "DISPLAY=:1 thunar ~ || DISPLAY=:1 xdg-open ~" &`);

        return {
          content: [
            {
              type: "text",
              text: `Opened home folder in ${args.name}.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to open home folder: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  return server;
}

// ============================================================================
// Server Startup
// ============================================================================

async function main() {
  if (process.argv.includes("--stdio")) {
    await createVirtualDesktopServer().connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3002", 10);
    await startServer(createVirtualDesktopServer, {
      port,
      name: "Virtual Desktop Server",
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
