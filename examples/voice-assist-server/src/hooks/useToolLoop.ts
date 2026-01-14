/**
 * Hook for running the LLM tool loop from the frontend via MCP app.
 *
 * Uses the hidden _run_tool_loop tool to execute the full sampling loop
 * on the server side.
 */

import { useState, useCallback, useRef } from "react";
import type { App } from "@modelcontextprotocol/ext-apps";

export interface ToolLoopResult {
  answer: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    api_calls: number;
  };
}

export interface UseToolLoopOptions {
  app: App;
  systemPrompt?: string;
  maxIterations?: number;
}

export interface UseToolLoopReturn {
  runLoop: (userMessage: string) => Promise<ToolLoopResult>;
  isRunning: boolean;
  error: string | null;
}

export function useToolLoop(options: UseToolLoopOptions): UseToolLoopReturn {
  const { app, systemPrompt, maxIterations } = options;

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const runLoop = useCallback(
    async (userMessage: string): Promise<ToolLoopResult> => {
      setIsRunning(true);
      setError(null);

      // Cancel any previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        // Call the hidden _run_tool_loop tool
        const result = await app.callServerTool(
          {
            name: "_run_tool_loop",
            arguments: {
              userMessage,
              systemPrompt,
              maxIterations,
            },
          },
          { signal: abortControllerRef.current.signal },
        );

        if (result.isError) {
          const errorText =
            result.content?.find((c) => c.type === "text")?.text ||
            "Unknown error";
          throw new Error(errorText);
        }

        // Extract structured content if available
        const structuredContent = result.structuredContent as
          | {
              answer: string;
              usage?: ToolLoopResult["usage"];
            }
          | undefined;

        const answer =
          structuredContent?.answer ||
          result.content?.find((c) => c.type === "text")?.text ||
          "";

        return {
          answer,
          usage: structuredContent?.usage,
        };
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") {
          throw err; // Re-throw abort errors
        }
        setError(err.message);
        throw err;
      } finally {
        setIsRunning(false);
      }
    },
    [app, systemPrompt, maxIterations],
  );

  return {
    runLoop,
    isRunning,
    error,
  };
}
