/**
 * Transport adapter for OpenAI Apps SDK (window.openai) compatibility.
 *
 * This transport allows MCP Apps to run in OpenAI's ChatGPT environment by
 * translating between the MCP Apps protocol and the OpenAI Apps SDK APIs.
 *
 * @see https://developers.openai.com/apps-sdk/build/chatgpt-ui/
 */

import {
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCNotification,
  RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  OpenAIGlobal,
  OpenAISafeArea,
  OpenAIDisplayMode,
  OpenAITheme,
  getOpenAIGlobal,
  isOpenAIEnvironment,
} from "./types.js";
import { LATEST_PROTOCOL_VERSION, McpUiHostContext } from "../spec.types.js";

/**
 * Event name dispatched by ChatGPT host when window.openai properties change.
 * @see https://developers.openai.com/apps-sdk/build/chatgpt-ui/
 */
const SET_GLOBALS_EVENT_TYPE = "openai:set_globals";

/**
 * Partial update payload from the openai:set_globals event.
 * Contains only the properties that changed.
 */
interface OpenAIGlobalsChangeDetail {
  theme?: OpenAITheme;
  displayMode?: OpenAIDisplayMode;
  maxHeight?: number;
  safeArea?: OpenAISafeArea;
  locale?: string;
  userAgent?: string;
}

/**
 * JSON-RPC success response message.
 * @internal
 */
interface JSONRPCSuccessResponse {
  jsonrpc: "2.0";
  id: RequestId;
  result: Record<string, unknown>;
}

/**
 * JSON-RPC error response message.
 * @internal
 */
interface JSONRPCErrorResponse {
  jsonrpc: "2.0";
  id: RequestId;
  error: { code: number; message: string; data?: unknown };
}

/**
 * Check if a message is a JSON-RPC request (has method and id).
 */
function isRequest(message: JSONRPCMessage): message is JSONRPCRequest {
  return "method" in message && "id" in message;
}

/**
 * Check if a message is a JSON-RPC notification (has method but no id).
 */
function isNotification(
  message: JSONRPCMessage,
): message is JSONRPCNotification {
  return "method" in message && !("id" in message);
}

/**
 * Transport implementation that bridges MCP Apps protocol to OpenAI Apps SDK.
 *
 * This transport enables MCP Apps to run seamlessly in ChatGPT by:
 * - Synthesizing initialization responses from window.openai properties
 * - Mapping tool calls to window.openai.callTool()
 * - Mapping messages to window.openai.sendFollowUpMessage()
 * - Mapping link opens to window.openai.openExternal()
 * - Reporting size changes via window.openai.notifyIntrinsicHeight()
 *
 * ## Usage
 *
 * Typically you don't create this transport directly. The App will create
 * it automatically when `experimentalOAICompatibility` is enabled (default)
 * and `window.openai` is detected.
 *
 * ```typescript
 * import { App } from '@modelcontextprotocol/ext-apps';
 *
 * const app = new App({ name: "MyApp", version: "1.0.0" }, {});
 * await app.connect(); // Auto-detects OpenAI environment
 * ```
 *
 * ## Manual Usage
 *
 * For advanced use cases, you can create the transport directly:
 *
 * ```typescript
 * import { App, OpenAITransport } from '@modelcontextprotocol/ext-apps';
 *
 * const app = new App({ name: "MyApp", version: "1.0.0" }, {});
 * await app.connect(new OpenAITransport());
 * ```
 *
 * @see {@link App.connect} for automatic transport selection
 * @see {@link PostMessageTransport} for MCP-compatible hosts
 */
export class OpenAITransport implements Transport {
  private openai: OpenAIGlobal;
  private _closed = false;
  private _globalsChangeHandler?: (event: Event) => void;

  /**
   * Create a new OpenAITransport.
   *
   * @throws {Error} If window.openai is not available
   *
   * @example
   * ```typescript
   * if (isOpenAIEnvironment()) {
   *   const transport = new OpenAITransport();
   *   await app.connect(transport);
   * }
   * ```
   */
  constructor() {
    const openai = getOpenAIGlobal();
    if (!openai) {
      throw new Error(
        "OpenAITransport requires window.openai to be available. " +
          "This transport should only be used in OpenAI/ChatGPT environments.",
      );
    }
    this.openai = openai;
  }

