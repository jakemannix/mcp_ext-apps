/**
 * SimpleMaze - A 2D canvas-based maze game
 *
 * Controls:
 * - Arrow keys or HJKL: Move
 * - Space: Fire laser in current direction
 * - S: Slow down enemies (halves their speed each press)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { Tile, Player, Enemy, TILE_SIZE } from "./types";

const TILE_SIZE_PX = 64;
const CELL_SIZE = 10; // pixels per cell
const CANVAS_SIZE = TILE_SIZE_PX * CELL_SIZE; // 640px

interface MazeGameProps {
  tile: Tile;
  player: Player;
  onTileExit: (direction: "north" | "south" | "east" | "west") => void;
  onPlayerUpdate: (player: Player) => void;
}

interface LaserBeam {
  x1: number; // start
  y1: number;
  x2: number; // end (hit point)
  y2: number;
  lifetime: number;
}

export function MazeGame({
  tile,
  player,
  onTileExit,
  onPlayerUpdate,
}: MazeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [enemies, setEnemies] = useState<Enemy[]>(tile.enemies);
  const [laserBeams, setLaserBeams] = useState<LaserBeam[]>([]);
  const [localPlayer, setLocalPlayer] = useState(player);
  const enemyMoveIntervalRef = useRef(500); // ms between enemy moves
  const lastEnemyMoveRef = useRef(0); // Track last enemy move time across effect restarts
  const enemiesRef = useRef(enemies); // Keep ref in sync for keyboard handler
  enemiesRef.current = enemies; // Update ref on every render

  // Update enemies when tile changes
  useEffect(() => {
    setEnemies(tile.enemies.filter((e) => e.alive));
  }, [tile]);

  // Update local player when prop changes
  useEffect(() => {
    setLocalPlayer(player);
  }, [player]);

  // Game loop
  useEffect(() => {
    let animationId: number;
    let lastTime = 0;

    const gameLoop = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;

      // Move enemies toward player periodically
      if (time - lastEnemyMoveRef.current > enemyMoveIntervalRef.current) {
        lastEnemyMoveRef.current = time;
        setEnemies((prevEnemies) => {
          return prevEnemies.map((enemy) => {
            if (!enemy.alive) return enemy;

            // Simple chase AI
            let newX = enemy.x;
            let newY = enemy.y;

            if (Math.random() < 0.7) {
              // 70% chance to move toward player
              const dx = localPlayer.x - enemy.x;
              const dy = localPlayer.y - enemy.y;

              if (Math.abs(dx) > Math.abs(dy)) {
                newX += dx > 0 ? 1 : -1;
              } else {
                newY += dy > 0 ? 1 : -1;
              }
            } else {
              // Random movement
              const dir = Math.floor(Math.random() * 4);
              if (dir === 0) newY--;
              else if (dir === 1) newY++;
              else if (dir === 2) newX--;
              else newX++;
            }

            // Check wall collision
            if (
              newX >= 0 &&
              newX < TILE_SIZE_PX &&
              newY >= 0 &&
              newY < TILE_SIZE_PX
            ) {
              if (!tile.walls[newY]?.[newX]) {
                return { ...enemy, x: newX, y: newY };
              }
            }
            return enemy;
          });
        });
      }

      // Update laser beams (just fade out)
      setLaserBeams((prev) =>
        prev
          .map((beam) => ({ ...beam, lifetime: beam.lifetime - dt }))
          .filter((beam) => beam.lifetime > 0),
      );

      // Check player-enemy collision
      enemies.forEach((enemy) => {
        if (!enemy.alive) return;
        if (enemy.x === localPlayer.x && enemy.y === localPlayer.y) {
          // Enemy hits player
          setLocalPlayer((p) => {
            const updated = { ...p, health: p.health - 1 };
            onPlayerUpdate(updated);
            return updated;
          });
          setEnemies((prev) =>
            prev.map((e) => (e.id === enemy.id ? { ...e, alive: false } : e)),
          );
        }
      });

      // Render
      render();

      animationId = requestAnimationFrame(gameLoop);
    };

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Clear
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Draw walls
      ctx.fillStyle = "#4a4a6e";
      for (let y = 0; y < TILE_SIZE_PX; y++) {
        for (let x = 0; x < TILE_SIZE_PX; x++) {
          if (tile.walls[y]?.[x]) {
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          }
        }
      }

      // Draw exits (highlighted)
      ctx.fillStyle = "#00ff8844";
      const mid = TILE_SIZE_PX / 2;
      if (!tile.walls[0]?.[mid]) {
        ctx.fillRect(mid * CELL_SIZE, 0, CELL_SIZE, CELL_SIZE);
      }
      if (!tile.walls[TILE_SIZE_PX - 1]?.[mid]) {
        ctx.fillRect(
          mid * CELL_SIZE,
          (TILE_SIZE_PX - 1) * CELL_SIZE,
          CELL_SIZE,
          CELL_SIZE,
        );
      }
      if (!tile.walls[mid]?.[0]) {
        ctx.fillRect(0, mid * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
      if (!tile.walls[mid]?.[TILE_SIZE_PX - 1]) {
        ctx.fillRect(
          (TILE_SIZE_PX - 1) * CELL_SIZE,
          mid * CELL_SIZE,
          CELL_SIZE,
          CELL_SIZE,
        );
      }

      // Draw enemies
      ctx.fillStyle = "#ff4444";
      enemies
        .filter((e) => e.alive)
        .forEach((enemy) => {
          ctx.beginPath();
          ctx.arc(
            enemy.x * CELL_SIZE + CELL_SIZE / 2,
            enemy.y * CELL_SIZE + CELL_SIZE / 2,
            CELL_SIZE / 2 - 1,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        });

      // Draw laser beams as lines
      laserBeams.forEach((beam) => {
        const alpha = Math.min(1, beam.lifetime / 100); // fade out
        ctx.strokeStyle = `rgba(255, 255, 0, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(
          beam.x1 * CELL_SIZE + CELL_SIZE / 2,
          beam.y1 * CELL_SIZE + CELL_SIZE / 2,
        );
        ctx.lineTo(
          beam.x2 * CELL_SIZE + CELL_SIZE / 2,
          beam.y2 * CELL_SIZE + CELL_SIZE / 2,
        );
        ctx.stroke();
        // Hit point glow
        ctx.fillStyle = `rgba(255, 100, 0, ${alpha})`;
        ctx.beginPath();
        ctx.arc(
          beam.x2 * CELL_SIZE + CELL_SIZE / 2,
          beam.y2 * CELL_SIZE + CELL_SIZE / 2,
          6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      });

      // Draw player
      ctx.fillStyle = "#00ff88";
      ctx.fillRect(
        localPlayer.x * CELL_SIZE + 1,
        localPlayer.y * CELL_SIZE + 1,
        CELL_SIZE - 2,
        CELL_SIZE - 2,
      );

      // Draw direction indicator
      ctx.fillStyle = "#ffffff";
      const cx = localPlayer.x * CELL_SIZE + CELL_SIZE / 2;
      const cy = localPlayer.y * CELL_SIZE + CELL_SIZE / 2;
      ctx.beginPath();
      if (localPlayer.direction === "n") {
        ctx.moveTo(cx, cy - 3);
        ctx.lineTo(cx - 2, cy + 1);
        ctx.lineTo(cx + 2, cy + 1);
      } else if (localPlayer.direction === "s") {
        ctx.moveTo(cx, cy + 3);
        ctx.lineTo(cx - 2, cy - 1);
        ctx.lineTo(cx + 2, cy - 1);
      } else if (localPlayer.direction === "w") {
        ctx.moveTo(cx - 3, cy);
        ctx.lineTo(cx + 1, cy - 2);
        ctx.lineTo(cx + 1, cy + 2);
      } else {
        ctx.moveTo(cx + 3, cy);
        ctx.lineTo(cx - 1, cy - 2);
        ctx.lineTo(cx - 1, cy + 2);
      }
      ctx.fill();
    };

    animationId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationId);
  }, [tile, localPlayer, enemies, laserBeams, onPlayerUpdate]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      let newX = localPlayer.x;
      let newY = localPlayer.y;
      let newDir = localPlayer.direction;

      switch (e.key) {
        case "ArrowUp":
        case "k":
          newY--;
          newDir = "n";
          break;
        case "ArrowDown":
        case "j":
          newY++;
          newDir = "s";
          break;
        case "ArrowLeft":
        case "h":
          newX--;
          newDir = "w";
          break;
        case "ArrowRight":
        case "l":
          newX++;
          newDir = "e";
          break;
        case " ":
          // Fire laser - instant hit-scan
          e.preventDefault();
          const dx =
            localPlayer.direction === "e"
              ? 1
              : localPlayer.direction === "w"
                ? -1
                : 0;
          const dy =
            localPlayer.direction === "s"
              ? 1
              : localPlayer.direction === "n"
                ? -1
                : 0;

          // Ray-trace to find hit point
          let hitX = localPlayer.x;
          let hitY = localPlayer.y;
          let hitEnemy: Enemy | null = null;

          for (let i = 1; i < TILE_SIZE_PX; i++) {
            const checkX = localPlayer.x + dx * i;
            const checkY = localPlayer.y + dy * i;

            // Out of bounds
            if (
              checkX < 0 ||
              checkX >= TILE_SIZE_PX ||
              checkY < 0 ||
              checkY >= TILE_SIZE_PX
            ) {
              hitX = checkX - dx; // stop at edge
              hitY = checkY - dy;
              break;
            }

            // Hit wall
            if (tile.walls[checkY]?.[checkX]) {
              hitX = checkX;
              hitY = checkY;
              break;
            }

            // Check for enemy hit (use ref for current state)
            const enemyAtPos = enemiesRef.current.find(
              (en) => en.alive && en.x === checkX && en.y === checkY,
            );
            if (enemyAtPos) {
              hitX = checkX;
              hitY = checkY;
              hitEnemy = enemyAtPos;
              break;
            }

            hitX = checkX;
            hitY = checkY;
          }

          // Create beam visual
          setLaserBeams((prev) => [
            ...prev,
            {
              x1: localPlayer.x,
              y1: localPlayer.y,
              x2: hitX,
              y2: hitY,
              lifetime: 200,
            },
          ]);

          // Kill enemy if hit
          if (hitEnemy) {
            setEnemies((prev) =>
              prev.map((en) =>
                en.id === hitEnemy!.id ? { ...en, alive: false } : en,
              ),
            );
            setLocalPlayer((p) => {
              const updated = { ...p, kills: p.kills + 1 };
              onPlayerUpdate(updated);
              return updated;
            });
          }
          return;
        case "s":
          // Cheat: slow down enemies by half
          e.preventDefault();
          enemyMoveIntervalRef.current = enemyMoveIntervalRef.current * 2;
          console.log(
            "Enemy speed slowed to",
            enemyMoveIntervalRef.current,
            "ms",
          );
          return;
        default:
          return;
      }

      e.preventDefault();

      // Check for tile exit
      if (newY < 0) {
        onTileExit("north");
        return;
      }
      if (newY >= TILE_SIZE_PX) {
        onTileExit("south");
        return;
      }
      if (newX < 0) {
        onTileExit("west");
        return;
      }
      if (newX >= TILE_SIZE_PX) {
        onTileExit("east");
        return;
      }

      // Check wall collision
      if (!tile.walls[newY]?.[newX]) {
        const updated = { ...localPlayer, x: newX, y: newY, direction: newDir };
        setLocalPlayer(updated);
        onPlayerUpdate(updated);
      } else {
        // Just update direction
        const updated = { ...localPlayer, direction: newDir };
        setLocalPlayer(updated);
        onPlayerUpdate(updated);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [localPlayer, tile, onTileExit, onPlayerUpdate]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      style={{
        border: "2px solid #4a4a6e",
        borderRadius: "4px",
        imageRendering: "pixelated",
      }}
      tabIndex={0}
    />
  );
}
