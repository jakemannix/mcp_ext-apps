import Foundation
import SwiftUI
import MCP
import McpApps

/// View model managing MCP server connection and tool execution.
@MainActor
class McpHostViewModel: ObservableObject {
    // MARK: - Published State

    @Published var connectionState: ConnectionState = .disconnected
    @Published var tools: [Tool] = []
    @Published var selectedTool: Tool?
    @Published var toolInputJson: String = "{}"
    @Published var activeToolCalls: [ToolCallInfo] = []
    @Published var errorMessage: String?

    /// Known MCP servers (matches examples/servers.json)
    static let knownServers = [
        ("basic-server-react", "http://localhost:3101/mcp"),
        ("basic-server-vanillajs", "http://localhost:3102/mcp"),
        ("budget-allocator-server", "http://localhost:3103/mcp"),
        ("cohort-heatmap-server", "http://localhost:3104/mcp"),
        ("customer-segmentation-server", "http://localhost:3105/mcp"),
        ("scenario-modeler-server", "http://localhost:3106/mcp"),
        ("system-monitor-server", "http://localhost:3107/mcp"),
        ("threejs-server", "http://localhost:3108/mcp"),
    ]

    /// Selected server index (-1 for custom URL)
    @Published var selectedServerIndex: Int = 0

    /// Custom server URL (used when selectedServerIndex is -1)
    @Published var customServerUrl: String = ""

    /// Computed server URL based on selection
    var serverUrlString: String {
        if selectedServerIndex >= 0 && selectedServerIndex < Self.knownServers.count {
            return Self.knownServers[selectedServerIndex].1
        }
        return customServerUrl
    }

    // MARK: - Private State

    private var mcpClient: Client?

    private let hostInfo = Implementation(name: "BasicHostSwift", version: "1.0.0")

    private let hostCapabilities = McpUiHostCapabilities(
        openLinks: EmptyCapability(),
        serverTools: ServerToolsCapability(),
        serverResources: ServerResourcesCapability(),
        logging: EmptyCapability()
    )

    init() {}

    // MARK: - Connection Management

    func connect() async {
        connectionState = .connecting
        errorMessage = nil

        do {
            guard let serverUrl = URL(string: serverUrlString) else {
                throw ConnectionError.invalidUrl(serverUrlString)
            }

            let client = Client(name: hostInfo.name, version: hostInfo.version)
            let transport = HTTPClientTransport(endpoint: serverUrl)
            _ = try await client.connect(transport: transport)

            self.mcpClient = client

            let (toolsList, _) = try await client.listTools()
            self.tools = toolsList

            connectionState = .connected

            if !tools.isEmpty {
                selectedTool = tools[0]
            }
        } catch {
            connectionState = .error(error.localizedDescription)
            errorMessage = "Failed to connect: \(error.localizedDescription)"
        }
    }

    func disconnect() async {
        await mcpClient?.disconnect()
        mcpClient = nil
        tools = []
        selectedTool = nil
        connectionState = .disconnected
    }

    /// Switch to a different server (disconnect current, connect to new)
    func switchServer(to index: Int) async {
        // Don't switch if already on this server and connected
        if index == selectedServerIndex && connectionState == .connected {
            return
        }

        // Disconnect from current server if connected
        if connectionState == .connected {
            await disconnect()
        }

        // Update selection and connect
        selectedServerIndex = index
        await connect()
    }

    // MARK: - Tool Execution

    func callTool() async {
        guard let tool = selectedTool else { return }
        guard let client = mcpClient else { return }

        errorMessage = nil

        do {
            guard let inputData = toolInputJson.data(using: .utf8),
                  let inputDict = try JSONSerialization.jsonObject(with: inputData) as? [String: Any] else {
                throw ToolCallError.invalidJson
            }

            let toolCallInfo = ToolCallInfo(
                tool: tool,
                input: inputDict,
                client: client,
                hostInfo: hostInfo,
                hostCapabilities: hostCapabilities
            )

            activeToolCalls.append(toolCallInfo)

            Task {
                await toolCallInfo.execute()
            }

        } catch {
            errorMessage = "Failed to call tool: \(error.localizedDescription)"
        }
    }

    func removeToolCall(_ toolCall: ToolCallInfo) {
        activeToolCalls.removeAll { $0.id == toolCall.id }
    }
}

// MARK: - Connection State

enum ConnectionState: Equatable {
    case disconnected
    case connecting
    case connected
    case error(String)

    var description: String {
        switch self {
        case .disconnected: return "Disconnected"
        case .connecting: return "Connecting..."
        case .connected: return "Connected"
        case .error(let message): return "Error: \(message)"
        }
    }
}

