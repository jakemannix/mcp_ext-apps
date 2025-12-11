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

    // Callbacks - using nonisolated(unsafe) for callback storage
    nonisolated(unsafe) public var onInitialized: (@Sendable () -> Void)?
    nonisolated(unsafe) public var onSizeChange: (@Sendable (Int?, Int?) -> Void)?
    nonisolated(unsafe) public var onMessage: (@Sendable (String, [ContentBlock]) async -> McpUiMessageResult)?
    nonisolated(unsafe) public var onOpenLink: (@Sendable (String) async -> McpUiOpenLinkResult)?
    nonisolated(unsafe) public var onLoggingMessage: (@Sendable (LogLevel, AnyCodable, String?) -> Void)?
    nonisolated(unsafe) public var onPing: (@Sendable () -> Void)?
    nonisolated(unsafe) public var onToolCall: (@Sendable (String, [String: AnyCodable]?) async throws -> [String: AnyCodable])?
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
            let width = notification.params?["width"]?.value as? Int
            let height = notification.params?["height"]?.value as? Int
            onSizeChange?(width, height)
        case "notifications/message":
            if let level = notification.params?["level"]?.value as? String,
               let logLevel = LogLevel(rawValue: level),
               let data = notification.params?["data"] {
                let logger = notification.params?["logger"]?.value as? String
                onLoggingMessage?(logLevel, data, logger)
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

    public func sendToolInput(arguments: [String: AnyCodable]?) async throws {
        try await sendNotification(method: "ui/notifications/tool-input",
            params: ["arguments": AnyCodable(arguments?.mapValues { $0.value } ?? [:])])
    }

    public func sendToolInputPartial(arguments: [String: AnyCodable]?) async throws {
        try await sendNotification(method: "ui/notifications/tool-input-partial",
            params: ["arguments": AnyCodable(arguments?.mapValues { $0.value } ?? [:])])
    }

    public func sendToolResult(_ result: [String: AnyCodable]) async throws {
        try await sendNotification(method: "ui/notifications/tool-result", params: result)
    }

    public func setHostContext(_ newContext: McpUiHostContext) async throws {
        guard newContext != hostContext else { return }
        hostContext = newContext
        let data = try JSONEncoder().encode(newContext)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        try await sendNotification(method: "ui/notifications/host-context-changed",
            params: dict.mapValues { AnyCodable($0) })
    }

    public func sendResourceTeardown() async throws -> McpUiResourceTeardownResult {
        _ = try await sendRequest(method: "ui/resource-teardown", params: nil)
        return McpUiResourceTeardownResult()
    }

    // MARK: - Helpers

    private func sendNotification(method: String, params: [String: AnyCodable]?) async throws {
        try await transport?.send(.notification(JSONRPCNotification(method: method, params: params)))
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
                    pendingRequests.removeValue(forKey: id)?.resume(throwing: error)
                }
            }
        }
    }
}

public enum BridgeError: Error {
    case disconnected
    case rpcError(JSONRPCError)
    case timeout
}
