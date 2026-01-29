// SimpleMaze game types

export interface Position {
  x: number;
  y: number;
}

export interface Enemy {
  id: string;
  x: number;
  y: number;
  alive: boolean;
}

export interface Tile {
  id: string;
  walls: boolean[][]; // 64x64 grid, true = wall
  enemies: Enemy[];
  exits: {
    north?: string | null;
    south?: string | null;
    east?: string | null;
    west?: string | null;
  };
  theme?: string;
}

export interface Player {
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  direction: "n" | "s" | "e" | "w";
  kills: number;
}

export interface GameState {
  sessionId: string;
  currentTileId: string;
  tiles: Map<string, Tile>;
  player: Player;
  narrative?: string;
}

export interface StartMazeResult {
  sessionId: string;
  tile: Tile;
  player: Player;
  narrative: string;
}

export interface GenerateTileResult {
  tile: Tile;
  narrative?: string;
}

export const TILE_SIZE = 64;
export const CELL_SIZE = 12; // pixels per cell when rendering
