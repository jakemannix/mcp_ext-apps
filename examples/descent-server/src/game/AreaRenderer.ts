/**
 * Area Renderer
 *
 * Converts AreaData to Three.js geometry.
 * Phase 1: Basic boxes for walls.
 */
import * as THREE from "three";
import type { AreaData, Theme } from "../types/GameTypes.ts";

// Theme colors
const THEME_COLORS: Record<
  Theme,
  { wall: number; floor: number; ceiling: number; emissive: number }
> = {
  alien_hive: {
    wall: 0x2a1a3a,
    floor: 0x1a0a2a,
    ceiling: 0x3a2a4a,
    emissive: 0x440066,
  },
  space_station: {
    wall: 0x2a2a3a,
    floor: 0x1a1a2a,
    ceiling: 0x3a3a4a,
    emissive: 0x003366,
  },
  ancient_ruins: {
    wall: 0x3a3020,
    floor: 0x2a2010,
    ceiling: 0x4a4030,
    emissive: 0x664400,
  },
  procedural_mix: {
    wall: 0x2a2a2a,
    floor: 0x1a1a1a,
    ceiling: 0x3a3a3a,
    emissive: 0x006644,
  },
};

export class AreaRenderer {
  private scene: THREE.Scene;
  private renderedAreas: Set<string> = new Set();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  renderArea(area: AreaData): void {
    // Don't re-render already rendered areas
    if (this.renderedAreas.has(area.id)) return;
    this.renderedAreas.add(area.id);

    const colors = THEME_COLORS[area.theme] || THEME_COLORS.space_station;
    const { width, height, length } = area.dimensions;
    const { x, y, z } = area.position;

    // Create a group for this area
    const areaGroup = new THREE.Group();
    areaGroup.name = `area-${area.id}`;
    areaGroup.position.set(x, y, z);

    // Wall thickness
    const wallThickness = 1;

    // Create materials
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: colors.wall,
      roughness: 0.8,
      metalness: 0.2,
      emissive: colors.emissive,
      emissiveIntensity: 0.1,
    });

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: colors.floor,
      roughness: 0.9,
      metalness: 0.1,
    });

    const ceilingMaterial = new THREE.MeshStandardMaterial({
      color: colors.ceiling,
      roughness: 0.7,
      metalness: 0.3,
      emissive: colors.emissive,
      emissiveIntensity: 0.05,
    });

    // Floor
    const floorGeom = new THREE.BoxGeometry(width, wallThickness, length);
    const floor = new THREE.Mesh(floorGeom, floorMaterial);
    floor.position.set(0, -height / 2, 0);
    floor.receiveShadow = true;
    areaGroup.add(floor);

    // Ceiling
    const ceilingGeom = new THREE.BoxGeometry(width, wallThickness, length);
    const ceiling = new THREE.Mesh(ceilingGeom, ceilingMaterial);
    ceiling.position.set(0, height / 2, 0);
    areaGroup.add(ceiling);

    // Walls - check for exits before creating
    const hasNorthExit = area.exits.some((e) => e.direction === "north");
    const hasSouthExit = area.exits.some((e) => e.direction === "south");
    const hasEastExit = area.exits.some((e) => e.direction === "east");
    const hasWestExit = area.exits.some((e) => e.direction === "west");

    // North wall (or wall segments with doorway)
    if (!hasNorthExit) {
      const wallGeom = new THREE.BoxGeometry(width, height, wallThickness);
      const wall = new THREE.Mesh(wallGeom, wallMaterial);
      wall.position.set(0, 0, -length / 2);
      areaGroup.add(wall);
    } else {
      this.createWallWithDoorway(
        areaGroup,
        wallMaterial,
        width,
        height,
        wallThickness,
        "north",
        length,
      );
    }

    // South wall
    if (!hasSouthExit) {
      const wallGeom = new THREE.BoxGeometry(width, height, wallThickness);
      const wall = new THREE.Mesh(wallGeom, wallMaterial);
      wall.position.set(0, 0, length / 2);
      areaGroup.add(wall);
    } else {
      this.createWallWithDoorway(
        areaGroup,
        wallMaterial,
        width,
        height,
        wallThickness,
        "south",
        length,
      );
    }

    // East wall
    if (!hasEastExit) {
      const wallGeom = new THREE.BoxGeometry(wallThickness, height, length);
      const wall = new THREE.Mesh(wallGeom, wallMaterial);
      wall.position.set(width / 2, 0, 0);
      areaGroup.add(wall);
    } else {
      this.createWallWithDoorway(
        areaGroup,
        wallMaterial,
        width,
        height,
        wallThickness,
        "east",
        length,
      );
    }

    // West wall
    if (!hasWestExit) {
      const wallGeom = new THREE.BoxGeometry(wallThickness, height, length);
      const wall = new THREE.Mesh(wallGeom, wallMaterial);
      wall.position.set(-width / 2, 0, 0);
      areaGroup.add(wall);
    } else {
      this.createWallWithDoorway(
        areaGroup,
        wallMaterial,
        width,
        height,
        wallThickness,
        "west",
        length,
      );
    }

    // Add area light
    const areaLight = new THREE.PointLight(
      colors.emissive,
      0.5,
      Math.max(width, length),
    );
    areaLight.position.set(0, height / 3, 0);
    areaGroup.add(areaLight);

    this.scene.add(areaGroup);
  }

  private createWallWithDoorway(
    group: THREE.Group,
    material: THREE.Material,
    roomWidth: number,
    roomHeight: number,
    wallThickness: number,
    direction: "north" | "south" | "east" | "west",
    roomLength: number,
  ): void {
    const doorWidth = 6;
    const doorHeight = 8;

    if (direction === "north" || direction === "south") {
      const zPos = direction === "north" ? -roomLength / 2 : roomLength / 2;
      const sideWidth = (roomWidth - doorWidth) / 2;

      // Left segment
      if (sideWidth > 0) {
        const leftGeom = new THREE.BoxGeometry(
          sideWidth,
          roomHeight,
          wallThickness,
        );
        const left = new THREE.Mesh(leftGeom, material);
        left.position.set(-roomWidth / 2 + sideWidth / 2, 0, zPos);
        group.add(left);
      }

      // Right segment
      if (sideWidth > 0) {
        const rightGeom = new THREE.BoxGeometry(
          sideWidth,
          roomHeight,
          wallThickness,
        );
        const right = new THREE.Mesh(rightGeom, material);
        right.position.set(roomWidth / 2 - sideWidth / 2, 0, zPos);
        group.add(right);
      }

      // Top segment (above door)
      const topHeight = roomHeight - doorHeight;
      if (topHeight > 0) {
        const topGeom = new THREE.BoxGeometry(
          doorWidth,
          topHeight,
          wallThickness,
        );
        const top = new THREE.Mesh(topGeom, material);
        top.position.set(
          0,
          doorHeight / 2 + topHeight / 2 - roomHeight / 2 + doorHeight / 2,
          zPos,
        );
        group.add(top);
      }
    } else {
      const xPos = direction === "east" ? roomWidth / 2 : -roomWidth / 2;
      const sideLength = (roomLength - doorWidth) / 2;

      // Front segment
      if (sideLength > 0) {
        const frontGeom = new THREE.BoxGeometry(
          wallThickness,
          roomHeight,
          sideLength,
        );
        const front = new THREE.Mesh(frontGeom, material);
        front.position.set(xPos, 0, -roomLength / 2 + sideLength / 2);
        group.add(front);
      }

      // Back segment
      if (sideLength > 0) {
        const backGeom = new THREE.BoxGeometry(
          wallThickness,
          roomHeight,
          sideLength,
        );
        const back = new THREE.Mesh(backGeom, material);
        back.position.set(xPos, 0, roomLength / 2 - sideLength / 2);
        group.add(back);
      }

      // Top segment (above door)
      const topHeight = roomHeight - doorHeight;
      if (topHeight > 0) {
        const topGeom = new THREE.BoxGeometry(
          wallThickness,
          topHeight,
          doorWidth,
        );
        const top = new THREE.Mesh(topGeom, material);
        top.position.set(
          xPos,
          doorHeight / 2 + topHeight / 2 - roomHeight / 2 + doorHeight / 2,
          0,
        );
        group.add(top);
      }
    }
  }

  removeArea(areaId: string): void {
    const areaGroup = this.scene.getObjectByName(`area-${areaId}`);
    if (areaGroup) {
      this.scene.remove(areaGroup);
      this.renderedAreas.delete(areaId);
    }
  }

  clear(): void {
    for (const areaId of this.renderedAreas) {
      this.removeArea(areaId);
    }
  }
}
