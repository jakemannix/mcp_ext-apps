package com.example.mcpappshost

import android.util.Log
import android.webkit.WebView
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.modelcontextprotocol.apps.generated.*
import io.modelcontextprotocol.kotlin.sdk.client.Client
import io.modelcontextprotocol.kotlin.sdk.client.SseClientTransport
import io.modelcontextprotocol.kotlin.sdk.types.ReadResourceRequest
import io.modelcontextprotocol.kotlin.sdk.types.ReadResourceRequestParams
import io.modelcontextprotocol.kotlin.sdk.types.TextResourceContents
import io.modelcontextprotocol.kotlin.sdk.types.BlobResourceContents
import io.modelcontextprotocol.kotlin.sdk.types.TextContent
import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.sse.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import kotlinx.serialization.encodeToString

private const val TAG = "McpHostViewModel"

// Known servers - using /sse endpoint for SSE transport (Kotlin SDK)
val knownServers = listOf(
    "basic-server-react" to "http://10.0.2.2:3101/sse",
    "basic-server-vanillajs" to "http://10.0.2.2:3102/sse",
    "budget-allocator-server" to "http://10.0.2.2:3103/sse",
    "cohort-heatmap-server" to "http://10.0.2.2:3104/sse",
    "customer-segmentation-server" to "http://10.0.2.2:3105/sse",
    "scenario-modeler-server" to "http://10.0.2.2:3106/sse",
    "system-monitor-server" to "http://10.0.2.2:3107/sse",
    "threejs-server" to "http://10.0.2.2:3108/sse",
)

data class ToolInfo(
    val name: String,
    val description: String?,
    val inputSchema: JsonElement?,
    val uiResourceUri: String? = null  // From _meta["ui/resourceUri"]
)

sealed class ConnectionState {
    data object Disconnected : ConnectionState()
    data object Connecting : ConnectionState()
    data object Connected : ConnectionState()
    data class Error(val message: String) : ConnectionState()
}

data class ToolCallState(
    val id: String = java.util.UUID.randomUUID().toString(),
    val serverName: String,
    val toolName: String,
    val input: String,
    val inputArgs: Map<String, Any>? = null,
    val state: State = State.CALLING,
    val result: String? = null,
    val toolResult: String? = null,  // Raw tool result for AppBridge
    val error: String? = null,
    val htmlContent: String? = null,
    var webView: WebView? = null,
    var preferredHeight: Int = 350,
    var appBridgeConnected: Boolean = false,
    val isDestroying: Boolean = false  // Two-phase teardown: true while waiting for app response
) {
    enum class State { CALLING, LOADING_UI, READY, COMPLETED, ERROR }

    val hasApp: Boolean get() = htmlContent != null && state == State.READY
}

class McpHostViewModel : ViewModel() {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    // Connection state
    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    // Tools
    private val _tools = MutableStateFlow<List<ToolInfo>>(emptyList())
    val tools: StateFlow<List<ToolInfo>> = _tools.asStateFlow()

    private val _selectedTool = MutableStateFlow<ToolInfo?>(null)
    val selectedTool: StateFlow<ToolInfo?> = _selectedTool.asStateFlow()

    // Server selection
    private val _selectedServerIndex = MutableStateFlow(0)
    val selectedServerIndex: StateFlow<Int> = _selectedServerIndex.asStateFlow()

    // Tool input
    private val _toolInputJson = MutableStateFlow("{}")
    val toolInputJson: StateFlow<String> = _toolInputJson.asStateFlow()

    // Active tool calls
    private val _toolCalls = MutableStateFlow<List<ToolCallState>>(emptyList())
    val toolCalls: StateFlow<List<ToolCallState>> = _toolCalls.asStateFlow()

    private var mcpClient: Client? = null

    private val hostInfo = Implementation(name = "BasicHostKotlin", version = "1.0.0")
    private val hostCapabilities = McpUiHostCapabilities(
        openLinks = EmptyCapability,
        serverTools = McpUiHostCapabilitiesServerTools(),
        serverResources = McpUiHostCapabilitiesServerResources(),
        logging = EmptyCapability
    )

    init {
        // Auto-connect on launch
        connect()
    }