// MARK: - Tool Call Info

/// Tool result type matching MCP SDK's callTool return
struct ToolResult {
    let content: [Tool.Content]
    let isError: Bool?
}

@MainActor
class ToolCallInfo: ObservableObject, Identifiable {
    let id = UUID()
    let tool: Tool
    let input: [String: Any]
    let client: Client
    let hostInfo: Implementation
    let hostCapabilities: McpUiHostCapabilities

    @Published var appBridge: AppBridge?
    @Published var htmlContent: String?
    @Published var cspConfig: CspConfig?
    @Published var preferredHeight: CGFloat = 350
    @Published var result: ToolResult?
    @Published var state: ExecutionState = .calling
    @Published var error: String?

    init(
        tool: Tool,
        input: [String: Any],
        client: Client,
        hostInfo: Implementation,
        hostCapabilities: McpUiHostCapabilities
    ) {
        self.tool = tool
        self.input = input
        self.client = client
        self.hostInfo = hostInfo
        self.hostCapabilities = hostCapabilities
    }

    func execute() async {
        do {
            state = .calling

            // Convert input to MCP Value type
            let arguments = input.compactMapValues { value -> Value? in
                if let str = value as? String { return .string(str) }
                if let num = value as? Int { return .int(num) }
                if let num = value as? Double { return .double(num) }
                if let bool = value as? Bool { return .bool(bool) }
                return nil
            }

            let (content, isError) = try await client.callTool(name: tool.name, arguments: arguments)
            self.result = ToolResult(content: content, isError: isError)

            if let uiResourceUri = getUiResourceUri(from: tool) {
                state = .loadingUi
                try await loadUiResource(uri: uiResourceUri)
                state = .ready
            } else {
                state = .completed
            }
        } catch {
            state = .error
            self.error = error.localizedDescription
        }
    }

    private func getUiResourceUri(from tool: Tool) -> String? {
        // The MCP Swift SDK doesn't expose tool._meta, so we can't access ui/resourceUri directly.
        // As a workaround for example servers, try to find a matching UI resource.
        //
        // Known UI resource URIs for example servers:
        // - basic-server-react/vanillajs: ui://get-time/mcp-app.html (tool: get_time)
        // - budget-allocator-server: ui://budget-allocator/mcp-app.html (tool: create_budget)
        // - cohort-heatmap-server: ui://get-cohort-data/mcp-app.html (tool: get_cohort_data)
        // - customer-segmentation-server: ui://customer-segmentation/mcp-app.html (tool: analyze_segments)
        // - scenario-modeler-server: ui://scenario-modeler/mcp-app.html (tool: run_scenario)
        // - system-monitor-server: ui://system-monitor/mcp-app.html (tool: get_system_stats)
        // - threejs-server: ui://threejs/mcp-app.html (tool: render_3d)

        // Tool names from example servers (verified from server.ts files)
        let knownMappings: [String: String] = [
            // basic-server-react & basic-server-vanillajs
            "get-time": "ui://get-time/mcp-app.html",
            // budget-allocator-server
            "get-budget-data": "ui://budget-allocator/mcp-app.html",
            // cohort-heatmap-server
            "get-cohort-data": "ui://get-cohort-data/mcp-app.html",
            // customer-segmentation-server
            "get-customer-data": "ui://customer-segmentation/mcp-app.html",
            // scenario-modeler-server
            "get-scenario-data": "ui://scenario-modeler/mcp-app.html",
            // system-monitor-server
            "get-system-stats": "ui://system-monitor/mcp-app.html",
            // threejs-server
            "show_threejs_scene": "ui://threejs/mcp-app.html",
            "learn_threejs": "ui://threejs/mcp-app.html",
        ]

        return knownMappings[tool.name]
    }

    private func loadUiResource(uri: String) async throws {
        let contents = try await client.readResource(uri: uri)

        guard let content = contents.first else {
            throw ToolCallError.noResourceContent
        }

        guard content.mimeType == McpAppsConfig.resourceMimeType else {
            throw ToolCallError.invalidMimeType(content.mimeType ?? "unknown")
        }

        if let text = content.text {
            htmlContent = text
        } else if let blob = content.blob,
                  let data = Data(base64Encoded: blob),
                  let text = String(data: data, encoding: .utf8) {
            htmlContent = text
        } else {
            throw ToolCallError.invalidHtmlContent
        }
    }

