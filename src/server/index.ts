/**
 * Utilities for MCP servers to register tools and resources that display interactive UIs.
 *
 * Use these helpers instead of the base SDK's `registerTool` and `registerResource` when
 * your tool should render an {@link app!App} in the client. They handle UI metadata normalization
 * and provide sensible defaults for the MCP Apps MIME type ({@link RESOURCE_MIME_TYPE}).
 *
 * @module server-helpers
 *
 * @example
 * {@includeCode ./index.examples.ts#index_overview}
 */

import {
  RESOURCE_URI_META_KEY,
  RESOURCE_MIME_TYPE,
  McpUiResourceMeta,
  McpUiToolMeta,
} from "../app.js";
import type {
  BaseToolCallback,
  McpServer,
  RegisteredTool,
  ResourceMetadata,
  ToolCallback,
  ReadResourceCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AnySchema,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

// Re-exports for convenience
export { RESOURCE_URI_META_KEY, RESOURCE_MIME_TYPE };
export type { ResourceMetadata, ToolCallback, ReadResourceCallback };

/**
 * Base tool configuration matching the standard MCP server tool options.
 * Extended by {@link McpUiAppToolConfig} to add UI metadata requirements.
 */
export interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: ZodRawShapeCompat | AnySchema;
  outputSchema?: ZodRawShapeCompat | AnySchema;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * Configuration for tools that render an interactive UI.
 *
 * Extends {@link ToolConfig} with a required `_meta` field that specifies UI metadata.
 * The UI resource can be specified in two ways:
 * - `_meta.ui.resourceUri` (preferred)
 * - `_meta["ui/resourceUri"]` (deprecated, for backward compatibility)
 *
 * @see {@link registerAppTool} for the recommended way to register app tools
 */
export interface McpUiAppToolConfig extends ToolConfig {
  _meta: {
    [key: string]: unknown;
  } & (
    | {
        ui: McpUiToolMeta;
      }
    | {
        /**
         * URI of the UI resource to display for this tool.
         * This is converted to `_meta["ui/resourceUri"]`.
         *
         * @example "ui://weather/widget.html"
         *
         * @deprecated Use `_meta.ui.resourceUri` instead.
         */
        [RESOURCE_URI_META_KEY]?: string;
      }
  );
}

/**
 * MCP App Resource configuration for {@link registerAppResource}.
 *
 * Extends the base MCP SDK `ResourceMetadata` with optional UI metadata
 * for configuring security policies and rendering preferences.
 *
 * @see {@link registerAppResource} for usage
 */
export interface McpUiAppResourceConfig extends ResourceMetadata {
  /**
   * Optional UI metadata for the resource.
   * Used to configure security policies (CSP) and rendering preferences.
   */
  _meta?: {
    /**
     * UI-specific metadata including CSP configuration and rendering preferences.
     */
    ui?: McpUiResourceMeta;
    // Allow additional metadata properties for extensibility.
    [key: string]: unknown;
  };
}

/**
 * Register an app tool with the MCP server.
 *
 * This is a convenience wrapper around `server.registerTool` that normalizes
 * UI metadata: if `_meta.ui.resourceUri` is set, the legacy `_meta["ui/resourceUri"]`
 * key is also populated (and vice versa) for compatibility with older hosts.
 *
 * @param server - The MCP server instance
 * @param name - Tool name/identifier
 * @param config - Tool configuration with `_meta` field containing UI metadata
 * @param cb - Tool handler function
 *
 * @example Basic usage
 * {@includeCode ./index.examples.ts#registerAppTool_basicUsage}
 *
 * @example Tool visible to model but not callable by UI
 * {@includeCode ./index.examples.ts#registerAppTool_modelOnlyVisibility}
 *
 * @example Tool hidden from model, only callable by UI
 * {@includeCode ./index.examples.ts#registerAppTool_appOnlyVisibility}
 *
 * @see {@link registerAppResource} to register the HTML resource referenced by the tool
 */
export function registerAppTool<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
>(
  server: Pick<McpServer, "registerTool">,
  name: string,
  config: McpUiAppToolConfig & {
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
  },
  cb: ToolCallback<InputArgs>,
): RegisteredTool {
  // Normalize metadata for backward compatibility:
  // - If _meta.ui.resourceUri is set, also set the legacy flat key
  // - If the legacy flat key is set, also set _meta.ui.resourceUri
  const meta = config._meta;
  const uiMeta = meta.ui as McpUiToolMeta | undefined;
  const legacyUri = meta[RESOURCE_URI_META_KEY] as string | undefined;

  let normalizedMeta = meta;
  if (uiMeta?.resourceUri && !legacyUri) {
    // New format -> also set legacy key
    normalizedMeta = { ...meta, [RESOURCE_URI_META_KEY]: uiMeta.resourceUri };
  } else if (legacyUri && !uiMeta?.resourceUri) {
    // Legacy format -> also set new format
    normalizedMeta = { ...meta, ui: { ...uiMeta, resourceUri: legacyUri } };
  }

  return server.registerTool(name, { ...config, _meta: normalizedMeta }, cb);
}

/**
 * Register an app resource with the MCP server.
 *
 * This is a convenience wrapper around `server.registerResource` that:
 * - Defaults the MIME type to {@link RESOURCE_MIME_TYPE} (`"text/html;profile=mcp-app"`)
 * - Provides a cleaner API matching the SDK's callback signature
 *
 * @param server - The MCP server instance
 * @param name - Human-readable resource name
 * @param uri - Resource URI (should match the `_meta.ui` field in tool config)
 * @param config - Resource configuration
 * @param readCallback - Callback that returns the resource contents
 *
 * @example Basic usage
 * {@includeCode ./index.examples.ts#registerAppResource_basicUsage}
 *
 * @example With CSP configuration for external domains
 * {@includeCode ./index.examples.ts#registerAppResource_withCsp}
 *
 * @see {@link registerAppTool} to register tools that reference this resource
 */
export function registerAppResource(
  server: Pick<McpServer, "registerResource">,
  name: string,
  uri: string,
  config: McpUiAppResourceConfig,
  readCallback: ReadResourceCallback,
): void {
  server.registerResource(
    name,
    uri,
    {
      // Default MIME type for MCP App UI resources (can still be overridden by config below)
      mimeType: RESOURCE_MIME_TYPE,
      ...config,
    },
    readCallback,
  );
}

/**
 * Extension identifier for MCP Apps capability negotiation.
 *
 * Used as the key in `experimental` or `extensions` to advertise MCP Apps support.
 */
export const EXTENSION_ID = "io.modelcontextprotocol/ui";

/**
 * MCP Apps capability settings advertised by clients.
 *
 * @see {@link hasUiSupport} for checking client support
 */
export interface McpUiClientCapability {
  /**
   * Array of supported MIME types for UI resources.
   * Must include `"text/html;profile=mcp-app"` for MCP Apps support.
   */
  mimeTypes?: string[];
}

/**
 * Check if client capabilities indicate MCP Apps support.
 *
 * This helper checks both `experimental` and `extensions` fields for the
 * MCP Apps capability, providing forward compatibility as the MCP specification
 * evolves. Currently, `experimental` is preferred (it's part of the existing
 * MCP schema); once SEP-1724 is accepted, `extensions` will be the canonical
 * location.
 *
 * @param clientCapabilities - The client capabilities from the initialize response
 * @param mimeType - MIME type to check for (defaults to `"text/html;profile=mcp-app"`)
 * @returns `true` if the client supports MCP Apps with the specified MIME type
 *
 * @example Basic usage in server initialization
 * ```typescript
 * import { hasUiSupport, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
 *
 * server.oninitialized = ({ clientCapabilities }) => {
 *   if (hasUiSupport(clientCapabilities)) {
 *     registerAppTool(server, "weather", {
 *       description: "Get weather with interactive dashboard",
 *       _meta: { ui: { resourceUri: "ui://weather/dashboard" } },
 *     }, weatherHandler);
 *   } else {
 *     // Register text-only fallback
 *     server.registerTool("weather", {
 *       description: "Get weather as text",
 *     }, textWeatherHandler);
 *   }
 * };
 * ```
 *
 * @example Checking for specific MIME type
 * ```typescript
 * if (hasUiSupport(clientCapabilities, "application/x-custom-widget")) {
 *   // Client supports custom widget MIME type
 * }
 * ```
 */
export function hasUiSupport(
  clientCapabilities:
    | {
        experimental?: Record<string, unknown>;
        extensions?: Record<string, unknown>;
      }
    | null
    | undefined,
  mimeType: string = RESOURCE_MIME_TYPE,
): boolean {
  if (!clientCapabilities) {
    return false;
  }

  // Check experimental field (current MCP schema)
  const experimentalCap = clientCapabilities.experimental?.[EXTENSION_ID] as
    | McpUiClientCapability
    | undefined;
  if (experimentalCap?.mimeTypes?.includes(mimeType)) {
    return true;
  }

  // Check extensions field (future SEP-1724)
  const extensionsCap = clientCapabilities.extensions?.[EXTENSION_ID] as
    | McpUiClientCapability
    | undefined;
  if (extensionsCap?.mimeTypes?.includes(mimeType)) {
    return true;
  }

  return false;
}

/**
 * Get MCP Apps capability settings from client capabilities.
 *
 * This helper retrieves the capability object from either `experimental` or
 * `extensions`, preferring `extensions` when both are present (for forward
 * compatibility with SEP-1724).
 *
 * @param clientCapabilities - The client capabilities from the initialize response
 * @returns The MCP Apps capability settings, or `undefined` if not supported
 *
 * @example
 * ```typescript
 * import { getUiCapability } from "@modelcontextprotocol/ext-apps/server";
 *
 * const uiCap = getUiCapability(clientCapabilities);
 * if (uiCap?.mimeTypes?.includes("text/html;profile=mcp-app")) {
 *   // Client supports MCP Apps
 * }
 * ```
 */
export function getUiCapability(
  clientCapabilities:
    | {
        experimental?: Record<string, unknown>;
        extensions?: Record<string, unknown>;
      }
    | null
    | undefined,
): McpUiClientCapability | undefined {
  if (!clientCapabilities) {
    return undefined;
  }

  // Prefer extensions when available (forward compatibility with SEP-1724)
  const extensionsCap = clientCapabilities.extensions?.[EXTENSION_ID] as
    | McpUiClientCapability
    | undefined;
  if (extensionsCap) {
    return extensionsCap;
  }

  // Fall back to experimental (current MCP schema)
  return clientCapabilities.experimental?.[EXTENSION_ID] as
    | McpUiClientCapability
    | undefined;
}