  /**
   * Begin listening for messages.
   *
   * Sets up a listener for the `openai:set_globals` event that ChatGPT
   * dispatches when host context properties change (theme, displayMode,
   * safeArea, maxHeight, etc.). Changes are forwarded to the app as
   * `ui/notifications/host-context-changed` notifications.
   */
  async start(): Promise<void> {
    // Listen for OpenAI global property changes
    this._globalsChangeHandler = (event: Event) => {
      if (this._closed) return;

      const detail = (event as CustomEvent<OpenAIGlobalsChangeDetail>).detail;
      if (!detail) return;

      const changes: Partial<McpUiHostContext> = {};
      let hasChanges = false;

      // Map OpenAI properties to MCP host context
      if (detail.safeArea !== undefined) {
        const sa = detail.safeArea;
        if (
          typeof sa.top === "number" &&
          typeof sa.right === "number" &&
          typeof sa.bottom === "number" &&
          typeof sa.left === "number"
        ) {
          changes.safeAreaInsets = sa;
          hasChanges = true;
        }
      }

      if (detail.theme !== undefined) {
        changes.theme = detail.theme;
        hasChanges = true;
      }

      if (detail.displayMode !== undefined) {
        changes.displayMode = detail.displayMode;
        hasChanges = true;
      }

      if (detail.maxHeight !== undefined) {
        changes.containerDimensions = { maxHeight: detail.maxHeight };
        hasChanges = true;
      }

      if (detail.locale !== undefined) {
        changes.locale = detail.locale;
        hasChanges = true;
      }

      if (detail.userAgent !== undefined) {
        changes.userAgent = detail.userAgent;
        hasChanges = true;
      }

      // Forward changes as host-context-changed notification
      if (hasChanges) {
        queueMicrotask(() => {
          this.onmessage?.({
            jsonrpc: "2.0",
            method: "ui/notifications/host-context-changed",
            params: changes,
          } as JSONRPCNotification);
        });
      }
    };

    window.addEventListener(
      SET_GLOBALS_EVENT_TYPE,
      this._globalsChangeHandler,
      { passive: true },
    );
  }

  /**
   * Send a JSON-RPC message.
   *
   * Requests are handled by mapping to window.openai methods.
   * Notifications are handled for size changes; others are no-ops.
   *
   * @param message - JSON-RPC message to send
   * @param _options - Send options (unused)
   */
  async send(
    message: JSONRPCMessage,
    _options?: TransportSendOptions,
  ): Promise<void> {
    if (this._closed) {
      throw new Error("Transport is closed");
    }

    if (isRequest(message)) {
      // Handle requests - map to window.openai methods and synthesize responses
      const response = await this.handleRequest(message);
      // Deliver response asynchronously to maintain message ordering
      queueMicrotask(() => this.onmessage?.(response));
    } else if (isNotification(message)) {
      // Handle notifications
      this.handleNotification(message);
    }
    // Responses are ignored - we don't receive requests from OpenAI
  }

