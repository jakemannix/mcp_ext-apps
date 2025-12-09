package io.modelcontextprotocol.apps

import io.modelcontextprotocol.apps.protocol.*
import io.modelcontextprotocol.apps.transport.McpAppsTransport
import io.modelcontextprotocol.apps.types.*
import io.modelcontextprotocol.kotlin.sdk.CallToolResult
import io.modelcontextprotocol.kotlin.sdk.Client
import io.modelcontextprotocol.kotlin.sdk.Implementation
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

/**
 * Options for configuring AppBridge behavior.
 */
data class HostOptions(
    /** Initial host context to send during initialization */
    val hostContext: McpUiHostContext = McpUiHostContext()
)

/**
 * Host-side bridge for communicating with a single Guest UI (App).
 *
 * AppBridge acts as a proxy between the host application and a Guest UI
 * running in a WebView. It handles the initialization handshake and
 * forwards MCP server capabilities to the Guest UI.
 *
 * ## Architecture
 *
 * **Guest UI ↔ AppBridge ↔ Host ↔ MCP Server**
 *
 * ## Lifecycle
 *
 * 1. **Create**: Instantiate AppBridge with MCP client and capabilities
 * 2. **Connect**: Call `connect()` with transport to establish communication
 * 3. **Wait for init**: Guest UI sends initialize request, bridge responds
 * 4. **Send data**: Call `sendToolInput()`, `sendToolResult()`, etc.
 * 5. **Teardown**: Call `sendResourceTeardown()` before unmounting WebView
 *
 * @param mcpClient MCP client connected to the server (for proxying requests)
 * @param hostInfo Host application identification (name and version)
 * @param hostCapabilities Features and capabilities the host supports
 * @param options Configuration options
 */
