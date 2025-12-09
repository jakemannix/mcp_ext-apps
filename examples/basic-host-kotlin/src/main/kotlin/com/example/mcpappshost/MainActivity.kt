package com.example.mcpappshost

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel

/**
 * Main Activity demonstrating MCP Apps hosting in Android.
 *
 * This activity:
 * 1. Connects to an MCP server
 * 2. Lists available tools
 * 3. Allows calling a tool
 * 4. Displays the tool's UI resource in a WebView
 * 5. Uses AppBridge to communicate with the Guest UI
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    McpHostApp()
                }
            }
        }
    }
}

@Composable
fun McpHostApp(viewModel: McpHostViewModel = viewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        // Header
        Text(
            text = "MCP Apps Host",
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        when (val state = uiState) {
            is McpUiState.Idle -> {
                IdleScreen(
                    serverUrl = state.serverUrl,
                    onServerUrlChange = viewModel::updateServerUrl,
                    onConnect = viewModel::connectToServer
                )
            }
            is McpUiState.Connecting -> {
                LoadingScreen(message = "Connecting to server...")
            }
            is McpUiState.Connected -> {
                ConnectedScreen(
                    serverName = state.serverName,
                    tools = state.tools,
                    selectedTool = state.selectedTool,
                    toolInput = state.toolInput,
                    onToolSelect = viewModel::selectTool,
                    onInputChange = viewModel::updateToolInput,
                    onCallTool = viewModel::callTool
                )
            }
            is McpUiState.ToolExecuting -> {
                LoadingScreen(message = "Calling tool ${state.toolName}...")
            }
            is McpUiState.ShowingApp -> {
                AppDisplayScreen(
                    toolName = state.toolName,
                    webViewState = state.webViewState,
                    onBack = viewModel::reset
                )
            }
            is McpUiState.Error -> {
                ErrorScreen(
                    error = state.message,
                    onRetry = viewModel::reset
                )
            }
        }
    }
}

@Composable
fun IdleScreen(
    serverUrl: String,
    onServerUrlChange: (String) -> Unit,
    onConnect: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Connect to MCP Server",
            style = MaterialTheme.typography.titleMedium
        )

        OutlinedTextField(
            value = serverUrl,
            onValueChange = onServerUrlChange,
            label = { Text("Server URL") },
            placeholder = { Text("http://localhost:3000/sse") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Button(
            onClick = onConnect,
            modifier = Modifier.align(Alignment.End),
            enabled = serverUrl.isNotBlank()
        ) {
            Text("Connect")
        }
    }
}

@Composable
fun LoadingScreen(message: String) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        CircularProgressIndicator()
        Spacer(modifier = Modifier.height(16.dp))
        Text(text = message)
    }
}

@Composable
fun ConnectedScreen(
    serverName: String,
    tools: List<String>,
    selectedTool: String,
    toolInput: String,
    onToolSelect: (String) -> Unit,
    onInputChange: (String) -> Unit,
    onCallTool: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Connected to: $serverName",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.primary
        )

        Text(
            text = "Available Tools:",
            style = MaterialTheme.typography.titleSmall
        )

        // Tool selection
        if (tools.isNotEmpty()) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                items(tools) { tool ->
                    RadioButtonItem(
                        text = tool,
                        selected = tool == selectedTool,
                        onClick = { onToolSelect(tool) }
                    )
                }
            }

            // Tool input
            Text(
                text = "Tool Input (JSON):",
                style = MaterialTheme.typography.titleSmall
            )

            OutlinedTextField(
                value = toolInput,
                onValueChange = onInputChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp),
                placeholder = { Text("{}") }
            )

            Button(
                onClick = onCallTool,
                modifier = Modifier.align(Alignment.End),
                enabled = selectedTool.isNotBlank()
            ) {
                Text("Call Tool")
            }
        } else {
            Text(
                text = "No tools available",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error
            )
        }
    }
}

@Composable
fun RadioButtonItem(
    text: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(
            selected = selected,
            onClick = onClick
        )
        Text(
            text = text,
            modifier = Modifier.padding(start = 8.dp)
        )
    }
}

@Composable
fun AppDisplayScreen(
    toolName: String,
    webViewState: WebViewState,
    onBack: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize()
    ) {
        // Header with back button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Tool: $toolName",
                style = MaterialTheme.typography.titleMedium
            )
            Button(onClick = onBack) {
                Text("Back")
            }
        }

        // WebView displaying the MCP App UI
        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    // WebView configuration is handled by the ViewModel
                    webViewState.webView = this
                }
            },
            modifier = Modifier
                .fillMaxSize()
                .weight(1f)
        )
    }
}

@Composable
fun ErrorScreen(
    error: String,
    onRetry: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "Error",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.error
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = error,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(horizontal = 32.dp)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(onClick = onRetry) {
            Text("Retry")
        }
    }
}
