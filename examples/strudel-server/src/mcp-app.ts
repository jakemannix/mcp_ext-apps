/**
 * Strudel audio-reactive shader MCP App
 * Combines Strudel live coding with WebGL visualization
 */
import {
  App,
  type McpUiHostContext,
  applyHostStyleVariables,
  applyDocumentTheme,
} from "@modelcontextprotocol/ext-apps";
import "./global.css";
import "./mcp-app.css";

// ─── Types ───
interface StrudelInput {
  strudel_source: string;
  shader_source: string;
  bpm: number;
}

interface AudioState {
  playing: boolean;
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  freqData: Uint8Array | null;
  timeData: Uint8Array | null;
  beat: number;
  beatFrac: number;
  amp: number;
  bass: number;
  mid: number;
  high: number;
  bpm: number;
  startTime: number;
}

interface ShaderUniforms {
  iTime: WebGLUniformLocation | null;
  iResolution: WebGLUniformLocation | null;
  iMouse: WebGLUniformLocation | null;
  iBeat: WebGLUniformLocation | null;
  iAmp: WebGLUniformLocation | null;
  iBass: WebGLUniformLocation | null;
  iMid: WebGLUniformLocation | null;
  iHigh: WebGLUniformLocation | null;
  iChannel0: WebGLUniformLocation | null;
}

// ─── Helpers ───
const log = {
  info: console.log.bind(console, "[APP]"),
  warn: console.warn.bind(console, "[APP]"),
  error: console.error.bind(console, "[APP]"),
};

// ─── State ───
const audioState: AudioState = {
  playing: false,
  audioCtx: null,
  analyser: null,
  freqData: null,
  timeData: null,
  beat: 0,
  beatFrac: 0,
  amp: 0,
  bass: 0,
  mid: 0,
  high: 0,
  bpm: 120,
  startTime: 0,
};

let currentInput: StrudelInput | null = null;
let currentDisplayMode: "inline" | "fullscreen" = "inline";

// Mouse state for iMouse uniform
let mouseX = 0,
  mouseY = 0,
  mouseDown = false;
let mouseClickX = 0,
  mouseClickY = 0;

// ─── DOM Elements ───
const canvas = document.getElementById("glCanvas") as HTMLCanvasElement;
const playBtn = document.getElementById("playBtn") as HTMLButtonElement;
const codePreview = document.getElementById("codePreview") as HTMLPreElement;
const codeOverlay = document.getElementById("codeOverlay") as HTMLPreElement;
const codeToggleBtn = document.getElementById(
  "codeToggleBtn",
) as HTMLButtonElement;
const copyCodeBtn = document.getElementById("copyCodeBtn") as HTMLButtonElement;
const copyShaderBtn = document.getElementById(
  "copyShaderBtn",
) as HTMLButtonElement;
const fullscreenBtn = document.getElementById(
  "fullscreenBtn",
) as HTMLButtonElement;
const metersBar = document.querySelector(".meters-bar") as HTMLElement;

// Code overlay toggle
codeToggleBtn.addEventListener("click", () => {
  codeOverlay.classList.toggle("visible");
  codeToggleBtn.classList.toggle("active");
});

// Copy to clipboard helper
async function copyToClipboard(
  text: string,
  btn: HTMLButtonElement,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add("copied");
    const label = btn.querySelector(".btn-label");
    const originalText = label?.textContent;
    if (label) label.textContent = "Copied!";
    setTimeout(() => {
      btn.classList.remove("copied");
      if (label && originalText) label.textContent = originalText;
    }, 1500);
  } catch (err) {
    log.error("Failed to copy:", err);
  }
}

// Copy buttons
copyCodeBtn.addEventListener("click", () => {
  if (currentInput?.strudel_source) {
    copyToClipboard(currentInput.strudel_source, copyCodeBtn);
  }
});

copyShaderBtn.addEventListener("click", () => {
  if (currentInput?.shader_source) {
    copyToClipboard(currentInput.shader_source, copyShaderBtn);
  }
});

// ─── WebGL Setup ───
const glContext = canvas.getContext("webgl2") || canvas.getContext("webgl");
if (!glContext) throw new Error("WebGL not supported");
const gl = glContext;

let program: WebGLProgram | null = null;
let uniforms: ShaderUniforms = {
  iTime: null,
  iResolution: null,
  iMouse: null,
  iBeat: null,
  iAmp: null,
  iBass: null,
  iMid: null,
  iHigh: null,
  iChannel0: null,
};
let fftTexture: WebGLTexture | null = null;
let fftTextureData: Uint8Array | null = null;
let startRenderTime = performance.now();

// Vertex shader (fullscreen quad)
const vertSrc = `
  attribute vec2 pos;
  void main() { gl_Position = vec4(pos, 0.0, 1.0); }
`;

