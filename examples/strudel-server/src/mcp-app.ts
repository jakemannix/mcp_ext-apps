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
  code: string;
  shader?: string;
  bpm?: number;
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
function isStrudelInput(value: unknown): value is StrudelInput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).code === "string"
  );
}

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
let strudelRepl: {
  stop: () => Promise<void>;
  evaluate: (code: string) => Promise<void>;
} | null = null;

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
const fullscreenBtn = document.getElementById(
  "fullscreenBtn",
) as HTMLButtonElement;
const metersBar = document.querySelector(".meters-bar") as HTMLElement;

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

// ─── Strudel Integration ───
async function startStrudel(code: string): Promise<void> {
  const audioCtx = setupAudio();

  // Stop previous instance
  if (strudelRepl) {
    try {
      await strudelRepl.stop();
    } catch {
      /* ignore */
    }
  }

  try {
    // Dynamically import Strudel from CDN
    // @ts-expect-error - Dynamic import from CDN
    const strudel = await import("https://esm.sh/@strudel/repl@1.1.0");

    const { scheduler, evaluate } = await strudel.repl({
      audioContext: audioCtx,
      onSchedulerError: (e: Error) => log.error("Scheduler:", e),
      onEvalError: (e: Error) => log.error("Eval:", e),
    });

    strudelRepl = {
      stop: () => scheduler.stop(),
      evaluate: (newCode: string) => evaluate(newCode),
    };

    await evaluate(code);
    scheduler.start();

    // Connect analyser to audio output
    if (audioState.analyser) {
      audioState.analyser.connect(audioCtx.destination);
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

    log.info("Strudel started, BPM:", audioState.bpm);
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
  if (strudelRepl) {
    try {
      await strudelRepl.stop();
    } catch {
      /* ignore */
    }
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
    await startStrudel(currentInput.code);
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
  const code = params.arguments?.code;
  codePreview.textContent = typeof code === "string" ? code : "";
  codePreview.scrollTop = codePreview.scrollHeight;
};

app.ontoolinput = async (params) => {
  log.info("Received tool input");

  // Hide code preview, show play button
  codePreview.classList.remove("visible");
  playBtn.classList.remove("hidden");

  if (!isStrudelInput(params.arguments)) {
    log.error("Invalid tool input");
    return;
  }

  const input = params.arguments;
  currentInput = input;

  // Update code overlay for hover display
  codeOverlay.textContent = input.code;
  codeOverlay.classList.add("has-code");

  // Set BPM from input
  if (input.bpm) {
    audioState.bpm = input.bpm;
  }

  // Build shader
  const shaderCode =
    input.shader ||
    `
    void mainImage(out vec4 O, in vec2 U) {
      vec2 uv = (U - .5 * iResolution.xy) / iResolution.y;
      float r = length(uv);
      float beat = exp(-3.0 * fract(iBeat));
      vec3 col = vec3(0.2, 0.4, 0.8) * (1.0 - r) + vec3(beat * 0.3);
      col += vec3(iBass, iMid, iHigh) * 0.5;
      O = vec4(col, 1.0);
    }
  `;

  if (!buildProgram(shaderCode)) {
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
