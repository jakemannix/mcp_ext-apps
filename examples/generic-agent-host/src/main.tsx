/**
 * Generic Agent Host - Chat UI with MCP Apps bridge support
 *
 * This combines:
 * - LLM agent chat interface
 * - MCP Apps bridge for proper iframe communication
 * - Support for ui/message from apps (forwarded to agent)
 */

import { StrictMode, useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  AppBridge,
  PostMessageTransport,
  type McpUiMessageRequest,
  type McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import "./styles.css";

const AGENT_SERVER = "http://localhost:3004";

// Minimal MCP client wrapper for AppBridge (uses backend for actual calls)
class BackendMcpClient {
  async callTool(params: { name: string; arguments: Record<string, unknown> }) {
    const response = await fetch(`${AGENT_SERVER}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Call tool: ${params.name}` }),
    });
    return { content: [] };
  }

  async readResource(params: { uri: string }) {
    const response = await fetch(
      `${AGENT_SERVER}/app-resource?uri=${encodeURIComponent(params.uri)}`
    );
    return response.json();
  }

  async listTools() {
    const response = await fetch(`${AGENT_SERVER}/tools`);
    const data = await response.json();
    return { tools: data.tools || [] };
  }

  // Required by AppBridge
  getServerCapabilities() {
    return {};
  }

  getServerVersion() {
    return { name: "GenericAgentHost", version: "0.1.0" };
  }
}

interface Message {
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

interface StructuredContent {
  [key: string]: unknown;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Welcome! I'm connected to an MCP server. What would you like to do?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mcpClient, setMcpClient] = useState<BackendMcpClient | null>(null);
  const [appBridge, setAppBridge] = useState<AppBridge | null>(null);
  const [showApp, setShowApp] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const appBridgeRef = useRef<AppBridge | null>(null);
  const appReadyRef = useRef(false);