// Create fullscreen quad
const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

// Wrap user shader in proper GLSL
function buildFragSrc(userCode: string): string {
  return `
    precision highp float;
    uniform float iTime;
    uniform vec3 iResolution;
    uniform vec4 iMouse;
    uniform float iBeat;
    uniform float iAmp;
    uniform float iBass;
    uniform float iMid;
    uniform float iHigh;
    uniform sampler2D iChannel0;

    ${userCode}

    void main() {
      vec4 color = vec4(0.0);
      mainImage(color, gl_FragCoord.xy);
      gl_FragColor = color;
    }
  `;
}

function compileShader(src: string, type: number): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    log.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function buildProgram(fragCode: string): boolean {
  const vs = compileShader(vertSrc, gl.VERTEX_SHADER);
  const fs = compileShader(buildFragSrc(fragCode), gl.FRAGMENT_SHADER);
  if (!vs || !fs) return false;

  const prog = gl.createProgram();
  if (!prog) return false;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    log.error("Shader link error:", gl.getProgramInfoLog(prog));
    return false;
  }

  if (program) gl.deleteProgram(program);
  program = prog;
  gl.useProgram(program);

  // Setup vertex attribute
  const posLoc = gl.getAttribLocation(program, "pos");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  // Get uniform locations
  uniforms = {
    iTime: gl.getUniformLocation(program, "iTime"),
    iResolution: gl.getUniformLocation(program, "iResolution"),
    iMouse: gl.getUniformLocation(program, "iMouse"),
    iBeat: gl.getUniformLocation(program, "iBeat"),
    iAmp: gl.getUniformLocation(program, "iAmp"),
    iBass: gl.getUniformLocation(program, "iBass"),
    iMid: gl.getUniformLocation(program, "iMid"),
    iHigh: gl.getUniformLocation(program, "iHigh"),
    iChannel0: gl.getUniformLocation(program, "iChannel0"),
  };

  return true;
}

// Create FFT texture (256x2: row 0 = frequency, row 1 = waveform)
function createFFTTexture(): void {
  fftTexture = gl.createTexture();
  fftTextureData = new Uint8Array(256 * 2);
  gl.bindTexture(gl.TEXTURE_2D, fftTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.LUMINANCE,
    256,
    2,
    0,
    gl.LUMINANCE,
    gl.UNSIGNED_BYTE,
    fftTextureData,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function updateFFTTexture(): void {
  if (
    !fftTexture ||
    !fftTextureData ||
    !audioState.freqData ||
    !audioState.timeData
  )
    return;

  // Copy frequency data to row 0
  const freqLen = Math.min(256, audioState.freqData.length);
  for (let i = 0; i < freqLen; i++) {
    fftTextureData[i] = audioState.freqData[i];
  }

  // Copy waveform data to row 1
  const timeLen = Math.min(256, audioState.timeData.length);
  for (let i = 0; i < timeLen; i++) {
    fftTextureData[256 + i] = audioState.timeData[i];
  }

  gl.bindTexture(gl.TEXTURE_2D, fftTexture);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    256,
    2,
    gl.LUMINANCE,
    gl.UNSIGNED_BYTE,
    fftTextureData,
  );
}

// ─── Canvas Resize ───
function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ─── Mouse tracking ───
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  mouseX = (e.clientX - rect.left) * dpr;
  mouseY = canvas.height - (e.clientY - rect.top) * dpr; // Flip Y for GL coords
});
canvas.addEventListener("mousedown", (e) => {
  mouseDown = true;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  mouseClickX = (e.clientX - rect.left) * dpr;
  mouseClickY = canvas.height - (e.clientY - rect.top) * dpr;
});
canvas.addEventListener("mouseup", () => {
  mouseDown = false;
});
canvas.addEventListener("mouseleave", () => {
  mouseDown = false;
});

// ─── Audio Analysis ───
function setupAudio(): AudioContext {
  if (audioState.audioCtx) return audioState.audioCtx;

  audioState.audioCtx = new (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext
  )();
  audioState.analyser = audioState.audioCtx.createAnalyser();
  audioState.analyser.fftSize = 512;
  audioState.analyser.smoothingTimeConstant = 0.7;

  const bufLen = audioState.analyser.frequencyBinCount;
  audioState.freqData = new Uint8Array(bufLen);
  audioState.timeData = new Uint8Array(bufLen);

  return audioState.audioCtx;
}

