import Foundation
import SwiftUI
import MCP
import McpApps
import os.log

private let logger = Logger(subsystem: "com.example.BasicHostSwift", category: "ToolCall")

/// View model managing MCP server connection and tool execution.
@MainActor
class McpHostViewModel: ObservableObject {
    // MARK: - Published State

    @Published var connectionState: ConnectionState = .disconnected
    @Published var tools: [Tool] = []
    @Published var toolInputJson: String = "{}"

    /// Selected tool - updates input JSON with defaults when changed
    @Published var selectedTool: Tool? {
        didSet {
            if let tool = selectedTool {
                toolInputJson = generateDefaultInput(for: tool)
            }
        }
    }
    @Published var activeToolCalls: [ToolCallInfo] = []
    @Published var errorMessage: String?
    @Published var toastMessage: String?

    func showToast(_ message: String, duration: TimeInterval = 3.0) {
        toastMessage = message
        Task {
            try? await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
            await MainActor.run { self.toastMessage = nil }
        }
    }

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

            let serverName = selectedServerIndex >= 0 && selectedServerIndex < Self.knownServers.count
                ? Self.knownServers[selectedServerIndex].0
                : "Custom Server"

            let toolCallInfo = ToolCallInfo(
                serverName: serverName,
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

    /// Generate default input JSON from tool's inputSchema
    private func generateDefaultInput(for tool: Tool) -> String {
        var defaults: [String: Any] = [:]

        // inputSchema is typically: { "type": "object", "properties": { ... }, "required": [...] }
        guard case .object(let schema) = tool.inputSchema,
              case .object(let properties)? = schema["properties"] else {
            return "{}"
        }

        // Get required fields
        var requiredFields = Set<String>()
        if case .array(let required)? = schema["required"] {
            for item in required {
                if case .string(let field) = item {
                    requiredFields.insert(field)
                }
            }
        }

        for (key, propSchema) in properties {
            guard case .object(let prop) = propSchema else { continue }

            // Check for explicit default value
            if let defaultValue = prop["default"] {
                defaults[key] = valueToAny(defaultValue)
                continue
            }

            // For required fields or all fields, generate appropriate defaults
            if let typeValue = prop["type"] {
                if case .string(let type) = typeValue {
                    switch type {
                    case "string":
                        // Check for enum values
                        if case .array(let enumValues)? = prop["enum"], let first = enumValues.first {
                            defaults[key] = valueToAny(first)
                        } else {
                            defaults[key] = ""
                        }
                    case "number":
                        defaults[key] = 0.0
                    case "integer":
                        defaults[key] = 0
                    case "boolean":
                        defaults[key] = false
                    case "array":
                        defaults[key] = []
                    case "object":
                        defaults[key] = [:]
                    default:
                        if requiredFields.contains(key) {
                            defaults[key] = NSNull()
                        }
                    }
                }
            }
        }

        // Convert to JSON string
        if let data = try? JSONSerialization.data(withJSONObject: defaults, options: [.prettyPrinted, .sortedKeys]),
           let json = String(data: data, encoding: .utf8) {
            return json
        }
        return "{}"
    }

    /// Convert MCP Value to Any for JSON serialization
    private func valueToAny(_ value: Value) -> Any {
        switch value {
        case .string(let s): return s
        case .int(let i): return i
        case .double(let d): return d
        case .bool(let b): return b
        case .array(let arr): return arr.map { valueToAny($0) }
        case .object(let obj): return obj.mapValues { valueToAny($0) }
        case .null: return NSNull()
        case .data(_, let d): return d.base64EncodedString()
        }
    }

    func removeToolCall(_ toolCall: ToolCallInfo) async {
        if let error = await toolCall.teardown() {
            showToast(error)
        }
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
    let serverName: String
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
    @Published var isTearingDown = false

    init(
        serverName: String,
        tool: Tool,
        input: [String: Any],
        client: Client,
        hostInfo: Implementation,
        hostCapabilities: McpUiHostCapabilities
    ) {
        self.serverName = serverName
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
        // Access the _meta field to get the UI resource URI (requires swift-sdk with _meta support)
        if let meta = tool._meta,
           let uriValue = meta[McpAppsConfig.resourceUriMetaKey],
           case .string(let uri) = uriValue {
            return uri
        }
        return nil
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
                let params = McpUiToolInputParams(
                    arguments: self.input.mapValues { AnyCodable($0) }
                )
                try? await bridge.sendToolInput(params)
                if let result = self.result {
                    try? await self.sendToolResult(result, to: bridge)
                }
            }
        }

        bridge.onMessage = { params in
            print("[Host] Message from Guest UI: \(params.role)")
            return McpUiMessageResult(isError: false)
        }

        bridge.onOpenLink = { params in
            print("[Host] Open link request: \(params.url)")
            if let urlObj = URL(string: params.url) {
                await MainActor.run {
                    UIApplication.shared.open(urlObj)
                }
            }
            return McpUiOpenLinkResult(isError: false)
        }

        bridge.onLoggingMessage = { params in
            print("[Host] Guest UI log [\(params.level)]: \(params.data.value)")
        }

        bridge.onSizeChange = { [weak self] params in
            print("[Host] Size change: \(params.width ?? 0) x \(params.height ?? 0)")
            if let height = params.height {
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

        logger.info("Connecting bridge to transport...")
        try await bridge.connect(transport)
        self.appBridge = bridge
        logger.info("AppBridge is now set and ready")
    }

    private func sendToolResult(_ result: ToolResult, to bridge: AppBridge) async throws {
        let contentItems: [McpUiToolResultNotificationParamsContentItem] = result.content.compactMap { c in
            switch c {
            case .text(let text):
                return .text(McpUiToolResultNotificationParamsContentItemText(type: "text", text: text))
            case .image(let data, let mimeType, _):
                return .image(McpUiToolResultNotificationParamsContentItemImage(type: "image", data: data, mimeType: mimeType))
            default:
                return nil
            }
        }
        let params = McpUiToolResultParams(content: contentItems, isError: result.isError)
        try await bridge.sendToolResult(params)
    }

    /// Teardown the app bridge before removing the tool call
    /// Returns an error message if teardown failed, nil on success
    func teardown() async -> String? {
        // Prevent double-tap
        guard !isTearingDown else {
            logger.info("Teardown already in progress, skipping")
            return nil
        }
        isTearingDown = true
        logger.info("Starting teardown, appBridge exists: \(self.appBridge != nil)")

        var errorMessage: String?

        if let bridge = appBridge {
            // Only send teardown if the bridge is initialized
            // If not initialized, the app hasn't done anything worth saving
            let isReady = await bridge.isReady()
            if isReady {
                logger.info("Sending teardown request...")
                do {
                    _ = try await bridge.sendResourceTeardown()
                    logger.info("Teardown request completed successfully")
                } catch {
                    logger.error("Teardown request failed: \(String(describing: error))")
                    errorMessage = "Teardown failed: app may not have saved data"
                }
            } else {
                logger.info("Skipping teardown - bridge not yet initialized")
            }

            logger.info("Closing bridge...")
            await bridge.close()
            logger.info("Bridge closed")
        } else {
            logger.warning("No bridge to teardown (appBridge is nil)")
        }
        appBridge = nil
        logger.info("Teardown complete, will remove card from list")
        return errorMessage
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
