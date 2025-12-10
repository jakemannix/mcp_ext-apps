// Generated from src/generated/schema.json
// DO NOT EDIT - Run: npx tsx scripts/generate-swift-types.ts

import Foundation

// MARK: - Helper Types

/// Empty capability marker (matches TypeScript `{}`)
public struct EmptyCapability: Codable, Sendable, Equatable {
    public init() {}
}

/// Type-erased value for dynamic JSON
public struct AnyCodable: Codable, Equatable, @unchecked Sendable {
    public let value: Any

    public init(_ value: Any) { self.value = value }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self.value = NSNull() }
        else if let bool = try? container.decode(Bool.self) { self.value = bool }
        else if let int = try? container.decode(Int.self) { self.value = int }
        else if let double = try? container.decode(Double.self) { self.value = double }
        else if let string = try? container.decode(String.self) { self.value = string }
        else if let array = try? container.decode([AnyCodable].self) { self.value = array.map { $0.value } }
        else if let dict = try? container.decode([String: AnyCodable].self) { self.value = dict.mapValues { $0.value } }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot decode") }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull: try container.encodeNil()
        case let v as Bool: try container.encode(v)
        case let v as Int: try container.encode(v)
        case let v as Double: try container.encode(v)
        case let v as String: try container.encode(v)
        case let v as [Any]: try container.encode(v.map { AnyCodable($0) })
        case let v as [String: Any]: try container.encode(v.mapValues { AnyCodable($0) })
        default: throw EncodingError.invalidValue(value, .init(codingPath: [], debugDescription: "Cannot encode"))
        }
    }

    public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        switch (lhs.value, rhs.value) {
        case is (NSNull, NSNull): return true
        case let (l as Bool, r as Bool): return l == r
        case let (l as Int, r as Int): return l == r
        case let (l as Double, r as Double): return l == r
        case let (l as String, r as String): return l == r
        default: return false
        }
    }
}

/// Application/host identification
public struct Implementation: Codable, Sendable, Equatable {
    public var name: String
    public var version: String
    public var title: String?

    public init(name: String, version: String, title: String? = nil) {
        self.name = name
        self.version = version
        self.title = title
    }
}

/// Text content block
public struct TextContent: Codable, Sendable {
    public var type: String = "text"
    public var text: String
    public init(text: String) { self.text = text }
}

/// Log level
public enum LogLevel: String, Codable, Sendable {
    case debug, info, notice, warning, error, critical, alert, emergency
}

/// Host options
public struct HostOptions: Sendable {
    public var hostContext: McpUiHostContext
    public init(hostContext: McpUiHostContext = McpUiHostContext()) {
        self.hostContext = hostContext
    }
}

/// CSP configuration
public struct CspConfig: Codable, Sendable {
    public var connectDomains: [String]?
    public var resourceDomains: [String]?
    public init(connectDomains: [String]? = nil, resourceDomains: [String]? = nil) {
        self.connectDomains = connectDomains
        self.resourceDomains = resourceDomains
    }
}

// MARK: - Type Aliases for Compatibility

public typealias McpUiInitializeParams = McpUiInitializeRequestParams
public typealias McpUiMessageParams = McpUiMessageRequestParams
public typealias McpUiOpenLinkParams = McpUiOpenLinkRequestParams
public typealias ServerToolsCapability = McpUiHostCapabilitiesServerTools
public typealias ServerResourcesCapability = McpUiHostCapabilitiesServerResources
public typealias AppToolsCapability = McpUiAppCapabilitiesTools

// MARK: - Generated Types

/// App exposes MCP-style tools that the host can call.
public struct McpUiAppCapabilitiesTools: Codable, Sendable, Equatable {
    /// App supports tools/list_changed notifications.
    public var listChanged: Bool?

    public init(
        listChanged: Bool? = nil
    ) {
        self.listChanged = listChanged
    }
}

public struct McpUiAppCapabilities: Codable, Sendable, Equatable {
    /// Experimental features (structure TBD).
    public var experimental: EmptyCapability?
    /// App exposes MCP-style tools that the host can call.
    public var tools: McpUiAppCapabilitiesTools?

    public init(
        experimental: EmptyCapability? = nil,
        tools: McpUiAppCapabilitiesTools? = nil
    ) {
        self.experimental = experimental
        self.tools = tools
    }
}