class AppBridge(
    private val mcpClient: Client,
    private val hostInfo: Implementation,
    private val hostCapabilities: McpUiHostCapabilities,
    private val options: HostOptions = HostOptions()
) : Protocol() {

    private var appCapabilities: McpUiAppCapabilities? = null
    private var appInfo: Implementation? = null
    private var hostContext: McpUiHostContext = options.hostContext
    private var isInitialized: Boolean = false

    // Callbacks
    var onInitialized: (() -> Unit)? = null
    var onSizeChange: ((width: Int?, height: Int?) -> Unit)? = null
    var onMessage: (suspend (role: String, content: List<io.modelcontextprotocol.kotlin.sdk.ContentBlock>) -> McpUiMessageResult)? = null
    var onOpenLink: (suspend (url: String) -> McpUiOpenLinkResult)? = null
    var onLoggingMessage: ((level: LogLevel, data: JsonElement, logger: String?) -> Unit)? = null
    var onPing: (() -> Unit)? = null

    init {
        setupHandlers()
    }

    private fun setupHandlers() {
        // Handle ui/initialize request
        setRequestHandler(
            method = "ui/initialize",
            paramsDeserializer = { params ->
                json.decodeFromJsonElement<McpUiInitializeParams>(params ?: JsonObject(emptyMap()))
            },
            resultSerializer = { result: McpUiInitializeResult ->
                json.encodeToJsonElement(result)
            }
        ) { params ->
            handleInitialize(params)
        }

        // Handle ui/notifications/initialized notification
        setNotificationHandler(
            method = "ui/notifications/initialized",
            paramsDeserializer = { Unit }
        ) {
            isInitialized = true
            onInitialized?.invoke()
        }

        // Handle ui/notifications/size-changed notification
        setNotificationHandler(
            method = "ui/notifications/size-changed",
            paramsDeserializer = { params ->
                json.decodeFromJsonElement<McpUiSizeChangedParams>(params ?: JsonObject(emptyMap()))
            }
        ) { params ->
            onSizeChange?.invoke(params.width, params.height)
        }

        // Handle ui/message request
        setRequestHandler(
            method = "ui/message",
            paramsDeserializer = { params ->
                json.decodeFromJsonElement<McpUiMessageParams>(params ?: JsonObject(emptyMap()))
            },
            resultSerializer = { result: McpUiMessageResult ->
                json.encodeToJsonElement(result)
            }
        ) { params ->
            onMessage?.invoke(params.role, params.content) ?: McpUiMessageResult(isError = true)
        }

        // Handle ui/open-link request
        setRequestHandler(
            method = "ui/open-link",
            paramsDeserializer = { params ->
                json.decodeFromJsonElement<McpUiOpenLinkParams>(params ?: JsonObject(emptyMap()))
            },
            resultSerializer = { result: McpUiOpenLinkResult ->
                json.encodeToJsonElement(result)
            }
        ) { params ->
            onOpenLink?.invoke(params.url) ?: McpUiOpenLinkResult(isError = true)
        }

        // Handle notifications/message (logging)
        setNotificationHandler(
            method = "notifications/message",
            paramsDeserializer = { params ->
                json.decodeFromJsonElement<LoggingMessageParams>(params ?: JsonObject(emptyMap()))
            }
        ) { params ->
            onLoggingMessage?.invoke(params.level, params.data, params.logger)
        }

        // Handle ping request
        setRequestHandler(
            method = "ping",
            paramsDeserializer = { Unit },
            resultSerializer = { JsonObject(emptyMap()) }
        ) {
            onPing?.invoke()
        }
    }

    private fun handleInitialize(params: McpUiInitializeParams): McpUiInitializeResult {
        appCapabilities = params.appCapabilities
        appInfo = params.appInfo

        val requestedVersion = params.protocolVersion
        val protocolVersion = if (McpAppsConfig.SUPPORTED_PROTOCOL_VERSIONS.contains(requestedVersion)) {
            requestedVersion
        } else {
            McpAppsConfig.LATEST_PROTOCOL_VERSION
        }

        return McpUiInitializeResult(
            protocolVersion = protocolVersion,
            hostInfo = hostInfo,
            hostCapabilities = hostCapabilities,
            hostContext = hostContext
        )
    }

    /**
     * Get the Guest UI's capabilities discovered during initialization.
     */
    fun getAppCapabilities(): McpUiAppCapabilities? = appCapabilities

    /**
     * Get the Guest UI's implementation info discovered during initialization.
     */
    fun getAppVersion(): Implementation? = appInfo

    /**
     * Check if the Guest UI has completed initialization.
     */
    fun isReady(): Boolean = isInitialized

    /**
     * Update the host context and notify the Guest UI of changes.
     *
     * Only changed fields are sent to the Guest UI.
     */
    suspend fun setHostContext(newContext: McpUiHostContext) {
        // Compare and find changes (simplified - in production, implement deep comparison)
        val hasChanges = newContext != hostContext
        if (hasChanges) {
            hostContext = newContext
            notification(
                method = "ui/notifications/host-context-changed",
                params = newContext,
                paramsSerializer = { json.encodeToJsonElement(it) as JsonObject }
            )
        }
    }

    /**
     * Send complete tool arguments to the Guest UI.
     *
     * Call this after the Guest UI completes initialization (after onInitialized fires).
     */
    suspend fun sendToolInput(arguments: Map<String, JsonElement>?) {
        notification(
            method = "ui/notifications/tool-input",
            params = McpUiToolInputParams(arguments = arguments),
            paramsSerializer = { json.encodeToJsonElement(it) as JsonObject }
        )
    }

    /**
     * Send streaming partial tool arguments to the Guest UI.
     *
     * Call this zero or more times while tool arguments are being streamed,
     * before sendToolInput() is called with complete arguments.
     */
    suspend fun sendToolInputPartial(arguments: Map<String, JsonElement>?) {
        notification(
            method = "ui/notifications/tool-input-partial",
            params = McpUiToolInputPartialParams(arguments = arguments),
            paramsSerializer = { json.encodeToJsonElement(it) as JsonObject }
        )
    }

    /**
     * Send tool execution result to the Guest UI.
     *
     * Call this when tool execution completes, provided the UI is still displayed.
     */
    suspend fun sendToolResult(result: CallToolResult) {
        notification(
            method = "ui/notifications/tool-result",
            params = result,
            paramsSerializer = { json.encodeToJsonElement(it) as JsonObject }
        )
    }

    /**
     * Send HTML resource to the sandbox proxy for secure loading.
     *
     * Internal method for web-based hosts implementing double-iframe sandbox.
     */
    suspend fun sendSandboxResourceReady(html: String, sandbox: String? = null, csp: CspConfig? = null) {
        notification(
            method = "ui/notifications/sandbox-resource-ready",
            params = McpUiSandboxResourceReadyParams(html = html, sandbox = sandbox, csp = csp),
            paramsSerializer = { json.encodeToJsonElement(it) as JsonObject }
        )
    }

    /**
     * Request graceful shutdown of the Guest UI.
     *
     * Call this before tearing down the WebView. The Guest UI has an opportunity
     * to save state and cancel pending operations.
     *
     * @return Result indicating the Guest UI is ready for teardown
     */
    suspend fun sendResourceTeardown(): McpUiResourceTeardownResult {
        return request(
            method = "ui/resource-teardown",
            params = McpUiResourceTeardownParams(),
            paramsSerializer = { JsonObject(emptyMap()) },
            resultDeserializer = { McpUiResourceTeardownResult() }
        )
    }

    /**
     * Connect to the Guest UI via transport and set up message forwarding.
     *
     * This establishes the transport connection and automatically sets up
     * request/notification forwarding based on the MCP server's capabilities.
     * It proxies the following server capabilities to the Guest UI:
     * - Tools (tools/call, notifications/tools/list_changed)
     * - Resources (resources/read, resources/list, resources/templates/list, notifications/resources/list_changed)
     * - Prompts (prompts/list, notifications/prompts/list_changed)
     *
     * After calling this, wait for the onInitialized callback before sending data.
     *
     * @param transport The transport layer for communication with the Guest UI
     * @throws IllegalStateException if server capabilities are not available. This occurs when
     *   connect() is called before the MCP client has completed its initialization with the server.
     *   Ensure the client's connect() completes before calling bridge.connect().
     */
    override suspend fun connect(transport: McpAppsTransport) {
        super.connect(transport)

        // Forward core available MCP features based on server capabilities
        val serverCapabilities = mcpClient.getServerCapabilities()
        if (serverCapabilities == null) {
            throw IllegalStateException("Client server capabilities not available")
        }

        // Forward tools capability if available
        if (serverCapabilities.tools != null) {
            // Forward tools/call requests
            setRequestHandler(
                method = "tools/call",
                paramsDeserializer = { it },  // Pass through as JsonObject
                resultSerializer = { it }     // Pass through as JsonElement
            ) { params ->
                println("Forwarding request tools/call from MCP UI client")
                val result = mcpClient.callTool(
                    json.decodeFromJsonElement(params ?: JsonObject(emptyMap()))
                )
                json.encodeToJsonElement(result)
            }

            // Forward tools/list_changed notifications if supported
            if (serverCapabilities.tools?.listChanged == true) {
                setNotificationHandler(
                    method = "notifications/tools/list_changed",
                    paramsDeserializer = { it }
                ) { _ ->
                    println("Forwarding notification notifications/tools/list_changed from MCP UI client")
                    // Notifications are received from Guest UI but typically don't need forwarding to server
                }
            }
        }

        // Forward resources capability if available
        if (serverCapabilities.resources != null) {
            // Forward resources/read requests
            setRequestHandler(
                method = "resources/read",
                paramsDeserializer = { it },
                resultSerializer = { it }
            ) { params ->
                println("Forwarding request resources/read from MCP UI client")
                val result = mcpClient.readResource(
                    json.decodeFromJsonElement(params ?: JsonObject(emptyMap()))
                )
                json.encodeToJsonElement(result)
            }

            // Forward resources/list requests
            setRequestHandler(
                method = "resources/list",
                paramsDeserializer = { it },
                resultSerializer = { it }
            ) { params ->
                println("Forwarding request resources/list from MCP UI client")
                val result = mcpClient.listResources(
                    json.decodeFromJsonElement(params ?: JsonObject(emptyMap()))
                )
                json.encodeToJsonElement(result)
            }

            // Forward resources/templates/list requests
            setRequestHandler(
                method = "resources/templates/list",
                paramsDeserializer = { it },
                resultSerializer = { it }
            ) { params ->
                println("Forwarding request resources/templates/list from MCP UI client")
                val result = mcpClient.listResourceTemplates(
                    json.decodeFromJsonElement(params ?: JsonObject(emptyMap()))
                )
                json.encodeToJsonElement(result)
            }

            // Forward resources/list_changed notifications if supported
            if (serverCapabilities.resources?.listChanged == true) {
                setNotificationHandler(
                    method = "notifications/resources/list_changed",
                    paramsDeserializer = { it }
                ) { _ ->
                    println("Forwarding notification notifications/resources/list_changed from MCP UI client")
                }
            }
        }

        // Forward prompts capability if available
        if (serverCapabilities.prompts != null) {
            // Forward prompts/list requests
            setRequestHandler(
                method = "prompts/list",
                paramsDeserializer = { it },
                resultSerializer = { it }
            ) { params ->
                println("Forwarding request prompts/list from MCP UI client")
                val result = mcpClient.listPrompts(
                    json.decodeFromJsonElement(params ?: JsonObject(emptyMap()))
                )
                json.encodeToJsonElement(result)
            }

            // Forward prompts/list_changed notifications if supported
            if (serverCapabilities.prompts?.listChanged == true) {
                setNotificationHandler(
                    method = "notifications/prompts/list_changed",
                    paramsDeserializer = { it }
                ) { _ ->
                    println("Forwarding notification notifications/prompts/list_changed from MCP UI client")
                }
            }
        }
    }
}
