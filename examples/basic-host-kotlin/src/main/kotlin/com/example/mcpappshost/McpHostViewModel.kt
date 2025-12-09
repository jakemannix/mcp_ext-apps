package com.example.mcpappshost

import android.util.Log
import android.webkit.WebView
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.modelcontextprotocol.apps.AppBridge
import io.modelcontextprotocol.apps.HostOptions
import io.modelcontextprotocol.apps.transport.WebViewTransport
import io.modelcontextprotocol.apps.types.*
import io.modelcontextprotocol.kotlin.sdk.CallToolResult
import io.modelcontextprotocol.kotlin.sdk.Client
import io.modelcontextprotocol.kotlin.sdk.Implementation
import io.modelcontextprotocol.kotlin.sdk.Tool
import io.modelcontextprotocol.kotlin.sdk.shared.StreamableHTTPClientTransport
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject

private const val TAG = "McpHostViewModel"

/**
 * Wrapper for WebView state that can be passed between UI states.
 */
class WebViewState {
    var webView: WebView? = null
}

/**
 * UI state for the MCP Apps host.
 */
sealed class McpUiState {
    data class Idle(val serverUrl: String = "http://10.0.2.2:3000/sse") : McpUiState()
    data object Connecting : McpUiState()
    data class Connected(
        val serverName: String,
        val tools: List<String>,
        val selectedTool: String = "",
        val toolInput: String = "{}"
    ) : McpUiState()
    data class ToolExecuting(val toolName: String) : McpUiState()
    data class ShowingApp(
        val toolName: String,
        val webViewState: WebViewState
    ) : McpUiState()
    data class Error(val message: String) : McpUiState()
}

/**
 * ViewModel managing MCP connection and AppBridge lifecycle.
 *
 * This ViewModel demonstrates the complete flow for hosting MCP Apps:
 *
 * 1. **Connection**: Connect to an MCP server using the Kotlin SDK Client
 * 2. **Discovery**: List available tools from the server
 * 3. **Tool Call**: Call a tool and get its result
 * 4. **UI Resource**: Read the tool's UI resource (HTML) if available
 * 5. **AppBridge**: Create and connect AppBridge for communication
 * 6. **WebView**: Load the UI in a WebView using WebViewTransport
 * 7. **Communication**: Handle all AppBridge callbacks (initialization, messages, etc.)
 */
class McpHostViewModel : ViewModel() {
    private val _uiState = MutableStateFlow<McpUiState>(McpUiState.Idle())
    val uiState: StateFlow<McpUiState> = _uiState.asStateFlow()

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    // MCP Client and connection state
    private var mcpClient: Client? = null
    private var serverName: String = ""
    private var availableTools: Map<String, Tool> = emptyMap()

    // AppBridge and transport
    private var appBridge: AppBridge? = null
    private var transport: WebViewTransport? = null

    fun updateServerUrl(url: String) {
        val current = _uiState.value
        if (current is McpUiState.Idle) {
            _uiState.value = current.copy(serverUrl = url)
        }
    }

    fun selectTool(toolName: String) {
        val current = _uiState.value
        if (current is McpUiState.Connected) {
            _uiState.value = current.copy(selectedTool = toolName)
        }
    }

    fun updateToolInput(input: String) {
        val current = _uiState.value
        if (current is McpUiState.Connected) {
            _uiState.value = current.copy(toolInput = input)
        }
    }

