# SimpleMaze - LLM-Driven 2D Maze Game

A minimal 2D maze game demonstrating MCP Apps + LLM agent architecture where the LLM is the creative driver of content generation.

## Architecture

The game uses two MCP tools:

1. **`start_maze`** - Initializes a new game session with a starting tile
2. **`generate_tile`** - LLM-controlled tile generation when exploring new areas

### LLM-Driven Content Generation

When the player walks off the edge of a tile into unexplored territory:

1. The app sends game context to the model via `updateModelContext()`
2. The app prompts: "I walked {direction}. What do I find?"
3. The LLM decides creative aspects and calls `generate_tile` with:
   - `tileStyle`: open_arena, tight_corridors, maze, ambush_room, treasure_room
   - `enemyCount`: 0-10 enemies
   - `enemyPlacement`: scattered, guarding_exit, patrol_center, ambush_corners
   - `narrative`: Custom atmospheric description
   - `wallDensity`: sparse, medium, dense

This makes the LLM the creative decision-maker rather than using hardcoded random generation.

## Running

### Prerequisites

```bash
# From repo root
npm install

# Build the maze-server
cd examples/maze-server
npm install
npm run build
```

### Start the Server

```bash
# HTTP mode (for MCP Apps)
npm run serve:http
```

Server runs on `http://localhost:3002` by default.

### Development

```bash
# Watch mode for UI changes
npm run dev

# In another terminal, run the server
npm run serve:http
```

## Game Controls

- **Arrow keys** or **HJKL**: Move player
- **Space**: Fire laser in current direction
- **S**: Slow down enemies (debug cheat)

## Files

- `server.ts` - MCP server with start_maze and generate_tile tools
- `src/MazeGame.tsx` - Canvas-based game renderer
- `src/mcp-app.tsx` - React app that connects to MCP tools
- `src/types.ts` - TypeScript types for game state
- `main.ts` - HTTP server entry point
- `mcp-app.html` - HTML template for the app
