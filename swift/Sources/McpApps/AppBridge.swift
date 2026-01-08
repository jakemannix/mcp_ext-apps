import Foundation

/// Handler type for request callbacks.
public typealias RequestHandler = @Sendable ([String: AnyCodable]?) async throws -> AnyCodable

/// Handler type for notification callbacks.
public typealias NotificationHandler = @Sendable ([String: AnyCodable]?) async -> Void

/// Host-side bridge for communicating with a single Guest UI (App).
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

    // MARK: - Notification Handlers (App → Host)

    /// Called when Guest UI completes initialization.
    nonisolated(unsafe) public var onInitialized: (@Sendable () -> Void)?

    /// Called when Guest UI reports a size change.
    nonisolated(unsafe) public var onSizeChange: (@Sendable (McpUiSizeChangedParams) -> Void)?

    /// Called when Guest UI sends a logging message.
    nonisolated(unsafe) public var onLoggingMessage: (@Sendable (LoggingMessageParams) -> Void)?

    /// Called when Guest UI sends a ping request.
    nonisolated(unsafe) public var onPing: (@Sendable () -> Void)?

    // MARK: - Request Handlers (App → Host, must return result)

    /// Called when Guest UI wants to add a message to the conversation.
    nonisolated(unsafe) public var onMessage: (@Sendable (McpUiMessageParams) async -> McpUiMessageResult)?

    /// Called when Guest UI wants to open an external link.
    nonisolated(unsafe) public var onOpenLink: (@Sendable (McpUiOpenLinkParams) async -> McpUiOpenLinkResult)?

    // MARK: - MCP Server Forwarding (App → Server via Host)

    /// Called when Guest UI wants to call a server tool.
    nonisolated(unsafe) public var onToolCall: (@Sendable (String, [String: AnyCodable]?) async throws -> [String: AnyCodable])?

    /// Called when Guest UI wants to read a server resource.
    nonisolated(unsafe) public var onResourceRead: (@Sendable (String) async throws -> [String: AnyCodable])?

    public init(
        hostInfo: Implementation,
        hostCapabilities: McpUiHostCapabilities,
        options: HostOptions = HostOptions()
    ) {
        self.hostInfo = hostInfo
        self.hostCapabilities = hostCapabilities
        self.hostContext = options.hostContext
    }

    // MARK: - Connection

    public func connect(_ transport: any McpAppsTransport) async throws {
        self.transport = transport
        try await transport.start()

        Task {
            for try await message in await transport.incoming {
                await handleMessage(message)
            }
        }
    }

    public func close() async {
        await transport?.close()
        transport = nil
    }

    // MARK: - Message Handling

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
        do {
            let result: AnyCodable
            switch request.method {
            case "ui/initialize":
                result = try await handleInitialize(request.params)
            case "ui/message":
                result = try await handleMessageRequest(request.params)
            case "ui/open-link":
                result = try await handleOpenLink(request.params)
            case "ping":
                onPing?()
                result = AnyCodable([:])
            case "tools/call":
                result = try await handleToolCall(request.params)
            case "resources/read":
                result = try await handleResourceRead(request.params)
            default:
                await sendError(id: request.id, code: JSONRPCError.methodNotFound, message: "Method not found: \(request.method)")
                return
            }
            let response = JSONRPCResponse(id: request.id, result: result)
            try await transport?.send(.response(response))
        } catch {
            await sendError(id: request.id, code: JSONRPCError.internalError, message: error.localizedDescription)
        }
    }

    private func handleNotification(_ notification: JSONRPCNotification) async {
        switch notification.method {
        case "ui/notifications/initialized":
            isInitialized = true
            onInitialized?()
        case "ui/notifications/size-changed":
            // Handle both Int and Double from JSON (integers decode as Int, not Double)
            let width = (notification.params?["width"]?.value as? NSNumber)?.doubleValue
            let height = (notification.params?["height"]?.value as? NSNumber)?.doubleValue
            let params = McpUiSizeChangedParams(width: width, height: height)
            onSizeChange?(params)
        case "notifications/message":
            if let level = notification.params?["level"]?.value as? String,
               let logLevel = LogLevel(rawValue: level),
               let data = notification.params?["data"] {
                let logger = notification.params?["logger"]?.value as? String
                let params = LoggingMessageParams(level: logLevel, data: data, logger: logger)
                onLoggingMessage?(params)
            }
        default:
            break
        }
    }

    private func handleResponse(_ response: JSONRPCResponse) {
        pendingRequests.removeValue(forKey: response.id)?.resume(returning: response.result)
    }

    private func handleErrorResponse(_ response: JSONRPCErrorResponse) {
        if let id = response.id {
            pendingRequests.removeValue(forKey: id)?.resume(throwing: BridgeError.rpcError(response.error))
        }
    }

    // MARK: - Request Handlers

    private func handleInitialize(_ params: [String: AnyCodable]?) async throws -> AnyCodable {
        let data = try JSONSerialization.data(withJSONObject: params?.mapValues { $0.value } ?? [:])
        let initParams = try JSONDecoder().decode(McpUiInitializeParams.self, from: data)

        appCapabilities = initParams.appCapabilities
        appInfo = initParams.appInfo

        let protocolVersion = McpAppsConfig.supportedProtocolVersions.contains(initParams.protocolVersion)
            ? initParams.protocolVersion
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

    private func handleMessageRequest(_ params: [String: AnyCodable]?) async throws -> AnyCodable {
        let data = try JSONSerialization.data(withJSONObject: params?.mapValues { $0.value } ?? [:])
        let msgParams = try JSONDecoder().decode(McpUiMessageParams.self, from: data)
        let result = await onMessage?(msgParams) ?? McpUiMessageResult(isError: true)
        return AnyCodable(["isError": result.isError ?? false])
    }

    private func handleOpenLink(_ params: [String: AnyCodable]?) async throws -> AnyCodable {
        let data = try JSONSerialization.data(withJSONObject: params?.mapValues { $0.value } ?? [:])
        let linkParams = try JSONDecoder().decode(McpUiOpenLinkParams.self, from: data)
        let result = await onOpenLink?(linkParams) ?? McpUiOpenLinkResult(isError: true)
        return AnyCodable(["isError": result.isError ?? false])
    }

    private func handleToolCall(_ params: [String: AnyCodable]?) async throws -> AnyCodable {
        guard let callback = onToolCall else {
            throw BridgeError.rpcError(JSONRPCError(code: JSONRPCError.methodNotFound, message: "tools/call not configured"))
        }
        guard let name = params?["name"]?.value as? String else {
            throw BridgeError.rpcError(JSONRPCError(code: JSONRPCError.invalidParams, message: "Missing tool name"))
        }
        var arguments: [String: AnyCodable]? = nil
        if let argsDict = params?["arguments"]?.value as? [String: Any] {
            arguments = argsDict.mapValues { AnyCodable($0) }
        }
        let result = try await callback(name, arguments)
        return AnyCodable(result.mapValues { $0.value })
    }

    private func handleResourceRead(_ params: [String: AnyCodable]?) async throws -> AnyCodable {
        guard let callback = onResourceRead else {
            throw BridgeError.rpcError(JSONRPCError(code: JSONRPCError.methodNotFound, message: "resources/read not configured"))
        }
        guard let uri = params?["uri"]?.value as? String else {
            throw BridgeError.rpcError(JSONRPCError(code: JSONRPCError.invalidParams, message: "Missing URI"))
        }
        let result = try await callback(uri)
        return AnyCodable(result.mapValues { $0.value })
    }

    private func sendError(id: JSONRPCId, code: Int, message: String) async {
        let error = JSONRPCErrorResponse(id: id, error: JSONRPCError(code: code, message: message))
        try? await transport?.send(.error(error))
    }

    // MARK: - Public API

    public func getAppCapabilities() -> McpUiAppCapabilities? { appCapabilities }
    public func getAppVersion() -> Implementation? { appInfo }
    public func isReady() -> Bool { isInitialized }

    /// Send complete tool arguments to the Guest UI.
    /// Must be called after initialization completes.
    public func sendToolInput(_ params: McpUiToolInputParams) async throws {
        let data = try JSONEncoder().encode(params)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        try await sendNotification(method: "ui/notifications/tool-input",
            params: dict.mapValues { AnyCodable($0) })
    }

    /// Send streaming partial tool arguments to the Guest UI.
    /// May be called zero or more times before sendToolInput.
    public func sendToolInputPartial(_ params: McpUiToolInputPartialParams) async throws {
        let data = try JSONEncoder().encode(params)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        try await sendNotification(method: "ui/notifications/tool-input-partial",
            params: dict.mapValues { AnyCodable($0) })
    }

    /// Send tool execution result to the Guest UI.
    /// Must be called after sendToolInput.
    public func sendToolResult(_ params: McpUiToolResultParams) async throws {
        let data = try JSONEncoder().encode(params)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        try await sendNotification(method: "ui/notifications/tool-result",
            params: dict.mapValues { AnyCodable($0) })
    }

    /// Notify the Guest UI that tool execution was cancelled.
    public func sendToolCancelled(_ params: McpUiToolCancelledParams = McpUiToolCancelledParams()) async throws {
        let data = try JSONEncoder().encode(params)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        try await sendNotification(method: "ui/notifications/tool-cancelled",
            params: dict.mapValues { AnyCodable($0) })
    }

    public func setHostContext(_ newContext: McpUiHostContext) async throws {
        guard newContext != hostContext else { return }
        hostContext = newContext
        let data = try JSONEncoder().encode(newContext)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        try await sendNotification(method: "ui/notifications/host-context-changed",
            params: dict.mapValues { AnyCodable($0) })
    }

    /// Request the App to perform cleanup before the resource is torn down.
    ///
    /// - Parameter timeout: Maximum time to wait for the App to respond (default 0.5s)
    public func sendResourceTeardown(timeout: TimeInterval = 0.5) async throws -> McpUiResourceTeardownResult {
        _ = try await sendRequest(method: "ui/resource-teardown", params: [:], timeout: timeout)
        return McpUiResourceTeardownResult()
    }

    // MARK: - Helpers

    private func sendNotification(method: String, params: [String: AnyCodable]?) async throws {
        try await transport?.send(.notification(JSONRPCNotification(method: method, params: params)))
    }

    private func sendRequest(method: String, params: [String: AnyCodable]?, timeout: TimeInterval = 30) async throws -> AnyCodable {
        let id = JSONRPCId.number(nextRequestId)
        nextRequestId += 1
        let request = JSONRPCRequest(id: id, method: method, params: params)

        guard let transport = transport else {
            throw BridgeError.disconnected
        }

        // Create the continuation and store it
        let result: AnyCodable = try await withCheckedThrowingContinuation { continuation in
            pendingRequests[id] = continuation

            // Start timeout task
            Task {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                // If still pending after timeout, fail it
                await self.failPendingRequest(id: id, error: BridgeError.timeout)
            }

            // Send the request
            Task {
                do {
                    try await transport.send(.request(request))
                } catch {
                    await self.failPendingRequest(id: id, error: error)
                }
            }
        }
        return result
    }

    private func failPendingRequest(id: JSONRPCId, error: Error) {
        pendingRequests.removeValue(forKey: id)?.resume(throwing: error)
    }
}

public enum BridgeError: Error {
    case disconnected
    case rpcError(JSONRPCError)
    case timeout
}