function analyzeAudio(): void {
  if (!audioState.analyser || !audioState.freqData || !audioState.timeData)
    return;

  // @ts-expect-error - Uint8Array type compatibility
  audioState.analyser.getByteFrequencyData(audioState.freqData);
  // @ts-expect-error - Uint8Array type compatibility
  audioState.analyser.getByteTimeDomainData(audioState.timeData);

  const bins = audioState.freqData.length;

  // Bass: bins 0-10 (~0-430Hz)
  let bassSum = 0;
  for (let i = 0; i < 10; i++) bassSum += audioState.freqData[i];
  audioState.bass = bassSum / (10 * 255);

  // Mid: bins 10-80 (~430-3400Hz)
  let midSum = 0;
  for (let i = 10; i < 80; i++) midSum += audioState.freqData[i];
  audioState.mid = midSum / (70 * 255);

  // High: bins 80+ (~3400Hz+)
  let highSum = 0;
  for (let i = 80; i < bins; i++) highSum += audioState.freqData[i];
  audioState.high = highSum / ((bins - 80) * 255);

  // Overall amplitude from time domain (RMS)
  let ampSum = 0;
  for (let i = 0; i < audioState.timeData.length; i++) {
    const v = (audioState.timeData[i] - 128) / 128;
    ampSum += v * v;
  }
  audioState.amp = Math.sqrt(ampSum / audioState.timeData.length);

  // Beat tracking from BPM
  if (audioState.playing) {
    const elapsed = (performance.now() - audioState.startTime) / 1000;
    const beatsPerSec = audioState.bpm / 60;
    audioState.beatFrac = (elapsed * beatsPerSec) % 1;
    audioState.beat = elapsed * beatsPerSec;
  }
}

// ─── Strudel Embed Integration ───
let embedLoaded = false;
let strudelReplElement: HTMLElement | null = null;

async function loadStrudelEmbed(): Promise<void> {
  if (embedLoaded) return;

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@strudel/embed@latest";
    script.onload = () => {
      embedLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load @strudel/embed"));
    document.head.appendChild(script);
  });
}

