# MCP Apps Native SDKs

Native SDKs for hosting MCP Apps in mobile and desktop applications.

## Overview

These SDKs enable native applications to host MCP Apps (interactive UIs) running in WebViews. They implement the host side of the MCP Apps protocol, handling:

- **Initialization Handshake**: Protocol version negotiation and capability exchange
- **Tool Data Flow**: Sending tool arguments and results to the Guest UI
- **Bidirectional Communication**: Handling messages, link requests, and logging
- **Host Context**: Theme, viewport, locale, and device capabilities

## Available SDKs

### Kotlin Multiplatform SDK

**Platforms**: Android, iOS (via Kotlin/Native), macOS, JVM Desktop, WebAssembly

```kotlin
dependencies {
    implementation("io.modelcontextprotocol:mcp-apps-sdk:0.1.0")
}
```

[Kotlin SDK Documentation](./kotlin/README.md)

### Swift SDK

**Platforms**: iOS 16+, macOS 13+, tvOS 16+, watchOS 9+

```swift
.package(url: "https://github.com/modelcontextprotocol/ext-apps.git", from: "0.1.0")
```

[Swift SDK Documentation](./swift/README.md)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Native App (Host)                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                     AppBridge                           │ │
│  │  • Handles ui/initialize                                │ │
│  │  • Sends tool input/result notifications                │ │
│  │  • Forwards MCP server requests                         │ │
│  │  • Handles ui/message, ui/open-link requests            │ │
│  └──────────────────────────────────────────────────────────┘ │
│                            ↕                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  WebViewTransport                       │ │
│  │  • Injects message receiver script                      │ │
│  │  • Sends messages via evaluateJavaScript                │ │
│  │  • Receives via JavaScript interface                    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                            ↕                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                     WebView                             │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │               MCP App (Guest UI)                  │  │ │
│  │  │  Uses TypeScript SDK or raw JSON-RPC              │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Protocol

All communication uses JSON-RPC 2.0 format over the WebView JavaScript bridge.

### Message Types

| Method                                  | Direction     | Type         | Description                 |
| --------------------------------------- | ------------- | ------------ | --------------------------- |
| `ui/initialize`                         | Guest → Host  | Request      | Initialization handshake    |
| `ui/notifications/initialized`          | Guest → Host  | Notification | Initialization complete     |
| `ui/notifications/tool-input`           | Host → Guest  | Notification | Complete tool arguments     |
| `ui/notifications/tool-input-partial`   | Host → Guest  | Notification | Streaming partial arguments |
| `ui/notifications/tool-result`          | Host → Guest  | Notification | Tool execution result       |
| `ui/notifications/size-changed`         | Bidirectional | Notification | UI size changed             |
| `ui/notifications/host-context-changed` | Host → Guest  | Notification | Context updated             |
| `ui/message`                            | Guest → Host  | Request      | Send chat message           |
| `ui/open-link`                          | Guest → Host  | Request      | Open external URL           |
| `ui/resource-teardown`                  | Host → Guest  | Request      | Graceful shutdown           |
| `notifications/message`                 | Guest → Host  | Notification | Logging message             |

## Integration with MCP SDKs

These SDKs are designed to work alongside the official MCP SDKs:

- **Kotlin**: [modelcontextprotocol/kotlin-sdk](https://github.com/modelcontextprotocol/kotlin-sdk)
- **Swift**: [modelcontextprotocol/swift-sdk](https://github.com/modelcontextprotocol/swift-sdk)

The `AppBridge` can forward tool calls and resource reads to the MCP server through the MCP client.

## Compatibility

These native SDKs are compatible with the TypeScript SDK (`@modelcontextprotocol/ext-apps`). Guest UIs built with the TypeScript SDK will work seamlessly with native hosts using these SDKs.

## Building

### Prerequisites

**Kotlin SDK:**

- JDK 17+
- Gradle 8+ (or use the wrapper)

**Swift SDK:**

- Xcode 15+ (for Swift 6.0)
- macOS 13+ for development

### Kotlin

```bash
cd sdk/kotlin

# Generate gradle wrapper (first time)
gradle wrapper

# Build
./gradlew build

# Run tests
./gradlew test

# Build for specific platform
./gradlew jvmJar        # JVM/Android
./gradlew iosArm64Main  # iOS
```

### Swift

```bash
cd sdk/swift

# Build
swift build

# Run tests (requires Xcode/macOS)
swift test

# Build for release
swift build -c release
```

### Example Apps

**Android (basic-host-kotlin):**

```bash
cd examples/basic-host-kotlin
# Open in Android Studio, or:
./gradlew assembleDebug
```

**iOS (basic-host-swift):**

```bash
cd examples/basic-host-swift
# Open Package.swift in Xcode, or:
swift build
```

## Contributing

See the main repository's [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## License

MIT License
