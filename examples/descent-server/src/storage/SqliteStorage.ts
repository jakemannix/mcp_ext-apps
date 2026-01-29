/**
 * SQLite-based Game Storage Implementation
 *
 * Implements the GameStorage interface for persisting game sessions,
 * areas, and player state.
 *
 * Uses bun:sqlite when running in Bun, or better-sqlite3 when running in Node.js.
 */

import { randomUUID } from "crypto";
import type {
  GameStorage,
  Session,
  Theme,
  Difficulty,
  AreaData,
  PlayerState,
} from "../types/GameTypes.js";

// Detect runtime and use appropriate SQLite implementation
const isBun = typeof (globalThis as any).Bun !== "undefined";

interface DatabaseWrapper {
  exec(sql: string): void;
  prepare(sql: string): StatementWrapper;
  close(): void;
}

interface StatementWrapper {
  run(...params: any[]): void;
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

async function createDatabase(dbPath: string): Promise<DatabaseWrapper> {
  if (isBun) {
    // Use bun:sqlite
    const { Database } = await import("bun:sqlite");
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");

    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        return {
          run: (...params: any[]) => stmt.run(...params),
          get: (...params: any[]) => stmt.get(...params),
          all: (...params: any[]) => stmt.all(...params),
        };
      },
      close: () => db.close(),
    };
  } else {
    // Use better-sqlite3 for Node.js
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        return {
          run: (...params: any[]) => stmt.run(...params),
          get: (...params: any[]) => stmt.get(...params),
          all: (...params: any[]) => stmt.all(...params),
        };
      },
      close: () => db.close(),
    };
  }
}

export class SqliteStorage implements GameStorage {
  private db: DatabaseWrapper | null = null;
  private dbPath: string;
  private initPromise: Promise<void> | null = null;

  constructor(dbPath: string = ":memory:") {
    this.dbPath = dbPath;
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    this.db = await createDatabase(this.dbPath);
    this.initializeTables();
  }

  private async ensureInitialized(): Promise<DatabaseWrapper> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    return this.db;
  }

  private initializeTables(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        theme TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_played INTEGER NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        exploration_depth INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS areas (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (session_id, id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS player_state (
        session_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_areas_session ON areas(session_id);
    `);
  }

  async createSession(theme: Theme, difficulty: Difficulty): Promise<Session> {
    const db = await this.ensureInitialized();

    const session: Session = {
      id: randomUUID(),
      theme,
      difficulty,
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      score: 0,
      explorationDepth: 0,
    };

    const stmt = db.prepare(`
      INSERT INTO sessions (id, theme, difficulty, created_at, last_played, score, exploration_depth)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.theme,
      session.difficulty,
      session.createdAt,
      session.lastPlayed,
      session.score,
      session.explorationDepth
    );

    return session;
  }

  async loadSession(sessionId: string): Promise<Session | null> {
    const db = await this.ensureInitialized();

    const stmt = db.prepare(`
      SELECT id, theme, difficulty, created_at, last_played, score, exploration_depth
      FROM sessions
      WHERE id = ?
    `);

    const row = stmt.get(sessionId) as {
      id: string;
      theme: string;
      difficulty: string;
      created_at: number;
      last_played: number;
      score: number;
      exploration_depth: number;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      theme: row.theme as Theme,
      difficulty: row.difficulty as Difficulty,
      createdAt: row.created_at,
      lastPlayed: row.last_played,
      score: row.score,
      explorationDepth: row.exploration_depth,
    };
  }

  async saveSession(session: Session): Promise<void> {
    const db = await this.ensureInitialized();

    const stmt = db.prepare(`
      UPDATE sessions
      SET theme = ?, difficulty = ?, last_played = ?, score = ?, exploration_depth = ?
      WHERE id = ?
    `);

    stmt.run(
      session.theme,
      session.difficulty,
      session.lastPlayed,
      session.score,
      session.explorationDepth,
      session.id
    );
  }

  async saveArea(sessionId: string, area: AreaData): Promise<void> {
    const db = await this.ensureInitialized();

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO areas (id, session_id, data)
      VALUES (?, ?, ?)
    `);

    stmt.run(area.id, sessionId, JSON.stringify(area));
  }

  async getArea(sessionId: string, areaId: string): Promise<AreaData | null> {
    const db = await this.ensureInitialized();

    const stmt = db.prepare(`
      SELECT data FROM areas
      WHERE session_id = ? AND id = ?
    `);

    const row = stmt.get(sessionId, areaId) as { data: string } | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.data) as AreaData;
  }

  async getAreasForSession(sessionId: string): Promise<AreaData[]> {
    const db = await this.ensureInitialized();

    const stmt = db.prepare(`
      SELECT data FROM areas
      WHERE session_id = ?
    `);

    const rows = stmt.all(sessionId) as { data: string }[];

    return rows.map((row) => JSON.parse(row.data) as AreaData);
  }

  async savePlayerState(sessionId: string, state: PlayerState): Promise<void> {
    const db = await this.ensureInitialized();

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO player_state (session_id, data)
      VALUES (?, ?)
    `);

    stmt.run(sessionId, JSON.stringify(state));
  }

  async loadPlayerState(sessionId: string): Promise<PlayerState | null> {
    const db = await this.ensureInitialized();

    const stmt = db.prepare(`
      SELECT data FROM player_state
      WHERE session_id = ?
    `);

    const row = stmt.get(sessionId) as { data: string } | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.data) as PlayerState;
  }

  /**
   * Close the database connection.
   * Call this when done using the storage.
   */
  async close(): Promise<void> {
    const db = await this.ensureInitialized();
    db.close();
    this.db = null;
  }

  /**
   * Delete a session and all associated data.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const db = await this.ensureInitialized();

    // First delete dependent data (areas and player_state)
    db.prepare(`DELETE FROM areas WHERE session_id = ?`).run(sessionId);
    db.prepare(`DELETE FROM player_state WHERE session_id = ?`).run(sessionId);
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  /**
   * List all sessions, ordered by last played descending.
   */
  async listSessions(): Promise<Session[]> {
    const db = await this.ensureInitialized();

    const stmt = db.prepare(`
      SELECT id, theme, difficulty, created_at, last_played, score, exploration_depth
      FROM sessions
      ORDER BY last_played DESC
    `);

    const rows = stmt.all() as {
      id: string;
      theme: string;
      difficulty: string;
      created_at: number;
      last_played: number;
      score: number;
      exploration_depth: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      theme: row.theme as Theme,
      difficulty: row.difficulty as Difficulty,
      createdAt: row.created_at,
      lastPlayed: row.last_played,
      score: row.score,
      explorationDepth: row.exploration_depth,
    }));
  }
}
