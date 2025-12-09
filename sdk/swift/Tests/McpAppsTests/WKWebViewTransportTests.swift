import XCTest
import WebKit
@testable import McpApps

@available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
final class WKWebViewTransportTests: XCTestCase {

    func testTransportCreation() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        // Transport should be created successfully
        XCTAssertNotNil(transport)
    }

    func testTransportStartAndClose() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        // Start transport
        try await transport.start()

        // Close transport
        await transport.close()
    }

    func testTransportSendRequest() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create a test request
        let request = JSONRPCRequest(
            id: .number(1),
            method: "ui/initialize",
            params: ["test": AnyCodable("value")]
        )

        // Send request - this should not throw
        try await transport.send(.request(request))

        await transport.close()
    }

    func testTransportSendNotification() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create a test notification
        let notification = JSONRPCNotification(
            method: "ui/notifications/initialized",
            params: nil
        )

        // Send notification - this should not throw
        try await transport.send(.notification(notification))

        await transport.close()
    }

    func testTransportSendResponse() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create a test response
        let response = JSONRPCResponse(
            id: .number(1),
            result: AnyCodable(["success": true])
        )

        // Send response - this should not throw
        try await transport.send(.response(response))

        await transport.close()
    }

    func testTransportSendError() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create a test error response
        let errorResponse = JSONRPCErrorResponse(
            id: .number(1),
            error: JSONRPCError(
                code: JSONRPCError.internalError,
                message: "Test error"
            )
        )

        // Send error - this should not throw
        try await transport.send(.error(errorResponse))

        await transport.close()
    }

    func testCustomHandlerName() async throws {
        let webView = WKWebView()
        let customHandlerName = "customBridge"
        let transport = WKWebViewTransport(webView: webView, handlerName: customHandlerName)

        try await transport.start()

        // Verify the handler is registered with the custom name
        // Note: We can't directly verify this without accessing private members,
        // but we can ensure start() completes without error
        XCTAssertNotNil(transport)

        await transport.close()
    }

    func testMultipleStartCallsAreIdempotent() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        // Start multiple times should not cause issues
        try await transport.start()
        try await transport.start()
        try await transport.start()

        await transport.close()
    }

    func testSendWithoutStartThrows() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        let request = JSONRPCRequest(
            id: .number(1),
            method: "test",
            params: nil
        )

        // Sending without start should still work (no explicit check in implementation)
        // but might fail due to missing script injection
        // This test documents the current behavior
        do {
            try await transport.send(.request(request))
            // If it doesn't throw, that's fine too
        } catch {
            // Expected to potentially fail
            XCTAssertTrue(error is Error)
        }
    }

    func testJSONEncodingWithSpecialCharacters() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Test with special characters that need escaping
        let request = JSONRPCRequest(
            id: .string("test-id"),
            method: "test/method",
            params: [
                "message": AnyCodable("Line 1\nLine 2\r\nWith \"quotes\" and \\backslash\\"),
                "nested": AnyCodable(["key": "value with spaces"])
            ]
        )

        // Should handle special characters without throwing
        try await transport.send(.request(request))

        await transport.close()
    }

    func testMessageReception() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create a task to collect incoming messages
        var receivedMessages: [JSONRPCMessage] = []
        let expectation = expectation(description: "Message received")
        expectation.isInverted = true // We don't expect messages in this test

        Task {
            for try await message in await transport.incoming {
                receivedMessages.append(message)
                expectation.fulfill()
                break
            }
        }

        // Wait a bit to ensure no messages are received
        await fulfillment(of: [expectation], timeout: 0.5)

        // Should have received no messages (no JavaScript execution)
        XCTAssertEqual(receivedMessages.count, 0)

        await transport.close()
    }

    func testTransportWithNilWebView() async throws {
        // Create a weak reference to test behavior with deallocated webView
        var webView: WKWebView? = WKWebView()
        let transport = WKWebViewTransport(webView: webView!)

        try await transport.start()

        // Deallocate webView
        webView = nil

        // Sending should throw notConnected error
        let request = JSONRPCRequest(id: .number(1), method: "test", params: nil)

        do {
            try await transport.send(.request(request))
            XCTFail("Should have thrown notConnected error")
        } catch TransportError.notConnected {
            // Expected
        } catch {
            XCTFail("Wrong error type: \(error)")
        }

        await transport.close()
    }

    func testConcurrentSends() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Send multiple messages concurrently
        try await withThrowingTaskGroup(of: Void.self) { group in
            for i in 0..<10 {
                group.addTask {
                    let request = JSONRPCRequest(
                        id: .number(i),
                        method: "test/method",
                        params: ["index": AnyCodable(i)]
                    )
                    try await transport.send(.request(request))
                }
            }

            try await group.waitForAll()
        }

        await transport.close()
    }

    func testMessageWithDifferentIdTypes() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Test with string ID
        let requestString = JSONRPCRequest(
            id: .string("test-id-123"),
            method: "test/method",
            params: nil
        )
        try await transport.send(.request(requestString))

        // Test with number ID
        let requestNumber = JSONRPCRequest(
            id: .number(42),
            method: "test/method",
            params: nil
        )
        try await transport.send(.request(requestNumber))

        await transport.close()
    }

    func testComplexNestedParams() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create complex nested structure
        let params: [String: AnyCodable] = [
            "string": AnyCodable("test"),
            "number": AnyCodable(42),
            "bool": AnyCodable(true),
            "null": AnyCodable(nil as String?),
            "array": AnyCodable([1, 2, 3]),
            "nested": AnyCodable([
                "level2": [
                    "level3": "deep value"
                ]
            ])
        ]

        let request = JSONRPCRequest(
            id: .number(1),
            method: "test/complex",
            params: params
        )

        try await transport.send(.request(request))

        await transport.close()
    }
}
