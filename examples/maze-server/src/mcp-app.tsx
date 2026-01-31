/**
 * MCP App wrapper for SimpleMaze
 *
 * Uses the MCP Apps SDK to communicate with the host.
 */

import { StrictMode, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { MazeGame } from "./MazeGame";
import type {
  Tile,
  Player,
  StartMazeResult,
  GenerateTileResult,
} from "./types";

const TILE_SIZE = 64;

function App() {
  const { app, status, error } = useApp({
    appInfo: { name: "SimpleMaze", version: "0.1.0" },
    capabilities: {},
  });

  useHostStyles(app, app?.getHostContext());

  const [gameState, setGameState] = useState<{
    sessionId: string;
    currentTile: Tile;
    tiles: Map<string, Tile>;
    player: Player;
    narrative: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("Waiting for game to start...");

  // Handle tool results (start_maze and generate_tile)
  app &&
    (app.ontoolresult = (result) => {
      if (!result.structuredContent) return;

      const data = result.structuredContent as Record<string, unknown>;

      // Check if this is a start_maze result (has sessionId and player)
      if ("sessionId" in data && "player" in data) {
        const startResult = data as unknown as StartMazeResult;
        const tiles = new Map<string, Tile>();
        tiles.set(startResult.tile.id, startResult.tile);

        setGameState({
          sessionId: startResult.sessionId,
          currentTile: startResult.tile,
          tiles,
          player: startResult.player,
          narrative: startResult.narrative,
        });
        setStatusText(startResult.narrative);
      }
      // Check if this is a generate_tile result (has tile but no sessionId)
      else if ("tile" in data && !("sessionId" in data)) {
        const tileResult = data as unknown as GenerateTileResult;

        setGameState((prev) => {
          if (!prev) return null;

          // Add new tile to map
          const newTiles = new Map(prev.tiles);
          newTiles.set(tileResult.tile.id, tileResult.tile);

          // Update current tile's exit to point to new tile
          // We need to figure out the direction - check which exit is missing
          const updatedCurrentTile = { ...prev.currentTile };
          for (const dir of ["north", "south", "east", "west"] as const) {
            if (!updatedCurrentTile.exits[dir]) {
              updatedCurrentTile.exits[dir] = tileResult.tile.id;
              break;
            }
          }
          newTiles.set(updatedCurrentTile.id, updatedCurrentTile);

          // Calculate entry position based on opposite direction
          let newX = prev.player.x;
          let newY = prev.player.y;
          // Default to center if we can't determine direction
          const TILE_SIZE = 64;
          if (prev.player.y <= 1) newY = TILE_SIZE - 2; // was moving north, enter from south
          if (prev.player.y >= TILE_SIZE - 2) newY = 1; // was moving south, enter from north
          if (prev.player.x >= TILE_SIZE - 2) newX = 1; // was moving east, enter from west
          if (prev.player.x <= 1) newX = TILE_SIZE - 2; // was moving west, enter from east

          return {
            ...prev,
            currentTile: tileResult.tile,
            tiles: newTiles,
            player: { ...prev.player, x: newX, y: newY },
            narrative: tileResult.narrative || prev.narrative,
          };
        });

        setStatusText(tileResult.narrative || "You enter a new area.");
        setLoading(false);
      }
    });

  // Handle tile exit - call generate_tile
  const handleTileExit = useCallback(
    async (direction: "north" | "south" | "east" | "west") => {
      if (!app || !gameState) return;

      // Check if we already have this tile
      const existingTileId = gameState.currentTile.exits[direction];
      if (existingTileId && gameState.tiles.has(existingTileId)) {
        // Move to existing tile
        const existingTile = gameState.tiles.get(existingTileId)!;

        // Calculate entry position (opposite side from where we exited)
        let newX = gameState.player.x;
        let newY = gameState.player.y;
        if (direction === "north") newY = TILE_SIZE - 2;
        if (direction === "south") newY = 1;
        if (direction === "east") newX = 1;
        if (direction === "west") newX = TILE_SIZE - 2;

        setGameState((prev) => ({
          ...prev!,
          currentTile: existingTile,
          player: { ...prev!.player, x: newX, y: newY },
        }));
        return;
      }

      // Generate new tile
      setLoading(true);
      setStatusText("Generating new area...");

      try {
        const tilesExplored = gameState.tiles.size;

        // First, update model context with current game state
        await app.updateModelContext({
          content: [
            {
              type: "text",
              text: `SimpleMaze game state:
sessionId: ${gameState.sessionId}
fromTileId: ${gameState.currentTile.id}
direction: ${direction}
health: ${gameState.player.health}/${gameState.player.maxHealth}
kills: ${gameState.player.kills}
tiles_explored: ${tilesExplored}`,
            },
          ],
        });

        // Then send a brief message to trigger tile generation
        // Per spec, ui/message should trigger agent follow-up
        await app.sendMessage({
          role: "user",
          content: [
            {
              type: "text",
              text: `The player moved ${direction} into unexplored territory. Please generate a new tile using the generate_tile tool.`,
            },
          ],
        });
        // The agent will call generate_tile, and we'll receive the result via ontoolresult
      } catch (err) {
        console.error("Failed to request tile generation:", err);
        setStatusText("Failed to explore new area.");
        setLoading(false);
      }
      // Note: setLoading(false) will be called when we receive the tool result
    },
    [app, gameState],
  );

  // Handle player updates
  const handlePlayerUpdate = useCallback((player: Player) => {
    setGameState((prev) => (prev ? { ...prev, player } : null));

    // Check for game over
    if (player.health <= 0) {
      setStatusText(`Game Over! You defeated ${player.kills} enemies.`);
    }
  }, []);

  if (status === "connecting") {
    return (
      <div style={styles.container}>
        <div style={styles.status}>Connecting...</div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={styles.container}>
        <div style={styles.error}>Error: {error?.message}</div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div style={styles.container}>
        <div style={styles.waiting}>
          <h2 style={styles.title}>SimpleMaze</h2>
          <p style={styles.text}>{statusText}</p>
          <p style={styles.hint}>Ask the agent to start the maze game.</p>
        </div>
      </div>
    );
  }

  if (gameState.player.health <= 0) {
    return (
      <div style={styles.container}>
        <div style={styles.gameOver}>
          <h2 style={styles.title}>Game Over</h2>
          <p style={styles.text}>Enemies defeated: {gameState.player.kills}</p>
          <p style={styles.hint}>Ask the agent to start a new game.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.hud}>
        <span style={styles.health}>
          {"❤️".repeat(gameState.player.health)}
          {"🖤".repeat(gameState.player.maxHealth - gameState.player.health)}
        </span>
        <span style={styles.kills}>Kills: {gameState.player.kills}</span>
      </div>

      <MazeGame
        tile={gameState.currentTile}
        player={gameState.player}
        onTileExit={handleTileExit}
        onPlayerUpdate={handlePlayerUpdate}
      />

      <div style={styles.narrative}>
        {loading ? "Generating..." : statusText}
      </div>

      <div style={styles.controls}>
        <span>Move: Arrow keys or HJKL</span>
        <span>Fire: Space</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "20px",
    fontFamily: "'Courier New', monospace",
    background: "#0a0a12",
    color: "#e0e0e0",
    minHeight: "100vh",
  },
  status: {
    color: "#888",
    fontSize: "14px",
  },
  error: {
    color: "#ff4444",
    fontSize: "14px",
  },
  waiting: {
    textAlign: "center",
    marginTop: "100px",
  },
  gameOver: {
    textAlign: "center",
    marginTop: "100px",
  },
  title: {
    color: "#00ff88",
    fontSize: "28px",
    marginBottom: "20px",
    textShadow: "0 0 10px #00aa55",
  },
  text: {
    fontSize: "16px",
    marginBottom: "10px",
  },
  hint: {
    color: "#888",
    fontSize: "14px",
  },
  hud: {
    display: "flex",
    justifyContent: "space-between",
    width: "640px",
    marginBottom: "10px",
    fontSize: "18px",
  },
  health: {
    letterSpacing: "2px",
  },
  kills: {
    color: "#00ff88",
  },
  narrative: {
    marginTop: "10px",
    fontStyle: "italic",
    color: "#888",
    maxWidth: "640px",
    textAlign: "center",
  },
  controls: {
    marginTop: "20px",
    fontSize: "12px",
    color: "#666",
    display: "flex",
    gap: "20px",
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
