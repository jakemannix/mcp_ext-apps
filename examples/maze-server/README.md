# SimpleMaze - LLM-Driven 2D Maze Game

A minimal 2D maze game demonstrating MCP Apps + LLM agent architecture where the LLM is the creative driver of content generation.

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
│                   http://localhost:3002/mcp                 │
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

## Running

### 1. Start the MCP Server

```bash
cd examples/maze-server
npm install
npm run build
npm run serve:http
```

Server runs at **http://localhost:3002/mcp**

### 2. Connect from Claude.ai

Add to your MCP server configuration:
```json
{
  "maze": {
    "url": "http://localhost:3002/mcp"
  }
}
```

Then ask Claude: "Start a maze game on easy difficulty"

## Game Controls

- **Arrow keys** or **HJKL**: Move player
- **Space**: Fire laser in current direction
- **S**: Slow down enemies (debug cheat)

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
