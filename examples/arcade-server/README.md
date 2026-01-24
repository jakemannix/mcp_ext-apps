# Example: Arcade Server

An MCP Apps server that lets you browse and play classic arcade games from [archive.org](https://archive.org) directly in an MCP-enabled host.

## Overview

This example demonstrates serving **external HTML content** as an MCP App resource. Instead of bundling a custom UI, it fetches game pages from archive.org, processes the HTML server-side to work within an iframe sandbox, and returns it as an inline resource.

Key techniques:
- Server-side HTML fetching and processing
- `<base href>` tag for resolving relative URLs against archive.org
- `baseUriDomains` CSP metadata to allow the base tag
- Rewriting ES module `import()` to classic `<script src>` loading (for srcdoc iframe compatibility)
- Local script endpoint to bypass CORS restrictions in sandboxed iframes

## Key Files

- [`server.ts`](server.ts) - MCP server with tool and resource registration
- [`index.ts`](index.ts) - HTTP transport and Express setup
- [`game-processor.ts`](game-processor.ts) - Fetches and processes archive.org HTML
- [`search.ts`](search.ts) - Archive.org search with smart fallbacks

## Getting Started

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3002/mcp` by default. Set the `PORT` environment variable to change it.

### MCP Client Configuration

```json
{
  "mcpServers": {
    "arcade": {
      "url": "http://localhost:3002/mcp"
    }
  }
}
```

## Tools

| Tool | Description | UI |
|------|-------------|----|
| `search_games` | Search archive.org for arcade games by name | No |
| `get_game_by_id` | Load and play a specific game | Yes |

## How It Works

```
1. Host calls search_games → Server queries archive.org API → Returns game list
2. Host calls get_game_by_id → Server fetches embed HTML from archive.org
3. Server processes HTML:
   - Removes archive.org's <base> tag
   - Injects <base href="https://archive.org/"> for URL resolution
   - Rewrites ES module import() to <script src> loading
   - Fetches emulation.min.js, patches it, serves from local endpoint
   - Injects layout CSS for full-viewport display
4. Host reads resource → Receives processed HTML → Renders in iframe
5. Game runs: emulator loads ROM, initializes MAME, game is playable
```

### Why the Processing?

Archive.org's game embed pages use ES module `import()` for loading the emulation engine. In `srcdoc` iframes (used by MCP hosts), `import()` fails because the iframe has a `null` origin. The server works around this by:

1. **Fetching `emulation.min.js` server-side** and replacing `import()` with `window.loadScript()`
2. **Serving the patched script** from a local Express endpoint (`/scripts/emulation.js`)
3. **Using `<script src>`** which is not subject to CORS restrictions, unlike `fetch()` or `import()`

## Example Game IDs

- `arcade_20pacgal` - Ms. Pac-Man / Galaga
- `arcade_galaga` - Galaga
- `arcade_sf2` - Street Fighter II
- `msdos_doom_1993` - DOOM
