/**
 * OpenSCAD MCP Server
 *
 * Provides tools for rendering 3D models from OpenSCAD code using WebAssembly.
 */
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// Default code example for the OpenSCAD widget
const DEFAULT_OPENSCAD_CODE = `// A simple parametric gear
$fn = 50;

module gear(teeth = 12, module_size = 2, thickness = 5) {
    pitch_radius = module_size * teeth / 2;
    addendum = module_size;
    dedendum = module_size * 1.25;
    outer_radius = pitch_radius + addendum;
    inner_radius = pitch_radius - dedendum;

    difference() {
        // Main gear body
        linear_extrude(height = thickness) {
            difference() {
                circle(r = outer_radius);
                circle(r = inner_radius * 0.4); // Center hole
            }
        }

        // Gear teeth cutouts (simplified)
        for (i = [0:teeth-1]) {
            rotate([0, 0, i * 360 / teeth])
            translate([pitch_radius, 0, -1])
            cylinder(h = thickness + 2, r = module_size * 0.8);
        }
    }
}

// Render gear
gear(teeth = 16, module_size = 2, thickness = 6);`;

const OPENSCAD_DOCUMENTATION = `# OpenSCAD Widget Documentation

## Overview
This widget compiles OpenSCAD code to 3D models using WebAssembly and renders them with Three.js.

## OpenSCAD Basics

### Primitive Shapes
\`\`\`openscad
cube([10, 20, 30]);           // Box with dimensions
sphere(r = 10);                // Sphere with radius
cylinder(h = 20, r = 5);       // Cylinder
cylinder(h = 20, r1 = 10, r2 = 5);  // Cone
\`\`\`

### Transformations
\`\`\`openscad
translate([x, y, z]) object();
rotate([x_deg, y_deg, z_deg]) object();
scale([x, y, z]) object();
mirror([1, 0, 0]) object();   // Mirror across YZ plane
\`\`\`

### Boolean Operations
\`\`\`openscad
union() { obj1(); obj2(); }        // Combine shapes
difference() { obj1(); obj2(); }   // Subtract obj2 from obj1
intersection() { obj1(); obj2(); } // Keep overlapping parts
\`\`\`

### Extrusion
\`\`\`openscad
linear_extrude(height = 10) circle(r = 5);
rotate_extrude() polygon([[0,0], [10,0], [10,5], [0,5]]);
\`\`\`

### Modules (Functions)
\`\`\`openscad
module my_shape(size = 10) {
    cube([size, size, size]);
}
my_shape(size = 20);
\`\`\`

### Special Variables
- \`$fn\` - Number of fragments for circles/spheres (higher = smoother)
- \`$fa\` - Minimum angle for fragments
- \`$fs\` - Minimum size of fragments

## Example: Parametric Box with Lid
\`\`\`openscad
$fn = 30;

module box(width, depth, height, wall = 2) {
    difference() {
        cube([width, depth, height]);
        translate([wall, wall, wall])
            cube([width - 2*wall, depth - 2*wall, height]);
    }
}

module lid(width, depth, lip = 3, wall = 2) {
    union() {
        cube([width, depth, wall]);
        translate([wall, wall, wall])
            cube([width - 2*wall, depth - 2*wall, lip]);
    }
}

// Main box
box(40, 30, 25);

// Lid (offset to the side)
translate([50, 0, 0])
    lid(40, 30);
\`\`\`

## Tips
- Use \`$fn = 50\` or higher for smooth curves
- Keep models centered at origin for best viewing
- Use \`echo()\` to debug values
- The Manifold backend is used for fast rendering
`;

const resourceUri = "ui://openscad/mcp-app.html";

// =============================================================================
// Server Setup
// =============================================================================

/**
 * Creates a new MCP server instance with tools and resources registered.
 * Each HTTP session needs its own server instance because McpServer only supports one transport.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "OpenSCAD Server",
    version: "1.0.0",
  });

  // Tool 1: show_openscad_model
  registerAppTool(
    server,
    "show_openscad_model",
    {
      title: "Show OpenSCAD Model",
      description:
        "Render a 3D model from OpenSCAD code. The code is compiled to STL using WebAssembly and rendered with Three.js. Supports full OpenSCAD syntax including modules, boolean operations, and transformations.",
      inputSchema: {
        code: z
          .string()
          .default(DEFAULT_OPENSCAD_CODE)
          .describe("OpenSCAD code to compile and render"),
        height: z
          .number()
          .int()
          .positive()
          .default(500)
          .describe("Height in pixels"),
      },
      outputSchema: z.object({
        success: z.boolean(),
      }),
      _meta: { ui: { resourceUri } },
    },
    async () => {
      return {
        content: [{ type: "text", text: "OpenSCAD model rendered" }],
        structuredContent: { success: true },
      };
    },
  );

  // Tool 2: learn_openscad (not a UI tool, just returns documentation)
  server.registerTool(
    "learn_openscad",
    {
      title: "Learn OpenSCAD",
      description:
        "Get documentation and examples for using the OpenSCAD widget",
      inputSchema: {},
    },
    async () => {
      return {
        content: [{ type: "text", text: OPENSCAD_DOCUMENTATION }],
      };
    },
  );

  // Resource registration
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE, description: "OpenSCAD Widget UI" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );

      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    },
  );

  return server;
}
