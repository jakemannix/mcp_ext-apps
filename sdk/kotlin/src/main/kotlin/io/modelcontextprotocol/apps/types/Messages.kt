package io.modelcontextprotocol.apps.types

import io.modelcontextprotocol.kotlin.sdk.Implementation
import io.modelcontextprotocol.kotlin.sdk.CallToolResult
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// =============================================================================
// Initialization Messages
// =============================================================================

/**
 * Parameters for the ui/initialize request from Guest UI to Host.
 */
@Serializable
data class McpUiInitializeParams(
    /** App identification (name and version) */
    val appInfo: Implementation,
    /** Features and capabilities this app provides */
    val appCapabilities: McpUiAppCapabilities,
    /** Protocol version this app supports */
    val protocolVersion: String
)

/**
 * Result from the ui/initialize request.
 */
@Serializable
data class McpUiInitializeResult(
    /** Negotiated protocol version string */
    val protocolVersion: String,
    /** Host application identification and version */
    val hostInfo: Implementation,
    /** Features and capabilities provided by the host */
    val hostCapabilities: McpUiHostCapabilities,
    /** Rich context about the host environment */
    val hostContext: McpUiHostContext
)

// =============================================================================
// Tool Notifications (Host → Guest)
// =============================================================================

/**
 * Parameters for ui/notifications/tool-input notification.
 * Contains complete tool arguments sent to the Guest UI.
 */
@Serializable
data class McpUiToolInputParams(
    /** Complete tool call arguments as key-value pairs */
    val arguments: Map<String, JsonElement>? = null
)

/**
 * Parameters for ui/notifications/tool-input-partial notification.
 * Contains partial/streaming tool arguments during tool call initialization.
 */
@Serializable
data class McpUiToolInputPartialParams(
    /** Partial tool call arguments (incomplete, may change) */
    val arguments: Map<String, JsonElement>? = null
)

/**
 * Parameters for ui/notifications/tool-result notification.
 * Uses the standard MCP CallToolResult type.
 */
typealias McpUiToolResultParams = CallToolResult

// =============================================================================
// Size Notification (Bidirectional)
// =============================================================================

/**
 * Parameters for ui/notifications/size-changed notification.
 */
@Serializable
data class McpUiSizeChangedParams(
    /** New width in pixels */
    val width: Int? = null,
    /** New height in pixels */
    val height: Int? = null
)

// =============================================================================
// Host Context Notification (Host → Guest)
// =============================================================================

/**
 * Parameters for ui/notifications/host-context-changed notification.
 * Contains partial updates - only changed fields are sent.
 */
typealias McpUiHostContextChangedParams = McpUiHostContext

// =============================================================================
// Message Request (Guest → Host)
// =============================================================================

/**
 * Parameters for ui/message request.
 */
@Serializable
data class McpUiMessageParams(
    /** Message role, currently only "user" is supported */
    val role: String = "user",
    /** Message content blocks (text, image, etc.) */
    val content: List<JsonElement>
)

/**
 * Result from ui/message request.
 */
@Serializable
data class McpUiMessageResult(
    /**
     * True if the host rejected or failed to deliver the message.
     * False or null indicates the message was accepted.
     */
    val isError: Boolean? = null
)

// =============================================================================
// Open Link Request (Guest → Host)
// =============================================================================

/**
 * Parameters for ui/open-link request.
 */
@Serializable
data class McpUiOpenLinkParams(
    /** URL to open in the host's browser */
    val url: String
)

/**
 * Result from ui/open-link request.
 */
@Serializable
data class McpUiOpenLinkResult(
    /**
     * True if the host failed to open the URL.
     * False or null indicates success.
     */
    val isError: Boolean? = null
)

// =============================================================================
// Resource Teardown Request (Host → Guest)
// =============================================================================

/**
 * Parameters for ui/resource-teardown request.
 */
@Serializable
class McpUiResourceTeardownParams

/**
 * Result from ui/resource-teardown request.
 * Empty result indicates the Guest UI is ready to be torn down.
 */
@Serializable
class McpUiResourceTeardownResult

// =============================================================================
// Sandbox Messages (Internal, for web hosts)
// =============================================================================

/**
 * Parameters for ui/notifications/sandbox-proxy-ready notification.
 */
@Serializable
class McpUiSandboxProxyReadyParams

/**
 * Parameters for ui/notifications/sandbox-resource-ready notification.
 */
@Serializable
data class McpUiSandboxResourceReadyParams(
    /** HTML content to load into the inner iframe */
    val html: String,
    /** Optional override for the inner iframe's sandbox attribute */
    val sandbox: String? = null,
    /** CSP configuration from resource metadata */
    val csp: CspConfig? = null
)

@Serializable
data class CspConfig(
    /** Origins for network requests (fetch/XHR/WebSocket) */
    val connectDomains: List<String>? = null,
    /** Origins for static resources (scripts, images, styles, fonts) */
    val resourceDomains: List<String>? = null
)

// =============================================================================
// Logging Notification (Guest → Host)
// =============================================================================

/**
 * Log level for logging messages.
 */
@Serializable
enum class LogLevel {
    @SerialName("debug") DEBUG,
    @SerialName("info") INFO,
    @SerialName("notice") NOTICE,
    @SerialName("warning") WARNING,
    @SerialName("error") ERROR,
    @SerialName("critical") CRITICAL,
    @SerialName("alert") ALERT,
    @SerialName("emergency") EMERGENCY
}

/**
 * Parameters for notifications/message (logging) notification.
 */
@Serializable
data class LoggingMessageParams(
    /** Log level */
    val level: LogLevel,
    /** Log message and optional structured data */
    val data: JsonElement,
    /** Optional logger name/identifier */
    val logger: String? = null
)

// =============================================================================
// UI Resource Metadata
// =============================================================================

/**
 * Content Security Policy configuration for UI resources.
 */
@Serializable
data class McpUiResourceCsp(
    /** Origins for network requests (fetch/XHR/WebSocket). Maps to CSP connect-src */
    val connectDomains: List<String>? = null,
    /** Origins for static resources. Maps to CSP img-src, script-src, style-src, font-src */
    val resourceDomains: List<String>? = null
)

/**
 * UI Resource metadata for security and rendering configuration.
 */
@Serializable
data class McpUiResourceMeta(
    /** Content Security Policy configuration */
    val csp: McpUiResourceCsp? = null,
    /** Dedicated origin for widget sandbox */
    val domain: String? = null,
    /** Visual boundary preference - true if UI prefers a visible border */
    val prefersBorder: Boolean? = null
)