/// Display mode for UI presentation.
public enum McpUiDisplayMode: String, Codable, Sendable, Equatable {
    case inline = "inline"
    case fullscreen = "fullscreen"
    case pip = "pip"
}

/// Host can proxy tool calls to the MCP server.
public struct McpUiHostCapabilitiesServerTools: Codable, Sendable, Equatable {
    /// Host supports tools/list_changed notifications.
    public var listChanged: Bool?

    public init(
        listChanged: Bool? = nil
    ) {
        self.listChanged = listChanged
    }
}

/// Host can proxy resource reads to the MCP server.
public struct McpUiHostCapabilitiesServerResources: Codable, Sendable, Equatable {
    /// Host supports resources/list_changed notifications.
    public var listChanged: Bool?

    public init(
        listChanged: Bool? = nil
    ) {
        self.listChanged = listChanged
    }
}

public struct McpUiHostCapabilities: Codable, Sendable, Equatable {
    /// Experimental features (structure TBD).
    public var experimental: EmptyCapability?
    /// Host supports opening external URLs.
    public var openLinks: EmptyCapability?
    /// Host can proxy tool calls to the MCP server.
    public var serverTools: McpUiHostCapabilitiesServerTools?
    /// Host can proxy resource reads to the MCP server.
    public var serverResources: McpUiHostCapabilitiesServerResources?
    /// Host accepts log messages.
    public var logging: EmptyCapability?

    public init(
        experimental: EmptyCapability? = nil,
        openLinks: EmptyCapability? = nil,
        serverTools: McpUiHostCapabilitiesServerTools? = nil,
        serverResources: McpUiHostCapabilitiesServerResources? = nil,
        logging: EmptyCapability? = nil
    ) {
        self.experimental = experimental
        self.openLinks = openLinks
        self.serverTools = serverTools
        self.serverResources = serverResources
        self.logging = logging
    }
}

public struct McpUiHostContextChangedNotificationParamsToolInfoToolIconsItem: Codable, Sendable, Equatable {
    public var src: String
    public var mimeType: String?
    public var sizes: [String]?

    public init(
        src: String,
        mimeType: String? = nil,
        sizes: [String]? = nil
    ) {
        self.src = src
        self.mimeType = mimeType
        self.sizes = sizes
    }
}

public struct McpUiHostContextChangedNotificationParamsToolInfoToolAnnotations: Codable, Sendable, Equatable {
    public var title: String?
    public var readOnlyHint: Bool?
    public var destructiveHint: Bool?
    public var idempotentHint: Bool?
    public var openWorldHint: Bool?

    public init(
        title: String? = nil,
        readOnlyHint: Bool? = nil,
        destructiveHint: Bool? = nil,
        idempotentHint: Bool? = nil,
        openWorldHint: Bool? = nil
    ) {
        self.title = title
        self.readOnlyHint = readOnlyHint
        self.destructiveHint = destructiveHint
        self.idempotentHint = idempotentHint
        self.openWorldHint = openWorldHint
    }
}

public struct McpUiHostContextChangedNotificationParamsToolInfoToolExecution: Codable, Sendable, Equatable {
    public var taskSupport: String?

    public init(
        taskSupport: String? = nil
    ) {
        self.taskSupport = taskSupport
    }
}

/// Tool definition including name, inputSchema, etc.
public struct McpUiHostContextChangedNotificationParamsToolInfoTool: Codable, Sendable, Equatable {
    public var name: String
    public var title: String?
    public var icons: [McpUiHostContextChangedNotificationParamsToolInfoToolIconsItem]?
    public var description: String?
    public var inputSchema: [String: AnyCodable]
    public var outputSchema: [String: AnyCodable]?
    public var annotations: McpUiHostContextChangedNotificationParamsToolInfoToolAnnotations?
    public var execution: McpUiHostContextChangedNotificationParamsToolInfoToolExecution?
    public var _meta: [String: AnyCodable]?

    public init(
        name: String,
        title: String? = nil,
        icons: [McpUiHostContextChangedNotificationParamsToolInfoToolIconsItem]? = nil,
        description: String? = nil,
        inputSchema: [String: AnyCodable],
        outputSchema: [String: AnyCodable]? = nil,
        annotations: McpUiHostContextChangedNotificationParamsToolInfoToolAnnotations? = nil,
        execution: McpUiHostContextChangedNotificationParamsToolInfoToolExecution? = nil,
        _meta: [String: AnyCodable]? = nil
    ) {
        self.name = name
        self.title = title
        self.icons = icons
        self.description = description
        self.inputSchema = inputSchema
        self.outputSchema = outputSchema
        self.annotations = annotations
        self.execution = execution
        self._meta = _meta
    }
}

