import SwiftUI
import MCP
import McpApps

/// Main view for the Basic Host Swift example.
///
/// This view displays:
/// - Connection controls and status
/// - Tool selection picker
/// - JSON input field for tool arguments
/// - Call tool button
/// - List of active tool UIs in WebViews
struct ContentView: View {
    @StateObject private var viewModel = McpHostViewModel()

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Connection Section
                connectionSection

                Divider()

                // Tool Call Section
                if viewModel.connectionState == .connected {
                    toolCallSection
                        .padding()
                }

                Divider()

                // Active Tool Calls Section
                if !viewModel.activeToolCalls.isEmpty {
                    ScrollView {
                        VStack(spacing: 16) {
                            ForEach(viewModel.activeToolCalls) { toolCall in
                                ToolCallCard(
                                    toolCallInfo: toolCall,
                                    onRemove: {
                                        viewModel.removeToolCall(toolCall)
                                    }
                                )
                            }
                        }
                        .padding()
                    }
                } else {
                    Spacer()
                    Text("No active tool calls")
                        .foregroundColor(.secondary)
                    Spacer()
                }
            }
            .navigationTitle("MCP Apps Host")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    // MARK: - Connection Section

    private var connectionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Server Status:")
                    .font(.headline)
                Spacer()
                Text(viewModel.connectionState.description)
                    .foregroundColor(connectionColor)
                    .font(.subheadline)
            }

            HStack {
                if case .error = viewModel.connectionState {
                    // Error state - show Retry button
                    Button(action: {
                        Task {
                            await viewModel.connect()
                        }
                    }) {
                        Label("Retry", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
                } else if viewModel.connectionState == .disconnected {
                    Button(action: {
                        Task {
                            await viewModel.connect()
                        }
                    }) {
                        Label("Connect", systemImage: "network")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                } else if viewModel.connectionState == .connecting {
                    Button(action: {}) {
                        HStack {
                            ProgressView()
                                .scaleEffect(0.8)
                            Text("Connecting...")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(true)
                } else if viewModel.connectionState == .connected {
                    Button(action: {
                        Task {
                            await viewModel.disconnect()
                        }
                    }) {
                        Label("Disconnect", systemImage: "network.slash")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                }
            }

            if let error = viewModel.errorMessage {
                VStack(alignment: .leading, spacing: 4) {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                    Text("Tap Retry to try again")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.1))
                .cornerRadius(4)
            }
        }
        .padding()
    }

    private var connectionColor: Color {
        switch viewModel.connectionState {
        case .disconnected:
            return .secondary
        case .connecting:
            return .orange
        case .connected:
            return .green
        case .error:
            return .red
        }
    }

    // MARK: - Tool Call Section

    private var toolCallSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Call Tool")
                .font(.headline)

            // Tool Picker
            if !viewModel.tools.isEmpty {
                Picker("Tool", selection: $viewModel.selectedTool) {
                    ForEach(viewModel.tools, id: \.name) { tool in
                        Text(tool.name)
                            .tag(tool as Tool?)
                    }
                }
                .pickerStyle(.menu)

                if let selectedTool = viewModel.selectedTool {
                    Text(selectedTool.description ?? "No description")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            } else {
                Text("No tools available")
                    .foregroundColor(.secondary)
            }

            // Input JSON
            VStack(alignment: .leading, spacing: 4) {
                Text("Input (JSON)")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                TextEditor(text: $viewModel.toolInputJson)
                    .font(.system(.body, design: .monospaced))
                    .frame(height: 100)
                    .padding(4)
                    .background(Color(UIColor.systemGray6))
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(isValidJson ? Color.clear : Color.red, lineWidth: 1)
                    )

                if !isValidJson {
                    Text("Invalid JSON")
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }

            // Call Button
            Button(action: {
                Task {
                    await viewModel.callTool()
                }
            }) {
                Label("Call Tool", systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.selectedTool == nil || !isValidJson)
        }
    }

    private var isValidJson: Bool {
        guard let data = viewModel.toolInputJson.data(using: .utf8) else {
            return false
        }
        return (try? JSONSerialization.jsonObject(with: data)) != nil
    }
}

// MARK: - Tool Call Card

/// Card displaying a single tool call and its UI
struct ToolCallCard: View {
    @ObservedObject var toolCallInfo: ToolCallInfo
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(toolCallInfo.tool.name)
                        .font(.headline)
                    Text(toolCallInfo.state.description)
                        .font(.caption)
                        .foregroundColor(stateColor)
                }

                Spacer()

                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
            }

            // Input
            VStack(alignment: .leading, spacing: 4) {
                Text("Input:")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                if let jsonData = try? JSONSerialization.data(
                    withJSONObject: toolCallInfo.input,
                    options: .prettyPrinted
                ),
                   let jsonString = String(data: jsonData, encoding: .utf8) {
                    Text(jsonString)
                        .font(.system(.caption, design: .monospaced))
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(UIColor.systemGray6))
                        .cornerRadius(4)
                }
            }

            // Result or UI
            if let error = toolCallInfo.error {
                // Error
                Text("Error: \(error)")
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(4)
            } else if toolCallInfo.state == .ready, toolCallInfo.htmlContent != nil {
                // WebView UI
                WebViewContainer(toolCallInfo: toolCallInfo)
                    .frame(height: 400)
                    .border(Color.gray.opacity(0.3))
            } else if toolCallInfo.state == .completed, let result = toolCallInfo.result {
                // Text result
                VStack(alignment: .leading, spacing: 4) {
                    Text("Result:")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    ForEach(Array(result.content.enumerated()), id: \.offset) { _, content in
                        switch content {
                        case .text(let text):
                            Text(text)
                                .font(.system(.caption, design: .monospaced))
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(UIColor.systemGray6))
                                .cornerRadius(4)
                        default:
                            EmptyView()
                        }
                    }
                }
            }
        }
        .padding()
        .background(Color(UIColor.systemBackground))
        .cornerRadius(12)
        .shadow(radius: 2)
    }

    private var stateColor: Color {
        switch toolCallInfo.state {
        case .calling, .loadingUi:
            return .orange
        case .ready, .completed:
            return .green
        case .error:
            return .red
        }
    }
}

// MARK: - Preview

#Preview {
    ContentView()
}
