#!/usr/bin/env npx tsx
/**
 * Generate Swift types from MCP Apps JSON Schema
 *
 * This generator:
 * 1. Identifies structurally equivalent types and deduplicates them
 * 2. Uses simpler names for common patterns
 * 3. Creates type aliases for compatibility
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, "..");
const SCHEMA_FILE = join(PROJECT_DIR, "src/generated/schema.json");
const OUTPUT_FILE = join(
  PROJECT_DIR,
  "sdk/swift/Sources/McpApps/Generated/SchemaTypes.swift",
);

interface JsonSchema {
  type?: string;
  const?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  required?: string[];
  anyOf?: JsonSchema[];
  $ref?: string;
  items?: JsonSchema;
  enum?: string[];
}

interface SchemaDoc {
  $defs: Record<string, JsonSchema>;
}

// Types defined in the header that should not be regenerated
const HEADER_DEFINED_TYPES = new Set([
  "EmptyCapability",
  "AnyCodable",
  "Implementation",
  "TextContent",
  "LogLevel",
  "HostOptions",
  "CspConfig",
]);

// Canonical type names - map verbose inline names to simpler ones
const CANONICAL_NAMES: Record<string, string> = {
  // Capabilities
  "McpUiInitializeResultHostCapabilities": "McpUiHostCapabilities",
  "McpUiInitializeResultHostCapabilitiesServerTools": "ServerToolsCapability",
  "McpUiInitializeResultHostCapabilitiesServerResources": "ServerResourcesCapability",
  "McpUiInitializeRequestParamsAppCapabilities": "McpUiAppCapabilities",
  "McpUiInitializeRequestParamsAppCapabilitiesTools": "AppToolsCapability",
  "McpUiHostContextChangedNotificationParamsDeviceCapabilities": "DeviceCapabilities",
  "McpUiInitializeResultHostContextDeviceCapabilities": "DeviceCapabilities",

  // Context types
  "McpUiInitializeResultHostContext": "McpUiHostContext",
  "McpUiHostContextChangedNotificationParams": "McpUiHostContext",

  // Enums
  "McpUiInitializeResultHostContextTheme": "McpUiTheme",
  "McpUiHostContextChangedNotificationParamsTheme": "McpUiTheme",
  "McpUiInitializeResultHostContextDisplayMode": "McpUiDisplayMode",
  "McpUiHostContextChangedNotificationParamsDisplayMode": "McpUiDisplayMode",
  "McpUiInitializeResultHostContextPlatform": "McpUiPlatform",
  "McpUiHostContextChangedNotificationParamsPlatform": "McpUiPlatform",

  // Viewport
  "McpUiInitializeResultHostContextViewport": "Viewport",
  "McpUiHostContextChangedNotificationParamsViewport": "Viewport",

  // Safe area
  "McpUiInitializeResultHostContextSafeAreaInsets": "SafeAreaInsets",
  "McpUiHostContextChangedNotificationParamsSafeAreaInsets": "SafeAreaInsets",

  // Implementation
  "McpUiInitializeResultHostInfo": "Implementation",
  "McpUiInitializeRequestParamsAppInfo": "Implementation",
};

// Types to skip (will use the canonical version)
const SKIP_TYPES = new Set(Object.keys(CANONICAL_NAMES));

// Empty object types
const EMPTY_TYPES = new Set<string>();

// Track generated types
const generatedTypes = new Set<string>();
const typeDefinitions: string[] = [];

function toSwiftPropertyName(name: string): string {
  return name.replace(/-/g, "_");
}

function getCanonicalName(name: string): string {
  return CANONICAL_NAMES[name] || name;
}

function isEmptyObject(schema: JsonSchema): boolean {
  return (
    schema.type === "object" &&
    schema.additionalProperties === false &&
    (!schema.properties || Object.keys(schema.properties).length === 0)
  );
}

function toSwiftType(
  schema: JsonSchema,
  contextName: string,
  defs: Record<string, JsonSchema>,
): string {
  if (schema.$ref) {
    const refName = schema.$ref.replace("#/$defs/", "");
    return getCanonicalName(refName);
  }

  if (schema.anyOf) {
    const allConsts = schema.anyOf.every((s) => s.const !== undefined);
    if (allConsts) {
      const canonical = getCanonicalName(contextName);
      if (!generatedTypes.has(canonical)) {
        generateEnum(contextName, schema);
      }
      return canonical;
    }
    return "AnyCodable";
  }

  if (schema.const) {
    return "String";
  }

  switch (schema.type) {
    case "string":
      return "String";
    case "number":
      return "Double";
    case "integer":
      return "Int";
    case "boolean":
      return "Bool";
    case "array":
      if (schema.items) {
        return `[${toSwiftType(schema.items, contextName + "Item", defs)}]`;
      }
      return "[AnyCodable]";
    case "object":
      if (isEmptyObject(schema)) {
        EMPTY_TYPES.add(contextName);
        return "EmptyCapability";
      }
      if (schema.additionalProperties && typeof schema.additionalProperties !== "boolean") {
        const valueType = toSwiftType(
          schema.additionalProperties,
          contextName + "Value",
          defs,
        );
        return `[String: ${valueType}]`;
      }
      if (schema.additionalProperties === true || (!schema.properties && schema.additionalProperties !== false)) {
        return "[String: AnyCodable]";
      }
      const canonical = getCanonicalName(contextName);
      if (!generatedTypes.has(canonical) && schema.properties) {
        generateStruct(contextName, schema, defs);
      }
      return canonical;
    default:
      return "AnyCodable";
  }
}

function generateEnum(name: string, schema: JsonSchema): void {
  const canonical = getCanonicalName(name);
  if (generatedTypes.has(canonical)) return;
  generatedTypes.add(canonical);

  const cases = schema
    .anyOf!.filter((s) => s.const)
    .map((s) => {
      const value = s.const!;
      const caseName = value.replace(/-/g, "").replace(/\//g, "");
      return `    case ${caseName} = "${value}"`;
    });

  const desc = schema.description ? `/// ${schema.description}\n` : "";
  typeDefinitions.push(`${desc}public enum ${canonical}: String, Codable, Sendable, Equatable {
${cases.join("\n")}
}`);
}

function generateStruct(
  name: string,
  schema: JsonSchema,
  defs: Record<string, JsonSchema>,
): void {
  const canonical = getCanonicalName(name);
  if (generatedTypes.has(canonical)) return;
  if (EMPTY_TYPES.has(name)) return;
  if (HEADER_DEFINED_TYPES.has(canonical)) return; // Defined in header
  generatedTypes.add(canonical);

  const props = schema.properties || {};
  const required = new Set(schema.required || []);

  const properties: Array<{
    swiftName: string;
    jsonName: string;
    type: string;
    isOptional: boolean;
    description?: string;
  }> = [];

  for (const [propName, propSchema] of Object.entries(props)) {
    const swiftName = toSwiftPropertyName(propName);
    const contextTypeName = name + capitalize(swiftName);

    let swiftType: string;
    if (isEmptyObject(propSchema)) {
      swiftType = "EmptyCapability";
    } else {
      swiftType = toSwiftType(propSchema, contextTypeName, defs);
    }

    properties.push({
      swiftName,
      jsonName: propName,
      type: swiftType,
      isOptional: !required.has(propName),
      description: propSchema.description,
    });
  }

  const propLines = properties
    .map((p) => {
      const desc = p.description ? `    /// ${p.description}\n` : "";
      const typeDecl = p.isOptional ? `${p.type}?` : p.type;
      return `${desc}    public var ${p.swiftName}: ${typeDecl}`;
    })
    .join("\n");

  const needsCodingKeys = properties.some((p) => p.swiftName !== p.jsonName);
  let codingKeys = "";
  if (needsCodingKeys) {
    const keyLines = properties
      .map((p) =>
        p.swiftName !== p.jsonName
          ? `        case ${p.swiftName} = "${p.jsonName}"`
          : `        case ${p.swiftName}`,
      )
      .join("\n");
    codingKeys = `

    private enum CodingKeys: String, CodingKey {
${keyLines}
    }`;
  }

  const initParams = properties
    .map((p) => {
      const defaultValue = p.isOptional ? " = nil" : "";
      return `        ${p.swiftName}: ${p.isOptional ? p.type + "?" : p.type}${defaultValue}`;
    })
    .join(",\n");

  const initAssignments = properties
    .map((p) => `        self.${p.swiftName} = ${p.swiftName}`)
    .join("\n");

  const desc = schema.description ? `/// ${schema.description}\n` : "";
  typeDefinitions.push(`${desc}public struct ${canonical}: Codable, Sendable, Equatable {
${propLines}${codingKeys}

    public init(
${initParams}
    ) {
${initAssignments}
    }
}`);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function generate(): string {
  const schema: SchemaDoc = JSON.parse(readFileSync(SCHEMA_FILE, "utf-8"));
  const defs = schema.$defs;

  const header = `// Generated from src/generated/schema.json
// DO NOT EDIT - Run: npx tsx scripts/generate-swift-types.ts

import Foundation

// MARK: - Helper Types

/// Empty capability marker (matches TypeScript \`{}\`)
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
`;

  // Process all definitions in order
  for (const [name, defSchema] of Object.entries(defs)) {
    if (defSchema.anyOf && defSchema.anyOf.every((s) => s.const)) {
      generateEnum(name, defSchema);
    } else if (defSchema.type === "object") {
      generateStruct(name, defSchema, defs);
    }
  }

  return header + "\n" + typeDefinitions.join("\n\n") + "\n";
}

try {
  console.log("🔧 Generating Swift types from schema.json...");
  const code = generate();

  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, code);

  console.log(`✅ Generated: ${OUTPUT_FILE}`);
  console.log(`   Types: ${generatedTypes.size}`);
  console.log(`   Deduplicated: ${Object.keys(CANONICAL_NAMES).length} inline types`);
} catch (error) {
  console.error("❌ Generation failed:", error);
  process.exit(1);
}
