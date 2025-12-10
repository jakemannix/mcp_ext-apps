package com.example.mcpappshost

import android.util.Log
import android.webkit.WebView
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.modelcontextprotocol.apps.AppBridge
import io.modelcontextprotocol.apps.HostOptions
import io.modelcontextprotocol.apps.generated.*
import io.modelcontextprotocol.kotlin.sdk.client.Client
import io.modelcontextprotocol.kotlin.sdk.client.SseClientTransport
import io.modelcontextprotocol.kotlin.sdk.types.Tool
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

private const val TAG = "McpHostViewModel"

// Known servers matching examples/servers.json
val knownServers = listOf(
    "basic-server-react" to "http://10.0.2.2:3101/mcp",
    "basic-server-vanillajs" to "http://10.0.2.2:3102/mcp",
    "budget-allocator-server" to "http://10.0.2.2:3103/mcp",
    "cohort-heatmap-server" to "http://10.0.2.2:3104/mcp",
    "customer-segmentation-server" to "http://10.0.2.2:3105/mcp",
    "scenario-modeler-server" to "http://10.0.2.2:3106/mcp",
    "system-monitor-server" to "http://10.0.2.2:3107/mcp",
    "threejs-server" to "http://10.0.2.2:3108/mcp",
)

data class ToolInfo(
    val name: String,
    val description: String?,
    val inputSchema: JsonElement?
)

sealed class ConnectionState {
    data object Disconnected : ConnectionState()
    data object Connecting : ConnectionState()
    data object Connected : ConnectionState()
    data class Error(val message: String) : ConnectionState()
}

data class ToolCallState(
    val id: String = java.util.UUID.randomUUID().toString(),
    val toolName: String,
    val input: String,
    val state: State = State.CALLING,
    val result: String? = null,
    val error: String? = null,
    val htmlContent: String? = null,
    var webView: WebView? = null,
    var preferredHeight: Int = 350
) {
    enum class State { CALLING, LOADING_UI, READY, COMPLETED, ERROR }
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

                val client = Client(
                    clientInfo = io.modelcontextprotocol.kotlin.sdk.types.Implementation(
                        name = "BasicHostKotlin",
                        version = "1.0.0"
                    )
                )

                val transport = SseClientTransport(serverUrl)
                client.connect(transport)

                mcpClient = client

                // List tools
                val result = client.listTools()
                _tools.value = result.tools.map { tool ->
                    ToolInfo(
                        name = tool.name,
                        description = tool.description,
                        inputSchema = null // TODO: Parse schema
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

        val toolCall = ToolCallState(
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

                // Call the tool
                val (content, isError) = client.callTool(tool.name, null)

                // Update tool call with result
                val resultText = content.joinToString("\n") { it.toString() }

                updateToolCall(toolCall.id) { it.copy(
                    state = ToolCallState.State.COMPLETED,
                    result = resultText
                )}

            } catch (e: Exception) {
                Log.e(TAG, "Tool call failed", e)
                updateToolCall(toolCall.id) { it.copy(
                    state = ToolCallState.State.ERROR,
                    error = e.message
                )}
            }
        }
    }

    fun removeToolCall(toolCall: ToolCallState) {
        _toolCalls.value = _toolCalls.value.filter { it.id != toolCall.id }
    }

    private fun updateToolCall(id: String, update: (ToolCallState) -> ToolCallState) {
        _toolCalls.value = _toolCalls.value.map { if (it.id == id) update(it) else it }
    }

    private fun generateDefaultInput(tool: ToolInfo): String {
        // TODO: Parse inputSchema and generate defaults
        return "{}"
    }
}
