/**
 * p5.js sketch renderer MCP App
 */
import {
  App,
  type McpUiHostContext,
  applyHostStyleVariables,
  applyDocumentTheme,
} from "@modelcontextprotocol/ext-apps";
import p5 from "p5";
import "./global.css";
import "./mcp-app.css";

interface SketchInput {
  sketch: string;
}

function isSketchInput(value: unknown): value is SketchInput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).sketch === "string"
  );
}

const log = {
  info: console.log.bind(console, "[APP]"),
  warn: console.warn.bind(console, "[APP]"),
  error: console.error.bind(console, "[APP]"),
};

// Get element references
const mainEl = document.querySelector(".main") as HTMLElement;
const sketchContainer = document.getElementById(
  "sketch-container",
) as HTMLElement;
const codePreview = document.getElementById("code-preview") as HTMLPreElement;
const fullscreenBtn = document.getElementById(
  "fullscreen-btn",
) as HTMLButtonElement;

// Display mode state
let currentDisplayMode: "inline" | "fullscreen" = "inline";

// p5.js instance
let p5Instance: p5 | null = null;
let isVisible = true;

// Handle host context changes (display mode, styling)
function handleHostContextChanged(ctx: McpUiHostContext) {
  // Apply host styling
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);

  // Show fullscreen button if available (only update if field is present)
  if (ctx.availableDisplayModes !== undefined) {
    if (ctx.availableDisplayModes.includes("fullscreen")) {
      fullscreenBtn.classList.add("available");
    } else {
      fullscreenBtn.classList.remove("available");
    }
  }

  // Update display mode state and UI
  if (ctx.displayMode) {
    currentDisplayMode = ctx.displayMode as "inline" | "fullscreen";
    if (currentDisplayMode === "fullscreen") {
      mainEl.classList.add("fullscreen");
    } else {
      mainEl.classList.remove("fullscreen");
    }
    // Trigger resize to update canvas
    if (p5Instance) {
      p5Instance.windowResized?.();
    }
  }
}

// Handle Escape key to exit fullscreen
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && currentDisplayMode === "fullscreen") {
    toggleFullscreen();
  }
});

// Toggle fullscreen mode
async function toggleFullscreen() {
  const newMode = currentDisplayMode === "fullscreen" ? "inline" : "fullscreen";
  try {
    const result = await app.requestDisplayMode({ mode: newMode });
    currentDisplayMode = result.mode as "inline" | "fullscreen";
    if (currentDisplayMode === "fullscreen") {
      mainEl.classList.add("fullscreen");
    } else {
      mainEl.classList.remove("fullscreen");
    }
    // Trigger resize to update canvas
    if (p5Instance) {
      p5Instance.windowResized?.();
    }
  } catch (err) {
    log.error("Failed to change display mode:", err);
  }
}

fullscreenBtn.addEventListener("click", toggleFullscreen);

/**
 * Creates a p5.js sketch from user code.
 * Wraps the code in a function that returns a p5 instance mode sketch.
 */
