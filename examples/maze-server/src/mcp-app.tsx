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

  // Handle tool result (start_maze)
  app &&
    (app.ontoolresult = (result) => {
      if (result.structuredContent) {
        const data = result.structuredContent as StartMazeResult;
        const tiles = new Map<string, Tile>();
        tiles.set(data.tile.id, data.tile);

        setGameState({
          sessionId: data.sessionId,
          currentTile: data.tile,
          tiles,
          player: data.player,
          narrative: data.narrative,
        });
        setStatusText(data.narrative);
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
        const mid = TILE_SIZE / 2;

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
        const result = await app.callServerTool({
          name: "generate_tile",
          arguments: {
            sessionId: gameState.sessionId,
            fromTileId: gameState.currentTile.id,
            direction,
            context: {
              playerHealth: gameState.player.health,
              playerKills: gameState.player.kills,
            },
          },
        });

        if (result.structuredContent) {
          const data = result.structuredContent as GenerateTileResult;

          // Add new tile to map
          const newTiles = new Map(gameState.tiles);
          newTiles.set(data.tile.id, data.tile);

          // Update current tile's exit
          const updatedCurrentTile = { ...gameState.currentTile };
          updatedCurrentTile.exits[direction] = data.tile.id;
          newTiles.set(updatedCurrentTile.id, updatedCurrentTile);

          // Calculate entry position
          let newX = gameState.player.x;
          let newY = gameState.player.y;
          if (direction === "north") newY = TILE_SIZE - 2;
          if (direction === "south") newY = 1;
          if (direction === "east") newX = 1;
          if (direction === "west") newX = TILE_SIZE - 2;

          setGameState({
            ...gameState,
            currentTile: data.tile,
            tiles: newTiles,
            player: { ...gameState.player, x: newX, y: newY },
            narrative: data.narrative || gameState.narrative,
          });
          setStatusText(data.narrative || "You enter a new area.");
        }
      } catch (err) {
        console.error("Failed to generate tile:", err);
        setStatusText("Failed to generate new area.");
      } finally {
        setLoading(false);
      }
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