  /**
   * Handle an outgoing JSON-RPC request by mapping to window.openai.
   */
  private async handleRequest(
    request: JSONRPCRequest,
  ): Promise<JSONRPCSuccessResponse | JSONRPCErrorResponse> {
    const { method, id, params } = request;

    try {
      switch (method) {
        case "ui/initialize":
          return this.handleInitialize(id);

        case "tools/call":
          return await this.handleToolCall(
            id,
            params as { name: string; arguments?: Record<string, unknown> },
          );

        case "ui/message":
          return await this.handleMessage(
            id,
            params as { role: string; content: unknown[] },
          );

        case "ui/open-link":
          return await this.handleOpenLink(id, params as { url: string });

        case "ui/request-display-mode":
          return await this.handleRequestDisplayMode(
            id,
            params as { mode: string },
          );

        case "ui/upload-file":
          return await this.handleUploadFile(
            id,
            params as { name: string; mimeType: string; data: string },
          );

        case "ui/get-file-url":
          return await this.handleGetFileUrl(id, params as { fileId: string });

        case "ui/update-model-context":
          return this.handleUpdateModelContextRequest(
            id,
            params as {
              content?: unknown[];
              structuredContent?: Record<string, unknown>;
            },
          );

        case "ping":
          return this.createSuccessResponse(id, {});

        default:
          return this.createErrorResponse(
            id,
            -32601,
            `Method not supported in OpenAI mode: ${method}`,
          );
      }
    } catch (error) {
      return this.createErrorResponse(
        id,
        -32603,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Handle ui/initialize request by synthesizing response from window.openai.
   */
  private handleInitialize(id: RequestId): JSONRPCSuccessResponse {
    // Safely extract userAgent - could be string or object
    let userAgent: string | undefined;
    if (typeof this.openai.userAgent === "string") {
      userAgent = this.openai.userAgent;
    } else if (
      this.openai.userAgent &&
      typeof this.openai.userAgent === "object"
    ) {
      userAgent = JSON.stringify(this.openai.userAgent);
    }

    // Safely extract safeAreaInsets - only include if all values are present
    let safeAreaInsets: McpUiHostContext["safeAreaInsets"];
    const sa = this.openai.safeArea;
    if (
      sa &&
      typeof sa.top === "number" &&
      typeof sa.right === "number" &&
      typeof sa.bottom === "number" &&
      typeof sa.left === "number"
    ) {
      safeAreaInsets = sa;
    }

    const hostContext: McpUiHostContext = {
      theme: this.openai.theme,
      locale: this.openai.locale,
      displayMode: this.openai.displayMode,
      // If requestDisplayMode is available, ChatGPT supports all three modes
      availableDisplayModes: this.openai.requestDisplayMode
        ? ["inline", "pip", "fullscreen"]
        : undefined,
      viewport: this.openai.maxHeight
        ? { width: 0, height: 0, maxHeight: this.openai.maxHeight }
        : undefined,
      safeAreaInsets,
      userAgent,
    };

    // Dynamically determine capabilities based on what window.openai supports
    const hostCapabilities: Record<string, unknown> = {
      // Logging is always available (we map to console.log)
      logging: {},
    };

    // Only advertise serverTools if callTool is available
    if (this.openai.callTool) {
      hostCapabilities.serverTools = {};
    }

    // Only advertise openLinks if openExternal is available
    if (this.openai.openExternal) {
      hostCapabilities.openLinks = {};
    }

    return this.createSuccessResponse(id, {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      hostInfo: {
        name: "ChatGPT",
        version: "1.0.0",
      },
      hostCapabilities,
      hostContext,
    });
  }

  /**
   * Handle tools/call request by delegating to window.openai.callTool().
   */
  private async handleToolCall(
    id: RequestId,
    params: { name: string; arguments?: Record<string, unknown> },
  ): Promise<JSONRPCSuccessResponse | JSONRPCErrorResponse> {
    if (!this.openai.callTool) {
      return this.createErrorResponse(
        id,
        -32601,
        "Tool calls are not supported in this OpenAI environment",
      );
    }

    const result = await this.openai.callTool(params.name, params.arguments);

    // Handle different response formats from OpenAI
    // Could be { content: [...] }, { structuredContent: ... }, or the raw data
    let content: { type: string; text: string }[];
    if (Array.isArray(result.content)) {
      // Clean up content items - remove null values for annotations/_meta
      content = result.content.map((item: unknown) => {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          "text" in item
        ) {
          const typedItem = item as {
            type: string;
            text: string;
            annotations?: unknown;
            _meta?: unknown;
          };
          return { type: typedItem.type, text: typedItem.text };
        }
        return { type: "text", text: JSON.stringify(item) };
      });
    } else if (result.structuredContent !== undefined) {
      content = [
        { type: "text", text: JSON.stringify(result.structuredContent) },
      ];
    } else if (result.content !== undefined) {
      content = [{ type: "text", text: JSON.stringify(result.content) }];
    } else {
      // The result itself might be the structured content
      content = [{ type: "text", text: JSON.stringify(result) }];
    }

    return this.createSuccessResponse(id, {
      content,
      isError: result.isError,
    });
  }

  /**
   * Handle ui/message request by delegating to window.openai.sendFollowUpMessage().
   *
   * For image content, images are uploaded via uploadFile and added to model context
   * via setWidgetState, since sendFollowUpMessage only accepts text.
   */
  private async handleMessage(
    id: RequestId,
    params: { role: string; content: unknown[] },
  ): Promise<JSONRPCSuccessResponse | JSONRPCErrorResponse> {
    if (!this.openai.sendFollowUpMessage) {
      return this.createErrorResponse(
        id,
        -32601,
        "Sending messages is not supported in this OpenAI environment",
      );
    }

    // Extract text content from the message
    const textContent = params.content
      .filter(
        (c): c is { type: "text"; text: string } =>
          typeof c === "object" &&
          c !== null &&
          (c as { type?: string }).type === "text",
      )
      .map((c) => c.text)
      .join("\n");

    // Extract image content blocks
    const imageContent = params.content.filter(
      (c): c is { type: "image"; data: string; mimeType: string } =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "image",
    );

    // Upload images if present and uploadFile is available
    const imageIds: string[] = [];
    if (imageContent.length > 0 && this.openai.uploadFile) {
      for (const image of imageContent) {
        try {
          // Convert base64 data to File object
          const binaryString = atob(image.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: image.mimeType });
          const file = new File(
            [blob],
            `image.${this.getExtension(image.mimeType)}`,
            {
              type: image.mimeType,
            },
          );

          const result = await this.openai.uploadFile(file);
          imageIds.push(result.fileId);
        } catch (error) {
          console.warn("[MCP App] Failed to upload image:", error);
        }
      }

      // Add uploaded images to model context via setWidgetState
      if (imageIds.length > 0 && this.openai.setWidgetState) {
        // Get current state and merge with new imageIds
        const currentState = this.openai.widgetState ?? {};
        const existingImageIds = Array.isArray(
          (currentState as { imageIds?: unknown }).imageIds,
        )
          ? (currentState as { imageIds: string[] }).imageIds
          : [];

        this.openai.setWidgetState({
          ...currentState,
          imageIds: [...existingImageIds, ...imageIds],
        });
      }
    }

    // Send text message (or empty if only images were sent)
    if (textContent || imageIds.length === 0) {
      await this.openai.sendFollowUpMessage({ prompt: textContent });
    }

    return this.createSuccessResponse(id, {});
  }

  /**
   * Get file extension from MIME type.
   */
  private getExtension(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
    };
    return mimeToExt[mimeType] ?? "bin";
  }

