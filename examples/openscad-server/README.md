# OpenSCAD MCP App Server

A 3D modeling MCP App Server that renders OpenSCAD code using WebAssembly and Three.js.

## Features

- **WebAssembly Compilation**: Uses [openscad-wasm](https://github.com/openscad/openscad-wasm) to compile OpenSCAD code in the browser
- **3D Rendering**: Renders STL output with Three.js and OrbitControls for interaction
- **Streaming Preview**: Shows code as it streams from the LLM
- **Fast Rendering**: Uses the Manifold backend for optimized compilation

## Tools

### `show_openscad_model`

Renders a 3D model from OpenSCAD code.

**Parameters:**

- `code` (string): OpenSCAD code to compile and render
- `height` (number, optional): Height of the viewer in pixels (default: 500)

### `learn_openscad`

Returns documentation and examples for using OpenSCAD.

## Running the Server

### HTTP Mode (default)

```bash
npm run start
# Server will be available at http://localhost:3120/mcp
```

### Stdio Mode

```bash
npm run start:stdio
```

### Development Mode

```bash
npm run dev
```

## MCP Client Configuration

### Claude Desktop

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "openscad": {
      "url": "http://localhost:3120/mcp"
    }
  }
}
```

## Example Usage

Ask Claude to create 3D models:

- "Create a parametric gear with 20 teeth"
- "Design a simple box with a hinged lid"
- "Make a spiral vase using rotate_extrude"
- "Create a chess pawn piece"

## OpenSCAD Quick Reference

### Basic Shapes

```openscad
cube([10, 20, 30]);           // Box
sphere(r = 10);                // Sphere
cylinder(h = 20, r = 5);       // Cylinder
```

### Transformations

```openscad
translate([x, y, z]) object();
rotate([rx, ry, rz]) object();
scale([sx, sy, sz]) object();
```

### Boolean Operations

```openscad
union() { a(); b(); }          // Combine
difference() { a(); b(); }     // Subtract b from a
intersection() { a(); b(); }   // Overlap only
```

### Modules

```openscad
module my_shape(size = 10) {
    cube([size, size, size]);
}
my_shape(size = 20);
```

## Credits

- [OpenSCAD](https://openscad.org/) - The original 3D CAD modeler
- [openscad-wasm](https://github.com/openscad/openscad-wasm) - WebAssembly port by @DSchroer
- [Three.js](https://threejs.org/) - 3D rendering library
