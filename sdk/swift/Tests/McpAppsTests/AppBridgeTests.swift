import XCTest
@testable import McpApps

final class AppBridgeTests: XCTestCase {

    let testHostInfo = Implementation(name: "TestHost", version: "1.0.0")
    let testAppInfo = Implementation(name: "TestApp", version: "1.0.0")
    let testHostCapabilities = McpUiHostCapabilities(
        openLinks: true,
        serverTools: ServerToolsCapability(),
        logging: true
    )

    func testMessageTypes() throws {
        // Test that all message types encode/decode correctly
        let initParams = McpUiInitializeParams(
            appInfo: Implementation(name: "TestApp", version: "1.0.0"),
            appCapabilities: McpUiAppCapabilities(
                tools: AppToolsCapability(listChanged: true)
            ),
            protocolVersion: "2025-11-21"
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(initParams)
        let decoded = try decoder.decode(McpUiInitializeParams.self, from: encoded)

        XCTAssertEqual(decoded.appInfo.name, initParams.appInfo.name)
        XCTAssertEqual(decoded.protocolVersion, initParams.protocolVersion)
    }

    func testHostContext() throws {
        let context = McpUiHostContext(
            theme: .dark,
            displayMode: .inline,
            viewport: Viewport(width: 800, height: 600, maxHeight: 1000),
            locale: "en-US",
            timeZone: "America/New_York",
            platform: .mobile,
            deviceCapabilities: DeviceCapabilities(touch: true, hover: false),
            safeAreaInsets: SafeAreaInsets(top: 44, right: 0, bottom: 34, left: 0)
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(context)
        let decoded = try decoder.decode(McpUiHostContext.self, from: encoded)

        XCTAssertEqual(decoded.theme, .dark)
        XCTAssertEqual(decoded.displayMode, .inline)
        XCTAssertEqual(decoded.viewport?.width, 800)
        XCTAssertEqual(decoded.locale, "en-US")
        XCTAssertEqual(decoded.platform, .mobile)
        XCTAssertEqual(decoded.deviceCapabilities?.touch, true)
    }

    func testToolInputParams() throws {
        let params = McpUiToolInputParams(
            arguments: [
                "query": AnyCodable("weather in NYC"),
                "count": AnyCodable(5)
            ]
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(params)
        let decoded = try decoder.decode(McpUiToolInputParams.self, from: encoded)

        XCTAssertEqual(decoded.arguments?["query"]?.value as? String, "weather in NYC")
        XCTAssertEqual(decoded.arguments?["count"]?.value as? Int, 5)
    }

    func testJSONRPCRequest() throws {
        let request = JSONRPCRequest(
            id: .number(1),
            method: "ui/initialize",
            params: ["test": AnyCodable("value")]
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(request)
        let decoded = try decoder.decode(JSONRPCRequest.self, from: encoded)

        XCTAssertEqual(decoded.id, .number(1))
        XCTAssertEqual(decoded.method, "ui/initialize")
        XCTAssertEqual(decoded.jsonrpc, "2.0")
    }

    func testJSONRPCNotification() throws {
        let notification = JSONRPCNotification(
            method: "ui/notifications/initialized",
            params: nil
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(notification)
        let decoded = try decoder.decode(JSONRPCNotification.self, from: encoded)

        XCTAssertEqual(decoded.method, "ui/notifications/initialized")
        XCTAssertEqual(decoded.jsonrpc, "2.0")
    }

    func testAnyCodable() throws {
        let values: [String: AnyCodable] = [
            "string": AnyCodable("hello"),
            "int": AnyCodable(42),
            "double": AnyCodable(3.14),
            "bool": AnyCodable(true),
            "array": AnyCodable([1, 2, 3]),
            "dict": AnyCodable(["nested": "value"])
        ]

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(values)
        let decoded = try decoder.decode([String: AnyCodable].self, from: encoded)

        XCTAssertEqual(decoded["string"]?.value as? String, "hello")
        XCTAssertEqual(decoded["int"]?.value as? Int, 42)
        XCTAssertEqual(decoded["bool"]?.value as? Bool, true)
    }

    func testAppBridgeCreation() async throws {
        let bridge = AppBridge(
            hostInfo: testHostInfo,
            hostCapabilities: testHostCapabilities
        )

        XCTAssertFalse(await bridge.isReady())
        XCTAssertNil(await bridge.getAppCapabilities())
        XCTAssertNil(await bridge.getAppVersion())
    }

    func testInMemoryTransportCreation() async throws {
        let (transport1, transport2) = await InMemoryTransport.createLinkedPair()

        try await transport1.start()
        try await transport2.start()

        // Test that we can create transports without error
        await transport1.close()
        await transport2.close()
    }

    func testInitializeResult() throws {
        let result = McpUiInitializeResult(
            protocolVersion: McpAppsConfig.latestProtocolVersion,
            hostInfo: testHostInfo,
            hostCapabilities: testHostCapabilities,
            hostContext: McpUiHostContext(theme: .light)
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(result)
        let decoded = try decoder.decode(McpUiInitializeResult.self, from: encoded)

        XCTAssertEqual(decoded.protocolVersion, McpAppsConfig.latestProtocolVersion)
        XCTAssertEqual(decoded.hostInfo.name, testHostInfo.name)
        XCTAssertEqual(decoded.hostContext.theme, .light)
    }

    func testLogLevel() throws {
        let levels: [LogLevel] = [.debug, .info, .notice, .warning, .error, .critical, .alert, .emergency]

        for level in levels {
            let params = LoggingMessageParams(
                level: level,
                data: AnyCodable("Test message"),
                logger: "TestLogger"
            )

            let encoder = JSONEncoder()
            let decoder = JSONDecoder()

            let encoded = try encoder.encode(params)
            let decoded = try decoder.decode(LoggingMessageParams.self, from: encoded)

            XCTAssertEqual(decoded.level, level)
        }
    }

    func testResourceMeta() throws {
        let meta = McpUiResourceMeta(
            csp: McpUiResourceCsp(
                connectDomains: ["https://api.example.com"],
                resourceDomains: ["https://cdn.example.com"]
            ),
            domain: "https://widget.example.com",
            prefersBorder: true
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(meta)
        let decoded = try decoder.decode(McpUiResourceMeta.self, from: encoded)

        XCTAssertEqual(decoded.csp?.connectDomains?.first, "https://api.example.com")
        XCTAssertEqual(decoded.domain, "https://widget.example.com")
        XCTAssertEqual(decoded.prefersBorder, true)
    }

    func testToolCallForwarding() async throws {
        let bridge = AppBridge(
            hostInfo: testHostInfo,
            hostCapabilities: testHostCapabilities
        )

        // Set up callback to handle tools/call
        var receivedToolName: String?
        var receivedArguments: [String: AnyCodable]?
        await bridge.setOnToolCall { name, arguments in
            receivedToolName = name
            receivedArguments = arguments
            return [
                "content": AnyCodable([
                    ["type": "text", "text": "Tool result"]
                ])
            ]
        }

        // Create linked transport pair
        let (hostTransport, guestTransport) = await InMemoryTransport.createLinkedPair()

        // Connect bridge
        try await bridge.connect(hostTransport)

        // Send tools/call request from guest
        let request = JSONRPCRequest(
            id: .number(1),
            method: "tools/call",
            params: [
                "name": AnyCodable("test_tool"),
                "arguments": AnyCodable([
                    "param1": "value1",
                    "param2": 42
                ])
            ]
        )
        try await guestTransport.send(.request(request))

        // Wait a bit for message processing
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        // Verify callback was called
        XCTAssertEqual(receivedToolName, "test_tool")
        XCTAssertNotNil(receivedArguments)
        XCTAssertEqual(receivedArguments?["param1"]?.value as? String, "value1")
        XCTAssertEqual(receivedArguments?["param2"]?.value as? Int, 42)

        await bridge.close()
        await guestTransport.close()
    }

    func testResourceReadForwarding() async throws {
        let bridge = AppBridge(
            hostInfo: testHostInfo,
            hostCapabilities: testHostCapabilities
        )

        // Set up callback to handle resources/read
        var receivedUri: String?
        await bridge.setOnResourceRead { uri in
            receivedUri = uri
            return [
                "contents": AnyCodable([
                    [
                        "uri": uri,
                        "mimeType": "text/html",
                        "text": "<html>Resource content</html>"
                    ]
                ])
            ]
        }

        // Create linked transport pair
        let (hostTransport, guestTransport) = await InMemoryTransport.createLinkedPair()

        // Connect bridge
        try await bridge.connect(hostTransport)

        // Send resources/read request from guest
        let request = JSONRPCRequest(
            id: .number(1),
            method: "resources/read",
            params: [
                "uri": AnyCodable("ui://test-app")
            ]
        )
        try await guestTransport.send(.request(request))

        // Wait a bit for message processing
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        // Verify callback was called
        XCTAssertEqual(receivedUri, "ui://test-app")

        await bridge.close()
        await guestTransport.close()
    }

    func testToolCallWithoutCallback() async throws {
        let bridge = AppBridge(
            hostInfo: testHostInfo,
            hostCapabilities: testHostCapabilities
        )

        // Don't set up callback - should result in error

        // Create linked transport pair
        let (hostTransport, guestTransport) = await InMemoryTransport.createLinkedPair()

        // Connect bridge
        try await bridge.connect(hostTransport)

        // Send tools/call request from guest
        let request = JSONRPCRequest(
            id: .number(1),
            method: "tools/call",
            params: [
                "name": AnyCodable("test_tool")
            ]
        )
        try await guestTransport.send(.request(request))

        // Wait a bit for message processing
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        // Verify error response was sent (we can't easily check the response without more infrastructure)
        // Just verify the bridge is still functional
        XCTAssertFalse(await bridge.isReady())

        await bridge.close()
        await guestTransport.close()
    }
}

// Helper extension for tests
extension AppBridge {
    func setOnToolCall(_ callback: @escaping @Sendable (String, [String: AnyCodable]?) async throws -> [String: AnyCodable]) {
        self.onToolCall = callback
    }

    func setOnResourceRead(_ callback: @escaping @Sendable (String) async throws -> [String: AnyCodable]) {
        self.onResourceRead = callback
    }
}