    /**
     * Step 1: Connect to MCP server and list available tools.
     */
    fun connectToServer() {
        val currentState = _uiState.value
        if (currentState !is McpUiState.Idle) return

        viewModelScope.launch {
            try {
                _uiState.value = McpUiState.Connecting
                Log.i(TAG, "Connecting to server: ${currentState.serverUrl}")

                // Create MCP client with host information
                val hostImpl = Implementation(
                    name = "MCP Apps Android Host",
                    version = "1.0.0"
                )
                val client = Client(hostImpl)

                // Connect to the server
                // Note: Use 10.0.2.2 instead of localhost when running in Android emulator
                val transport = StreamableHTTPClientTransport(currentState.serverUrl)
                client.connect(transport)

                // Get server information
                val serverVersion = client.getServerVersion()
                serverName = serverVersion?.name ?: "Unknown Server"
                Log.i(TAG, "Connected to: $serverName")

                // List available tools
                val toolsResult = client.listTools()
                availableTools = toolsResult.tools.associateBy { it.name }
                Log.i(TAG, "Available tools: ${availableTools.keys}")

                // Store the client for later use
                mcpClient = client

                _uiState.value = McpUiState.Connected(
                    serverName = serverName,
                    tools = availableTools.keys.toList(),
                    selectedTool = availableTools.keys.firstOrNull() ?: "",
                    toolInput = "{}"
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to connect to server", e)
                _uiState.value = McpUiState.Error("Failed to connect: ${e.message}")
            }
        }
    }

    /**
     * Step 2: Call the selected tool and display its UI if available.
     */
    fun callTool() {
        val currentState = _uiState.value
        if (currentState !is McpUiState.Connected) return

        val client = mcpClient ?: return
        val toolName = currentState.selectedTool
        val tool = availableTools[toolName] ?: return

        viewModelScope.launch {
            try {
                _uiState.value = McpUiState.ToolExecuting(toolName)
                Log.i(TAG, "Calling tool: $toolName")

                // Parse tool input
                val arguments = try {
                    json.decodeFromString<JsonObject>(currentState.toolInput)
                } catch (e: Exception) {
                    Log.w(TAG, "Invalid JSON input, using empty object", e)
                    buildJsonObject { }
                }

                // Check if tool has a UI resource
                val uiResourceUri = getUiResourceUri(tool)
                Log.i(TAG, "Tool UI resource URI: $uiResourceUri")

                if (uiResourceUri != null) {
                    // This tool has a UI - set up AppBridge and WebView
                    setupAppBridgeAndWebView(client, tool, arguments, uiResourceUri)
                } else {
                    // No UI - just call the tool and show the result
                    val result = client.callTool(
                        io.modelcontextprotocol.kotlin.sdk.CallToolRequest(
                            name = toolName,
                            arguments = arguments
                        )
                    )
                    Log.i(TAG, "Tool result: $result")
                    _uiState.value = McpUiState.Error(
                        "Tool executed successfully but has no UI.\nResult: ${json.encodeToString(CallToolResult.serializer(), result)}"
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to call tool", e)
                _uiState.value = McpUiState.Error("Failed to call tool: ${e.message}")
            }
        }
    }

    /**
     * Get the UI resource URI from tool metadata if available.
     */
    private fun getUiResourceUri(tool: Tool): String? {
        // Check tool._meta.ui.resourceUri for the UI resource URI
        val meta = tool._meta
        if (meta != null && meta is JsonObject) {
            val ui = meta["ui"]
            if (ui != null && ui is JsonObject) {
                val resourceUri = ui["resourceUri"]
                if (resourceUri != null) {
                    val uriString = resourceUri.toString().trim('"')
                    if (uriString.startsWith("ui://")) {
                        return uriString
                    }
                }
            }
        }
        return null
    }

    /**
     * Step 3: Set up AppBridge with WebView and load the UI resource.
     */
    private suspend fun setupAppBridgeAndWebView(
        client: Client,
        tool: Tool,
        arguments: JsonObject,
        uiResourceUri: String
    ) {
        try {
            Log.i(TAG, "Reading UI resource: $uiResourceUri")

            // Read the UI resource (HTML) from the server
            val resource = client.readResource(
                io.modelcontextprotocol.kotlin.sdk.ReadResourceRequest(uri = uiResourceUri)
            )

            if (resource.contents.isEmpty()) {
                throw IllegalStateException("No resource content received")
            }

            val content = resource.contents[0]

            // Verify MIME type
            val expectedMimeType = "text/html;profile=mcp-app"
            if (content.mimeType != expectedMimeType) {
                Log.w(TAG, "Unexpected MIME type: ${content.mimeType}, expected: $expectedMimeType")
            }

            // Extract HTML content
            val html = when {
                content is io.modelcontextprotocol.kotlin.sdk.TextContent -> content.text
                content is io.modelcontextprotocol.kotlin.sdk.BlobContent -> {
                    // Decode base64 blob
                    String(android.util.Base64.decode(content.blob, android.util.Base64.DEFAULT))
                }
                else -> throw IllegalStateException("Unsupported content type: ${content::class.simpleName}")
            }

            Log.i(TAG, "Loaded UI resource HTML (${html.length} bytes)")

            // Create WebView state
            val webViewState = WebViewState()

            // Update UI to show the WebView
            _uiState.value = McpUiState.ShowingApp(
                toolName = tool.name,
                webViewState = webViewState
            )

            // Wait for WebView to be created by Compose
            // In a real app, you might want a more robust mechanism
            var attempts = 0
            while (webViewState.webView == null && attempts < 50) {
                kotlinx.coroutines.delay(100)
                attempts++
            }

            val webView = webViewState.webView
            if (webView == null) {
                throw IllegalStateException("WebView not initialized")
            }

            Log.i(TAG, "WebView initialized, setting up AppBridge")

            // Create AppBridge with server capabilities
            val serverCapabilities = client.getServerCapabilities()
            val hostCapabilities = McpUiHostCapabilities(
                serverTools = serverCapabilities?.tools?.let {
                    ServerToolsCapability(listChanged = it.listChanged)
                },
                serverResources = serverCapabilities?.resources?.let {
                    ServerResourcesCapability(listChanged = it.listChanged)
                },
                openLinks = emptyMap(),
                logging = emptyMap()
            )

            val hostImpl = Implementation(
                name = "MCP Apps Android Host",
                version = "1.0.0"
            )

            val bridge = AppBridge(
                mcpClient = client,
                hostInfo = hostImpl,
                hostCapabilities = hostCapabilities,
                options = HostOptions(
                    hostContext = McpUiHostContext(
                        toolInfo = ToolInfo(
                            tool = tool,
                            id = null
                        ),
                        theme = McpUiTheme.LIGHT,
                        platform = McpUiPlatform.MOBILE,
                        deviceCapabilities = DeviceCapabilities(
                            touch = true,
                            hover = false
                        )
                    )
                )
            )

            // Set up AppBridge callbacks
            setupAppBridgeCallbacks(bridge)

            // Create WebView transport
            val webViewTransport = WebViewTransport(webView, json)
            transport = webViewTransport

            // Start the transport
            webViewTransport.start()

            // Connect the AppBridge
            Log.i(TAG, "Connecting AppBridge...")
            bridge.connect(webViewTransport)
            appBridge = bridge

            // Wait for initialization
            var initialized = false
            bridge.onInitialized = {
                Log.i(TAG, "AppBridge initialized!")
                initialized = true
            }

            // Wait for initialization to complete (with timeout)
            attempts = 0
            while (!initialized && attempts < 50) {
                kotlinx.coroutines.delay(100)
                attempts++
            }

            if (!initialized) {
                Log.w(TAG, "AppBridge initialization timeout, but continuing...")
            }

            // Load the HTML directly in the WebView
            Log.i(TAG, "Loading HTML in WebView")
            webView.post {
                webView.loadDataWithBaseURL(
                    "https://mcp-app.local/",
                    html,
                    "text/html",
                    "UTF-8",
                    null
                )
            }

            // Send tool input to the app
            Log.i(TAG, "Sending tool input: $arguments")
            bridge.sendToolInput(arguments)

            // Call the tool and send result when ready
            viewModelScope.launch {
                try {
                    val result = client.callTool(
                        io.modelcontextprotocol.kotlin.sdk.CallToolRequest(
                            name = tool.name,
                            arguments = arguments
                        )
                    )
                    Log.i(TAG, "Tool result received, sending to app")
                    bridge.sendToolResult(result)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to call tool or send result", e)
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "Failed to set up AppBridge and WebView", e)
            _uiState.value = McpUiState.Error("Failed to load UI: ${e.message}")
        }
    }

    /**
     * Set up AppBridge callback handlers.
     */
    private fun setupAppBridgeCallbacks(bridge: AppBridge) {
        // Called when the Guest UI completes initialization
        bridge.onInitialized = {
            Log.i(TAG, "Guest UI initialized")
        }

        // Called when the Guest UI requests a size change
        bridge.onSizeChange = { width, height ->
            Log.i(TAG, "Guest UI requested size change: ${width}x${height}")
            // In a real app, you might adjust the WebView size here
        }

        // Called when the Guest UI sends a message (e.g., to LLM)
        bridge.onMessage = { role, content ->
            Log.i(TAG, "Message from Guest UI - role: $role, content: $content")
            // In a real app, you would forward this to your LLM
            McpUiMessageResult(isError = false)
        }

        // Called when the Guest UI wants to open a link
        bridge.onOpenLink = { url ->
            Log.i(TAG, "Guest UI requested to open link: $url")
            // In a real app, you would open this URL in a browser
            McpUiOpenLinkResult(isError = false)
        }

        // Called when the Guest UI logs a message
        bridge.onLoggingMessage = { level, data, logger ->
            val loggerName = logger ?: "guest"
            Log.i(TAG, "[$loggerName] $level: $data")
        }

        // Called when the Guest UI pings
        bridge.onPing = {
            Log.d(TAG, "Ping from Guest UI")
        }
    }

    /**
     * Reset to initial state and clean up resources.
     */
    fun reset() {
        viewModelScope.launch {
            try {
                // Clean up AppBridge
                appBridge?.let { bridge ->
                    try {
                        bridge.sendResourceTeardown()
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to send teardown", e)
                    }
                }
                appBridge = null

                // Clean up transport
                transport?.close()
                transport = null

                // Clean up MCP client
                mcpClient?.close()
                mcpClient = null

                // Reset state
                _uiState.value = McpUiState.Idle()
            } catch (e: Exception) {
                Log.e(TAG, "Error during reset", e)
                _uiState.value = McpUiState.Idle()
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        // Clean up resources
        viewModelScope.launch {
            try {
                transport?.close()
                mcpClient?.close()
            } catch (e: Exception) {
                Log.e(TAG, "Error during cleanup", e)
            }
        }
    }
}
