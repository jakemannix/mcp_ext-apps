/**
 * MCP App using React
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./mcp-app.module.css";

function extractTime(callToolResult: CallToolResult): string {
  const textContent = callToolResult.content?.find((c) => c.type === "text");
  return textContent && "text" in textContent ? textContent.text : "[ERROR]";
}

function McpApp() {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [hostContext, setHostContext] = useState<
    McpUiHostContext | undefined
  >();

  const { app, error } = useApp({
    appInfo: { name: "MCP App", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => {
        console.info("App is being torn down");
        return {};
      };
      app.ontoolinput = async (input) => {
        console.info("Received tool call input:", input);
      };
      app.ontoolresult = async (result) => {
        console.info("Received tool call result:", result);
        setToolResult(result);
      };
      app.ontoolcancelled = (params) => {
        console.info("Tool call cancelled:", params.reason);
      };
      app.onerror = console.error;
      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error)
    return (
      <div>
        <strong>ERROR:</strong> {error.message}
      </div>
    );
  if (!app) return <div>Connecting...</div>;

  return (
    <McpAppInner app={app} toolResult={toolResult} hostContext={hostContext} />
  );
}

interface McpAppInnerProps {
  app: App;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
}

function McpAppInner({ app, toolResult, hostContext }: McpAppInnerProps) {
  const [serverTime, setServerTime] = useState("Loading...");

  useEffect(() => {
    if (toolResult) {
      setServerTime(extractTime(toolResult));
    }
  }, [toolResult]);

  const handleGetTime = useCallback(async () => {
    try {
      console.info("Calling get-time tool...");
      const result = await app.callServerTool({
        name: "get-time",
        arguments: {},
      });
      console.info("get-time result:", result);
      setServerTime(extractTime(result));
    } catch (e) {
      console.error(e);
      setServerTime("[ERROR]");
    }
  }, [app]);

  return (
    <main
      className={styles.main}
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <h1>MCP App</h1>
      <div className={styles.action}>
        <p>
          <strong>Server Time:</strong>{" "}
          <code id="server-time">{serverTime}</code>
        </p>
        <button onClick={handleGetTime}>Get Server Time</button>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <McpApp />
  </StrictMode>,
);
