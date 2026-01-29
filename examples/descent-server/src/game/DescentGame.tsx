/**
 * Descent Game - Main Component
 *
 * Renders the 6DOF shooter with LLM-generated levels.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import type { ViewProps } from "../mcp-app-wrapper.tsx";
import type {
  Theme,
  Difficulty,
  StartGameOutput,
  GenerateAreaOutput,
  AreaData,
  PlayerState,
} from "../types/GameTypes.ts";
import { WorldManager } from "./WorldManager.ts";
import { Ship6DOF } from "./Ship6DOF.ts";
import { AreaRenderer } from "./AreaRenderer.ts";

// =============================================================================
// Types
// =============================================================================

interface DescentToolInput {
  theme?: Theme;
  difficulty?: Difficulty;
}

type DescentGameProps = ViewProps<DescentToolInput>;

type GameState = "menu" | "loading" | "playing";

// =============================================================================
// Theme Selector Component
// =============================================================================

interface ThemeSelectorProps {
  selectedTheme: Theme;
  onThemeSelect: (theme: Theme) => void;
  onStartGame: () => void;
  isLoading: boolean;
}

const THEMES: { id: Theme; name: string; description: string }[] = [
  {
    id: "alien_hive",
    name: "Alien Hive",
    description: "Organic corridors with pulsing walls and insectoid enemies",
  },
  {
    id: "space_station",
    name: "Space Station",
    description: "Industrial metal halls with flickering lights and robots",
  },
  {
    id: "ancient_ruins",
    name: "Ancient Ruins",
    description: "Stone temples with mystical hazards and ancient guardians",
  },
  {
    id: "procedural_mix",
    name: "Reality Flux",
    description: "Unstable blend of all themes - reality itself warps",
  },
];

function ThemeSelector({
  selectedTheme,
  onThemeSelect,
  onStartGame,
  isLoading,
}: ThemeSelectorProps) {
  return (
    <div className="theme-selector">
      <h1>DESCENT</h1>
      <h2>Select Mission Environment</h2>
      <div className="theme-options">
        {THEMES.map((theme) => (
          <div
            key={theme.id}
            className={`theme-option ${selectedTheme === theme.id ? "selected" : ""}`}
            onClick={() => onThemeSelect(theme.id)}
          >
            <h3>{theme.name}</h3>
            <p>{theme.description}</p>
          </div>
        ))}
      </div>
      <button
        className="start-button"
        onClick={onStartGame}
        disabled={isLoading}
      >
        {isLoading ? "Initializing..." : "Launch Mission"}
      </button>
    </div>
  );
}

// =============================================================================
// HUD Component
// =============================================================================

interface HUDProps {
  player: PlayerState | null;
  narrative: string | null;
  onDismissNarrative: () => void;
}

function HUD({ player, narrative, onDismissNarrative }: HUDProps) {
  if (!player) return null;

  const healthPercent = (player.health / player.maxHealth) * 100;
  const shieldPercent = (player.shields / player.maxShields) * 100;

  return (
    <div className="hud-overlay">
      {/* Health/Shield bars */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#0f0", width: 60 }}>HULL</span>
          <div
            style={{
              width: 150,
              height: 12,
              background: "rgba(0,0,0,0.5)",
              border: "1px solid #0f0",
            }}
          >
            <div
              style={{
                width: `${healthPercent}%`,
                height: "100%",
                background:
                  healthPercent > 50
                    ? "#0f0"
                    : healthPercent > 25
                      ? "#ff0"
                      : "#f00",
              }}
            />
          </div>
          <span style={{ color: "#0f0" }}>{Math.round(player.health)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#0af", width: 60 }}>SHIELD</span>
          <div
            style={{
              width: 150,
              height: 12,
              background: "rgba(0,0,0,0.5)",
              border: "1px solid #0af",
            }}
          >
            <div
              style={{
                width: `${shieldPercent}%`,
                height: "100%",
                background: "#0af",
              }}
            />
          </div>
          <span style={{ color: "#0af" }}>{Math.round(player.shields)}</span>
        </div>
      </div>

      {/* Controls help */}
      <div className="controls-help">
        <div>
          <kbd>W</kbd>/<kbd>S</kbd> Forward/Back
        </div>
        <div>
          <kbd>A</kbd>/<kbd>D</kbd> Strafe
        </div>
        <div>
          <kbd>Q</kbd>/<kbd>E</kbd> Roll
        </div>
        <div>
          <kbd>Space</kbd>/<kbd>Shift</kbd> Up/Down
        </div>
        <div>Mouse: Look</div>
      </div>

      {/* Narrative */}
      {narrative && (
        <div className="narrative-box" onClick={onDismissNarrative}>
          {narrative}
          <div
            style={{
              marginTop: 8,
              fontSize: "0.75rem",
              color: "#666",
              textAlign: "right",
            }}
          >
            Click to dismiss
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Game Component
// =============================================================================

export default function DescentGame({
  toolInputs,
  toolInputsPartial,
  toolResult,
  hostContext,
  callServerTool,
  sendLog,
}: DescentGameProps) {
  // Game state
  const [gameState, setGameState] = useState<GameState>("menu");
  const [selectedTheme, setSelectedTheme] = useState<Theme>("alien_hive");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Three.js refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const shipRef = useRef<Ship6DOF | null>(null);
  const worldManagerRef = useRef<WorldManager | null>(null);
  const areaRendererRef = useRef<AreaRenderer | null>(null);
  const animationFrameRef = useRef<number>(0);
  const startingAreaRef = useRef<AreaData | null>(null);

  // Handle initial tool inputs from start_game
  useEffect(() => {
    if (toolResult?.structuredContent) {
      const result = toolResult.structuredContent as unknown as StartGameOutput;
      if (result.sessionId && result.startingArea && result.player) {
        setSessionId(result.sessionId);
        setPlayer(result.player);
        setNarrative(result.narrative);
        startingAreaRef.current = result.startingArea;
        setGameState("playing");
        setIsLoading(false);
      }
    }
  }, [toolResult]);

  // Handle theme from tool inputs
  useEffect(() => {
    const theme = toolInputs?.theme || toolInputsPartial?.theme;
    if (theme) {
      setSelectedTheme(theme);
    }
  }, [toolInputs, toolInputsPartial]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    if (gameState !== "playing" || !sessionId) return;

    const width = containerRef.current.offsetWidth;
    const height = 600;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 50, 200);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 5, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x111111);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00ff88, 1, 50);
    pointLight.position.copy(camera.position);
    scene.add(pointLight);

    // Ship controls
    const ship = new Ship6DOF(camera, containerRef.current);
    shipRef.current = ship;

    // World manager
    const worldManager = new WorldManager(
      scene,
      sessionId,
      callServerTool,
      sendLog,
    );
    worldManagerRef.current = worldManager;

    // Area renderer
    const areaRenderer = new AreaRenderer(scene);
    areaRendererRef.current = areaRenderer;

    // Render starting area
    if (startingAreaRef.current) {
      worldManager.addArea(startingAreaRef.current);
      areaRenderer.renderArea(startingAreaRef.current);
    }

    // Listen for area generation events
    const handleAreaGenerated = (event: Event) => {
      const customEvent = event as CustomEvent<GenerateAreaOutput>;
      if (customEvent.detail?.area) {
        areaRenderer.renderArea(customEvent.detail.area);
        if (customEvent.detail.narrative) {
          setNarrative(customEvent.detail.narrative);
        }
      }
    };
    window.addEventListener("areaGenerated", handleAreaGenerated);

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      // Update ship
      ship.update();

      // Update point light to follow camera
      pointLight.position.copy(camera.position);

      // Check for area generation triggers
      if (worldManagerRef.current && player) {
        worldManagerRef.current.checkGenerationNeeded(
          camera.position,
          camera.getWorldDirection(new THREE.Vector3()),
          player,
        );
      }

      renderer.render(scene, camera);
    };
    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener("areaGenerated", handleAreaGenerated);
      ship.dispose();
      renderer.dispose();
    };
  }, [gameState, sessionId, callServerTool, sendLog, player]);

  // Start game handler
  const handleStartGame = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await callServerTool({
        name: "start_game",
        arguments: {
          theme: selectedTheme,
          difficulty: "normal",
        },
      });

      if (result.structuredContent) {
        const gameResult =
          result.structuredContent as unknown as StartGameOutput;
        setSessionId(gameResult.sessionId);
        setPlayer(gameResult.player);
        setNarrative(gameResult.narrative);
        startingAreaRef.current = gameResult.startingArea;
        setGameState("playing");
      }
    } catch (error) {
      sendLog({
        level: "error",
        data: `Failed to start game: ${error}`,
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedTheme, callServerTool, sendLog]);

  // Safe area insets
  const safeAreaInsets = hostContext?.safeAreaInsets;
  const containerStyle = {
    paddingTop: safeAreaInsets?.top,
    paddingRight: safeAreaInsets?.right,
    paddingBottom: safeAreaInsets?.bottom,
    paddingLeft: safeAreaInsets?.left,
  };

  // Render menu
  if (gameState === "menu") {
    return (
      <div style={containerStyle}>
        <ThemeSelector
          selectedTheme={selectedTheme}
          onThemeSelect={setSelectedTheme}
          onStartGame={handleStartGame}
          isLoading={isLoading}
        />
      </div>
    );
  }

  // Render game
  return (
    <div
      ref={containerRef}
      className="descent-container"
      style={containerStyle}
    >
      <canvas ref={canvasRef} className="game-canvas" style={{ height: 600 }} />
      <HUD
        player={player}
        narrative={narrative}
        onDismissNarrative={() => setNarrative(null)}
      />
    </div>
  );
}
