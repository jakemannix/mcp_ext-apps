/**
 * Storage System Exports
 *
 * Provides the GameStorage interface implementation for persisting
 * game sessions, areas, and player state.
 */

export { SqliteStorage } from "./SqliteStorage.js";
export type { GameStorage } from "../types/GameTypes.js";
