# SimpleMaze - LLM-Driven 2D Maze Game

A minimal 2D maze game demonstrating MCP Apps + LLM agent architecture where the LLM is the creative driver of content generation.

## Quick Start

There are two ways to run this demo:

### Option 1: Local Agent Host (Self-contained)

Run everything locally with the bundled Python agent:

```bash
# Set your API key (one of these)
export ANTHROPIC_API_KEY='sk-ant-...'
# or: export OPENROUTER_API_KEY='...'
# or: export GOOGLE_API_KEY='...'

# Start all services
./demo.sh start

# Open http://localhost:5173 and type "Start a maze game"
```

This starts:
- MCP Server on port 3002
- Python Agent Server on port 3004
- Frontend on port 5173

### Option 2: Claude.ai via Cloudflare Tunnel

Expose the MCP server to the internet so Claude.ai can connect directly:

```bash
# Start MCP server + tunnel (no API key needed - Claude.ai provides the LLM)
./demo.sh tunnel
```

The script will output a public URL like `https://random-name.trycloudflare.com/mcp`.

Then in Claude.ai:
1. Go to **Settings > MCP Servers**
2. Add a new server:
   ```json
   {
     "maze": {
       "url": "https://random-name.trycloudflare.com/mcp"
     }
   }
   ```
3. Start a new conversation and say: **"Start a maze game on easy difficulty"**

### Stopping Services

```bash
./demo.sh stop
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude.ai (Host)                        │
│  ┌─────────────────┐      ┌─────────────────────────────┐  │
│  │  User Chat UI   │      │      LLM (Claude)           │  │
│  │                 │      │  - Receives ui/message      │  │
│  │  Game appears   │      │  - Calls generate_tile      │  │
│  │  in artifact    │      │  - Creative decision-maker  │  │
│  └────────┬────────┘      └──────────────┬──────────────┘  │
│           │                              │                  │
│           │         MCP Protocol         │                  │
└───────────┼──────────────────────────────┼──────────────────┘
            │                              │
            ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  maze-server (MCP Server)                   │
│              Local: http://localhost:3002/mcp               │
│           Tunneled: https://xxx.trycloudflare.com/mcp       │
│                                                             │
│  Tools:                                                     │
│  - start_maze: Initialize game session                      │
│  - generate_tile: LLM provides creative parameters          │
│                                                             │
│  Resources:                                                 │
│  - ui://maze/mcp-app.html: Game UI (React canvas app)       │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

1. **Game Start**: User asks Claude to start a maze game
2. **Claude calls `start_maze`**: Creates session, returns initial tile + UI resource
3. **Player moves**: HJKL/arrows move player, Space fires laser
4. **Edge reached**: When player walks off tile edge into unexplored area:
   - App sends `ui/message` with `role: "assistant"` containing game state
   - Claude receives this as an assistant turn continuation
   - Claude calls `generate_tile` with creative choices (style, enemies, narrative)
   - App receives structured result and renders new tile

### LLM Creative Control

The `generate_tile` tool gives Claude full creative control:
- `tileStyle`: open_arena, tight_corridors, maze, ambush_room, treasure_room
- `enemyCount`: 0-10 enemies
- `enemyPlacement`: scattered, guarding_exit, patrol_center, ambush_corners
- `narrative`: Custom atmospheric description
- `wallDensity`: sparse, medium, dense

## Prerequisites

### For Local Agent Host (`./demo.sh start`)

- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- One of: `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, or `GOOGLE_API_KEY`

### For Tunnel Mode (`./demo.sh tunnel`)

- Node.js 18+
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  ```bash
  # macOS
  brew install cloudflared

  # Linux (Debian/Ubuntu)
  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
  sudo dpkg -i cloudflared.deb
  ```

## Game Controls

- **Arrow keys** or **HJKL**: Move player
- **Space**: Fire laser in current direction
- **S**: Slow down enemies (debug cheat)

## Manual Setup (without demo.sh)

### 1. Build and Start the MCP Server

```bash
cd examples/maze-server
npm install
npm run build
npm run serve:http
```

Server runs at **http://localhost:3002/mcp**

### 2a. Connect via Local Agent Host

```bash
cd examples/generic-agent-host
npm install
npm run build
ANTHROPIC_API_KEY=... MCP_SERVER_URL=http://localhost:3002 uv run python -m agent
```

Then open http://localhost:3004

### 2b. Connect via Claude.ai

Start a Cloudflare tunnel:
```bash
cloudflared tunnel --url http://localhost:3002
```

Copy the generated URL and add to Claude.ai MCP settings.

## Testing Notes

### The `role: "assistant"` Experiment

When the player walks off an edge, the app sends:
```typescript
app.sendMessage({
  role: "assistant",
  content: [{
    type: "text",
    text: "The player moved north into unexplored territory..."
  }]
});
```

This tests whether Claude.ai respects `role: "assistant"` in `ui/message` requests.
- If working: Message appears as Claude's response, Claude continues and calls generate_tile
- If not working: Message appears in user's text input box

## Files

- `server.ts` - MCP server with start_maze and generate_tile tools
- `src/MazeGame.tsx` - Canvas-based game renderer
- `src/mcp-app.tsx` - React app that connects to MCP tools
- `src/types.ts` - TypeScript types for game state
- `main.ts` - HTTP server entry point
- `demo.sh` - Launch script for running the demo
