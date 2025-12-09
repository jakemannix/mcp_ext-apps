package io.modelcontextprotocol.apps.transport

import android.webkit.WebView
import io.modelcontextprotocol.apps.protocol.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.jupiter.api.Test
import org.mockito.kotlin.*
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Unit tests for WebViewTransport.
 *
 * Note: These tests use Mockito to mock the WebView since we're testing
 * the transport logic without needing an actual Android environment.
 */
class WebViewTransportTest {

    /**
     * Create a mock WebView that simulates the Android WebView behavior.
     */
    private fun createMockWebView(): WebView {
        val webView = mock<WebView>()
        val settings = mock<android.webkit.WebSettings>()
        whenever(webView.settings).thenReturn(settings)

        // Mock post() to execute runnables immediately for testing
        whenever(webView.post(any())).thenAnswer { invocation ->
            val runnable = invocation.arguments[0] as Runnable
            runnable.run()
            true
        }

        return webView
    }

    @Test
    fun testStartInitializesWebView() = runTest {
        val webView = createMockWebView()
        val transport = WebViewTransport(webView)

        transport.start()

        // Verify JavaScript is enabled
        verify(webView.settings).javaScriptEnabled = true

        // Verify JavaScript interface is added with the correct bridge name
        verify(webView).addJavascriptInterface(any(), argThat { equals("AndroidMcpBridge") })

        // Verify bridge script is injected
        verify(webView).evaluateJavascript(argThat { contains("window.mcpBridge") }, isNull())
    }

    @Test
    fun testSendMessageToWebView() = runTest {
        val webView = createMockWebView()
        val transport = WebViewTransport(webView)

        transport.start()

        // Create a test message
        val message = JSONRPCRequest(
            id = JsonPrimitive(1),
            method = "test/method",
            params = buildJsonObject {
                put("key", JsonPrimitive("value"))
            }
        )

        transport.send(message)

        // Verify evaluateJavascript was called with the message
        verify(webView, atLeast(2)).evaluateJavascript(
            argThat { contains("MessageEvent") && contains("test/method") },
            isNull()
        )
    }

    @Test
    fun testReceiveMessageFromJavaScript() = runTest {
        val webView = createMockWebView()
        val transport = WebViewTransport(webView)

        transport.start()

        // Capture the JsBridge instance
        val bridgeCaptor = argumentCaptor<Any>()
        verify(webView).addJavascriptInterface(bridgeCaptor.capture(), argThat { equals("AndroidMcpBridge") })

        val jsBridge = bridgeCaptor.firstValue

        // Create a test message JSON
        val messageJson = """{"jsonrpc":"2.0","id":1,"method":"ui/initialize","params":{}}"""

        // Collect incoming messages in a separate coroutine
        val receivedMessages = mutableListOf<JSONRPCMessage>()
        val job = launch {
            transport.incoming.collect { receivedMessages.add(it) }
        }

        // Simulate JavaScript calling the send method
        val sendMethod = jsBridge.javaClass.getMethod("send", String::class.java)
        sendMethod.invoke(jsBridge, messageJson)

        // Give some time for the message to be processed
        delay(50)

        // Verify message was received
        assertTrue(receivedMessages.isNotEmpty(), "Should have received at least one message")
        val received = receivedMessages.first() as JSONRPCRequest
        assertEquals("ui/initialize", received.method)
        assertEquals(JsonPrimitive(1), received.id)

        job.cancel()
    }

    @Test
    fun testCloseRemovesJavaScriptInterface() = runTest {
        val webView = createMockWebView()
        val transport = WebViewTransport(webView)

        transport.start()
        transport.close()

        // Verify JavaScript interface is removed
        verify(webView).removeJavascriptInterface("AndroidMcpBridge")
    }

    @Test
    fun testErrorHandlingForInvalidJSON() = runTest {
        val webView = createMockWebView()
        val transport = WebViewTransport(webView)

        transport.start()

        // Capture the JsBridge instance
        val bridgeCaptor = argumentCaptor<Any>()
        verify(webView).addJavascriptInterface(bridgeCaptor.capture(), argThat { equals("AndroidMcpBridge") })

        val jsBridge = bridgeCaptor.firstValue

        // Collect errors
        val receivedErrors = mutableListOf<Throwable>()
        val job = launch {
            transport.errors.collect { receivedErrors.add(it) }
        }

        // Simulate JavaScript sending invalid JSON
        val sendMethod = jsBridge.javaClass.getMethod("send", String::class.java)
        sendMethod.invoke(jsBridge, "invalid json{")

        delay(50)

        // Verify error was emitted
        assertTrue(receivedErrors.isNotEmpty(), "Should have received at least one error")
        assertTrue(receivedErrors.first().message?.contains("Failed to parse") == true)

        job.cancel()
    }

    @Test
    fun testMultipleMessages() = runTest {
        val webView = createMockWebView()
        val transport = WebViewTransport(webView)

        transport.start()

        // Capture the JsBridge instance
        val bridgeCaptor = argumentCaptor<Any>()
        verify(webView).addJavascriptInterface(bridgeCaptor.capture(), argThat { equals("AndroidMcpBridge") })

        val jsBridge = bridgeCaptor.firstValue
        val sendMethod = jsBridge.javaClass.getMethod("send", String::class.java)

        // Collect incoming messages
        val receivedMessages = mutableListOf<JSONRPCMessage>()
        val job = launch {
            transport.incoming.collect { receivedMessages.add(it) }
        }

        // Send multiple messages
        val message1 = """{"jsonrpc":"2.0","method":"notification/one"}"""
        val message2 = """{"jsonrpc":"2.0","method":"notification/two"}"""
        val message3 = """{"jsonrpc":"2.0","id":42,"method":"request/three"}"""

        sendMethod.invoke(jsBridge, message1)
        sendMethod.invoke(jsBridge, message2)
        sendMethod.invoke(jsBridge, message3)

        delay(100)

        // Verify all messages were received
        assertEquals(3, receivedMessages.size)
        assertEquals("notification/one", (receivedMessages[0] as JSONRPCNotification).method)
        assertEquals("notification/two", (receivedMessages[1] as JSONRPCNotification).method)
        assertEquals("request/three", (receivedMessages[2] as JSONRPCRequest).method)

        job.cancel()
    }

    @Test
    fun testJavaScriptBridgeScriptFormat() {
        // Verify the bridge script contains expected components
        val bridgeScript = WebViewTransport::class.java.getDeclaredField("BRIDGE_SCRIPT").apply {
            isAccessible = true
        }.get(null) as String

        // Should create window.mcpBridge
        assertTrue(bridgeScript.contains("window.mcpBridge"), "Should define window.mcpBridge")

        // Should have send function
        assertTrue(bridgeScript.contains("send:"), "Should define send function")

        // Should override window.parent.postMessage
        assertTrue(
            bridgeScript.contains("window.parent.postMessage"),
            "Should override window.parent.postMessage"
        )

        // Should check for AndroidMcpBridge
        assertTrue(
            bridgeScript.contains("AndroidMcpBridge"),
            "Should reference AndroidMcpBridge"
        )

        // Should handle initialization check
        assertTrue(
            bridgeScript.contains("_initialized"),
            "Should have initialization guard"
        )
    }
}