  /**
   * Handle ui/open-link request by delegating to window.openai.openExternal().
   */
  private async handleOpenLink(
    id: RequestId,
    params: { url: string },
  ): Promise<JSONRPCSuccessResponse | JSONRPCErrorResponse> {
    if (!this.openai.openExternal) {
      return this.createErrorResponse(
        id,
        -32601,
        "Opening external links is not supported in this OpenAI environment",
      );
    }

    await this.openai.openExternal({ href: params.url });

    return this.createSuccessResponse(id, {});
  }

  /**
   * Handle ui/request-display-mode by delegating to window.openai.requestDisplayMode().
   */
  private async handleRequestDisplayMode(
    id: RequestId,
    params: { mode: string },
  ): Promise<JSONRPCSuccessResponse | JSONRPCErrorResponse> {
    if (!this.openai.requestDisplayMode) {
      return this.createErrorResponse(
        id,
        -32601,
        "Display mode changes are not supported in this OpenAI environment",
      );
    }

    const mode = params.mode as "inline" | "pip" | "fullscreen";
    await this.openai.requestDisplayMode({ mode });

    return this.createSuccessResponse(id, { mode });
  }

  /**
   * Handle ui/upload-file by delegating to window.openai.uploadFile().
   */
  private async handleUploadFile(
    id: RequestId,
    params: { name: string; mimeType: string; data: string },
  ): Promise<JSONRPCSuccessResponse | JSONRPCErrorResponse> {
    if (!this.openai.uploadFile) {
      return this.createErrorResponse(
        id,
        -32601,
        "File upload is not supported in this OpenAI environment",
      );
    }

    // Convert base64 data back to File object
    const binaryString = atob(params.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: params.mimeType });
    const file = new File([blob], params.name, { type: params.mimeType });

