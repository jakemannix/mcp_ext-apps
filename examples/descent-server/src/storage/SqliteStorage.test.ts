/**
 * Basic tests for SqliteStorage
 *
 * Run with: bun test src/storage/SqliteStorage.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SqliteStorage } from "./SqliteStorage.js";
import type { AreaData, PlayerState } from "../types/GameTypes.js";

describe("SqliteStorage", () => {
  let storage: SqliteStorage;

  beforeEach(() => {
    // Use in-memory database for tests
    storage = new SqliteStorage(":memory:");
  });

  afterEach(async () => {
    await storage.close();
  });

  describe("Session management", () => {
    test("createSession creates a new session", async () => {
      const session = await storage.createSession("alien_hive", "normal");

      expect(session.id).toBeDefined();
      expect(session.theme).toBe("alien_hive");
      expect(session.difficulty).toBe("normal");
      expect(session.score).toBe(0);
      expect(session.explorationDepth).toBe(0);
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.lastPlayed).toBeGreaterThan(0);
    });

    test("loadSession retrieves a session", async () => {
      const created = await storage.createSession("space_station", "hard");
      const loaded = await storage.loadSession(created.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(created.id);
      expect(loaded!.theme).toBe("space_station");
      expect(loaded!.difficulty).toBe("hard");
    });

    test("loadSession returns null for non-existent session", async () => {
      const loaded = await storage.loadSession("non-existent-id");
      expect(loaded).toBeNull();
    });

    test("saveSession updates session data", async () => {
      const session = await storage.createSession("ancient_ruins", "easy");
      session.score = 1000;
      session.explorationDepth = 5;
      session.lastPlayed = Date.now();

      await storage.saveSession(session);

      const loaded = await storage.loadSession(session.id);
      expect(loaded!.score).toBe(1000);
      expect(loaded!.explorationDepth).toBe(5);
    });
  });

  describe("Area persistence", () => {
    test("saveArea and getArea work correctly", async () => {
      const session = await storage.createSession("procedural_mix", "normal");

      const area: AreaData = {
        id: "area-001",
        type: "room",
        shape: "box",
        dimensions: { width: 20, height: 10, length: 30 },
        position: { x: 0, y: 0, z: 0 },
        theme: "alien_hive",
        exits: [
          { direction: "north", type: "open", targetAreaId: null },
          { direction: "south", type: "door", targetAreaId: "area-002" },
        ],
      };

      await storage.saveArea(session.id, area);
      const loaded = await storage.getArea(session.id, "area-001");

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("area-001");
      expect(loaded!.type).toBe("room");
      expect(loaded!.shape).toBe("box");
      expect(loaded!.dimensions.width).toBe(20);
      expect(loaded!.exits).toHaveLength(2);
      expect(loaded!.exits[0].direction).toBe("north");
    });

    test("getArea returns null for non-existent area", async () => {
      const session = await storage.createSession("alien_hive", "normal");
      const loaded = await storage.getArea(session.id, "non-existent");
      expect(loaded).toBeNull();
    });

    test("getAreasForSession returns all areas", async () => {
      const session = await storage.createSession("space_station", "normal");

      const area1: AreaData = {
        id: "area-001",
        type: "corridor",
        shape: "box",
        dimensions: { width: 5, height: 5, length: 20 },
        position: { x: 0, y: 0, z: 0 },
        theme: "space_station",
        exits: [],
      };

      const area2: AreaData = {
        id: "area-002",
        type: "junction",
        shape: "cross",
        dimensions: { width: 15, height: 8, length: 15 },
        position: { x: 0, y: 0, z: 25 },
        theme: "space_station",
        exits: [],
      };

      await storage.saveArea(session.id, area1);
      await storage.saveArea(session.id, area2);

      const areas = await storage.getAreasForSession(session.id);
      expect(areas).toHaveLength(2);
      expect(areas.map((a) => a.id).sort()).toEqual(["area-001", "area-002"]);
    });

    test("saveArea updates existing area", async () => {
      const session = await storage.createSession("alien_hive", "normal");

      const area: AreaData = {
        id: "area-001",
        type: "room",
        shape: "box",
        dimensions: { width: 10, height: 10, length: 10 },
        position: { x: 0, y: 0, z: 0 },
        theme: "alien_hive",
        exits: [],
      };

      await storage.saveArea(session.id, area);

      // Update the area with new exits
      area.exits = [{ direction: "north", type: "open", targetAreaId: "area-002" }];
      await storage.saveArea(session.id, area);

      const loaded = await storage.getArea(session.id, "area-001");
      expect(loaded!.exits).toHaveLength(1);
    });
  });

  describe("Player state persistence", () => {
    test("savePlayerState and loadPlayerState work correctly", async () => {
      const session = await storage.createSession("ancient_ruins", "hard");

      const playerState: PlayerState = {
        position: { x: 10, y: 5, z: -20 },
        rotation: { x: 0, y: 1.57, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        health: 75,
        maxHealth: 100,
        shields: 50,
        maxShields: 100,
        score: 2500,
        inventory: {
          weapons: [
            { type: "laser", level: 1, damage: 10, fireRate: 5, ammoType: null },
            { type: "vulcan", level: 2, damage: 5, fireRate: 20, ammoType: "vulcan" },
          ],
          primaryIndex: 1,
          secondaryIndex: null,
          ammo: {
            vulcan: 500,
            plasma: 0,
            fusion: 0,
            concussion: 10,
            homing: 5,
            smart: 0,
          },
          powerUps: [{ type: "quad_damage", remainingTime: 15.5 }],
        },
      };

      await storage.savePlayerState(session.id, playerState);
      const loaded = await storage.loadPlayerState(session.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.position.x).toBe(10);
      expect(loaded!.health).toBe(75);
      expect(loaded!.score).toBe(2500);
      expect(loaded!.inventory.weapons).toHaveLength(2);
      expect(loaded!.inventory.weapons[1].type).toBe("vulcan");
      expect(loaded!.inventory.ammo.vulcan).toBe(500);
      expect(loaded!.inventory.powerUps[0].remainingTime).toBe(15.5);
    });

    test("loadPlayerState returns null for non-existent state", async () => {
      const session = await storage.createSession("alien_hive", "normal");
      const loaded = await storage.loadPlayerState(session.id);
      expect(loaded).toBeNull();
    });

    test("savePlayerState updates existing state", async () => {
      const session = await storage.createSession("space_station", "normal");

      const initialState: PlayerState = {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        health: 100,
        maxHealth: 100,
        shields: 100,
        maxShields: 100,
        score: 0,
        inventory: {
          weapons: [{ type: "laser", level: 1, damage: 10, fireRate: 5, ammoType: null }],
          primaryIndex: 0,
          secondaryIndex: null,
          ammo: { vulcan: 0, plasma: 0, fusion: 0, concussion: 0, homing: 0, smart: 0 },
          powerUps: [],
        },
      };

      await storage.savePlayerState(session.id, initialState);

      // Update state
      initialState.health = 50;
      initialState.score = 100;
      await storage.savePlayerState(session.id, initialState);

      const loaded = await storage.loadPlayerState(session.id);
      expect(loaded!.health).toBe(50);
      expect(loaded!.score).toBe(100);
    });
  });

  describe("Full game flow", () => {
    test("create session, save area, reload - data persists", async () => {
      // Create a new game session
      const session = await storage.createSession("alien_hive", "normal");

      // Generate and save starting area
      const startingArea: AreaData = {
        id: "start",
        type: "room",
        name: "Entry Bay",
        shape: "box",
        dimensions: { width: 30, height: 12, length: 30 },
        position: { x: 0, y: 0, z: 0 },
        theme: "alien_hive",
        hazards: ["darkness"],
        exits: [
          { direction: "north", type: "door", targetAreaId: null },
          { direction: "east", type: "open", targetAreaId: null },
        ],
      };
      await storage.saveArea(session.id, startingArea);

      // Save initial player state
      const playerState: PlayerState = {
        position: { x: 15, y: 2, z: 15 },
        rotation: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        health: 100,
        maxHealth: 100,
        shields: 100,
        maxShields: 100,
        score: 0,
        inventory: {
          weapons: [{ type: "laser", level: 1, damage: 10, fireRate: 5, ammoType: null }],
          primaryIndex: 0,
          secondaryIndex: null,
          ammo: { vulcan: 0, plasma: 0, fusion: 0, concussion: 0, homing: 0, smart: 0 },
          powerUps: [],
        },
      };
      await storage.savePlayerState(session.id, playerState);

      // Update session progress
      session.explorationDepth = 1;
      session.lastPlayed = Date.now();
      await storage.saveSession(session);

      // Simulate "reload" - verify all data persists
      const reloadedSession = await storage.loadSession(session.id);
      const reloadedArea = await storage.getArea(session.id, "start");
      const reloadedPlayer = await storage.loadPlayerState(session.id);

      expect(reloadedSession).not.toBeNull();
      expect(reloadedSession!.explorationDepth).toBe(1);
      expect(reloadedSession!.theme).toBe("alien_hive");

      expect(reloadedArea).not.toBeNull();
      expect(reloadedArea!.name).toBe("Entry Bay");
      expect(reloadedArea!.hazards).toContain("darkness");
      expect(reloadedArea!.exits).toHaveLength(2);

      expect(reloadedPlayer).not.toBeNull();
      expect(reloadedPlayer!.position.x).toBe(15);
      expect(reloadedPlayer!.health).toBe(100);
    });
  });

  describe("Additional utilities", () => {
    test("listSessions returns all sessions ordered by lastPlayed", async () => {
      const session1 = await storage.createSession("alien_hive", "easy");
      const session2 = await storage.createSession("space_station", "normal");

      // Update session1 to have older lastPlayed
      session1.lastPlayed = Date.now() - 10000;
      await storage.saveSession(session1);

      const sessions = await storage.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe(session2.id); // More recent first
      expect(sessions[1].id).toBe(session1.id);
    });

    test("deleteSession removes session and cascade data", async () => {
      const session = await storage.createSession("ancient_ruins", "hard");

      const area: AreaData = {
        id: "area-001",
        type: "room",
        shape: "box",
        dimensions: { width: 10, height: 10, length: 10 },
        position: { x: 0, y: 0, z: 0 },
        theme: "ancient_ruins",
        exits: [],
      };
      await storage.saveArea(session.id, area);

      await storage.deleteSession(session.id);

      expect(await storage.loadSession(session.id)).toBeNull();
      // Areas should also be deleted due to CASCADE
      expect(await storage.getArea(session.id, "area-001")).toBeNull();
    });
  });
});
