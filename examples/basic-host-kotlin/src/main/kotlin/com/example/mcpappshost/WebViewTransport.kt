package com.example.mcpappshost

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import io.modelcontextprotocol.apps.protocol.JSONRPCMessage
import io.modelcontextprotocol.apps.protocol.JSONRPCNotification
import io.modelcontextprotocol.apps.protocol.JSONRPCRequest
import io.modelcontextprotocol.apps.protocol.JSONRPCResponse
import io.modelcontextprotocol.apps.protocol.JSONRPCErrorResponse
import io.modelcontextprotocol.apps.transport.McpAppsTransport
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.serialization.json.Json

private const val TAG = "WebViewTransport"

/**
 * Transport for MCP Apps communication using Android WebView.
 *
 * This transport bridges between Kotlin and JavaScript in a WebView:
 * - Native → JS: evaluateJavascript to dispatch MessageEvent
 * - JS → Native: @JavascriptInterface to receive messages
 */
class WebViewTransport(
    private val webView: WebView,
    private val handlerName: String = "mcpBridge"
) : McpAppsTransport {

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val mainHandler = Handler(Looper.getMainLooper())

    private val _incoming = MutableSharedFlow<JSONRPCMessage>()
    private val _errors = MutableSharedFlow<Throwable>()

    override val incoming: Flow<JSONRPCMessage> = _incoming
    override val errors: Flow<Throwable> = _errors

    /**
     * JavaScript interface for receiving messages from the WebView.
     */
    @JavascriptInterface
    fun receiveMessage(jsonString: String) {
        Log.d(TAG, "Received from JS: $jsonString")
        try {
            val message = json.decodeFromString<JSONRPCMessage>(jsonString)
            // Emit on main thread
            mainHandler.post {
                _incoming.tryEmit(message)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse message: $jsonString", e)
            mainHandler.post {
                _errors.tryEmit(e)
            }
        }
    }

    override suspend fun start() {
        mainHandler.post {
            // Add JavaScript interface
            webView.addJavascriptInterface(this, handlerName)

            // Inject bridge script
            val bridgeScript = """
                (function() {
                    // Override window.parent.postMessage for TypeScript SDK compatibility
                    window.parent = window.parent || {};
                    window.parent.postMessage = function(message, targetOrigin) {
                        if (window.$handlerName) {
                            window.$handlerName.receiveMessage(JSON.stringify(message));
                        } else {
                            console.error('WebView message handler not available');
                        }
                    };

                    // Signal that the bridge is ready
                    window.dispatchEvent(new Event('mcp-bridge-ready'));
                    console.log('MCP Apps WebView bridge initialized');
                })();
            """.trimIndent()

            webView.evaluateJavascript(bridgeScript, null)
        }
    }

    override suspend fun send(message: JSONRPCMessage) {
        val jsonString = json.encodeToString(JSONRPCMessage.serializer(), message)
        Log.d(TAG, "Sending to JS: $jsonString")

        // Dispatch MessageEvent on the window
        val script = """
            (function() {
                try {
                    const messageObj = $jsonString;
                    window.dispatchEvent(new MessageEvent('message', {
                        data: messageObj,
                        origin: window.location.origin,
                        source: window
                    }));
                } catch (error) {
                    console.error('Failed to dispatch message:', error);
                }
            })();
        """.trimIndent()

        mainHandler.post {
            webView.evaluateJavascript(script, null)
        }
    }

    override suspend fun close() {
        mainHandler.post {
            webView.removeJavascriptInterface(handlerName)
        }
    }
}

/**
 * Injects the bridge script into HTML content before loading.
 */
fun injectBridgeScript(html: String, handlerName: String = "mcpBridge"): String {
    val bridgeScript = """
        <script>
        (function() {
            window.parent = window.parent || {};
            window.parent.postMessage = function(message, targetOrigin) {
                if (window.$handlerName) {
                    window.$handlerName.receiveMessage(JSON.stringify(message));
                } else {
                    console.error('WebView handler not available');
                }
            };
            window.dispatchEvent(new Event('mcp-bridge-ready'));
            console.log('MCP bridge initialized');
        })();
        </script>
    """.trimIndent()

    // Inject at the beginning of <head>
    return when {
        html.contains("<head>", ignoreCase = true) -> {
            html.replaceFirst("<head>", "<head>$bridgeScript", ignoreCase = true)
        }
        html.contains("<html>", ignoreCase = true) -> {
            // Find <html...> tag and add <head> after it
            val htmlTagEnd = html.indexOf(">", html.indexOf("<html", ignoreCase = true))
            if (htmlTagEnd > 0) {
                html.substring(0, htmlTagEnd + 1) + "<head>$bridgeScript</head>" + html.substring(htmlTagEnd + 1)
            } else {
                bridgeScript + html
            }
        }
        else -> bridgeScript + html
    }
}