    fun selectTool(tool: ToolInfo) {
        _selectedTool.value = tool
        // Generate default input from schema
        _toolInputJson.value = generateDefaultInput(tool)
    }

    fun updateToolInput(input: String) {
        _toolInputJson.value = input
    }

    fun switchServer(index: Int) {
        if (index == _selectedServerIndex.value && _connectionState.value is ConnectionState.Connected) {
            return
        }
        viewModelScope.launch {
            disconnect()
            _selectedServerIndex.value = index
            connect()
        }
    }

    fun connect() {
        val serverUrl = if (_selectedServerIndex.value >= 0 && _selectedServerIndex.value < knownServers.size) {
            knownServers[_selectedServerIndex.value].second
        } else {
            return
        }

        viewModelScope.launch {
            try {
                _connectionState.value = ConnectionState.Connecting
                Log.i(TAG, "Connecting to $serverUrl")

                val httpClient = HttpClient(CIO) {
                    install(SSE)
                }
                val transport = SseClientTransport(httpClient, serverUrl)

                val client = Client(
                    clientInfo = io.modelcontextprotocol.kotlin.sdk.types.Implementation(
                        name = "BasicHostKotlin",
                        version = "1.0.0"
                    )
                )
                client.connect(transport)

                mcpClient = client

                // List tools
                val result = client.listTools()
                _tools.value = result.tools.map { tool ->
                    // Extract UI resource URI from _meta (JsonObject)
                    val meta = tool.meta as? JsonObject
                    val uiResourceUri = meta?.get("ui/resourceUri")?.let { element ->
                        (element as? JsonPrimitive)?.contentOrNull
                    }
                    Log.d(TAG, "Tool ${tool.name} uiResourceUri: $uiResourceUri")
                    ToolInfo(
                        name = tool.name,
                        description = tool.description,
                        inputSchema = null,
                        uiResourceUri = uiResourceUri
                    )
                }

                if (_tools.value.isNotEmpty()) {
                    selectTool(_tools.value.first())
                }

                _connectionState.value = ConnectionState.Connected
                Log.i(TAG, "Connected, found ${_tools.value.size} tools")

            } catch (e: Exception) {
                Log.e(TAG, "Connection failed", e)
                _connectionState.value = ConnectionState.Error(e.message ?: "Unknown error")
            }
        }
    }

    fun disconnect() {
        mcpClient = null
        _tools.value = emptyList()
        _selectedTool.value = null
        _connectionState.value = ConnectionState.Disconnected
    }