function createSketch(sketchCode: string): (p: p5) => void {
  return (p: p5) => {
    // Cast to any to access all p5 properties dynamically
    const _p = p as unknown as Record<string, unknown>;

    // Helper to safely bind a method
    const bind = (name: string) => {
      const fn = _p[name];
      return typeof fn === "function" ? fn.bind(p) : fn;
    };

    // Create wrapper with all p5 methods and properties
    const createWrapper = () => {
      // Methods - bind to p5 instance
      const methods = [
        "background", "clear", "colorMode", "fill", "noFill", "noStroke", "stroke", "strokeWeight",
        "arc", "ellipse", "circle", "line", "point", "quad", "rect", "square", "triangle",
        "ellipseMode", "rectMode", "strokeCap", "strokeJoin",
        "bezier", "bezierDetail", "bezierPoint", "bezierTangent",
        "curve", "curveDetail", "curvePoint", "curveTangent", "curveTightness",
        "beginContour", "beginShape", "bezierVertex", "curveVertex", "endContour", "endShape", "quadraticVertex", "vertex",
        "plane", "box", "sphere", "cylinder", "cone", "ellipsoid", "torus", "orbitControl", "debugMode", "noDebugMode",
        "ambientLight", "directionalLight", "pointLight", "lights", "lightFalloff", "spotLight", "noLights",
        "camera", "perspective", "ortho", "frustum", "createCamera", "setCamera",
        "applyMatrix", "resetMatrix", "rotate", "rotateX", "rotateY", "rotateZ", "scale", "shearX", "shearY", "translate",
        "textAlign", "textLeading", "textSize", "textStyle", "textWidth", "textAscent", "textDescent", "textWrap", "textFont", "text", "loadFont",
        "createImage", "saveCanvas", "saveFrames", "image", "imageMode", "tint", "noTint", "loadImage",
        "blend", "copy", "filter", "get", "set", "loadPixels", "updatePixels",
        "constrain", "dist", "lerp", "mag", "map", "norm", "sq", "fract",
        "random", "randomSeed", "randomGaussian", "noise", "noiseDetail", "noiseSeed", "createVector",
        "degrees", "radians", "angleMode",
        "color", "alpha", "blue", "brightness", "green", "hue", "lerpColor", "lightness", "red", "saturation",
        "push", "pop", "loop", "noLoop", "isLooping", "redraw",
        "createCanvas", "resizeCanvas", "createGraphics", "blendMode",
        "frameRate", "cursor", "noCursor", "fullscreen", "pixelDensity", "displayDensity",
        "getURL", "getURLPath", "getURLParams",
        "millis", "second", "minute", "hour", "day", "month", "year",
        "createStringDict", "createNumberDict",
        "append", "arrayCopy", "concat", "reverse", "shorten", "shuffle", "sort", "splice", "subset",
        "float", "int", "str", "boolean", "byte", "char", "unchar", "hex", "unhex",
        "join", "match", "matchAll", "nf", "nfc", "nfp", "nfs", "split", "splitTokens", "trim",
        "select", "selectAll", "removeElements",
        "createDiv", "createP", "createSpan", "createImg", "createA", "createSlider", "createButton",
        "createCheckbox", "createSelect", "createRadio", "createColorPicker", "createInput", "createFileInput",
        "createVideo", "createAudio", "createCapture", "createElement"
      ];

      const boundMethods: Record<string, unknown> = {};
      for (const name of methods) {
        boundMethods[name] = bind(name);
      }

      // Add Math functions that p5 also provides
      boundMethods.abs = Math.abs;
      boundMethods.ceil = Math.ceil;
      boundMethods.floor = Math.floor;
      boundMethods.round = Math.round;
      boundMethods.sqrt = Math.sqrt;
      boundMethods.pow = Math.pow;
      boundMethods.min = Math.min;
      boundMethods.max = Math.max;
      boundMethods.exp = Math.exp;
      boundMethods.log = Math.log;
      boundMethods.sin = Math.sin;
      boundMethods.cos = Math.cos;
      boundMethods.tan = Math.tan;
      boundMethods.asin = Math.asin;
      boundMethods.acos = Math.acos;
      boundMethods.atan = Math.atan;
      boundMethods.atan2 = Math.atan2;

      // Constants
      const constants = [
        "PI", "TWO_PI", "HALF_PI", "QUARTER_PI", "TAU",
        "CENTER", "LEFT", "RIGHT", "TOP", "BOTTOM", "BASELINE",
        "CORNER", "CORNERS", "RADIUS",
        "CLOSE", "OPEN", "CHORD", "PIE",
        "SQUARE", "ROUND", "PROJECT", "MITER", "BEVEL",
        "RGB", "HSB", "HSL", "WEBGL", "P2D",
        "POINTS", "LINES", "TRIANGLES", "TRIANGLE_FAN", "TRIANGLE_STRIP", "QUADS", "QUAD_STRIP",
        "BLEND", "ADD", "DARKEST", "LIGHTEST", "DIFFERENCE", "EXCLUSION", "MULTIPLY", "SCREEN",
        "REPLACE", "OVERLAY", "HARD_LIGHT", "SOFT_LIGHT", "DODGE", "BURN",
        "ARROW", "CROSS", "HAND", "MOVE", "TEXT", "WAIT",
        "LEFT_ARROW", "RIGHT_ARROW", "UP_ARROW", "DOWN_ARROW",
        "ENTER", "RETURN", "ESCAPE", "BACKSPACE", "DELETE", "TAB", "SHIFT", "CONTROL", "OPTION", "ALT"
      ];

      for (const name of constants) {
        boundMethods[name] = _p[name];
      }

      // Dynamic properties - use getters
      boundMethods.ctx = {
        get mouseX() { return _p.mouseX; },
        get mouseY() { return _p.mouseY; },
        get pmouseX() { return _p.pmouseX; },
        get pmouseY() { return _p.pmouseY; },
        get winMouseX() { return _p.winMouseX; },
        get winMouseY() { return _p.winMouseY; },
        get pwinMouseX() { return _p.pwinMouseX; },
        get pwinMouseY() { return _p.pwinMouseY; },
        get mouseButton() { return _p.mouseButton; },
        get mouseIsPressed() { return _p.mouseIsPressed; },
        get movedX() { return _p.movedX; },
        get movedY() { return _p.movedY; },
        get key() { return _p.key; },
        get keyCode() { return _p.keyCode; },
        get keyIsPressed() { return _p.keyIsPressed; },
        get touches() { return _p.touches; },
        get frameCount() { return _p.frameCount; },
        get deltaTime() { return _p.deltaTime; },
        get focused() { return _p.focused; },
        get windowWidth() { return _p.windowWidth; },
        get windowHeight() { return _p.windowHeight; },
        get width() { return _p.width; },
        get height() { return _p.height; },
        get displayWidth() { return _p.displayWidth; },
        get displayHeight() { return _p.displayHeight; },
        get pixels() { return _p.pixels; },
      };

      return boundMethods;
    };

    try {
      const wrapper = createWrapper();

      // Build the function body with all bindings
      // Define dynamic properties on globalThis (safe in iframe sandbox)
      const fnBody = `
        const {
          background, clear, colorMode, fill, noFill, noStroke, stroke, strokeWeight,
          arc, ellipse, circle, line, point, quad, rect, square, triangle,
          ellipseMode, rectMode, strokeCap, strokeJoin,
          bezier, curve, beginContour, beginShape, bezierVertex, curveVertex, endContour, endShape, quadraticVertex, vertex,
          plane, box, sphere, cylinder, cone, ellipsoid, torus, orbitControl,
          ambientLight, directionalLight, pointLight, lights, spotLight, noLights,
          camera, perspective, ortho, applyMatrix, resetMatrix, rotate, rotateX, rotateY, rotateZ, scale, shearX, shearY, translate,
          textAlign, textSize, textFont, text, textWidth, loadFont,
          createImage, image, imageMode, tint, noTint, loadImage,
          loadPixels, updatePixels, get, set,
          abs, ceil, floor, round, sqrt, pow, min, max, exp, log, sin, cos, tan, asin, acos, atan, atan2,
          constrain, dist, lerp, mag, map, norm, sq,
          random, randomSeed, randomGaussian, noise, noiseDetail, noiseSeed, createVector, degrees, radians, angleMode,
          color, alpha, blue, brightness, green, hue, lerpColor, lightness, red, saturation,
          push, pop, loop, noLoop, redraw,
          createCanvas, resizeCanvas, createGraphics, blendMode,
          frameRate, cursor, noCursor, millis, second, minute, hour, day, month, year,
          PI, TWO_PI, HALF_PI, QUARTER_PI, TAU,
          CENTER, LEFT, RIGHT, TOP, BOTTOM, BASELINE, CORNER, CORNERS, RADIUS,
          CLOSE, OPEN, CHORD, PIE, SQUARE, ROUND, PROJECT, MITER, BEVEL,
          RGB, HSB, HSL, WEBGL, P2D,
          POINTS, LINES, TRIANGLES, TRIANGLE_FAN, TRIANGLE_STRIP, QUADS, QUAD_STRIP,
          BLEND, ADD, DARKEST, LIGHTEST, DIFFERENCE, EXCLUSION, MULTIPLY, SCREEN, REPLACE, OVERLAY, HARD_LIGHT, SOFT_LIGHT, DODGE, BURN,
          LEFT_ARROW, RIGHT_ARROW, UP_ARROW, DOWN_ARROW, ENTER, RETURN, ESCAPE, BACKSPACE, DELETE, TAB, SHIFT, CONTROL, OPTION, ALT,
          ctx
        } = __wrapper__;

        // Define dynamic properties as getters on globalThis
        // This makes them available as global variables in the sketch
        const __dynamicProps__ = [
          'mouseX', 'mouseY', 'pmouseX', 'pmouseY', 'winMouseX', 'winMouseY',
          'pwinMouseX', 'pwinMouseY', 'movedX', 'movedY',
          'mouseButton', 'mouseIsPressed', 'key', 'keyCode', 'keyIsPressed',
          'touches', 'frameCount', 'deltaTime', 'focused',
          'windowWidth', 'windowHeight', 'width', 'height',
          'displayWidth', 'displayHeight', 'pixels'
        ];

        __dynamicProps__.forEach(prop => {
          Object.defineProperty(globalThis, prop, {
            get: () => ctx[prop],
            configurable: true,
            enumerable: false
          });
        });

        // User's sketch code
        ${sketchCode}

        // Return functions that were defined
        return {
          preload: typeof preload === 'function' ? preload : undefined,
          setup: typeof setup === 'function' ? setup : undefined,
          draw: typeof draw === 'function' ? draw : undefined,
          mousePressed: typeof mousePressed === 'function' ? mousePressed : undefined,
          mouseReleased: typeof mouseReleased === 'function' ? mouseReleased : undefined,
          mouseClicked: typeof mouseClicked === 'function' ? mouseClicked : undefined,
          mouseMoved: typeof mouseMoved === 'function' ? mouseMoved : undefined,
          mouseDragged: typeof mouseDragged === 'function' ? mouseDragged : undefined,
          mouseWheel: typeof mouseWheel === 'function' ? mouseWheel : undefined,
          keyPressed: typeof keyPressed === 'function' ? keyPressed : undefined,
          keyReleased: typeof keyReleased === 'function' ? keyReleased : undefined,
          keyTyped: typeof keyTyped === 'function' ? keyTyped : undefined,
          touchStarted: typeof touchStarted === 'function' ? touchStarted : undefined,
          touchMoved: typeof touchMoved === 'function' ? touchMoved : undefined,
          touchEnded: typeof touchEnded === 'function' ? touchEnded : undefined,
          windowResized: typeof windowResized === 'function' ? windowResized : undefined
        };
      `;

      const sketchFn = new Function("__wrapper__", fnBody);
      const fns = sketchFn.call({}, wrapper);

      // Bind the p5 functions from user code
      if (fns.preload) p.preload = fns.preload.bind(p);
      if (fns.setup) p.setup = fns.setup.bind(p);
      if (fns.draw) {
        const userDraw = fns.draw.bind(p);
        p.draw = () => {
          if (isVisible) {
            userDraw();
          }
        };
      }
      if (fns.mousePressed) p.mousePressed = fns.mousePressed.bind(p);
      if (fns.mouseReleased) p.mouseReleased = fns.mouseReleased.bind(p);
      if (fns.mouseClicked) p.mouseClicked = fns.mouseClicked.bind(p);
      if (fns.mouseMoved) p.mouseMoved = fns.mouseMoved.bind(p);
      if (fns.mouseDragged) p.mouseDragged = fns.mouseDragged.bind(p);
      if (fns.mouseWheel) p.mouseWheel = fns.mouseWheel.bind(p);
      if (fns.keyPressed) p.keyPressed = fns.keyPressed.bind(p);
      if (fns.keyReleased) p.keyReleased = fns.keyReleased.bind(p);
      if (fns.keyTyped) p.keyTyped = fns.keyTyped.bind(p);
      if (fns.touchStarted) p.touchStarted = fns.touchStarted.bind(p);
      if (fns.touchMoved) p.touchMoved = fns.touchMoved.bind(p);
      if (fns.touchEnded) p.touchEnded = fns.touchEnded.bind(p);
      if (fns.windowResized) p.windowResized = fns.windowResized.bind(p);
    } catch (err) {
      log.error("Error creating sketch:", err);
      // Show error on canvas
      p.setup = () => {
        p.createCanvas(400, 200);
        p.background(40);
        p.fill(255, 100, 100);
        p.textSize(14);
        p.textAlign(p.CENTER, p.CENTER);
        p.text(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
          p.width / 2,
          p.height / 2,
        );
      };
    }
  };
}

