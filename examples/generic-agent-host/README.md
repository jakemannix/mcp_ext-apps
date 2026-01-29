# Generic Agent Host

A generic LLM agent host with full MCP Apps bridge support. Works with any MCP App.

## Current Status (2026-01-29)

**FULLY WORKING:**
- Python backend with LLM agent (Anthropic/OpenRouter/Google)
- MCP client for tool calls
- React frontend with AppBridge for MCP Apps protocol
- Game starts correctly via `start_maze` tool
- Player movement, combat, all game mechanics work
- **LLM-driven tile generation works!** When player walks to border:
  1. App sends `ui/message` with `role: "assistant"`
  2. Frontend forwards to agent backend
  3. Agent injects as assistant turn and continues loop
  4. LLM calls `generate_tile` with creative parameters
  5. New tile renders in game

**Local ext-apps modification:**
This uses a local modification to ext-apps that adds `role: "assistant"` support
to `ui/message`. The upstream ext-apps@1.0.0 only allows `role: "user"`.
See `src/spec.types.ts` for the change.

This is a potential upstream contribution if the pattern proves useful.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Generic Agent Host                               │
│                                                                      │
│  ┌──────────────────────────────────┐  ┌─────────────────────────┐  │
│  │         Chat Panel               │  │      App Panel          │  │
│  │  ┌────────────────────────────┐  │  │  ┌─────────────────────┐│  │
│  │  │      Messages              │  │  │  │  MCP App (iframe)   ││  │
│  │  │  User: Start a maze game   │  │  │  │                     ││  │
│  │  │  Assistant: ...            │  │  │  │  [Game Canvas]      ││  │
│  │  │  Tool: start_maze          │  │  │  │                     ││  │
│  │  └────────────────────────────┘  │  │  └─────────────────────┘│  │
│  │  ┌────────────────────────────┐  │  │         ↑               │  │
│  │  │ [Input box] [Send]         │  │  │    AppBridge           │  │
│  └──┴────────────────────────────┴──┘  └────────│────────────────┘  │
│                │                                 │                   │
│                ↓                                 │                   │
│  ┌──────────────────────────────────────────────┴─────────────────┐ │
│  │              Python Agent Server (port 3004)                    │ │
│  │  - /chat: User messages                                         │ │
│  │  - /app-message: ui/message from app (role: assistant)         │ │
│  │  - /update-context: updateModelContext from app                │ │
│  └─────────────────────────────────────┬───────────────────────────┘ │
│                                        │                             │
└────────────────────────────────────────│─────────────────────────────┘
                                         │ MCP Protocol
                                         ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    MCP Server (e.g., maze-server:3002)              │
│  - start_maze: Initialize game                                      │
│  - generate_tile: LLM-controlled tile generation                    │
│  - ui://maze/mcp-app.html: Game UI resource                         │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Features

1. **Full MCP Apps Bridge Support**
   - Uses `@modelcontextprotocol/ext-apps/app-bridge`
   - Proper `ui/message` handling with role support
   - `updateModelContext` forwarding
   - Direct iframe loading (no sandbox proxy needed for local dev)

2. **LLM Agent Loop**
   - ReAct pattern with tool calling
   - Multi-provider support (Anthropic, OpenRouter, Google)
   - Streaming responses via SSE

3. **Generic Design**
   - Works with any MCP App
   - No hardcoded UI - loads from MCP resource

## Running

### 1. Start the MCP Server (e.g., maze-server)

```bash
cd examples/maze-server
npm run build
npm run serve:http
# Running on port 3002
```

### 2. Start the Agent Server

```bash
cd examples/generic-agent-host
MCP_SERVER_URL=http://localhost:3002 uv run python -m agent
# Running on port 3004
```

### 3. Start the Frontend (development)

```bash
npm install
npm run dev
# Open http://localhost:5173
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_SERVER_URL` | `http://localhost:3002` | MCP server to connect to |
| `ANTHROPIC_API_KEY` | - | Anthropic API key (primary) |
| `OPENROUTER_API_KEY` | - | OpenRouter API key (fallback) |
| `GOOGLE_API_KEY` | - | Google API key (fallback) |

## How ui/message Works

When the MCP App sends a message:

```typescript
app.sendMessage({
  role: "assistant",
  content: [{ type: "text", text: "The player moved north..." }]
});
```

The flow is:

1. **App** sends `ui/message` to **AppBridge** (in frontend)
2. **Frontend** forwards to `/app-message` endpoint (Python backend)
3. **Agent** receives the message with `role: "assistant"`
4. **Agent** injects it as an assistant turn and continues the loop
5. **Agent** may call tools (e.g., `generate_tile`)
6. **Agent** streams results back to **Frontend**
7. **Frontend** sends `structuredContent` to **App** via **AppBridge**

This enables the app to "speak as the assistant" and trigger tool calls.
