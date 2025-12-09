import Foundation

/// Options for configuring AppBridge behavior.
public struct HostOptions: Sendable {
    /// Initial host context to send during initialization
    public var hostContext: McpUiHostContext

    public init(hostContext: McpUiHostContext = McpUiHostContext()) {
        self.hostContext = hostContext
    }
}

/// Host-side bridge for communicating with a single Guest UI (App).
///
/// AppBridge acts as a proxy between the host application and a Guest UI
/// running in a WebView. It handles the initialization handshake and
/// forwards MCP server capabilities to the Guest UI.
///
/// ## Architecture
///
/// **Guest UI ↔ AppBridge ↔ Host ↔ MCP Server**
///
/// ## Lifecycle
///
/// 1. **Create**: Instantiate AppBridge with MCP client and capabilities
/// 2. **Connect**: Call `connect()` with transport to establish communication
/// 3. **Wait for init**: Guest UI sends initialize request, bridge responds
/// 4. **Send data**: Call `sendToolInput()`, `sendToolResult()`, etc.
/// 5. **Teardown**: Call `sendResourceTeardown()` before unmounting WebView
///
/// ## MCP Server Forwarding
///
/// AppBridge supports forwarding tool and resource requests from the Guest UI to an MCP server.
/// This is accomplished via callbacks that the host sets up:
///
/// ```swift
/// // Create bridge with server capabilities advertised
/// let bridge = AppBridge(
///     hostInfo: Implementation(name: "MyHost", version: "1.0.0"),
///     hostCapabilities: McpUiHostCapabilities(
///         serverTools: ServerToolsCapability(),
///         serverResources: ServerResourcesCapability()
///     )
/// )
///
/// // Set up tool call forwarding
/// await bridge.setOnToolCall { toolName, arguments in
///     // Forward to MCP server and return result
///     let result = try await mcpClient.callTool(name: toolName, arguments: arguments)
///     // Convert MCP result to dictionary format
///     return [
///         "content": AnyCodable(result.content),
///         "isError": AnyCodable(result.isError ?? false)
///     ]
/// }
///
/// // Set up resource read forwarding
/// await bridge.setOnResourceRead { uri in
///     // Forward to MCP server and return resource content
///     let resource = try await mcpClient.readResource(uri: uri)
///     // Convert MCP resource to dictionary format
///     return [
///         "contents": AnyCodable(resource.contents)
///     ]
/// }
/// ```
public actor AppBridge {
    private let hostInfo: Implementation
    private let hostCapabilities: McpUiHostCapabilities
    private var hostContext: McpUiHostContext
    private var transport: (any McpAppsTransport)?

    private var appCapabilities: McpUiAppCapabilities?
    private var appInfo: Implementation?
    private var isInitialized: Bool = false
    private var nextRequestId: Int = 1

    private var pendingRequests: [JSONRPCId: CheckedContinuation<AnyCodable, Error>] = [:]
    private var requestHandlers: [String: @Sendable (([String: AnyCodable]?) async throws -> AnyCodable)] = [:]
    private var notificationHandlers: [String: @Sendable (([String: AnyCodable]?) async -> Void)] = [:]

    // Callbacks
    public var onInitialized: (@Sendable () -> Void)?
    public var onSizeChange: (@Sendable (Int?, Int?) -> Void)?
    public var onMessage: (@Sendable (String, [TextContent]) async -> McpUiMessageResult)?
    public var onOpenLink: (@Sendable (String) async -> McpUiOpenLinkResult)?
    public var onLoggingMessage: (@Sendable (LogLevel, AnyCodable, String?) -> Void)?
    public var onPing: (@Sendable () -> Void)?

    // MCP Server forwarding callbacks
    /// Callback for forwarding tools/call requests to the MCP server.
    /// Parameters:
    ///   - toolName: Name of the tool to call
    ///   - arguments: Tool arguments as key-value pairs
    /// Returns: Tool execution result as key-value pairs
    public var onToolCall: (@Sendable (String, [String: AnyCodable]?) async throws -> [String: AnyCodable])?

    /// Callback for forwarding resources/read requests to the MCP server.
    /// Parameters:
    ///   - uri: Resource URI to read
    /// Returns: Resource content as key-value pairs
    public var onResourceRead: (@Sendable (String) async throws -> [String: AnyCodable])?

    /// Create a new AppBridge instance.
    ///
    /// - Parameters:
    ///   - hostInfo: Host application identification (name and version)
    ///   - hostCapabilities: Features and capabilities the host supports
    ///   - options: Configuration options
    public init(
        hostInfo: Implementation,
        hostCapabilities: McpUiHostCapabilities,
        options: HostOptions = HostOptions()
    ) {
        self.hostInfo = hostInfo
        self.hostCapabilities = hostCapabilities
        self.hostContext = options.hostContext
        setupHandlers()
    }

    private func setupHandlers() {
        // Handle ui/initialize request
        requestHandlers["ui/initialize"] = { [weak self] params in
            guard let self = self else { throw BridgeError.disconnected }
            return try await self.handleInitialize(params)
        }

        // Handle ui/message request
        requestHandlers["ui/message"] = { [weak self] params in
            guard let self = self else { throw BridgeError.disconnected }
            return try await self.handleMessage(params)
        }

        // Handle ui/open-link request
        requestHandlers["ui/open-link"] = { [weak self] params in
            guard let self = self else { throw BridgeError.disconnected }
            return try await self.handleOpenLink(params)
        }

        // Handle ping request
        requestHandlers["ping"] = { [weak self] _ in
            await self?.onPing?()
            return AnyCodable([:])
        }

        // Handle tools/call request - forward to MCP server
        requestHandlers["tools/call"] = { [weak self] params in
            guard let self = self else { throw BridgeError.disconnected }
            return try await self.handleToolCall(params)
        }

        // Handle resources/read request - forward to MCP server
        requestHandlers["resources/read"] = { [weak self] params in
            guard let self = self else { throw BridgeError.disconnected }
            return try await self.handleResourceRead(params)
        }
    }

    private func handleInitialize(_ params: [String: AnyCodable]?) async throws -> AnyCodable {
        // Decode params
        let data = try JSONSerialization.data(withJSONObject: params?.mapValues { $0.value } ?? [:])
        let initParams = try JSONDecoder().decode(McpUiInitializeParams.self, from: data)

        appCapabilities = initParams.appCapabilities
        appInfo = initParams.appInfo

        let requestedVersion = initParams.protocolVersion
        let protocolVersion = McpAppsConfig.supportedProtocolVersions.contains(requestedVersion)
            ? requestedVersion
            : McpAppsConfig.latestProtocolVersion

        let result = McpUiInitializeResult(
            protocolVersion: protocolVersion,
            hostInfo: hostInfo,
            hostCapabilities: hostCapabilities,
            hostContext: hostContext
        )

        let resultData = try JSONEncoder().encode(result)
        let resultDict = try JSONSerialization.jsonObject(with: resultData) as? [String: Any] ?? [:]
        return AnyCodable(resultDict)
    }

    private func handleMessage(_ params: [String: AnyCodable]?) async throws -> AnyCodable {
        let data = try JSONSerialization.data(withJSONObject: params?.mapValues { $0.value } ?? [:])
        let msgParams = try JSONDecoder().decode(McpUiMessageParams.self, from: data)

        let result = await onMessage?(msgParams.role, msgParams.content) ?? McpUiMessageResult(isError: true)
        return AnyCodable(["isError": result.isError ?? false])
    }

    private func handleOpenLink(_ params: [String: AnyCodable]?) async throws -> AnyCodable {
        let data = try JSONSerialization.data(withJSONObject: params?.mapValues { $0.value } ?? [:])
        let linkParams = try JSONDecoder().decode(McpUiOpenLinkParams.self, from: data)

        let result = await onOpenLink?(linkParams.url) ?? McpUiOpenLinkResult(isError: true)
        return AnyCodable(["isError": result.isError ?? false])
    }

    private func handleToolCall(_ params: [String: AnyCodable]?) async throws -> AnyCodable {
        guard let onToolCall = onToolCall else {
            throw BridgeError.rpcError(JSONRPCError(code: JSONRPCError.methodNotFound, message: "tools/call forwarding not configured"))
        }

        // Extract tool name and arguments from params
        guard let name = params?["name"]?.value as? String else {
            throw BridgeError.rpcError(JSONRPCError(code: JSONRPCError.invalidParams, message: "Missing tool name"))
        }

        // Extract arguments if present
        var arguments: [String: AnyCodable]? = nil
        if let argsValue = params?["arguments"]?.value {
            if let argsDict = argsValue as? [String: Any] {
                arguments = argsDict.mapValues { AnyCodable($0) }
            }
        }

        // Forward to callback
        let result = try await onToolCall(name, arguments)

        // Convert result to AnyCodable
        let resultData = try JSONSerialization.data(withJSONObject: result.mapValues { $0.value })
        let resultDict = try JSONSerialization.jsonObject(with: resultData) as? [String: Any] ?? [:]
        return AnyCodable(resultDict)
    }

    private func handleResourceRead(_ params: [String: AnyCodable]?) async throws -> AnyCodable {
        guard let onResourceRead = onResourceRead else {
            throw BridgeError.rpcError(JSONRPCError(code: JSONRPCError.methodNotFound, message: "resources/read forwarding not configured"))
        }

        // Extract URI from params
        guard let uri = params?["uri"]?.value as? String else {
            throw BridgeError.rpcError(JSONRPCError(code: JSONRPCError.invalidParams, message: "Missing resource URI"))
        }

        // Forward to callback
        let result = try await onResourceRead(uri)

        // Convert result to AnyCodable
        let resultData = try JSONSerialization.data(withJSONObject: result.mapValues { $0.value })
        let resultDict = try JSONSerialization.jsonObject(with: resultData) as? [String: Any] ?? [:]
        return AnyCodable(resultDict)
    }

    /// Connect to the Guest UI via transport.
    public func connect(_ transport: any McpAppsTransport) async throws {
        self.transport = transport
        try await transport.start()

        // Start processing incoming messages
        Task {
            for try await message in await transport.incoming {
                await handleMessage(message)
            }
        }
    }

    /// Close the connection.
    public func close() async {
        await transport?.close()
        transport = nil
    }

    private func handleMessage(_ message: JSONRPCMessage) async {
        switch message {
        case .request(let request):
            await handleRequest(request)
        case .notification(let notification):
            await handleNotification(notification)
        case .response(let response):
            handleResponse(response)
        case .error(let error):
            handleErrorResponse(error)
        }
    }

    private func handleRequest(_ request: JSONRPCRequest) async {
        guard let handler = requestHandlers[request.method] else {
            await sendError(id: request.id, code: JSONRPCError.methodNotFound, message: "Method not found: \(request.method)")
            return
        }

        do {
            let result = try await handler(request.params)
            let response = JSONRPCResponse(id: request.id, result: result)
            try await transport?.send(.response(response))
        } catch {
            await sendError(id: request.id, code: JSONRPCError.internalError, message: error.localizedDescription)
        }
    }

    private func handleNotification(_ notification: JSONRPCNotification) async {
        // Handle ui/notifications/initialized
        if notification.method == "ui/notifications/initialized" {
            isInitialized = true
            onInitialized?()
            return
        }

        // Handle ui/notifications/size-changed
        if notification.method == "ui/notifications/size-changed" {
            let width = (notification.params?["width"]?.value as? Int)
            let height = (notification.params?["height"]?.value as? Int)
            onSizeChange?(width, height)
            return
        }

        // Handle notifications/message (logging)
        if notification.method == "notifications/message" {
            if let level = notification.params?["level"]?.value as? String,
               let logLevel = LogLevel(rawValue: level),
               let data = notification.params?["data"] {
                let logger = notification.params?["logger"]?.value as? String
                onLoggingMessage?(logLevel, data, logger)
            }
            return
        }

        // Check custom handlers
        if let handler = notificationHandlers[notification.method] {
            await handler(notification.params)
        }
    }

    private func handleResponse(_ response: JSONRPCResponse) {
        if let continuation = pendingRequests.removeValue(forKey: response.id) {
            continuation.resume(returning: response.result)
        }
    }

    private func handleErrorResponse(_ response: JSONRPCErrorResponse) {
        if let id = response.id, let continuation = pendingRequests.removeValue(forKey: id) {
            continuation.resume(throwing: BridgeError.rpcError(response.error))
        }
    }

    private func sendError(id: JSONRPCId, code: Int, message: String) async {
        let error = JSONRPCErrorResponse(
            id: id,
            error: JSONRPCError(code: code, message: message)
        )
        try? await transport?.send(.error(error))
    }

    // MARK: - Public Methods

    /// Get the Guest UI's capabilities discovered during initialization.
    public func getAppCapabilities() -> McpUiAppCapabilities? {
        appCapabilities
    }

    /// Get the Guest UI's implementation info discovered during initialization.
    public func getAppVersion() -> Implementation? {
        appInfo
    }

    /// Check if the Guest UI has completed initialization.
    public func isReady() -> Bool {
        isInitialized
    }

    /// Send complete tool arguments to the Guest UI.
    public func sendToolInput(arguments: [String: AnyCodable]?) async throws {
        try await sendNotification(
            method: "ui/notifications/tool-input",
            params: ["arguments": AnyCodable(arguments?.mapValues { $0.value } ?? [:])]
        )
    }

    /// Send streaming partial tool arguments to the Guest UI.
    public func sendToolInputPartial(arguments: [String: AnyCodable]?) async throws {
        try await sendNotification(
            method: "ui/notifications/tool-input-partial",
            params: ["arguments": AnyCodable(arguments?.mapValues { $0.value } ?? [:])]
        )
    }

    /// Send tool execution result to the Guest UI.
    public func sendToolResult(_ result: [String: AnyCodable]) async throws {
        try await sendNotification(
            method: "ui/notifications/tool-result",
            params: result
        )
    }

    /// Update the host context and notify the Guest UI of changes.
    public func setHostContext(_ newContext: McpUiHostContext) async throws {
        guard newContext != hostContext else { return }
        hostContext = newContext

        let data = try JSONEncoder().encode(newContext)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        try await sendNotification(
            method: "ui/notifications/host-context-changed",
            params: dict.mapValues { AnyCodable($0) }
        )
    }

    /// Request graceful shutdown of the Guest UI.
    public func sendResourceTeardown() async throws -> McpUiResourceTeardownResult {
        _ = try await sendRequest(method: "ui/resource-teardown", params: nil)
        return McpUiResourceTeardownResult()
    }

    // MARK: - Private Helpers

    private func sendNotification(method: String, params: [String: AnyCodable]?) async throws {
        let notification = JSONRPCNotification(method: method, params: params)
        try await transport?.send(.notification(notification))
    }

    private func sendRequest(method: String, params: [String: AnyCodable]?) async throws -> AnyCodable {
        let id = JSONRPCId.number(nextRequestId)
        nextRequestId += 1

        let request = JSONRPCRequest(id: id, method: method, params: params)

        return try await withCheckedThrowingContinuation { continuation in
            pendingRequests[id] = continuation
            Task {
                do {
                    try await transport?.send(.request(request))
                } catch {
                    if let cont = pendingRequests.removeValue(forKey: id) {
                        cont.resume(throwing: error)
                    }
                }
            }
        }
    }
}

/// Bridge errors.
public enum BridgeError: Error {
    case disconnected
    case rpcError(JSONRPCError)
    case timeout
}