    const result = await this.openai.uploadFile(file);

    return this.createSuccessResponse(id, { fileId: result.fileId });
  }

  /**
   * Handle ui/get-file-url by delegating to window.openai.getFileDownloadUrl().
   */
  private async handleGetFileUrl(
    id: RequestId,
    params: { fileId: string },
  ): Promise<JSONRPCSuccessResponse | JSONRPCErrorResponse> {
    if (!this.openai.getFileDownloadUrl) {
      return this.createErrorResponse(
        id,
        -32601,
        "File URL retrieval is not supported in this OpenAI environment",
      );
    }

    const result = await this.openai.getFileDownloadUrl({
      fileId: params.fileId,
    });

    return this.createSuccessResponse(id, { url: result.url });
  }

  /**
   * Handle an outgoing notification.
   */
  private handleNotification(notification: JSONRPCNotification): void {
    const { method, params } = notification;

    switch (method) {
      case "ui/notifications/size-changed":
        this.handleSizeChanged(params as { width?: number; height?: number });
        break;

      case "ui/notifications/initialized":
        // No-op - OpenAI doesn't need this notification
        break;

      case "notifications/message":
        // Log messages - could be sent to console in OpenAI mode
        console.log("[MCP App Log]", params);
        break;

      default:
        // Ignore unknown notifications
        break;
    }
  }

  /**
   * Handle size changed notification by calling window.openai.notifyIntrinsicHeight().
   */
  private handleSizeChanged(params: { width?: number; height?: number }): void {
    if (this.openai.notifyIntrinsicHeight && params.height !== undefined) {
      this.openai.notifyIntrinsicHeight(params.height);
    }
  }

  /**
   * Handle ui/update-model-context request by calling window.openai.setWidgetState().
   *
   * Translates MCP's content/structuredContent format to OpenAI's setWidgetState format.
   */
  private handleUpdateModelContextRequest(
    id: RequestId,
    params: {
      content?: unknown[];
      structuredContent?: Record<string, unknown>;
    },
  ): JSONRPCSuccessResponse | JSONRPCErrorResponse {
    if (!this.openai.setWidgetState) {
      // No-op if setWidgetState is not available, but still return success
      // since the host may not need to persist state
      return this.createSuccessResponse(id, {});
    }

    // Translate MCP format to OpenAI's setWidgetState format
    // content is ContentBlock[], structuredContent is freeform JSON
    let modelContent: string | Record<string, unknown> | null = null;

    // If structuredContent is provided, use it as modelContent
    if (params.structuredContent) {
      modelContent = params.structuredContent;
    } else if (params.content && params.content.length > 0) {
      // Extract text from content blocks
      const textParts = params.content
        .filter(
          (c): c is { type: "text"; text: string } =>
            typeof c === "object" &&
            c !== null &&
            (c as { type?: string }).type === "text",
        )
        .map((c) => c.text);

      if (textParts.length > 0) {
        modelContent = textParts.join("\n");
      }
    }

    this.openai.setWidgetState({
      modelContent,
      privateContent: null,
      imageIds: [],
    });

    return this.createSuccessResponse(id, {});
  }

  /**
   * Create a success JSON-RPC response.
   */
  private createSuccessResponse(
    id: RequestId,
    result: Record<string, unknown>,
  ): JSONRPCSuccessResponse {
    return {
      jsonrpc: "2.0",
      id,
      result,
    };
  }

  /**
   * Create an error JSON-RPC response.
   */
  private createErrorResponse(
    id: RequestId,
    code: number,
    message: string,
  ): JSONRPCErrorResponse {
    return {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    };
  }

  /**
   * Deliver initial tool input, result, and widget state notifications.
   *
   * Called by App after connection to deliver pre-populated data from
   * window.openai as notifications that the app's handlers expect.
   *
   * @internal
   */
  deliverInitialState(): void {
    // Deliver tool input if available
    if (this.openai.toolInput !== undefined) {
      queueMicrotask(() => {
        this.onmessage?.({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-input",
          params: { arguments: this.openai.toolInput },
        } as JSONRPCNotification);
      });
    }

    // Deliver widget state if available (for state hydration)
    if (this.openai.widgetState !== undefined) {
      queueMicrotask(() => {
        this.onmessage?.({
          jsonrpc: "2.0",
          method: "ui/notifications/widget-state",
          params: { state: this.openai.widgetState },
        } as JSONRPCNotification);
      });
    }

    // Deliver tool output if available (check for both null and undefined)
    if (this.openai.toolOutput != null) {
      queueMicrotask(() => {
        // Normalize toolOutput to MCP CallToolResult format
        let content: Array<{
          type: string;
          text?: string;
          [key: string]: unknown;
        }>;
        let structuredContent: Record<string, unknown> | undefined;
        const output = this.openai.toolOutput;

        // Check if output is already a CallToolResult-like object with content/structuredContent
        if (
          typeof output === "object" &&
          output !== null &&
          ("content" in output || "structuredContent" in output)
        ) {
          const result = output as {
            content?: unknown;
            structuredContent?: Record<string, unknown>;
          };
          // Prefer structuredContent if available
          if (result.structuredContent !== undefined) {
            structuredContent = result.structuredContent;
            // Generate content from structuredContent if not provided
            content = Array.isArray(result.content)
              ? result.content
              : [
                  {
                    type: "text",
                    text: JSON.stringify(result.structuredContent),
                  },
                ];
          } else if (Array.isArray(result.content)) {
            content = result.content;
          } else {
            content = [{ type: "text", text: JSON.stringify(output) }];
          }
        } else if (Array.isArray(output)) {
          // Already an array of content blocks
          content = output;
        } else if (
          typeof output === "object" &&
          output !== null &&
          "type" in output &&
          typeof (output as { type: unknown }).type === "string"
        ) {
          // Single content block object like {type: "text", text: "..."}
          content = [output as { type: string; text?: string }];
        } else if (
          typeof output === "object" &&
          output !== null &&
          "text" in output &&
          typeof (output as { text: unknown }).text === "string"
        ) {
          // Object with just text field - treat as text content
          content = [{ type: "text", text: (output as { text: string }).text }];
        } else if (typeof output === "object" && output !== null) {
          // Plain object - use as structuredContent and generate text content
          structuredContent = output as Record<string, unknown>;
          content = [{ type: "text", text: JSON.stringify(output) }];
        } else {
          // Unknown shape - stringify it
          content = [{ type: "text", text: JSON.stringify(output) }];
        }

        this.onmessage?.({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            content,
            structuredContent,
            // Include _meta from toolResponseMetadata if available (use undefined not null)
            _meta: this.openai.toolResponseMetadata ?? undefined,
          },
        } as JSONRPCNotification);
      });
    }
  }

  /**
   * Close the transport.
   */
  async close(): Promise<void> {
    this._closed = true;

    // Clean up the globals change listener
    if (this._globalsChangeHandler) {
      window.removeEventListener(
        SET_GLOBALS_EVENT_TYPE,
        this._globalsChangeHandler,
      );
      this._globalsChangeHandler = undefined;
    }

    this.onclose?.();
  }

  /**
   * Called when the transport is closed.
   */
  onclose?: () => void;

  /**
   * Called when an error occurs.
   */
  onerror?: (error: Error) => void;

  /**
   * Called when a message is received.
   */
  onmessage?: (message: JSONRPCMessage) => void;

  /**
   * Session identifier (unused in OpenAI mode).
   */
  sessionId?: string;

  /**
   * Callback to set the negotiated protocol version.
   */
  setProtocolVersion?: (version: string) => void;
}

// Re-export utility functions
export { isOpenAIEnvironment, getOpenAIGlobal };
