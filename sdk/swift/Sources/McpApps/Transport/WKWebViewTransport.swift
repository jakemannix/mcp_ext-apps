import Foundation
import WebKit

/// Transport for MCP Apps communication using WKWebView.
///
/// This transport enables bidirectional communication between a Swift host
/// application and a Guest UI running in a WKWebView. It bridges between
/// Swift's native APIs and JavaScript's postMessage/messageHandlers APIs.
///
/// ## Architecture
///
/// **Guest UI (JavaScript) ↔ WKWebView Bridge ↔ Swift Host**
///
/// - **Outgoing (Swift → JavaScript)**: Uses `evaluateJavaScript()` to dispatch
///   MessageEvents on the window object
/// - **Incoming (JavaScript → Swift)**: Uses `WKScriptMessageHandler` to receive
///   messages from `webkit.messageHandlers.mcpBridge.postMessage()`
///
/// ## JavaScript Bridge
///
/// The transport injects a user script that creates a bridge between the MCP Apps
/// TypeScript SDK and WKWebView's message handlers:
///
/// ```javascript
/// // Creates window.mcpBridge.send() for explicit sending
/// window.mcpBridge = {
///   send: (message) => webkit.messageHandlers.mcpBridge.postMessage(message)
/// };
///
/// // Overrides window.parent.postMessage for TypeScript SDK compatibility
/// window.parent.postMessage = (message) => {
///   webkit.messageHandlers.mcpBridge.postMessage(message);
/// };
/// ```
///
/// ## Usage
///
/// ```swift
/// // Create WKWebView with message handler
/// let webView = WKWebView()
/// let transport = WKWebViewTransport(webView: webView, handlerName: "mcpBridge")
///
/// // Connect to AppBridge
/// let bridge = AppBridge(hostInfo: hostInfo, hostCapabilities: capabilities)
/// try await bridge.connect(transport)
///
/// // Load Guest UI HTML
/// webView.loadHTMLString(htmlContent, baseURL: nil)
/// ```
///
/// ## Thread Safety
///
/// This actor ensures all transport operations are serialized and thread-safe.
/// WKWebView operations must be performed on the main thread, so this transport
/// uses `@MainActor` where necessary.
///
/// ## Platform Support
///
/// - iOS 15+
/// - macOS 12+
/// - tvOS 15+
/// - watchOS 8+
@available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
public actor WKWebViewTransport: McpAppsTransport {
    private weak var webView: WKWebView?
    private let handlerName: String
    private var continuation: AsyncThrowingStream<JSONRPCMessage, Error>.Continuation?
    private var isStarted: Bool = false

    public let incoming: AsyncThrowingStream<JSONRPCMessage, Error>

    /// Create a new WKWebView transport.
    ///
    /// - Parameters:
    ///   - webView: The WKWebView instance to communicate with
    ///   - handlerName: Name of the message handler (default: "mcpBridge")
    ///
    /// - Note: The transport will automatically inject the bridge script when started.
    ///   Ensure you call `start()` before loading content in the WebView.
    public init(webView: WKWebView, handlerName: String = "mcpBridge") {
        self.webView = webView
        self.handlerName = handlerName

        var continuation: AsyncThrowingStream<JSONRPCMessage, Error>.Continuation?
        self.incoming = AsyncThrowingStream { continuation = $0 }
        self.continuation = continuation
    }

    /// Start the transport and inject the JavaScript bridge.
    ///
    /// This method must be called before loading content in the WebView.
    /// It registers the message handler and injects the bridge script.
    public func start() async throws {
        guard !isStarted else { return }

        await MainActor.run {
            // Register message handler
            webView?.configuration.userContentController.add(
                MessageHandlerProxy(transport: self),
                name: handlerName
            )

            // Inject bridge script
            let bridgeScript = createBridgeScript()
            let userScript = WKUserScript(
                source: bridgeScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            webView?.configuration.userContentController.addUserScript(userScript)
        }

        isStarted = true
    }

    /// Send a JSON-RPC message to the Guest UI.
    ///
    /// Messages are encoded to JSON and dispatched as MessageEvents on the
    /// window object in JavaScript.
    public func send(_ message: JSONRPCMessage) async throws {
        guard let webView = webView else {
            throw TransportError.notConnected
        }

        // Encode message to JSON
        let encoder = JSONEncoder()
        let data = try encoder.encode(message)

        guard let jsonString = String(data: data, encoding: .utf8) else {
            throw TransportError.serializationFailed
        }

        // Escape the JSON string for JavaScript
        let escapedJson = jsonString
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")

        // Dispatch MessageEvent on window
        let script = """
        (function() {
            try {
                const message = JSON.parse("\(escapedJson)");
                window.dispatchEvent(new MessageEvent('message', {
                    data: message,
                    origin: window.location.origin
                }));
            } catch (error) {
                console.error('Failed to dispatch message:', error);
            }
        })();
        """

        try await MainActor.run {
            try await webView.evaluateJavaScript(script)
        }
    }

    /// Close the transport and cleanup resources.
    public func close() async {
        continuation?.finish()

        await MainActor.run {
            webView?.configuration.userContentController.removeScriptMessageHandler(
                forName: handlerName
            )
            webView?.configuration.userContentController.removeAllUserScripts()
        }

        isStarted = false
    }

    // MARK: - Private Methods

    private func createBridgeScript() -> String {
        """
        (function() {
            // Create mcpBridge for explicit message sending
            window.mcpBridge = {
                send: function(message) {
                    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.\(handlerName)) {
                        window.webkit.messageHandlers.\(handlerName).postMessage(message);
                    } else {
                        console.error('WKWebView message handler not available');
                    }
                }
            };

            // Override window.parent.postMessage for TypeScript SDK compatibility
            // The TypeScript SDK uses window.parent.postMessage to communicate with the host
            const originalPostMessage = window.parent.postMessage.bind(window.parent);
            window.parent.postMessage = function(message, targetOrigin, transfer) {
                // Check if this is a JSON-RPC message (has jsonrpc property)
                if (message && typeof message === 'object' && message.jsonrpc) {
                    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.\(handlerName)) {
                        window.webkit.messageHandlers.\(handlerName).postMessage(message);
                    } else {
                        console.error('WKWebView message handler not available');
                    }
                } else {
                    // Fall back to original postMessage for non-JSON-RPC messages
                    originalPostMessage(message, targetOrigin, transfer);
                }
            };

            console.log('MCP Apps WKWebView bridge initialized');
        })();
        """
    }

    /// Receive a message from JavaScript and parse it as a JSON-RPC message.
    nonisolated func receiveMessage(_ body: Any) {
        Task {
            await handleIncomingMessage(body)
        }
    }

    private func handleIncomingMessage(_ body: Any) async {
        do {
            // Convert message body to Data
            let data: Data
            if let dict = body as? [String: Any] {
                data = try JSONSerialization.data(withJSONObject: dict)
            } else if let string = body as? String,
                      let stringData = string.data(using: .utf8) {
                data = stringData
            } else {
                throw TransportError.invalidMessage
            }

            // Decode JSON-RPC message
            let decoder = JSONDecoder()
            let message = try decoder.decode(JSONRPCMessage.self, from: data)

            // Yield to incoming stream
            continuation?.yield(message)
        } catch {
            continuation?.yield(with: .failure(error))
        }
    }
}

/// Proxy class to bridge between WKScriptMessageHandler and the actor.
///
/// WKScriptMessageHandler requires NSObject conformance and cannot be
/// implemented directly on an actor, so we use this proxy.
@available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
private class MessageHandlerProxy: NSObject, WKScriptMessageHandler {
    private let transport: WKWebViewTransport

    init(transport: WKWebViewTransport) {
        self.transport = transport
        super.init()
    }

    nonisolated func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        transport.receiveMessage(message.body)
    }
}