/// Metadata of the tool call that instantiated this App.
public struct McpUiHostContextChangedNotificationParamsToolInfo: Codable, Sendable, Equatable {
    /// JSON-RPC id of the tools/call request.
    public var id: AnyCodable
    /// Tool definition including name, inputSchema, etc.
    public var tool: McpUiHostContextChangedNotificationParamsToolInfoTool

    public init(
        id: AnyCodable,
        tool: McpUiHostContextChangedNotificationParamsToolInfoTool
    ) {
        self.id = id
        self.tool = tool
    }
}

/// Current color theme preference.
public enum McpUiTheme: String, Codable, Sendable, Equatable {
    case light = "light"
    case dark = "dark"
}

/// Current and maximum dimensions available to the UI.
public struct Viewport: Codable, Sendable, Equatable {
    /// Current viewport width in pixels.
    public var width: Double
    /// Current viewport height in pixels.
    public var height: Double
    /// Maximum available height in pixels (if constrained).
    public var maxHeight: Double?
    /// Maximum available width in pixels (if constrained).
    public var maxWidth: Double?

    public init(
        width: Double,
        height: Double,
        maxHeight: Double? = nil,
        maxWidth: Double? = nil
    ) {
        self.width = width
        self.height = height
        self.maxHeight = maxHeight
        self.maxWidth = maxWidth
    }
}

/// Platform type for responsive design decisions.
public enum McpUiPlatform: String, Codable, Sendable, Equatable {
    case web = "web"
    case desktop = "desktop"
    case mobile = "mobile"
}

/// Device input capabilities.
public struct DeviceCapabilities: Codable, Sendable, Equatable {
    /// Whether the device supports touch input.
    public var touch: Bool?
    /// Whether the device supports hover interactions.
    public var hover: Bool?

    public init(
        touch: Bool? = nil,
        hover: Bool? = nil
    ) {
        self.touch = touch
        self.hover = hover
    }
}

/// Mobile safe area boundaries in pixels.
public struct SafeAreaInsets: Codable, Sendable, Equatable {
    /// Top safe area inset in pixels.
    public var top: Double
    /// Right safe area inset in pixels.
    public var right: Double
    /// Bottom safe area inset in pixels.
    public var bottom: Double
    /// Left safe area inset in pixels.
    public var left: Double

    public init(
        top: Double,
        right: Double,
        bottom: Double,
        left: Double
    ) {
        self.top = top
        self.right = right
        self.bottom = bottom
        self.left = left
    }
}

/// Partial context update containing only changed fields.
public struct McpUiHostContext: Codable, Sendable, Equatable {
    /// Metadata of the tool call that instantiated this App.
    public var toolInfo: McpUiHostContextChangedNotificationParamsToolInfo?
    /// Current color theme preference.
    public var theme: McpUiTheme?
    /// How the UI is currently displayed.
    public var displayMode: McpUiDisplayMode?
    /// Display modes the host supports.
    public var availableDisplayModes: [String]?
    /// Current and maximum dimensions available to the UI.
    public var viewport: Viewport?
    /// User's language and region preference in BCP 47 format.
    public var locale: String?
    /// User's timezone in IANA format.
    public var timeZone: String?
    /// Host application identifier.
    public var userAgent: String?
    /// Platform type for responsive design decisions.
    public var platform: McpUiPlatform?
    /// Device input capabilities.
    public var deviceCapabilities: DeviceCapabilities?
    /// Mobile safe area boundaries in pixels.
    public var safeAreaInsets: SafeAreaInsets?