// Create app instance
const app = new App({ name: "p5.js Renderer", version: "1.0.0" });

app.onteardown = async () => {
  log.info("App is being torn down");
  if (p5Instance) {
    p5Instance.remove();
    p5Instance = null;
  }
  return {};
};

app.ontoolinputpartial = (params) => {
  // Show code preview, hide sketch
  codePreview.classList.add("visible");
  sketchContainer.classList.add("hidden");
  const code = params.arguments?.sketch;
  codePreview.textContent = typeof code === "string" ? code : "";
  codePreview.scrollTop = codePreview.scrollHeight;
};

app.ontoolinput = (params) => {
  log.info("Received sketch input");

  // Hide code preview, show sketch container
  codePreview.classList.remove("visible");
  sketchContainer.classList.remove("hidden");

  if (!isSketchInput(params.arguments)) {
    log.error("Invalid tool input");
    return;
  }

  const { sketch } = params.arguments;

  // Remove previous p5 instance if exists
  if (p5Instance) {
    p5Instance.remove();
    p5Instance = null;
  }

  // Clear the container
  sketchContainer.innerHTML = "";

  // Create new p5 instance
  try {
    p5Instance = new p5(createSketch(sketch), sketchContainer);
    log.info("Sketch created successfully");
  } catch (err) {
    log.error("Failed to create sketch:", err);
  }
};

app.onerror = log.error;

app.onhostcontextchanged = handleHostContextChanged;

// Pause/resume sketch based on visibility
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    isVisible = entry.isIntersecting;
    if (p5Instance) {
      if (isVisible) {
        p5Instance.loop();
      } else {
        p5Instance.noLoop();
      }
    }
  });
});
observer.observe(mainEl);

// Connect to host
app.connect().then(() => {
  log.info("Connected to host");
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
