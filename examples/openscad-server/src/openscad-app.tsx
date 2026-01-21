/**
 * OpenSCAD App Component
 *
 * Compiles OpenSCAD code to STL using WebAssembly and renders with Three.js.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { WidgetProps } from "./mcp-app-wrapper.tsx";

// =============================================================================
// Types
// =============================================================================

interface OpenSCADToolInput {
  code?: string;
  height?: number;
}

type OpenSCADAppProps = WidgetProps<OpenSCADToolInput>;

interface OpenSCADInstance {
  FS: {
    writeFile: (path: string, data: string | Uint8Array) => void;
    readFile: (path: string, opts?: { encoding?: string }) => Uint8Array;
    unlink: (path: string) => void;
  };
  callMain: (args: string[]) => number;
}

type OpenSCADFactory = (options: {
  noInitialRun: boolean;
}) => Promise<OpenSCADInstance>;

// =============================================================================
// Constants
// =============================================================================

// OpenSCAD WASM from official releases via jsDelivr
const OPENSCAD_WASM_URL =
  "https://cdn.jsdelivr.net/gh/openscad/openscad-wasm@main/dist/openscad.js";

// Default demo code shown when no code is provided
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

// =============================================================================
// OpenSCAD WASM Loading
// =============================================================================

let openscadPromise: Promise<OpenSCADFactory> | null = null;

async function loadOpenSCAD(): Promise<OpenSCADFactory> {
  if (openscadPromise) return openscadPromise;

  openscadPromise = (async () => {
    // Dynamically load the OpenSCAD WASM module
    const script = document.createElement("script");
    script.src = OPENSCAD_WASM_URL;
    script.async = true;

    await new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load OpenSCAD WASM"));
      document.head.appendChild(script);
    });

    // The script exposes OpenSCAD as a global
    const OpenSCAD = (window as unknown as { OpenSCAD: OpenSCADFactory })
      .OpenSCAD;
    if (!OpenSCAD) {
      throw new Error("OpenSCAD not found after loading script");
    }

    return OpenSCAD;
  })();

  return openscadPromise;
}

async function compileOpenSCAD(code: string): Promise<Uint8Array> {
  const OpenSCAD = await loadOpenSCAD();
  const instance = await OpenSCAD({ noInitialRun: true });

  // Write the input file
  instance.FS.writeFile("/input.scad", code);

  // Compile to STL with Manifold backend for speed
  const exitCode = instance.callMain([
    "/input.scad",
    "-o",
    "/output.stl",
    "--enable=manifold",
  ]);

  if (exitCode !== 0) {
    throw new Error(`OpenSCAD compilation failed with exit code ${exitCode}`);
  }

  // Read the output STL
  const stlData = instance.FS.readFile("/output.stl");

  // Cleanup
  try {
    instance.FS.unlink("/input.scad");
    instance.FS.unlink("/output.stl");
  } catch {
    // Ignore cleanup errors
  }

  return stlData;
}

// =============================================================================
// Streaming Preview
// =============================================================================

function LoadingShimmer({ height, code }: { height: number; code?: string }) {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [code]);

  return (
    <div
      style={{
        width: "100%",
        height,
        borderRadius: "var(--border-radius-lg, 8px)",
        padding: 16,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, var(--color-background-secondary, light-dark(#f0f0f5, #2a2a3c)) 0%, var(--color-background-tertiary, light-dark(#e5e5ed, #1e1e2e)) 100%)",
      }}
    >
      <div
        style={{
          color: "var(--color-text-tertiary, light-dark(#666, #888))",
          fontFamily: "var(--font-sans, system-ui)",
          fontSize: 12,
          marginBottom: 8,
        }}
      >
        OpenSCAD
      </div>
      {code && (
        <pre
          ref={preRef}
          style={{
            margin: 0,
            padding: 0,
            flex: 1,
            overflow: "auto",
            color: "var(--color-text-ghost, light-dark(#777, #aaa))",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "var(--font-text-xs-size, 11px)",
            lineHeight: "var(--font-text-xs-line-height, 1.4)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {code}
        </pre>
      )}
    </div>
  );
}

// =============================================================================
// Three.js Rendering
// =============================================================================

interface ThreeContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  mesh: THREE.Mesh | null;
  animationId: number | null;
}

function createThreeContext(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): ThreeContext {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
  camera.position.set(50, 50, 50);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(50, 50, 50);
  scene.add(directionalLight);

  const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
  fillLight.position.set(-50, 0, -50);
  scene.add(fillLight);

  return {
    scene,
    camera,
    renderer,
    controls,
    mesh: null,
    animationId: null,
  };
}

function loadSTLGeometry(stlData: Uint8Array): THREE.BufferGeometry {
  const loader = new STLLoader();
  // Create a copy of the buffer to ensure it's a proper ArrayBuffer
  const buffer = stlData.buffer.slice(
    stlData.byteOffset,
    stlData.byteOffset + stlData.byteLength,
  ) as ArrayBuffer;
  const geometry = loader.parse(buffer);
  geometry.computeVertexNormals();
  return geometry;
}

function centerAndScaleModel(
  geometry: THREE.BufferGeometry,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): THREE.Mesh {
  // Center the geometry
  geometry.computeBoundingBox();
  const boundingBox = geometry.boundingBox!;
  const center = new THREE.Vector3();
  boundingBox.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  // Create mesh with nice material
  const material = new THREE.MeshStandardMaterial({
    color: 0x00cc66,
    metalness: 0.3,
    roughness: 0.6,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geometry, material);

  // Calculate size for camera positioning
  const size = new THREE.Vector3();
  boundingBox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const fitOffset = 1.5;
  const distance =
    (maxDim * fitOffset) / Math.tan((camera.fov * Math.PI) / 360);

  camera.position.set(distance * 0.7, distance * 0.7, distance * 0.7);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();

  return mesh;
}

// =============================================================================
// Main Component
// =============================================================================

export default function OpenSCADApp({
  toolInputs,
  toolInputsPartial,
  toolResult: _toolResult,
  hostContext,
  callServerTool: _callServerTool,
  sendMessage: _sendMessage,
  openLink: _openLink,
  sendLog,
}: OpenSCADAppProps) {
  const [compileError, setCompileError] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compiledCode, setCompiledCode] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const threeContextRef = useRef<ThreeContext | null>(null);

  const height = toolInputs?.height ?? toolInputsPartial?.height ?? 500;
  const code = toolInputs?.code || DEFAULT_OPENSCAD_CODE;
  const partialCode = toolInputsPartial?.code;
  const isStreaming = !toolInputs && !!toolInputsPartial;

  const safeAreaInsets = hostContext?.safeAreaInsets;
  const containerStyle = {
    paddingTop: safeAreaInsets?.top,
    paddingRight: safeAreaInsets?.right,
    paddingBottom: safeAreaInsets?.bottom,
    paddingLeft: safeAreaInsets?.left,
  };

  // Animation loop
  const animate = useCallback(() => {
    const ctx = threeContextRef.current;
    if (!ctx) return;

    ctx.controls.update();
    ctx.renderer.render(ctx.scene, ctx.camera);
    ctx.animationId = requestAnimationFrame(animate);
  }, []);

  // Cleanup Three.js context
  const cleanup = useCallback(() => {
    const ctx = threeContextRef.current;
    if (!ctx) return;

    if (ctx.animationId !== null) {
      cancelAnimationFrame(ctx.animationId);
    }
    if (ctx.mesh) {
      ctx.scene.remove(ctx.mesh);
      ctx.mesh.geometry.dispose();
      (ctx.mesh.material as THREE.Material).dispose();
    }
    ctx.renderer.dispose();
    ctx.controls.dispose();
    threeContextRef.current = null;
  }, []);

  // Reset camera to default position
  const resetCamera = useCallback(() => {
    const ctx = threeContextRef.current;
    if (!ctx || !ctx.mesh) return;

    const geometry = ctx.mesh.geometry;
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox!;
    const size = new THREE.Vector3();
    boundingBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance =
      (maxDim * 1.5) / Math.tan((ctx.camera.fov * Math.PI) / 360);

    ctx.camera.position.set(distance * 0.7, distance * 0.7, distance * 0.7);
    ctx.camera.lookAt(0, 0, 0);
    ctx.controls.target.set(0, 0, 0);
    ctx.controls.update();
  }, []);

  // Compile and render
  useEffect(() => {
    if (!code || isStreaming) return;
    if (compiledCode === code) return; // Already compiled this code

    const compileAndRender = async () => {
      setIsCompiling(true);
      setCompileError(null);

      try {
        sendLog({ level: "info", data: "Compiling OpenSCAD code..." });

        const stlData = await compileOpenSCAD(code);

        sendLog({
          level: "info",
          data: "Compilation successful, rendering...",
        });

        // Setup Three.js if needed
        if (!canvasRef.current || !containerRef.current) return;

        cleanup();

        const width = containerRef.current.offsetWidth || 800;
        const ctx = createThreeContext(canvasRef.current, width, height);
        threeContextRef.current = ctx;

        // Load and display the STL
        const geometry = loadSTLGeometry(stlData);
        const mesh = centerAndScaleModel(geometry, ctx.camera, ctx.controls);
        ctx.mesh = mesh;
        ctx.scene.add(mesh);

        // Start animation
        animate();

        setCompiledCode(code);
        sendLog({ level: "info", data: "Rendering complete" });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        setCompileError(errorMessage);
        sendLog({
          level: "error",
          data: `Compilation failed: ${errorMessage}`,
        });
      } finally {
        setIsCompiling(false);
      }
    };

    compileAndRender();

    return cleanup;
  }, [code, isStreaming, compiledCode, height, cleanup, animate, sendLog]);

  // Handle resize
  useEffect(() => {
    const ctx = threeContextRef.current;
    if (!ctx || !containerRef.current) return;

    const handleResize = () => {
      const width = containerRef.current!.offsetWidth;
      ctx.camera.aspect = width / height;
      ctx.camera.updateProjectionMatrix();
      ctx.renderer.setSize(width, height);
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [height]);

  // Visibility-based pause/play
  useEffect(() => {
    if (!containerRef.current) return;

    let isVisible = true;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        isVisible = entry.isIntersecting;
        const ctx = threeContextRef.current;
        if (ctx) {
          if (isVisible && ctx.animationId === null) {
            animate();
          } else if (!isVisible && ctx.animationId !== null) {
            cancelAnimationFrame(ctx.animationId);
            ctx.animationId = null;
          }
        }
      });
    });
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [animate]);

  if (isStreaming || !code) {
    return (
      <div style={containerStyle}>
        <LoadingShimmer height={height} code={partialCode} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="openscad-container"
      style={containerStyle}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height,
          borderRadius: "var(--border-radius-lg, 8px)",
          display: "block",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        }}
      />

      {isCompiling && (
        <div className="compiling-overlay">
          <div className="spinner" />
          <div>Compiling OpenSCAD...</div>
        </div>
      )}

      {compileError && (
        <div className="error-overlay">
          <div style={{ fontWeight: "bold", marginBottom: 8 }}>
            Compilation Error
          </div>
          <div>{compileError}</div>
        </div>
      )}

      {!isCompiling && !compileError && compiledCode && (
        <div className="controls-overlay">
          <button className="control-button" onClick={resetCamera}>
            Reset View
          </button>
        </div>
      )}
    </div>
  );
}