  // Create MCP client wrapper on mount
  useEffect(() => {
    const client = new BackendMcpClient();

    // Test connection to backend
    fetch(`${AGENT_SERVER}/health`)
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "ok") {
          console.log("[HOST] Connected to agent backend");
          setMcpClient(client);
        }
      })
      .catch((err) => {
        console.error("[HOST] Failed to connect to agent backend:", err);
      });
  }, []);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initialize AppBridge when iframe is ready
  const initializeAppBridge = useCallback(
    async (iframe: HTMLIFrameElement) => {
      console.log("[HOST] initializeAppBridge called, mcpClient:", !!mcpClient);
      if (!mcpClient) {
        console.error("[HOST] No mcpClient, cannot initialize AppBridge!");
        return;
      }

      console.log("[HOST] Initializing AppBridge");

      let bridge: AppBridge;
      try {
        bridge = new AppBridge(
          mcpClient as any, // Cast to any to work around type mismatch
          { name: "GenericAgentHost", version: "0.1.0" },
          {
            openLinks: {},
            updateModelContext: { text: {} },
          },
          {
            hostContext: {
              theme: "dark",
              platform: "web",
              containerDimensions: { maxHeight: 600 },
              displayMode: "inline",
              availableDisplayModes: ["inline"],
            },
          }
        );
        console.log("[HOST] AppBridge created successfully");
      } catch (err) {
        console.error("[HOST] Failed to create AppBridge:", err);
        return;
      }

      // Handle ui/message from app - forward to agent
      bridge.onmessage = async (params: McpUiMessageRequest["params"]) => {
        console.log("[HOST] Message from app:", params);

        // Forward to agent server
        try {
          const response = await fetch(`${AGENT_SERVER}/app-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });

          if (!response.ok) {
            console.error("[HOST] Failed to forward message to agent");
            return { isError: true };
          }

          // Only invoke agent loop if triggerAgent is true
          if (params.triggerAgent) {
            console.log("[HOST] triggerAgent=true, streaming agent response");
            await handleAgentStream(response);
          } else {
            console.log("[HOST] triggerAgent=false, message added to context only");
          }
        } catch (err) {
          console.error("[HOST] Error forwarding message:", err);
          return { isError: true };
        }

        return {};
      };

      // Handle updateModelContext from app
      bridge.onupdatemodelcontext = async (
        params: McpUiUpdateModelContextRequest["params"]
      ) => {
        console.log("[HOST] Context update from app:", params);

        try {
          await fetch(`${AGENT_SERVER}/update-context`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
        } catch (err) {
          console.error("[HOST] Error forwarding context:", err);
        }

        return {};
      };

      bridge.onopenlink = async (params) => {
        window.open(params.url, "_blank");
        return {};
      };

      bridge.onloggingmessage = (params) => {
        console.log("[APP]", params.level, params.data);
      };

      bridge.onsizechange = async ({ width, height }) => {
        if (height !== undefined) {
          iframe.style.height = `${height}px`;
        }
        if (width !== undefined) {
          iframe.style.width = `${Math.min(width, 800)}px`;
        }
      };

      // Set up oninitialized callback - fires when app signals it's ready
      bridge.oninitialized = () => {
        console.log("[HOST] App initialized! Ready to receive tool results.");
        appReadyRef.current = true;
      };

      // Connect bridge to the iframe (HTML is already loaded)
      console.log("[HOST] Connecting AppBridge to iframe...");
      try {
        await bridge.connect(
          new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!)
        );
        console.log("[HOST] AppBridge connected successfully");
      } catch (err) {
        console.error("[HOST] AppBridge connect failed:", err);
        return;
      }

      appBridgeRef.current = bridge;
      setAppBridge(bridge);
      console.log("[HOST] AppBridge set in state, waiting for app to initialize...");
    },
    [mcpClient]
  );

  // Handle SSE stream from agent
  const handleAgentStream = async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";
    let currentText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));
          await handleAgentEvent(data, (text) => {
            currentText += text;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, content: currentText }];
              }
              return [...prev, { role: "assistant", content: currentText }];
            });
          });
        }
      }
    }
  };

  // Handle individual agent events
  const handleAgentEvent = async (
    event: {
      type: string;
      text?: string;
      tool_name?: string;
      tool_args?: Record<string, unknown>;
      tool_result?: string;
      structured_content?: StructuredContent;
      error?: string;
    },
    appendText: (text: string) => void
  ) => {
    switch (event.type) {
      case "text":
        if (event.text) {
          appendText(event.text);
        }
        break;

      case "tool_call":
        setMessages((prev) => [
          ...prev,
          {
            role: "tool",
            content: `Calling ${event.tool_name}...`,
            toolName: event.tool_name,
            toolArgs: event.tool_args,
          },
        ]);
        break;

      case "structured_content":
        // Forward to app iframe via AppBridge (use refs to avoid closure issues)
        const bridge = appBridgeRef.current;
        const ready = appReadyRef.current;
        console.log("[HOST] Got structured_content event, appBridge:", !!bridge, "appReady:", ready);
        if (event.structured_content && bridge && ready) {
          console.log("[HOST] Sending structured content to app:", Object.keys(event.structured_content));
          try {
            bridge.sendToolResult({
              content: [{ type: "text", text: "Result" }],
              structuredContent: event.structured_content,
            });
            console.log("[HOST] sendToolResult called successfully");
          } catch (err) {
            console.error("[HOST] Error sending tool result:", err);
          }
        } else if (!bridge) {
          console.warn("[HOST] No AppBridge available to send structured content!");
        } else if (!ready) {
          console.warn("[HOST] App not ready yet! structured_content may be lost.");
        }
        break;

      case "error":
        setMessages((prev) => [
          ...prev,
          { role: "error", content: event.error || "Unknown error" },
        ]);
        break;

      case "done":
        break;
    }
  };

  // Send message to agent
  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch(`${AGENT_SERVER}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await handleAgentStream(response);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "error", content: `Error: ${err}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Load app in iframe - writes HTML directly, no sandbox proxy needed
  const loadApp = async (resourceUri: string) => {
    if (!mcpClient || !iframeRef.current) return;

    console.log("[HOST] Loading app resource:", resourceUri);

    try {
      const resource = await mcpClient.readResource({ uri: resourceUri });
      const content = resource.contents?.[0];

      if (!content) {
        console.error("[HOST] No content in resource response");
        return;
      }

      const html = content.text || "";
      if (!html) {
        console.error("[HOST] No HTML content");
        return;
      }

      // Write HTML directly to iframe using document.write
      // (same technique the sandbox proxy uses internally)
      const iframe = iframeRef.current;

      // Need to set src to about:blank first to get a proper document
      iframe.src = "about:blank";

      // Wait for iframe to be ready
      await new Promise<void>((resolve) => {
        iframe.onload = () => resolve();
      });

      // Initialize AppBridge BEFORE writing HTML
      // This ensures the bridge is listening when the app's JS runs
      setShowApp(true);
      await initializeAppBridge(iframe);

      // Now write the HTML - the app will connect to our already-listening bridge
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        console.log("[HOST] Writing HTML to iframe...");
        doc.open();
        doc.write(html);
        doc.close();
        console.log("[HOST] HTML written, app should be initializing...");
      } else {
        console.error("[HOST] Could not access iframe document");
        return;
      }
    } catch (err) {
      console.error("[HOST] Failed to load app:", err);
    }
  };

  // When we get a tool result with structured content, check for UI resource
  useEffect(() => {
    console.log("[HOST] useEffect for loadUI, mcpClient:", !!mcpClient, "showApp:", showApp);
    // Auto-load UI when client is ready
    const loadUI = async () => {
      if (!mcpClient || showApp) {
        console.log("[HOST] loadUI skipped, mcpClient:", !!mcpClient, "showApp:", showApp);
        return;
      }

      try {
        // Get app info from backend
        const response = await fetch(`${AGENT_SERVER}/app-info`);
        const data = await response.json();

        if (data.apps && data.apps.length > 0) {
          const firstApp = data.apps[0];
          console.log("[HOST] Found app:", firstApp);
          await loadApp(firstApp.resourceUri);
        }
      } catch (err) {
        console.error("[HOST] Failed to auto-load UI:", err);
      }
    };

    if (mcpClient && !showApp) {
      loadUI();
    }
  }, [mcpClient, showApp]);

  return (
    <div className="container">
      <div className="chat-panel">
        <div className="chat-header">
          <h1>Agent Host</h1>
          <span className="status">
            {mcpClient ? "Connected" : "Connecting..."}
          </span>
        </div>

        <div className="messages">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="role">{msg.role}</div>
              <div className="content">
                {msg.toolName ? (
                  <>
                    <strong>{msg.toolName}</strong>
                    <pre>{JSON.stringify(msg.toolArgs, null, 2)}</pre>
                  </>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="message assistant">
              <div className="role">assistant</div>
              <div className="content typing">Thinking...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form
          className="input-area"
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
            Send
          </button>
        </form>
      </div>

      <div className={`app-panel ${showApp ? "visible" : ""}`}>
        <div className="app-header">
          <h2>App</h2>
        </div>
        <div className="app-content">
          <iframe
            ref={iframeRef}
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
