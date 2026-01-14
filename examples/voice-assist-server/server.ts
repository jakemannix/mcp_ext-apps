/**
 * Voice Assist MCP Server
 *
 * Provides:
 * - A voice-assist tool with a UI resource
 * - Hidden _sampling_create tool for frontend to call LLM sampling
 * - ripgrep and read tools for the LLM to search/read files
 * - Fallback sampling provider when client doesn't support sampling
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  CallToolResult,
  ReadResourceResult,
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { startServer } from "./server-utils.js";
import { createFallbackSamplingProvider } from "./lib/backfillSampling.js";
import { ToolRegistry } from "./lib/toolRegistry.js";
import { runToolLoop } from "./lib/toolLoop.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const WORKING_DIR = process.env.VOICE_ASSIST_CWD || process.cwd();

/**
 * Run ripgrep command and return results
 */
async function runRipgrep(pattern: string, directory: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "--json",
      "--max-count=50",
      "--max-filesize=1M",
      "-e",
      pattern,
      directory,
    ];

    const rg = spawn("rg", args, { cwd: directory });
    let stdout = "";
    let stderr = "";

    rg.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    rg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    rg.on("close", (code) => {
      if (code === 0 || code === 1) {
        // code 1 means no matches, which is fine
        resolve(stdout || "No matches found.");
      } else {
        reject(new Error(`ripgrep failed: ${stderr}`));
      }
    });

    rg.on("error", (err) => {
      // ripgrep not installed, try grep as fallback
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const grep = spawn("grep", ["-rn", "--include=*", pattern, "."], {
          cwd: directory,
        });
        let grepOut = "";

        grep.stdout.on("data", (data) => {
          grepOut += data.toString();
        });

        grep.on("close", () => {
          resolve(grepOut || "No matches found.");
        });

        grep.on("error", () => {
          resolve("Neither ripgrep nor grep available.");
        });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Create tool registry with ripgrep and read tools for LLM to use
 */
function createInternalTools(): ToolRegistry {
  return new ToolRegistry({
    ripgrep: {
      title: "Ripgrep Search",
      description:
        "Search for files containing a pattern using ripgrep. Returns matching lines with file paths and line numbers.",
      inputSchema: z.object({
        pattern: z.string().describe("The regex pattern to search for"),
        directory: z
          .string()
          .optional()
          .describe("Directory to search in (defaults to working directory)"),
      }),
      callback: async (args) => {
        const { pattern, directory } = args as {
          pattern: string;
          directory?: string;
        };
        const searchDir = directory
          ? path.resolve(WORKING_DIR, directory)
          : WORKING_DIR;

        try {
          const result = await runRipgrep(pattern, searchDir);
          return {
            content: [{ type: "text", text: result }],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Error: ${(error as Error).message}` },
            ],
            isError: true,
          };
        }
      },
    },
    read: {
      title: "Read File",
      description:
        "Read the contents of a file. Can read specific line ranges.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Path to the file to read (relative to working directory)"),
        startLine: z
          .number()
          .optional()
          .describe("Start reading from this line (1-indexed)"),
        endLine: z
          .number()
          .optional()
          .describe("Stop reading at this line (1-indexed, inclusive)"),
      }),
      callback: async (args) => {
        const {
          path: filePath,
          startLine,
          endLine,
        } = args as {
          path: string;
          startLine?: number;
          endLine?: number;
        };
        const fullPath = path.resolve(WORKING_DIR, filePath);

        try {
          const content = await fs.readFile(fullPath, "utf-8");
          let lines = content.split("\n");

          if (startLine !== undefined || endLine !== undefined) {
            const start = (startLine ?? 1) - 1;
            const end = endLine ?? lines.length;
            lines = lines.slice(start, end);
          }

          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error reading file: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }
      },
    },
  });
}

/**
 * Creates the MCP server with all tools and resources
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Voice Assist MCP Server",
    version: "1.0.0",
  });

  const resourceUri = "ui://voice-assist/mcp-app.html";
  const internalTools = createInternalTools();

  // Create fallback sampling provider (lazily initialized)
  let fallbackProvider: Awaited<
    ReturnType<typeof createFallbackSamplingProvider>
  > | null = null;

  /**
   * Get or create the fallback sampling provider
   */
  async function getFallbackProvider() {
    if (!fallbackProvider) {
      fallbackProvider = await createFallbackSamplingProvider();
    }
    return fallbackProvider;
  }

  /**
   * Create a message using either client sampling or fallback provider
   */
  async function createMessage(
    params: CreateMessageRequest["params"],
  ): Promise<CreateMessageResult> {
    const clientCapabilities = server.server.getClientCapabilities();

    if (clientCapabilities?.sampling) {
      // Client supports sampling, use standard MCP flow
      return server.server.createMessage(params);
    }

    // Fallback to direct Anthropic API call
    const provider = await getFallbackProvider();
    return provider.createMessage(params);
  }

  // ============================================================
  // VISIBLE TOOL: voice-assist (launches UI)
  // ============================================================

  registerAppTool(
    server,
    "voice-assist",
    {
      title: "Voice Assistant",
      description:
        "Interactive voice assistant with speech-to-text and text-to-speech. Talk naturally to search files and get information.",
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: "Voice assistant UI launched. Speak to interact.",
          },
        ],
      };
    },
  );

  // ============================================================
  // HIDDEN TOOL: _run_tool_loop (for app to run full tool loop)
  // ============================================================

  registerAppTool(
    server,
    "_run_tool_loop",
    {
      title: "Run Tool Loop",
      description:
        "Run a complete tool loop with the given user message. Uses internal tools (ripgrep, read) automatically.",
      inputSchema: z.object({
        userMessage: z.string().describe("The user's message/question"),
        systemPrompt: z
          .string()
          .optional()
          .describe("Optional custom system prompt"),
        maxIterations: z
          .number()
          .optional()
          .describe("Maximum tool loop iterations (default: 10)"),
      }),
      _meta: {
        ui: {
          visibility: ["app"], // Hidden from model!
        },
      },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { userMessage, systemPrompt, maxIterations } = args as {
        userMessage: string;
        systemPrompt?: string;
        maxIterations?: number;
      };

      const defaultSystemPrompt = `You are a helpful voice assistant. Keep responses concise and suitable for voice output.
When you need to find information in files, use the ripgrep tool to search.
When you need to read file contents, use the read tool.
Provide clear, spoken-language responses.`;

      try {
        const result = await runToolLoop(
          {
            initialMessages: [
              {
                role: "user",
                content: [{ type: "text", text: userMessage }],
              },
            ],
            server,
            registry: internalTools,
            maxIterations: maxIterations ?? 10,
            systemPrompt: systemPrompt ?? defaultSystemPrompt,
            createMessage,
          },
          extra,
        );

        return {
          content: [{ type: "text", text: result.answer }],
          structuredContent: {
            answer: result.answer,
            usage: result.usage,
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Tool loop error: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ============================================================
  // Also register internal tools for direct tool/call access
  // ============================================================

  internalTools.register(server);

  // ============================================================
  // UI RESOURCE: The voice assistant React app
  // ============================================================

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          permissions: { microphone: {} }, // Request microphone permission
          prefersBorder: true,
        },
      },
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await createServer().connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3001", 10);
    await startServer(createServer, { port, name: "Voice Assist MCP Server" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
