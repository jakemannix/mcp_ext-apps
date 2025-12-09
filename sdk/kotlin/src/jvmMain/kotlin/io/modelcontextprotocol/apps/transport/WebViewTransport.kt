package io.modelcontextprotocol.apps.transport

import android.webkit.JavascriptInterface
import android.webkit.WebView
import io.modelcontextprotocol.apps.protocol.JSONRPCMessage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Transport implementation for Android WebView using JavaScript bridge.
 *
 * This transport enables bidirectional communication between a Kotlin/Android host
 * and a JavaScript guest UI running in a WebView. It implements the McpAppsTransport
 * interface for MCP Apps communication.
 *
 * ## Architecture
 *
 * The transport works by:
 * 1. Injecting a JavaScript bridge script into the WebView that creates:
 *    - `window.mcpBridge.send()` for sending messages from JS to Kotlin
 *    - Override of `window.parent.postMessage()` for TypeScript SDK compatibility
 *    - Message event dispatching for incoming messages from Kotlin
 * 2. Using `@JavascriptInterface` methods to receive messages from JavaScript
 * 3. Using `webView.evaluateJavascript()` to send messages to JavaScript
 *
 * ## Usage
 *
 * ```kotlin
 * val webView = findViewById<WebView>(R.id.webView)
 * val transport = WebViewTransport(webView)
 *
 * // Connect to AppBridge
 * val bridge = AppBridge(mcpClient, hostInfo, hostCapabilities)
 * bridge.connect(transport)
 *
 * // Load your guest UI
 * webView.loadUrl("file:///android_asset/guest-ui.html")
 * ```
 *
 * ## JavaScript Side
 *
 * The guest UI can use either:
 * - `window.mcpBridge.send(message)` to send messages
 * - `window.parent.postMessage(message, '*')` (TypeScript SDK compatibility)
 *
 * To receive messages:
 * ```javascript
 * window.addEventListener('message', (event) => {
 *   const message = event.data;
 *   // Handle JSON-RPC message
 * });
 * ```
 *
 * @param webView The Android WebView instance to communicate with
 * @param json Optional JSON serializer (defaults to kotlinx.serialization.json.Json)
 */
class WebViewTransport(
    private val webView: WebView,
    private val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
    }
) : McpAppsTransport {

    private val _incoming = MutableSharedFlow<JSONRPCMessage>(replay = 0, extraBufferCapacity = 64)
    private val _errors = MutableSharedFlow<Throwable>(replay = 0, extraBufferCapacity = 64)

    override val incoming: Flow<JSONRPCMessage> = _incoming
    override val errors: Flow<Throwable> = _errors

    private var isStarted = false
    private val jsBridge = JsBridge()

    /**
     * JavaScript bridge object that will be accessible from the WebView.
     * This object receives messages from JavaScript via @JavascriptInterface methods.
     */
    inner class JsBridge {
        /**
         * Called from JavaScript to send a message to the Kotlin host.
         * This method is exposed via @JavascriptInterface.
         *
         * @param messageJson JSON string containing the JSON-RPC message
         */
        @JavascriptInterface
        fun send(messageJson: String) {
            try {
                val message = json.decodeFromString<JSONRPCMessage>(messageJson)
                // Use trySend for non-suspending emission from interface method
                val result = _incoming.tryEmit(message)
                if (!result) {
                    _errors.tryEmit(IllegalStateException("Failed to emit message: buffer full"))
                }
            } catch (e: Exception) {
                _errors.tryEmit(Exception("Failed to parse message from JavaScript: ${e.message}", e))
            }
        }
    }

    /**
     * Start the transport and inject the JavaScript bridge.
     *
     * This method:
     * 1. Configures the WebView to enable JavaScript
     * 2. Adds the JavaScript interface for receiving messages
     * 3. Injects the bridge script that sets up the communication layer
     */
    override suspend fun start() {
        if (isStarted) return
        isStarted = true

        // Configure WebView on the main thread
        webView.post {
            // Enable JavaScript
            webView.settings.javaScriptEnabled = true

            // Add JavaScript interface
            webView.addJavascriptInterface(jsBridge, BRIDGE_NAME)

            // Inject the bridge script
            webView.evaluateJavascript(BRIDGE_SCRIPT, null)
        }
    }

    /**
     * Send a JSON-RPC message to the JavaScript guest UI.
     *
     * The message is serialized to JSON and dispatched as a MessageEvent
     * on the window object in the WebView.
     *
     * @param message The JSON-RPC message to send
     */
    override suspend fun send(message: JSONRPCMessage) {
        if (!isStarted) {
            throw IllegalStateException("Transport not started. Call start() first.")
        }

        val messageJson = json.encodeToString(message)
        // Escape the JSON string for JavaScript
        val escapedJson = messageJson
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")

        val script = """
            (function() {
                try {
                    const message = JSON.parse("$escapedJson");
                    const event = new MessageEvent('message', {
                        data: message,
                        origin: window.location.origin
                    });
                    window.dispatchEvent(event);
                } catch (e) {
                    console.error('Failed to dispatch message:', e);
                }
            })();
        """.trimIndent()

        webView.post {
            webView.evaluateJavascript(script, null)
        }
    }

    /**
     * Close the transport and cleanup resources.
     *
     * Removes the JavaScript interface and marks the transport as stopped.
     */
    override suspend fun close() {
        if (!isStarted) return

        webView.post {
            webView.removeJavascriptInterface(BRIDGE_NAME)
        }

        isStarted = false
    }

    companion object {
        /**
         * Name of the JavaScript interface exposed to the WebView.
         */
        private const val BRIDGE_NAME = "AndroidMcpBridge"

        /**
         * JavaScript bridge script injected into the WebView.
         *
         * This script:
         * 1. Creates window.mcpBridge.send() for sending messages to Android
         * 2. Overrides window.parent.postMessage() for TypeScript SDK compatibility
         * 3. Sets up proper error handling
         */
        private const val BRIDGE_SCRIPT = """
(function() {
    'use strict';

    // Prevent re-initialization
    if (window.mcpBridge && window.mcpBridge._initialized) {
        return;
    }

    // Create the MCP bridge object
    window.mcpBridge = {
        _initialized: true,

        /**
         * Send a message to the Android host.
         * @param {object} message - JSON-RPC message object
         */
        send: function(message) {
            try {
                const messageJson = JSON.stringify(message);
                if (window.AndroidMcpBridge) {
                    window.AndroidMcpBridge.send(messageJson);
                } else {
                    console.error('AndroidMcpBridge not available');
                }
            } catch (e) {
                console.error('Failed to send message:', e);
            }
        }
    };

    // Override window.parent.postMessage for TypeScript SDK compatibility
    // The TypeScript SDK uses postMessage, so we redirect it to our bridge
    const originalPostMessage = window.parent.postMessage;
    window.parent.postMessage = function(message, targetOrigin) {
        // If this is a JSON-RPC message (has jsonrpc field), use our bridge
        if (message && typeof message === 'object' && message.jsonrpc) {
            window.mcpBridge.send(message);
        } else {
            // Otherwise, fall back to original postMessage
            originalPostMessage.call(window.parent, message, targetOrigin);
        }
    };

    console.log('MCP WebView bridge initialized');
})();
"""
    }
}
