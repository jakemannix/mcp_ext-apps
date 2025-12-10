package com.example.mcpappshost

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    McpHostApp()
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun McpHostApp(viewModel: McpHostViewModel = viewModel()) {
    val toolCalls by viewModel.toolCalls.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val tools by viewModel.tools.collectAsState()
    val selectedTool by viewModel.selectedTool.collectAsState()
    val selectedServerIndex by viewModel.selectedServerIndex.collectAsState()
    val toolInputJson by viewModel.toolInputJson.collectAsState()

    var isInputExpanded by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    // Auto-scroll to new tool calls
    LaunchedEffect(toolCalls.size) {
        if (toolCalls.isNotEmpty()) {
            listState.animateScrollToItem(toolCalls.size - 1)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("MCP Host") })
        },
        bottomBar = {
            BottomToolbar(
                connectionState = connectionState,
                selectedServerIndex = selectedServerIndex,
                tools = tools,
                selectedTool = selectedTool,
                toolInputJson = toolInputJson,
                isInputExpanded = isInputExpanded,
                onServerSelect = { viewModel.switchServer(it) },
                onToolSelect = { viewModel.selectTool(it) },
                onInputChange = { viewModel.updateToolInput(it) },
                onExpandToggle = { isInputExpanded = !isInputExpanded },
                onCallTool = { viewModel.callTool() }
            )
        }
    ) { paddingValues ->
        if (toolCalls.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                Text("No active tool calls", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(toolCalls, key = { it.id }) { toolCall ->
                    ToolCallCard(toolCall = toolCall, onRemove = { viewModel.removeToolCall(toolCall) })
                }
            }
        }
    }
}

@Composable
fun BottomToolbar(
    connectionState: ConnectionState,
    selectedServerIndex: Int,
    tools: List<ToolInfo>,
    selectedTool: ToolInfo?,
    toolInputJson: String,
    isInputExpanded: Boolean,
    onServerSelect: (Int) -> Unit,
    onToolSelect: (ToolInfo) -> Unit,
    onInputChange: (String) -> Unit,
    onExpandToggle: () -> Unit,
    onCallTool: () -> Unit
) {
    val isConnected = connectionState is ConnectionState.Connected

    Column(modifier = Modifier.fillMaxWidth()) {
        AnimatedVisibility(visible = isInputExpanded && isConnected) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Input (JSON)", style = MaterialTheme.typography.labelSmall)
                Spacer(modifier = Modifier.height(4.dp))
                OutlinedTextField(
                    value = toolInputJson,
                    onValueChange = onInputChange,
                    modifier = Modifier.fillMaxWidth().height(100.dp),
                    textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
                )
            }
        }

        HorizontalDivider()

        Row(
            modifier = Modifier.fillMaxWidth().padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            ServerPicker(selectedServerIndex, connectionState, onServerSelect, Modifier.weight(1f))

            if (isConnected) {
                ToolPicker(tools, selectedTool, onToolSelect, Modifier.weight(1f))

                IconButton(onClick = onExpandToggle) {
                    Icon(
                        if (isInputExpanded) Icons.Default.KeyboardArrowDown else Icons.Default.KeyboardArrowUp,
                        contentDescription = "Toggle input"
                    )
                }

                Button(onClick = onCallTool, enabled = selectedTool != null) {
                    Text("Call")
                }
            }
        }
    }
}

@Composable
fun ServerPicker(
    selectedServerIndex: Int,
    connectionState: ConnectionState,
    onServerSelect: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }

    Box(modifier = modifier.clickable { expanded = true }.padding(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = if (selectedServerIndex in knownServers.indices) knownServers[selectedServerIndex].first else "Custom",
                style = MaterialTheme.typography.bodySmall
            )
            Icon(Icons.Default.ArrowDropDown, contentDescription = null, modifier = Modifier.size(16.dp))
            if (connectionState is ConnectionState.Connecting) {
                Spacer(modifier = Modifier.width(4.dp))
                CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 2.dp)
            }
        }

        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            knownServers.forEachIndexed { index, (name, _) ->
                DropdownMenuItem(
                    text = { Text(name) },
                    onClick = { expanded = false; onServerSelect(index) },
                    leadingIcon = if (index == selectedServerIndex && connectionState is ConnectionState.Connected) {
                        { Icon(Icons.Default.Check, contentDescription = null) }
                    } else null
                )
            }
        }
    }
}

@Composable
fun ToolPicker(
    tools: List<ToolInfo>,
    selectedTool: ToolInfo?,
    onToolSelect: (ToolInfo) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }

    Box(modifier = modifier.clickable(enabled = tools.isNotEmpty()) { expanded = true }.padding(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(selectedTool?.name ?: "Select tool", style = MaterialTheme.typography.bodySmall)
            Icon(Icons.Default.ArrowDropDown, contentDescription = null, modifier = Modifier.size(16.dp))
        }

        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            tools.forEach { tool ->
                DropdownMenuItem(text = { Text(tool.name) }, onClick = { expanded = false; onToolSelect(tool) })
            }
        }
    }
}

@Composable
fun ToolCallCard(toolCall: ToolCallState, onRemove: () -> Unit) {
    var isInputExpanded by remember { mutableStateOf(false) }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(toolCall.toolName, style = MaterialTheme.typography.titleSmall)

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val (color, text) = when (toolCall.state) {
                        ToolCallState.State.CALLING -> MaterialTheme.colorScheme.tertiary to "Calling"
                        ToolCallState.State.LOADING_UI -> MaterialTheme.colorScheme.tertiary to "Loading"
                        ToolCallState.State.READY -> MaterialTheme.colorScheme.primary to "Ready"
                        ToolCallState.State.COMPLETED -> MaterialTheme.colorScheme.primary to "Done"
                        ToolCallState.State.ERROR -> MaterialTheme.colorScheme.error to "Error"
                    }
                    Surface(color = color.copy(alpha = 0.15f), shape = MaterialTheme.shapes.small) {
                        Text(text, color = color, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(4.dp))
                    }

                    IconButton(onClick = { isInputExpanded = !isInputExpanded }, modifier = Modifier.size(24.dp)) {
                        Icon(if (isInputExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown, contentDescription = "Toggle")
                    }

                    IconButton(onClick = onRemove, modifier = Modifier.size(24.dp)) {
                        Icon(Icons.Default.Close, contentDescription = "Remove")
                    }
                }
            }

            AnimatedVisibility(visible = isInputExpanded) {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = Modifier.padding(top = 8.dp)) {
                    Text(toolCall.input, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), modifier = Modifier.padding(8.dp))
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            when {
                toolCall.error != null -> {
                    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.small) {
                        Text(toolCall.error, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.padding(8.dp))
                    }
                }
                toolCall.state == ToolCallState.State.COMPLETED && toolCall.result != null -> {
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small) {
                        Text(toolCall.result, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), modifier = Modifier.padding(8.dp))
                    }
                }
                toolCall.state == ToolCallState.State.CALLING || toolCall.state == ToolCallState.State.LOADING_UI -> {
                    Row(modifier = Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Loading...", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
