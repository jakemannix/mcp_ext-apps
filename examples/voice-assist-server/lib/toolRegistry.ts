/**
 * Tool registry for managing tools that can be called during sampling.
 * Adapted from MCP SDK examples.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ZodType } from "zod";
import type {
  Tool,
  ToolUseContent,
  ToolResultContent,
  ServerRequest,
  ServerNotification,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BreakToolLoopError } from "./toolLoop.js";

export interface ToolDefinition {
  title?: string;
  description?: string;
  inputSchema?: ZodType;
  outputSchema?: ZodType;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  callback: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => Promise<CallToolResult>;
}

export class ToolRegistry {
  readonly tools: Tool[];

  constructor(private toolDefinitions: { [name: string]: ToolDefinition }) {
    this.tools = Object.entries(this.toolDefinitions).map(
      ([name, tool]) =>
        ({
          name,
          title: tool.title,
          description: tool.description,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          inputSchema: tool.inputSchema
            ? zodToJsonSchema(tool.inputSchema as any)
            : undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          outputSchema: tool.outputSchema
            ? zodToJsonSchema(tool.outputSchema as any)
            : undefined,
          annotations: tool.annotations,
          _meta: tool._meta,
        }) as Tool,
    );
  }

  /**
   * Register all tools with an MCP server (for external client calls via tools/call)
   */
  register(server: McpServer): void {
    for (const [name, tool] of Object.entries(this.toolDefinitions)) {
      server.registerTool(
        name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
          _meta: tool._meta,
        },
        tool.callback,
      );
    }
  }

  /**
   * Execute tool calls from LLM responses (internal loop calls)
   */
  async callTools(
    toolCalls: ToolUseContent[],
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ): Promise<ToolResultContent[]> {
    return Promise.all(
      toolCalls.map(async ({ name, id, input }) => {
        const tool = this.toolDefinitions[name];
        if (!tool) {
          throw new Error(`Tool ${name} not found`);
        }
        try {
          const result = await tool.callback(input, extra);
          return {
            type: "tool_result",
            toolUseId: id,
            content: result.content,
            structuredContent: result.structuredContent,
            isError: result.isError,
          } as ToolResultContent;
        } catch (error) {
          if (error instanceof BreakToolLoopError) {
            throw error;
          }
          throw new Error(
            `Tool ${name} failed: ${error instanceof Error ? `${error.message}\n${error.stack}` : error}`,
          );
        }
      }),
    );
  }
}

export { BreakToolLoopError };
