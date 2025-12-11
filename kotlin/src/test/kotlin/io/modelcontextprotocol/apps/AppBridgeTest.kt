package io.modelcontextprotocol.apps

import io.modelcontextprotocol.apps.generated.*
import io.modelcontextprotocol.apps.transport.InMemoryTransport
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import kotlin.test.*

class AppBridgeTest {
    private val testHostInfo = Implementation(name = "TestHost", version = "1.0.0")
    private val testHostCapabilities = McpUiHostCapabilities(
        openLinks = EmptyCapability,
        serverTools = McpUiHostCapabilitiesServerTools(),
        logging = EmptyCapability
    )
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun testAppBridgeCreation() {
        val bridge = AppBridge(
            hostInfo = testHostInfo,
            hostCapabilities = testHostCapabilities
        )
        assertNotNull(bridge)
        assertFalse(bridge.isReady())
    }

    @Test
    fun testMessageTypes() {
        val initParams = McpUiInitializeParams(
            appInfo = Implementation(name = "TestApp", version = "1.0.0"),
            appCapabilities = McpUiAppCapabilities(),
            protocolVersion = "2025-11-21"
        )
        assertEquals("TestApp", initParams.appInfo.name)
        assertEquals("2025-11-21", initParams.protocolVersion)
    }

    @Test
    fun testSizeChangedParams() {
        val params = McpUiSizeChangedParams(width = 800.0, height = 600.0)
        assertEquals(800.0, params.width)
        assertEquals(600.0, params.height)

        // Test serialization
        val encoded = json.encodeToString(McpUiSizeChangedParams.serializer(), params)
        val decoded = json.decodeFromString(McpUiSizeChangedParams.serializer(), encoded)
        assertEquals(params.width, decoded.width)
        assertEquals(params.height, decoded.height)
    }

    @Test
    fun testToolInputParams() {
        val params = McpUiToolInputParams(
            arguments = mapOf(
                "query" to JsonPrimitive("weather in NYC"),
                "count" to JsonPrimitive(5)
            )
        )
        assertEquals("weather in NYC", (params.arguments?.get("query") as? JsonPrimitive)?.content)
        assertEquals(5, (params.arguments?.get("count") as? JsonPrimitive)?.int)
    }

    @Test
    fun testToolCancelledParams() {
        val params = McpUiToolCancelledParams(reason = "User cancelled")
        assertEquals("User cancelled", params.reason)

        // Test serialization
        val encoded = json.encodeToString(McpUiToolCancelledParams.serializer(), params)
        val decoded = json.decodeFromString(McpUiToolCancelledParams.serializer(), encoded)
        assertEquals(params.reason, decoded.reason)
    }

    @Test
    fun testLoggingMessageParams() {
        val params = LoggingMessageParams(
            level = LogLevel.warning,
            data = JsonPrimitive("Test warning message"),
            logger = "TestLogger"
        )
        assertEquals(LogLevel.warning, params.level)
        assertEquals("Test warning message", (params.data as? JsonPrimitive)?.content)
        assertEquals("TestLogger", params.logger)
    }

    @Test
    fun testMessageParams() {
        // Test that McpUiMessageParams alias works
        val params = McpUiMessageParams(
            role = "user",
            content = listOf(JsonPrimitive("Hello"))
        )
        assertEquals("user", params.role)
        assertEquals(1, params.content.size)
    }

    @Test
    fun testOpenLinkParams() {
        // Test that McpUiOpenLinkParams alias works
        val params = McpUiOpenLinkParams(url = "https://example.com")
        assertEquals("https://example.com", params.url)
    }
}
