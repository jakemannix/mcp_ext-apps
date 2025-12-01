import { useEffect, useRef, useState } from "react";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  type CallToolResult,
  ErrorCode,
  Implementation,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { AppBridge, McpUiAppCapabilities, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

import {
  getToolUiResourceUri,
  readToolUiResource,
  setupSandboxProxyIframe,
} from "./app-host-utils";

/**
 * Props for the AppRenderer component.
 */
export interface AppRendererProps {
  /** URL to the sandbox proxy HTML that will host the tool UI iframe */
  sandboxProxyUrl: URL;

  /** MCP client connected to the server providing the tool */
  client: Client;

  /** Name of the MCP tool to render UI for */
  toolName: string;

  /** Optional pre-fetched resource URI. If not provided, will be fetched via getToolUiResourceUri() */
  toolResourceUri?: string;

  /** Optional input arguments to pass to the tool UI once it's ready */
  toolInput?: Record<string, unknown>;

  /** Whether the tool input is partial (still streaming). When true, sends tool-input-partial instead of tool-input */
  isToolInputPartial?: boolean;

  /** Optional result from tool execution to pass to the tool UI once it's ready */
  toolResult?: CallToolResult;

  onopenlink?: AppBridge["onopenlink"];
  onmessage?: AppBridge["onmessage"];
  onloggingmessage?: AppBridge["onloggingmessage"];

  /** Callback invoked when an error occurs during setup or message handling */
  onerror?: (error: Error) => void;

  /** Callback invoked when MCP UI initialization completes */
  oninitialized?: (appVersion: Implementation | undefined, appCapabilities: McpUiAppCapabilities) => void;
}

/**
 * React component that renders an MCP tool's custom UI in a sandboxed iframe.
 *
 * This component manages the complete lifecycle of an MCP-UI tool:
 * 1. Creates a sandboxed iframe with the proxy HTML
 * 2. Establishes MCP communication channel between host and iframe
 * 3. Fetches and loads the tool's UI resource (HTML)
 * 4. Sends tool inputs and results to the UI when ready
 * 5. Handles UI actions (intents, link opening, prompts, notifications)
 * 6. Automatically resizes iframe based on content size changes
 *
 * @example
 * ```tsx
 * <AppRenderer
 *   sandboxProxyUrl={new URL('http://localhost:8765/sandbox_proxy.html')}
 *   client={mcpClient}
 *   toolName="create-chart"
 *   toolInput={{ data: [1, 2, 3], type: 'bar' }}
 *   onUIAction={async (action) => {
 *     if (action.type === 'intent') {
 *       // Handle intent request from UI
 *       console.log('Intent:', action.payload.intent);
 *     }
 *   }}
 *   onerror={(error) => console.error('UI Error:', error)}
 * />
 * ```
 *
 * **Architecture:**
 * - Host (this component) ↔ Sandbox Proxy (iframe) ↔ Tool UI (nested iframe)
 * - Communication uses MCP protocol over postMessage
 * - Sandbox proxy provides CSP isolation for untrusted tool UIs
 * - Standard MCP initialization flow determines when UI is ready
 *
 * **Lifecycle:**
 * 1. `setupSandboxProxyIframe()` creates iframe and waits for proxy ready
 * 2. Component creates `McpUiProxyServer` instance
 * 3. Registers all handlers (BEFORE connecting to avoid race conditions)
 * 4. Connects proxy to iframe via `MessageTransport`
 * 5. MCP initialization completes → `onClientReady` callback fires
 * 6. Fetches tool UI resource and sends to sandbox proxy
 * 7. Sends tool inputs/results when iframe signals ready
 *
 * @param props - Component props
 * @returns React element containing the sandboxed tool UI iframe
 */
export const AppRenderer = (props: AppRendererProps) => {
  const {
    client,
    sandboxProxyUrl,
    toolName,
    toolResourceUri,
    toolInput,
    isToolInputPartial,
    toolResult,
    onmessage,
    onopenlink,
    onloggingmessage,
    onerror,
  } = props;

  // State - using strings for stable effect dependencies
  const [sandboxUrlHref, setSandboxUrlHref] = useState<string | null>(null);
  const [resourceHtml, setResourceHtml] = useState<string | null>(null);
  const [appBridge, setAppBridge] = useState<AppBridge | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Use refs for callbacks to avoid effect re-runs when they change
  const onmessageRef = useRef(onmessage);
  const onopenlinkRef = useRef(onopenlink);
  const onloggingmessageRef = useRef(onloggingmessage);
  const onerrorRef = useRef(onerror);
  const oninitializedRef = useRef(props.oninitialized);

  useEffect(() => {
    onmessageRef.current = onmessage;
    onopenlinkRef.current = onopenlink;
    onloggingmessageRef.current = onloggingmessage;
    onerrorRef.current = onerror;
    oninitializedRef.current = props.oninitialized;
  });

  // Effect 1: Fetch resource to get HTML + CSP, build sandbox URL with CSP params
  useEffect(() => {
    let cancelled = false;

    const fetchResource = async () => {
      try {
        let uri: string;

        if (toolResourceUri) {
          uri = toolResourceUri;
        } else {
          const info = await getToolUiResourceUri(client, toolName);
          if (!info) {
            throw new Error(
              `Tool ${toolName} has no UI resource (no ui/resourceUri in tool._meta)`,
            );
          }
          uri = info.uri;
        }

        if (cancelled) return;

        const { html, meta } = await readToolUiResource(client, { uri });

        if (cancelled) return;

        // Build sandbox URL with CSP params from resource metadata
        const url = new URL(sandboxProxyUrl.href);
        if (meta?.csp?.connectDomains?.length) {
          url.searchParams.set(
            "connect-src",
            meta.csp.connectDomains.join(" "),
          );
        }
        if (meta?.csp?.resourceDomains?.length) {
          url.searchParams.set(
            "resource-src",
            meta.csp.resourceDomains.join(" "),
          );
        }

        setSandboxUrlHref(url.href);
        setResourceHtml(html);
      } catch (err) {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onerrorRef.current?.(error);
      }
    };

    fetchResource();

    return () => {
      cancelled = true;
    };
  }, [client, toolName, toolResourceUri, sandboxProxyUrl.href]);

  // Effect 2: When sandbox URL is ready, create iframe and setup AppBridge
  useEffect(() => {
    if (!sandboxUrlHref) return;

    let mounted = true;

    const setup = async () => {
      try {
        const { iframe, onReady } = await setupSandboxProxyIframe(
          new URL(sandboxUrlHref),
        );

        if (!mounted) return;

        iframeRef.current = iframe;
        if (containerRef.current) {
          containerRef.current.appendChild(iframe);
        }

        await onReady;

        if (!mounted) return;

        const serverCapabilities = client.getServerCapabilities();
        const bridge = new AppBridge(
          client,
          {
            name: "Example MCP UI Host",
            version: "1.0.0",
          },
          {
            openLinks: {},
            serverTools: serverCapabilities?.tools,
            serverResources: serverCapabilities?.resources,
          },
        );

        // Register ALL handlers BEFORE connecting
        bridge.oninitialized = () => {
          if (!mounted) return;
          setInitialized(true);
          oninitializedRef.current?.(bridge.getAppVersion(), bridge.getAppCapabilities());
        };

        bridge.onmessage = (params, extra) => {
          if (!onmessageRef.current) {
            throw new McpError(ErrorCode.MethodNotFound, "Method not found");
          }
          return onmessageRef.current?.(params, extra);
        };
        bridge.onopenlink = (params, extra) => {
          if (!onopenlinkRef.current) {
            throw new McpError(ErrorCode.MethodNotFound, "Method not found");
          }
          return onopenlinkRef.current?.(params, extra);
        };
        bridge.onloggingmessage = (params) => {
          if (!onloggingmessageRef.current) {
            throw new McpError(ErrorCode.MethodNotFound, "Method not found");
          }
          return onloggingmessageRef.current?.(params);
        };

        bridge.onsizechange = async ({ width, height }) => {
          if (iframeRef.current) {
            if (width !== undefined) {
              iframeRef.current.style.width = `${width}px`;
            }
            if (height !== undefined) {
              iframeRef.current.style.height = `${height}px`;
            }
          }
        };

        await bridge.connect(
          new PostMessageTransport(
            iframe.contentWindow!,
            iframe.contentWindow!,
          ),
        );

        if (!mounted) return;

        setAppBridge(bridge);
      } catch (err) {
        if (!mounted) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onerrorRef.current?.(error);
      }
    };

    setup();

    return () => {
      mounted = false;
      if (
        iframeRef.current &&
        containerRef.current?.contains(iframeRef.current)
      ) {
        containerRef.current.removeChild(iframeRef.current);
      }
    };
  }, [sandboxUrlHref, client]);

  // Effect 3: When appBridge and HTML exist, send HTML to sandbox
  useEffect(() => {
    if (!appBridge || !resourceHtml) return;
    appBridge.sendSandboxResourceReady({ html: resourceHtml });
  }, [appBridge, resourceHtml]);

  // Effect 4: Send tool input when ready
  useEffect(() => {
    if (appBridge && initialized && toolInput) {
      if (isToolInputPartial) {
        appBridge.sendToolInputPartial({ arguments: toolInput });
      } else {
        appBridge.sendToolInput({ arguments: toolInput });
      }
    }
  }, [appBridge, initialized, toolInput, isToolInputPartial]);

  // Effect 5: Send tool result when ready
  useEffect(() => {
    if (appBridge && initialized && toolResult) {
      appBridge.sendToolResult(toolResult);
    }
  }, [appBridge, initialized, toolResult]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {error && (
        <div style={{ color: "red", padding: "1rem" }}>
          Error: {error.message}
        </div>
      )}
    </div>
  );
};