    func setupAppBridge(transport: WKWebViewTransport) async throws {
        let bridge = AppBridge(
            hostInfo: hostInfo,
            hostCapabilities: hostCapabilities,
            options: HostOptions(
                hostContext: McpUiHostContext(
                    theme: .light,
                    displayMode: .inline,
                    platform: .mobile,
                    deviceCapabilities: DeviceCapabilities(touch: true, hover: false)
                )
            )
        )

        bridge.onInitialized = { [weak self] in
            Task { @MainActor in
                guard let self = self else { return }
                try? await bridge.sendToolInput(
                    arguments: self.input.mapValues { AnyCodable($0) }
                )
                if let result = self.result {
                    try? await self.sendToolResult(result, to: bridge)
                }
            }
        }

        bridge.onMessage = { role, content in
            print("[Host] Message from Guest UI: \(role)")
            return McpUiMessageResult(isError: false)
        }

        bridge.onOpenLink = { url in
            print("[Host] Open link request: \(url)")
            if let urlObj = URL(string: url) {
                await MainActor.run {
                    UIApplication.shared.open(urlObj)
                }
            }
            return McpUiOpenLinkResult(isError: false)
        }

        bridge.onLoggingMessage = { level, data, logger in
            print("[Host] Guest UI log [\(level)]: \(data.value)")
        }

        bridge.onSizeChange = { [weak self] width, height in
            print("[Host] Size change: \(width ?? 0) x \(height ?? 0)")
            if let height = height {
                Task { @MainActor in
                    self?.preferredHeight = CGFloat(height)
                }
            }
        }

        bridge.onToolCall = { [weak self] toolName, arguments in
            guard let self = self else { throw ToolCallError.clientNotAvailable }

            let args = arguments?.compactMapValues { value -> Value? in
                if let str = value.value as? String { return .string(str) }
                if let num = value.value as? Int { return .int(num) }
                if let num = value.value as? Double { return .double(num) }
                if let bool = value.value as? Bool { return .bool(bool) }
                return nil
            }

            let (content, isError) = try await self.client.callTool(name: toolName, arguments: args)

            return [
                "content": AnyCodable(content.map { c -> [String: Any] in
                    switch c {
                    case .text(let text):
                        return ["type": "text", "text": text]
                    case .image(let data, let mimeType, _):
                        return ["type": "image", "data": data, "mimeType": mimeType]
                    default:
                        return ["type": "text", "text": ""]
                    }
                }),
                "isError": AnyCodable(isError ?? false)
            ]
        }

        bridge.onResourceRead = { [weak self] uri in
            guard let self = self else { throw ToolCallError.clientNotAvailable }

            let contents = try await self.client.readResource(uri: uri)

            return [
                "contents": AnyCodable(contents.map { c in
                    var dict: [String: Any] = ["uri": c.uri]
                    if let text = c.text { dict["text"] = text }
                    if let blob = c.blob { dict["blob"] = blob }
                    if let mimeType = c.mimeType { dict["mimeType"] = mimeType }
                    return dict
                })
            ]
        }

        try await bridge.connect(transport)
        self.appBridge = bridge
    }

    private func sendToolResult(_ result: ToolResult, to bridge: AppBridge) async throws {
        try await bridge.sendToolResult([
            "content": AnyCodable(result.content.map { c -> [String: Any] in
                switch c {
                case .text(let text):
                    return ["type": "text", "text": text]
                case .image(let data, let mimeType, _):
                    return ["type": "image", "data": data, "mimeType": mimeType]
                default:
                    return ["type": "text", "text": ""]
                }
            }),
            "isError": AnyCodable(result.isError ?? false)
        ])
    }
}

// MARK: - Execution State

enum ExecutionState {
    case calling, loadingUi, ready, completed, error

    var description: String {
        switch self {
        case .calling: return "Calling..."
        case .loadingUi: return "Loading UI..."
        case .ready: return "Ready"
        case .completed: return "Completed"
        case .error: return "Error"
        }
    }
}

// MARK: - Errors

enum ToolCallError: LocalizedError {
    case invalidJson
    case noResourceContent
    case invalidMimeType(String)
    case invalidHtmlContent
    case clientNotAvailable

    var errorDescription: String? {
        switch self {
        case .invalidJson: return "Invalid JSON input"
        case .noResourceContent: return "No content in UI resource"
        case .invalidMimeType(let m): return "Invalid MIME type: \(m)"
        case .invalidHtmlContent: return "Invalid HTML content"
        case .clientNotAvailable: return "MCP client not available"
        }
    }
}

enum ConnectionError: LocalizedError {
    case invalidUrl(String)

    var errorDescription: String? {
        switch self {
        case .invalidUrl(let url): return "Invalid URL: \(url)"
        }
    }
}
