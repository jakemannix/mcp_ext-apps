# Example: Inlined Server

A minimal MCP App example with inline HTML UI embedded directly in the server code.

> [!TIP]
> This example requires no build step! The UI is defined as a template string in the server and loads the App SDK from a CDN.

## Overview

- **No build required**: UI is embedded as inline HTML in `server.ts`
- **CDN-based**: Loads the [`App`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html) class from unpkg CDN
- **Minimal setup**: Just two files (`server.ts` and `server-utils.ts`)
- Tool registration with linked UI resource
- App communication APIs: [`ontoolresult`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#ontoolresult), [`openLink`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#openlink)

## Key Files

- [`server.ts`](server.ts) - MCP server with inline HTML UI and tool registration
- [`server-utils.ts`](server-utils.ts) - HTTP transport utilities

## Getting Started

```bash
npm install
npm start
```

Or with stdio transport:

```bash
npm run serve:stdio
```

## How It Works

1. The server defines the UI HTML as a template string with an embedded `<script>` tag.
2. The script imports the `App` class from the unpkg CDN.
3. The server registers a `show-example` tool linked to the UI resource at `ui://page`.
4. When the tool is invoked, the host renders the inline HTML UI.
5. The UI receives tool results via `ontoolresult` and can request actions like `openLink`.

## Inline HTML Pattern

```typescript
const uiHtml = `
  <html>
    <head>
      <script type="module">
        import { App } from "https://unpkg.com/@modelcontextprotocol/ext-apps@0.3.1/dist/src/app-with-deps.js";

        window.onload = async () => {
          const app = new App({ name: "My App", version: "1.0.0" });
          app.ontoolresult = (params) => {
            // Handle tool results
          };
          await app.connect();
        };
      </script>
    </head>
    <body>
      <!-- Your UI here -->
    </body>
  </html>
`;
```

## CSP Configuration

Since the UI loads from a CDN, the resource must declare CSP domains:

```typescript
_meta: {
  ui: {
    csp: {
      connectDomains: ["https://unpkg.com"],
      resourceDomains: ["https://unpkg.com"],
    },
  },
}
```

## When to Use This Pattern

- Quick prototypes without a build step
- Simple UIs that don't need a framework
- Demonstrations of the core MCP App concepts
- Environments where build tooling is unavailable

For production apps with complex UIs, consider using the framework-based examples like [`basic-server-react`](../basic-server-react) or [`basic-server-vanillajs`](../basic-server-vanillajs).