    fun callTool() {
        val tool = _selectedTool.value ?: return
        val client = mcpClient ?: return

        val serverName = if (_selectedServerIndex.value in knownServers.indices) {
            knownServers[_selectedServerIndex.value].first
        } else "Custom"

        val toolCall = ToolCallState(
            serverName = serverName,
            toolName = tool.name,
            input = _toolInputJson.value
        )
        _toolCalls.value = _toolCalls.value + toolCall

        viewModelScope.launch {
            try {
                // Parse input JSON
                val inputArgs = try {
                    json.parseToJsonElement(_toolInputJson.value) as? JsonObject
                } catch (e: Exception) {
                    null
                }

                // Call the tool (name, arguments, meta, options)
                val callResult = client.callTool(tool.name, emptyMap(), emptyMap())

                // Check for UI resource
                if (tool.uiResourceUri != null) {
                    updateToolCall(toolCall.id) { it.copy(state = ToolCallState.State.LOADING_UI) }
                    Log.i(TAG, "Reading UI resource: ${tool.uiResourceUri}")

                    try {
                        // Read the UI resource
                        val request = ReadResourceRequest(ReadResourceRequestParams(uri = tool.uiResourceUri))
                        val resourceResult = client.readResource(request)
                        val htmlContent = resourceResult.contents.firstOrNull()?.let { content ->
                            when (content) {
                                is TextResourceContents -> content.text
                                is BlobResourceContents -> {
                                    String(android.util.Base64.decode(content.blob, android.util.Base64.DEFAULT))
                                }
                                else -> null
                            }
                        }

                        if (htmlContent != null) {
                            Log.i(TAG, "Loaded UI resource (${htmlContent.length} chars)")
                            // Store both HTML and tool result for AppBridge
                            val toolResultJson = json.encodeToString(
                                kotlinx.serialization.json.JsonObject.serializer(),
                                buildJsonObject {
                                    put("content", buildJsonArray {
                                        callResult.content.forEach { block ->
                                            // Extract text properly from content block
                                            val text = when (block) {
                                                is TextContent -> block.text
                                                else -> block.toString()
                                            }
                                            add(buildJsonObject {
                                                put("type", JsonPrimitive("text"))
                                                put("text", JsonPrimitive(text))
                                            })
                                        }
                                    })
                                    put("isError", JsonPrimitive(callResult.isError ?: false))
                                }
                            )
                            updateToolCall(toolCall.id) { it.copy(
                                state = ToolCallState.State.READY,
                                htmlContent = htmlContent,
                                toolResult = toolResultJson,
                                inputArgs = inputArgs?.let { args ->
                                    args.mapValues { (_, v) -> v.toString() }
                                }
                            )}
                        } else {
                            Log.w(TAG, "No HTML content in resource")
                            val resultText = callResult.content.joinToString("\n") { it.toString() }
                            updateToolCall(toolCall.id) { it.copy(
                                state = ToolCallState.State.COMPLETED,
                                result = resultText
                            )}
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to read UI resource: ${e.message}", e)
                        val resultText = callResult.content.joinToString("\n") { it.toString() }
                        updateToolCall(toolCall.id) { it.copy(
                            state = ToolCallState.State.COMPLETED,
                            result = resultText
                        )}
                    }
                } else {
                    // No UI resource, show text result
                    val resultText = callResult.content.joinToString("\n") { it.toString() }
                    Log.i(TAG, "Tool result (no UI): $resultText")
                    updateToolCall(toolCall.id) { it.copy(
                        state = ToolCallState.State.COMPLETED,
                        result = resultText
                    )}
                }

            } catch (e: Exception) {
                Log.e(TAG, "Tool call failed", e)
                updateToolCall(toolCall.id) { it.copy(
                    state = ToolCallState.State.ERROR,
                    error = e.message
                )}
            }
        }
    }

    /**
     * Request to close a tool call. For apps, this marks as destroying and waits
     * for teardown. For non-app results, removes immediately.
     */
    fun requestClose(toolCall: ToolCallState) {
        if (toolCall.hasApp) {
            // Mark as destroying - the WebView will send teardown and call completeClose
            updateToolCall(toolCall.id) { it.copy(isDestroying = true) }
        } else {
            // Non-app results close immediately
            completeClose(toolCall.id)
        }
    }

    /**
     * Complete the close after teardown response (or immediately for non-apps).
     */
    fun completeClose(id: String) {
        _toolCalls.value = _toolCalls.value.filter { it.id != id }
    }

    /**
     * Forward a tool call from the WebView App to the MCP server.
     * Returns the result as a JSON string.
     */
    suspend fun forwardToolCall(name: String, arguments: Map<String, Any>?): String {
        val client = mcpClient ?: throw IllegalStateException("Not connected")

        Log.i(TAG, "Forwarding tool call: $name with args: $arguments")

        val callResult = client.callTool(name, emptyMap(), emptyMap())

        // Format result as JSON for the App
        val resultJson = json.encodeToString(
            kotlinx.serialization.json.JsonObject.serializer(),
            buildJsonObject {
                put("content", buildJsonArray {
                    callResult.content.forEach { block ->
                        val text = when (block) {
                            is TextContent -> block.text
                            else -> block.toString()
                        }
                        add(buildJsonObject {
                            put("type", JsonPrimitive("text"))
                            put("text", JsonPrimitive(text))
                        })
                    }
                })
                put("isError", JsonPrimitive(callResult.isError ?: false))
            }
        )

        Log.i(TAG, "Tool call result: $resultJson")
        return resultJson
    }

    private fun updateToolCall(id: String, update: (ToolCallState) -> ToolCallState) {
        _toolCalls.value = _toolCalls.value.map { if (it.id == id) update(it) else it }
    }

    private fun generateDefaultInput(tool: ToolInfo): String {
        // TODO: Parse inputSchema and generate defaults
        return "{}"
    }
}
