import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const TOOL_DESCRIPTION = `Creates audio-reactive visualizations with live-coded music using Strudel (a JavaScript port of TidalCycles) and WebGL shaders.

STRUDEL MINI-NOTATION:
- Sequences: "c3 e3 g3 b3" - notes play in order over one cycle
- Rests: "~ c3 ~ e3" - tilde creates silence
- Subdivision: "[c3 e3] g3" - brackets subdivide time
- Chords: "[c3,e3,g3]" - comma for simultaneous notes
- Euclidean: "c3(3,8)" - distribute 3 notes over 8 steps
- Speed: "c3*4" (faster) or "c3/2" (slower)

PATTERN FUNCTIONS:
- note("c3 e3 g3") - pitch pattern
- s("bd sd hh") - samples (kick, snare, hihat)
- sound("piano") - instrument sounds
- gain(0.8), pan("<0 1>"), speed(2)
- delay(0.5), room(0.8), lpf(2000), hpf(200)

PATTERN MODIFIERS:
- .fast(2), .slow(2), .rev(), .palindrome()
- .sometimes(fn), .every(4, fn)
- stack(pattern1, pattern2) - layer patterns
- .cpm(120) - set cycles per minute (tempo)

SHADER FORMAT (Shadertoy-style with audio uniforms):
Write a mainImage function. Available uniforms:
- iResolution (vec3): viewport resolution
- iTime (float): elapsed time in seconds
- iMouse (vec4): mouse position
- iBeat (float): current beat (fractional)
- iAmp (float): overall amplitude (0-1)
- iBass (float): bass level (0-1)
- iMid (float): mid frequencies (0-1)
- iHigh (float): high frequencies (0-1)
- iChannel0 (sampler2D): FFT texture (256x2, row 0=frequency, row 1=waveform)

EXAMPLE SHADER:
void mainImage(out vec4 O, in vec2 U) {
  vec2 uv = (U - .5 * iResolution.xy) / iResolution.y;
  float r = length(uv);
  float beat = exp(-3.0 * fract(iBeat));
  float ring = smoothstep(0.02, 0.0, abs(r - 0.3 * beat - 0.1 * iBass));
  vec3 col = vec3(0.9, 0.2, 0.3) * ring * (1.0 + iBass);
  col += vec3(0.2, 0.5, 0.9) * iMid * (1.0 - r);
  O = vec4(col, 1.0);
}

SOUNDS: bd, sd, hh, oh, cp, piano, sawtooth, sine, square

Note: Click play button to start audio (browser security requires user gesture).`;

const DEFAULT_PATTERN = `note("[c eb g <f bb>](3,8,<0 1>)".sub(12))
.s("<sawtooth>/64")
.lpf(sine.range(300,2000).slow(16))
.lpa(0.005)
.lpd(perlin.range(.02,.2))
.lps(perlin.range(0,.5).slow(3))
.lpq(sine.range(2,10).slow(32))
.release(.5)
.lpenv(perlin.range(1,8).slow(2))
.ftype('24db')
.room(1)
.juxBy(.5,rev)
.sometimes(add(note(12)))
.stack(s("bd*2").bank('RolandTR909'))
.gain(.5).fast(2)`;

const DEFAULT_SHADER = `void mainImage(out vec4 O, in vec2 U) {
  vec2 uv = (U - .5 * iResolution.xy) / iResolution.y;

  // Radial pulse on beat
  float r = length(uv);
  float beat = exp(-3.0 * fract(iBeat));
  float ring = smoothstep(0.02, 0.0, abs(r - 0.3 * beat - 0.1 * iBass));

  // Swirl with bass
  float a = atan(uv.y, uv.x);
  float spiral = sin(a * 5.0 + iTime * 2.0 - r * 10.0 + iBass * 3.0);
  spiral = smoothstep(0.0, 0.4, spiral * (1.0 - r));

  // Color from frequency bands
  vec3 col = vec3(0.0);
  col += vec3(0.9, 0.2, 0.3) * ring * (1.0 + iBass);
  col += vec3(0.2, 0.5, 0.9) * spiral * iMid;
  col += vec3(0.1, 0.9, 0.5) * beat * 0.3;

  // Vignette
  col *= 1.0 - 0.6 * r * r;

  O = vec4(col, 1.0);
}`;

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Strudel Server",
    version: "1.0.0",
  });

  const resourceUri = "ui://strudel/mcp-app.html";

  // Register the play-strudel tool with UI metadata
  registerAppTool(
    server,
    "play-strudel",
    {
      title: "Strudel Music",
      description: TOOL_DESCRIPTION,
      inputSchema: z.object({
        code: z
          .string()
          .default(DEFAULT_PATTERN)
          .describe(
            "Strudel pattern code using mini-notation and pattern functions",
          ),
        shader: z
          .string()
          .default(DEFAULT_SHADER)
          .describe(
            "GLSL fragment shader code (mainImage function) for audio-reactive visualization",
          ),
        bpm: z
          .number()
          .positive()
          .default(120)
          .describe(
            "Beats per minute for beat tracking (auto-detected from .cpm() if present)",
          ),
      }),
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: "Strudel pattern loaded with audio-reactive shader",
          },
        ],
      };
    },
  );

  // Register the resource which returns the bundled HTML/JavaScript for the UI
  // CSP configuration for external Strudel dependencies
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          csp: {
            connectDomains: [
              "https://cdn.jsdelivr.net",
              "https://esm.sh",
              "https://unpkg.com",
            ],
            resourceDomains: [
              "https://cdn.jsdelivr.net",
              "https://esm.sh",
              "https://unpkg.com",
            ],
          },
        },
      },
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );

      return {
        contents: [
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