async function startStrudel(code: string): Promise<void> {
  try {
    await loadStrudelEmbed();

    // Remove existing REPL if present
    if (strudelReplElement) {
      strudelReplElement.remove();
    }

    // Create strudel-repl element (code in HTML comments)
    strudelReplElement = document.createElement("strudel-repl");
    strudelReplElement.innerHTML = `<!--\n${code}\n-->`;
    strudelReplElement.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 5;
    `;

    // Insert before the UI overlay
    const overlay = document.querySelector(".ui-overlay");
    if (overlay) {
      overlay.parentElement?.insertBefore(strudelReplElement, overlay);
    } else {
      document.body.appendChild(strudelReplElement);
    }

    audioState.playing = true;
    audioState.startTime = performance.now();

    // Extract BPM from code
    const cpmMatch = code.match(/\.cpm\((\d+(?:\.\d+)?)\s*\/\s*(\d+)\)/);
    if (cpmMatch) {
      audioState.bpm = parseFloat(cpmMatch[1]);
    } else {
      const cpmMatch2 = code.match(/\.cpm\((\d+(?:\.\d+)?)\)/);
      if (cpmMatch2) audioState.bpm = parseFloat(cpmMatch2[1]) * 4;
    }

    log.info("Strudel REPL loaded");
  } catch (e) {
    log.error("Strudel init error:", e);
    // Fallback: simple oscillator demo
    startFallbackAudio();
  }
}

function startFallbackAudio(): void {
  const audioCtx = setupAudio();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  if (audioState.analyser) {
    gain.connect(audioState.analyser);
    audioState.analyser.connect(audioCtx.destination);
  }
  osc.start();

  audioState.playing = true;
  audioState.startTime = performance.now();

  // Pulse on beat
  function pulse() {
    if (!audioState.playing) return;
    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    setTimeout(pulse, (60 / audioState.bpm) * 1000);
  }
  pulse();
  log.info("Fallback audio started");
}

async function stopAudio(): Promise<void> {
  audioState.playing = false;

  // Remove strudel-repl element if present
  if (strudelReplElement) {
    strudelReplElement.remove();
    strudelReplElement = null;
  }
  if (audioState.audioCtx) {
    try {
      await audioState.audioCtx.suspend();
    } catch {
      /* ignore */
    }
  }
}

// ─── Render Loop ───
function render(): void {
  requestAnimationFrame(render);
  analyzeAudio();

  if (!program) return;

  const t = (performance.now() - startRenderTime) / 1000;

  gl.uniform1f(uniforms.iTime, t);
  gl.uniform3f(uniforms.iResolution, canvas.width, canvas.height, 1.0);
  gl.uniform4f(
    uniforms.iMouse,
    mouseDown ? mouseX : mouseClickX,
    mouseDown ? mouseY : mouseClickY,
    mouseDown ? mouseClickX : -mouseClickX,
    mouseDown ? mouseClickY : -mouseClickY,
  );
  gl.uniform1f(uniforms.iBeat, audioState.beat);
  gl.uniform1f(uniforms.iAmp, audioState.amp);
  gl.uniform1f(uniforms.iBass, audioState.bass);
  gl.uniform1f(uniforms.iMid, audioState.mid);
  gl.uniform1f(uniforms.iHigh, audioState.high);

  // Update FFT texture
  updateFFTTexture();
  if (fftTexture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fftTexture);
    gl.uniform1i(uniforms.iChannel0, 0);
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Update UI meters
  const mBass = document.getElementById("mBass");
  const mMid = document.getElementById("mMid");
  const mHigh = document.getElementById("mHigh");
  const mAmp = document.getElementById("mAmp");
  const beatDot = document.getElementById("beatDot");

  if (mBass) mBass.style.width = `${audioState.bass * 100}%`;
  if (mMid) mMid.style.width = `${audioState.mid * 100}%`;
  if (mHigh) mHigh.style.width = `${audioState.high * 100}%`;
  if (mAmp) mAmp.style.width = `${audioState.amp * 100}%`;

  if (beatDot) {
    if (audioState.beatFrac < 0.1) {
      beatDot.classList.add("flash");
    } else {
      beatDot.classList.remove("flash");
    }
  }
}

// ─── UI Handlers ───
function updatePlayButton(): void {
  playBtn.classList.toggle("playing", audioState.playing);
  metersBar?.classList.toggle("visible", audioState.playing);
}

playBtn.addEventListener("click", async () => {
  if (audioState.playing) {
    await stopAudio();
    updatePlayButton();
  } else if (currentInput) {
    await startStrudel(currentInput.strudel_source);
    updatePlayButton();
  }
});

// ─── Host Context ───
function handleHostContextChanged(ctx: McpUiHostContext): void {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);

  if (ctx.availableDisplayModes !== undefined) {
    const canFullscreen = ctx.availableDisplayModes.includes("fullscreen");
    fullscreenBtn.classList.toggle("available", canFullscreen);
  }

  if (ctx.displayMode) {
    currentDisplayMode = ctx.displayMode as "inline" | "fullscreen";
    document.body.classList.toggle(
      "fullscreen",
      currentDisplayMode === "fullscreen",
    );
  }
}

// Fullscreen toggle
async function toggleFullscreen(): Promise<void> {
  const newMode = currentDisplayMode === "fullscreen" ? "inline" : "fullscreen";
  try {
    const result = await app.requestDisplayMode({ mode: newMode });
    currentDisplayMode = result.mode as "inline" | "fullscreen";
    document.body.classList.toggle(
      "fullscreen",
      currentDisplayMode === "fullscreen",
    );
  } catch (err) {
    log.error("Failed to change display mode:", err);
  }
}

fullscreenBtn.addEventListener("click", toggleFullscreen);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && currentDisplayMode === "fullscreen") {
    toggleFullscreen();
  }
});

// ─── MCP App ───
const app = new App({ name: "Strudel Music", version: "1.0.0" });

app.onteardown = async () => {
  log.info("App teardown");
  await stopAudio();
  return {};
};

app.ontoolinputpartial = (params) => {
  // Show code preview during streaming
  codePreview.classList.add("visible");
  playBtn.classList.add("hidden");
  const code = params.arguments?.strudel_source;
  codePreview.textContent = typeof code === "string" ? code : "";
  codePreview.scrollTop = codePreview.scrollHeight;
};

app.ontoolinput = async (params) => {
  log.info("Received tool input");

  // Hide code preview, show play button
  codePreview.classList.remove("visible");
  playBtn.classList.remove("hidden");

  // Apply defaults for missing fields
  const input = params.arguments as any as StrudelInput;
  currentInput = input;

  // Update code overlay for hover display
  codeOverlay.textContent = input.strudel_source;
  codeOverlay.classList.add("has-code");

  // Set BPM from input
  audioState.bpm = input.bpm;

  if (!buildProgram(input.shader_source)) {
    log.error("Failed to build shader, using fallback");
    buildProgram(`
      void mainImage(out vec4 O, in vec2 U) {
        vec2 uv = U / iResolution.xy;
        O = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
      }
    `);
  }

  // Show play button prominently
  playBtn.classList.add("ready");
};

app.onerror = log.error;
app.onhostcontextchanged = handleHostContextChanged;

// ─── Initialize ───
createFFTTexture();

// Build default shader
buildProgram(`
  void mainImage(out vec4 O, in vec2 U) {
    vec2 uv = (U - .5 * iResolution.xy) / iResolution.y;
    float r = length(uv);
    vec3 col = vec3(0.1, 0.15, 0.2) * (1.0 - r * 0.5);
    O = vec4(col, 1.0);
  }
`);

// Start render loop
render();

// Connect to host
app.connect().then(() => {
  log.info("Connected to host");
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});
