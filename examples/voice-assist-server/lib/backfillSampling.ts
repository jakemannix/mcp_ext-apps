/**
 * Fallback sampling provider for when the client doesn't support MCP sampling.
 * Uses the Anthropic API directly as a fallback.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  TextBlockParam,
  ImageBlockParam,
  Tool as ClaudeTool,
  ToolChoiceAuto,
  ToolChoiceAny,
  ToolChoiceNone,
  DocumentBlockParam,
  MessageParam,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import type { ToolUseBlockParam } from "@anthropic-ai/sdk/resources/messages.mjs";
import type {
  CreateMessageRequest,
  CreateMessageResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_MAX_TOKENS = process.env.DEFAULT_MAX_TOKENS
  ? parseInt(process.env.DEFAULT_MAX_TOKENS)
  : 1000;

/**
 * Converts MCP Tool definition to Claude API tool format
 */
function toolToClaudeFormat(tool: Tool): ClaudeTool {
  return {
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.inputSchema as ClaudeTool["input_schema"],
  };
}

/**
 * Converts MCP ToolChoice to Claude API tool_choice format
 */
function toolChoiceToClaudeFormat(
  toolChoice: CreateMessageRequest["params"]["toolChoice"],
): ToolChoiceAuto | ToolChoiceAny | ToolChoiceNone | undefined {
  if (!toolChoice) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tc = toolChoice as any;
  switch (tc.mode) {
    case "auto":
      return {
        type: "auto",
        disable_parallel_tool_use: tc.disable_parallel_tool_use,
      };
    case "required":
      return {
        type: "any",
        disable_parallel_tool_use: tc.disable_parallel_tool_use,
      };
    case "none":
      return { type: "none" };
    default:
      return undefined;
  }
}

/**
 * Converts Claude API content block to MCP format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contentToMcp(content: ContentBlock): any {
  switch (content.type) {
    case "text":
      return { type: "text", text: content.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: content.id,
        name: content.name,
        input: content.input,
      };
    default:
      throw new Error(
        `[contentToMcp] Unsupported content type: ${(content as { type: string }).type}`,
      );
  }
}

/**
 * Converts Claude API stop reason to MCP format
 */
function stopReasonToMcp(
  reason: string | null,
): CreateMessageResult["stopReason"] {
  switch (reason) {
    case "max_tokens":
      return "maxTokens";
    case "stop_sequence":
      return "stopSequence";
    case "tool_use":
      return "toolUse";
    case "end_turn":
      return "endTurn";
    case null:
      return undefined;
    default:
      throw new Error(`[stopReasonToMcp] Unsupported stop reason: ${reason}`);
  }
}

/**
 * Converts MCP content block to Claude API format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contentBlockFromMcp(content: any): ContentBlockParam {
  switch (content.type) {
    case "text":
      return { type: "text", text: content.text };
    case "image":
      return {
        type: "image",
        source: {
          data: content.data,
          media_type: content.mimeType,
          type: "base64",
        },
      } as ImageBlockParam;
    case "tool_result": {
      const makeImageBlock = (
        data: string,
        media_type: string,
      ): ImageBlockParam => ({
        type: "image",
        source: {
          type: "base64",
          data: data,
          media_type: media_type as
            | "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp",
        },
      });

      const resultContent = content.structuredContent
        ? [
            {
              type: "text",
              text: JSON.stringify(content.structuredContent),
            } as TextBlockParam,
          ]
        : content.content.map(
            (c: {
              type: string;
              text?: string;
              data?: string;
              mimeType?: string;
              resource?: { mimeType?: string; text?: string; blob?: string };
              uri?: string;
            }) => {
              if (c.type === "text") {
                return { type: "text", text: c.text } as TextBlockParam;
              } else if (c.type === "image") {
                return makeImageBlock(c.data!, c.mimeType!);
              } else if (c.type === "resource") {
                if (c.resource?.mimeType === "text/plain" && c.resource.text) {
                  return {
                    type: "text",
                    text: c.resource.text,
                  } as TextBlockParam;
                } else if (
                  c.resource?.mimeType?.startsWith("image/") &&
                  c.resource.blob
                ) {
                  return makeImageBlock(c.resource.blob, c.resource.mimeType);
                } else if (
                  c.resource?.mimeType === "application/pdf" &&
                  c.resource.blob
                ) {
                  return {
                    type: "document",
                    source: {
                      type: "base64",
                      data: c.resource.blob,
                      media_type: "application/pdf",
                    },
                  } as DocumentBlockParam;
                }
                throw new Error(
                  `[contentBlockFromMcp] Unsupported resource mimeType: ${c.resource?.mimeType}`,
                );
              } else if (
                c.type === "resource_link" &&
                c.mimeType === "application/pdf"
              ) {
                return {
                  type: "document",
                  source: {
                    type: "url",
                    url: c.uri,
                  },
                } as DocumentBlockParam;
              }
              throw new Error(
                `[contentBlockFromMcp] Unsupported content type in tool_result: ${c.type}`,
              );
            },
          );

      return {
        type: "tool_result",
        tool_use_id: content.toolUseId,
        content: resultContent,
        is_error: content.isError,
      } as ToolResultBlockParam;
    }
    case "tool_use":
      return {
        type: "tool_use",
        id: content.id,
        name: content.name,
        input: content.input,
      } as ToolUseBlockParam;
    default:
      throw new Error(
        `[contentBlockFromMcp] Unsupported content type: ${content.type}`,
      );
  }
}

/**
 * Converts MCP messages to Claude API format
 */
async function messagesFromMcp(
  messages: CreateMessageRequest["params"]["messages"],
): Promise<MessageParam[]> {
  return Promise.all(
    messages.map(async ({ role, content }) => ({
      role,
      content: await Promise.all(
        (Array.isArray(content) ? content : [content]).map(contentBlockFromMcp),
      ),
    })),
  );
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export interface FallbackSamplingProviderOptions {
  apiKey?: string;
  model?: string;
}

/**
 * Creates a fallback sampling provider that uses the Anthropic API directly.
 */
export async function createFallbackSamplingProvider(
  options: FallbackSamplingProviderOptions = {},
): Promise<{
  createMessage: (
    params: CreateMessageRequest["params"],
  ) => Promise<CreateMessageResult>;
  defaultModel: string;
}> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required for fallback sampling",
    );
  }

  const api = new Anthropic({ apiKey });
  const defaultModel = options.model ?? DEFAULT_MODEL;

  const createMessage = async (
    params: CreateMessageRequest["params"],
  ): Promise<CreateMessageResult> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tc = params.toolChoice as any;
    const tools =
      tc?.mode === "none" ? undefined : params.tools?.map(toolToClaudeFormat);
    const tool_choice = toolChoiceToClaudeFormat(params.toolChoice);

    const msg = await api.messages.create({
      model: defaultModel,
      system:
        params.systemPrompt === undefined
          ? undefined
          : [
              {
                type: "text",
                text: params.systemPrompt,
              },
            ],
      messages: await messagesFromMcp(params.messages),
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: params.temperature,
      stop_sequences: params.stopSequences,
      tools: tools && tools.length > 0 ? tools : undefined,
      tool_choice: tool_choice,
      ...(params.metadata ?? {}),
    });

    return {
      model: msg.model,
      stopReason: stopReasonToMcp(msg.stop_reason),
      role: "assistant",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: (Array.isArray(msg.content) ? msg.content : [msg.content]).map(
        contentToMcp,
      ) as any,
      _meta: {
        usage: msg.usage,
      },
    };
  };

  return {
    createMessage,
    defaultModel,
  };
}