    public init(
        toolInfo: McpUiHostContextChangedNotificationParamsToolInfo? = nil,
        theme: McpUiTheme? = nil,
        displayMode: McpUiDisplayMode? = nil,
        availableDisplayModes: [String]? = nil,
        viewport: Viewport? = nil,
        locale: String? = nil,
        timeZone: String? = nil,
        userAgent: String? = nil,
        platform: McpUiPlatform? = nil,
        deviceCapabilities: DeviceCapabilities? = nil,
        safeAreaInsets: SafeAreaInsets? = nil
    ) {
        self.toolInfo = toolInfo
        self.theme = theme
        self.displayMode = displayMode
        self.availableDisplayModes = availableDisplayModes
        self.viewport = viewport
        self.locale = locale
        self.timeZone = timeZone
        self.userAgent = userAgent
        self.platform = platform
        self.deviceCapabilities = deviceCapabilities
        self.safeAreaInsets = safeAreaInsets
    }
}

public struct McpUiHostContextChangedNotification: Codable, Sendable, Equatable {
    public var method: String
    /// Partial context update containing only changed fields.
    public var params: McpUiHostContext

    public init(
        method: String,
        params: McpUiHostContext
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiInitializeRequestParams: Codable, Sendable, Equatable {
    /// App identification (name and version).
    public var appInfo: Implementation
    /// Features and capabilities this app provides.
    public var appCapabilities: McpUiAppCapabilities
    /// Protocol version this app supports.
    public var protocolVersion: String

    public init(
        appInfo: Implementation,
        appCapabilities: McpUiAppCapabilities,
        protocolVersion: String
    ) {
        self.appInfo = appInfo
        self.appCapabilities = appCapabilities
        self.protocolVersion = protocolVersion
    }
}

public struct McpUiInitializeRequest: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiInitializeRequestParams

    public init(
        method: String,
        params: McpUiInitializeRequestParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiInitializeResult: Codable, Sendable, Equatable {
    /// Negotiated protocol version string (e.g., "2025-11-21").
    public var protocolVersion: String
    /// Host application identification and version.
    public var hostInfo: Implementation
    /// Features and capabilities provided by the host.
    public var hostCapabilities: McpUiHostCapabilities
    /// Rich context about the host environment.
    public var hostContext: McpUiHostContext

    public init(
        protocolVersion: String,
        hostInfo: Implementation,
        hostCapabilities: McpUiHostCapabilities,
        hostContext: McpUiHostContext
    ) {
        self.protocolVersion = protocolVersion
        self.hostInfo = hostInfo
        self.hostCapabilities = hostCapabilities
        self.hostContext = hostContext
    }
}

public struct McpUiInitializedNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: EmptyCapability?

    public init(
        method: String,
        params: EmptyCapability? = nil
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiMessageRequestParams: Codable, Sendable, Equatable {
    /// Message role, currently only "user" is supported.
    public var role: String
    /// Message content blocks (text, image, etc.).
    public var content: [AnyCodable]

    public init(
        role: String,
        content: [AnyCodable]
    ) {
        self.role = role
        self.content = content
    }
}

public struct McpUiMessageRequest: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiMessageRequestParams

    public init(
        method: String,
        params: McpUiMessageRequestParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiMessageResult: Codable, Sendable, Equatable {
    /// True if the host rejected or failed to deliver the message.
    public var isError: Bool?

    public init(
        isError: Bool? = nil
    ) {
        self.isError = isError
    }
}

public struct McpUiOpenLinkRequestParams: Codable, Sendable, Equatable {
    /// URL to open in the host's browser
    public var url: String

    public init(
        url: String
    ) {
        self.url = url
    }
}

public struct McpUiOpenLinkRequest: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiOpenLinkRequestParams

    public init(
        method: String,
        params: McpUiOpenLinkRequestParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiOpenLinkResult: Codable, Sendable, Equatable {
    /// True if the host failed to open the URL (e.g., due to security policy).
    public var isError: Bool?

    public init(
        isError: Bool? = nil
    ) {
        self.isError = isError
    }
}

public struct McpUiResourceCsp: Codable, Sendable, Equatable {
    /// Origins for network requests (fetch/XHR/WebSocket).
    public var connectDomains: [String]?
    /// Origins for static resources (scripts, images, styles, fonts).
    public var resourceDomains: [String]?

    public init(
        connectDomains: [String]? = nil,
        resourceDomains: [String]? = nil
    ) {
        self.connectDomains = connectDomains
        self.resourceDomains = resourceDomains
    }
}

/// Content Security Policy configuration.
public struct McpUiResourceMetaCsp: Codable, Sendable, Equatable {
    /// Origins for network requests (fetch/XHR/WebSocket).
    public var connectDomains: [String]?
    /// Origins for static resources (scripts, images, styles, fonts).
    public var resourceDomains: [String]?

    public init(
        connectDomains: [String]? = nil,
        resourceDomains: [String]? = nil
    ) {
        self.connectDomains = connectDomains
        self.resourceDomains = resourceDomains
    }
}

public struct McpUiResourceMeta: Codable, Sendable, Equatable {
    /// Content Security Policy configuration.
    public var csp: McpUiResourceMetaCsp?
    /// Dedicated origin for widget sandbox.
    public var domain: String?
    /// Visual boundary preference - true if UI prefers a visible border.
    public var prefersBorder: Bool?

    public init(
        csp: McpUiResourceMetaCsp? = nil,
        domain: String? = nil,
        prefersBorder: Bool? = nil
    ) {
        self.csp = csp
        self.domain = domain
        self.prefersBorder = prefersBorder
    }
}

public struct McpUiResourceTeardownRequest: Codable, Sendable, Equatable {
    public var method: String
    public var params: EmptyCapability

    public init(
        method: String,
        params: EmptyCapability
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiResourceTeardownResult: Codable, Sendable, Equatable {


    public init(

    ) {

    }
}

public struct McpUiSandboxProxyReadyNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: EmptyCapability

    public init(
        method: String,
        params: EmptyCapability
    ) {
        self.method = method
        self.params = params
    }
}

/// CSP configuration from resource metadata.
public struct McpUiSandboxResourceReadyNotificationParamsCsp: Codable, Sendable, Equatable {
    /// Origins for network requests (fetch/XHR/WebSocket).
    public var connectDomains: [String]?
    /// Origins for static resources (scripts, images, styles, fonts).
    public var resourceDomains: [String]?

    public init(
        connectDomains: [String]? = nil,
        resourceDomains: [String]? = nil
    ) {
        self.connectDomains = connectDomains
        self.resourceDomains = resourceDomains
    }
}

public struct McpUiSandboxResourceReadyNotificationParams: Codable, Sendable, Equatable {
    /// HTML content to load into the inner iframe.
    public var html: String
    /// Optional override for the inner iframe's sandbox attribute.
    public var sandbox: String?
    /// CSP configuration from resource metadata.
    public var csp: McpUiSandboxResourceReadyNotificationParamsCsp?

    public init(
        html: String,
        sandbox: String? = nil,
        csp: McpUiSandboxResourceReadyNotificationParamsCsp? = nil
    ) {
        self.html = html
        self.sandbox = sandbox
        self.csp = csp
    }
}

public struct McpUiSandboxResourceReadyNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiSandboxResourceReadyNotificationParams

    public init(
        method: String,
        params: McpUiSandboxResourceReadyNotificationParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiSizeChangedNotificationParams: Codable, Sendable, Equatable {
    /// New width in pixels.
    public var width: Double?
    /// New height in pixels.
    public var height: Double?

    public init(
        width: Double? = nil,
        height: Double? = nil
    ) {
        self.width = width
        self.height = height
    }
}

public struct McpUiSizeChangedNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiSizeChangedNotificationParams

    public init(
        method: String,
        params: McpUiSizeChangedNotificationParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiToolInputNotificationParams: Codable, Sendable, Equatable {
    /// Complete tool call arguments as key-value pairs.
    public var arguments: [String: AnyCodable]?

    public init(
        arguments: [String: AnyCodable]? = nil
    ) {
        self.arguments = arguments
    }
}

public struct McpUiToolInputNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiToolInputNotificationParams

    public init(
        method: String,
        params: McpUiToolInputNotificationParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiToolInputPartialNotificationParams: Codable, Sendable, Equatable {
    /// Partial tool call arguments (incomplete, may change).
    public var arguments: [String: AnyCodable]?

    public init(
        arguments: [String: AnyCodable]? = nil
    ) {
        self.arguments = arguments
    }
}

public struct McpUiToolInputPartialNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiToolInputPartialNotificationParams

    public init(
        method: String,
        params: McpUiToolInputPartialNotificationParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiToolResultNotification: Codable, Sendable, Equatable {
    public var method: String
    /// Standard MCP tool execution result.
    public var params: [String: AnyCodable]

    public init(
        method: String,
        params: [String: AnyCodable]
    ) {
        self.method = method
        self.params = params
    }
}
