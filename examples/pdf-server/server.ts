/**
 * PDF MCP Server - Range Query Based (Library Entry Point)
 *
 * No caching, no indexing, no sessions - just proxies range requests.
 * - Remote URLs (arxiv): HTTP Range requests
 * - Local files: fs.createReadStream with start/end
 */

import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// =============================================================================
// Configuration
// =============================================================================

export const DEFAULT_PDF = "https://arxiv.org/pdf/1706.03762"; // Attention Is All You Need
export const MAX_CHUNK_BYTES = 512 * 1024; // 512KB max per request
export const RESOURCE_URI = "ui://pdf-viewer/mcp-app.html";

/** Allowed remote origins (security allowlist) */
export const allowedRemoteOrigins = new Set([
  "https://arxiv.org",
  "https://ssrn.com",
  "https://www.researchsquare.com",
  "https://www.preprints.org",
  "https://osf.io",
  "https://zenodo.org",
  "https://www.biorxiv.org",
  "https://www.medrxiv.org",
  "https://chemrxiv.org",
  "https://www.eartharxiv.org",
  "https://psyarxiv.com",
  "https://osf.io/preprints/socarxiv",
  "https://engrxiv.org",
  "https://www.sportarxiv.org",
  "https://agrirxiv.org",
  "https://edarxiv.org",
  "https://hal.science",
]);

/** Allowed local file paths (populated from CLI args) */
export const allowedLocalFiles = new Set<string>();

/** Add a remote origin to the whitelist */
export function addAllowedOrigin(origin: string): void {
  allowedRemoteOrigins.add(origin);
}

/** Add a local file to the whitelist */
export function addAllowedLocalFile(filePath: string): void {
  allowedLocalFiles.add(path.resolve(filePath));
}

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// =============================================================================
// URL Validation & Normalization
// =============================================================================

export function isFileUrl(url: string): boolean {
  return url.startsWith("file://");
}

export function isArxivUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "arxiv.org" || parsed.hostname === "www.arxiv.org";
  } catch {
    return false;
  }
}

export function normalizeArxivUrl(url: string): string {
  // Convert arxiv abstract URLs to PDF URLs
  // https://arxiv.org/abs/1706.03762 -> https://arxiv.org/pdf/1706.03762
  return url.replace("/abs/", "/pdf/").replace(/\.pdf$/, "");
}

export function fileUrlToPath(fileUrl: string): string {
  return decodeURIComponent(fileUrl.replace("file://", ""));
}

export function pathToFileUrl(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  return `file://${encodeURIComponent(absolutePath).replace(/%2F/g, "/")}`;
}

export function validateUrl(url: string): { valid: boolean; error?: string } {
  if (isFileUrl(url)) {
    const filePath = fileUrlToPath(url);
    if (!allowedLocalFiles.has(filePath)) {
      return { valid: false, error: `Local file not in allowed list: ${filePath}` };
    }
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: `File not found: ${filePath}` };
    }
    return { valid: true };
  }

  // Remote URL - check against allowed origins
  try {
    const parsed = new URL(url);
    const origin = `${parsed.protocol}//${parsed.hostname}`;
    if (![...allowedRemoteOrigins].some(allowed => origin.startsWith(allowed))) {
      return { valid: false, error: `Origin not allowed: ${origin}` };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: `Invalid URL: ${url}` };
  }
}

// =============================================================================
// Range Request Helpers
// =============================================================================

export interface PdfInfo {
  url: string;
  totalBytes: number;
  contentType: string;
}

export async function getPdfInfo(url: string): Promise<PdfInfo> {
  const normalized = isArxivUrl(url) ? normalizeArxivUrl(url) : url;

  if (isFileUrl(normalized)) {
    const filePath = fileUrlToPath(normalized);
    const stats = await fs.promises.stat(filePath);
    return {
      url: normalized,
      totalBytes: stats.size,
      contentType: "application/pdf",
    };
  }

  // Remote URL - HEAD request
  const response = await fetch(normalized, { method: "HEAD" });
  if (!response.ok) {
    throw new Error(`HEAD request failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  if (!contentLength) {
    throw new Error("Server did not return Content-Length");
  }

  return {
    url: normalized,
    totalBytes: parseInt(contentLength, 10),
    contentType: response.headers.get("content-type") || "application/pdf",
  };
}

export async function readPdfRange(
  url: string,
  offset: number,
  byteCount: number,
): Promise<{ data: Uint8Array; totalBytes: number }> {
  const normalized = isArxivUrl(url) ? normalizeArxivUrl(url) : url;
  const clampedByteCount = Math.min(byteCount, MAX_CHUNK_BYTES);

  if (isFileUrl(normalized)) {
    const filePath = fileUrlToPath(normalized);
    const stats = await fs.promises.stat(filePath);
    const totalBytes = stats.size;

    // Clamp to file bounds
    const start = Math.min(offset, totalBytes);
    const end = Math.min(start + clampedByteCount, totalBytes);

    if (start >= totalBytes) {
      return { data: new Uint8Array(0), totalBytes };
    }

    // Read range from local file
    const buffer = Buffer.alloc(end - start);
    const fd = await fs.promises.open(filePath, "r");
    try {
      await fd.read(buffer, 0, end - start, start);
    } finally {
      await fd.close();
    }

    return { data: new Uint8Array(buffer), totalBytes };
  }

  // Remote URL - Range request
  const response = await fetch(normalized, {
    headers: {
      Range: `bytes=${offset}-${offset + clampedByteCount - 1}`,
    },
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(`Range request failed: ${response.status} ${response.statusText}`);
  }

  // Parse total size from Content-Range header
  const contentRange = response.headers.get("content-range");
  let totalBytes = 0;
  if (contentRange) {
    const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
    if (match) {
      totalBytes = parseInt(match[1], 10);
    }
  }

  const data = new Uint8Array(await response.arrayBuffer());
  return { data, totalBytes };
}

// =============================================================================
// MCP Server Factory
// =============================================================================

export function createServer(): McpServer {
  const server = new McpServer({ name: "PDF Server", version: "2.0.0" });

  // Tool: list_pdfs - List available PDFs (local files + allowed origins)
  server.tool(
    "list_pdfs",
    "List available PDFs that can be displayed",
    {},
    async (): Promise<CallToolResult> => {
      const pdfs: Array<{ url: string; type: "local" | "remote" }> = [];

      // Add local files
      for (const filePath of allowedLocalFiles) {
        pdfs.push({ url: pathToFileUrl(filePath), type: "local" });
      }

      // Note: Remote URLs from allowed origins can be loaded dynamically
      const text = pdfs.length > 0
        ? `Available PDFs:\n${pdfs.map(p => `- ${p.url} (${p.type})`).join("\n")}\n\nRemote PDFs from ${[...allowedRemoteOrigins].join(", ")} can also be loaded dynamically.`
        : `No local PDFs configured. Remote PDFs from ${[...allowedRemoteOrigins].join(", ")} can be loaded dynamically.`;

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          localFiles: pdfs.filter(p => p.type === "local").map(p => p.url),
          allowedOrigins: [...allowedRemoteOrigins],
        },
      };
    },
  );

  // Tool: get_pdf_info - HEAD request to get size
  server.tool(
    "get_pdf_info",
    "Get PDF file information (size, type) without downloading",
    {
      url: z.string().describe("PDF URL (https:// or file://)"),
    },
    async ({ url }): Promise<CallToolResult> => {
      const validation = validateUrl(url);
      if (!validation.valid) {
        return {
          content: [{ type: "text", text: validation.error! }],
          isError: true,
        };
      }

      try {
        const info = await getPdfInfo(url);
        return {
          content: [{ type: "text", text: `PDF: ${info.totalBytes} bytes` }],
          structuredContent: { ...info },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: read_pdf_bytes (app-only) - Range request for chunks
  registerAppTool(
    server,
    "read_pdf_bytes",
    {
      title: "Read PDF Bytes",
      description: "Read a range of bytes from a PDF (max 512KB per request)",
      inputSchema: {
        url: z.string().describe("PDF URL"),
        offset: z.number().min(0).default(0).describe("Byte offset"),
        byteCount: z.number().min(1).max(MAX_CHUNK_BYTES).default(MAX_CHUNK_BYTES).describe("Bytes to read"),
      },
      outputSchema: z.object({
        url: z.string(),
        bytes: z.string().describe("Base64 encoded bytes"),
        offset: z.number(),
        byteCount: z.number(),
        totalBytes: z.number(),
        hasMore: z.boolean(),
      }),
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ url, offset, byteCount }): Promise<CallToolResult> => {
      const validation = validateUrl(url);
      if (!validation.valid) {
        return {
          content: [{ type: "text", text: validation.error! }],
          isError: true,
        };
      }

      try {
        const normalized = isArxivUrl(url) ? normalizeArxivUrl(url) : url;
        const { data, totalBytes } = await readPdfRange(url, offset, byteCount);

        // Base64 encode for JSON transport
        const bytes = Buffer.from(data).toString("base64");
        const hasMore = offset + data.length < totalBytes;

        return {
          content: [{ type: "text", text: `${data.length} bytes at ${offset}/${totalBytes}` }],
          structuredContent: {
            url: normalized,
            bytes,
            offset,
            byteCount: data.length,
            totalBytes,
            hasMore,
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: display_pdf - Show interactive viewer
  registerAppTool(
    server,
    "display_pdf",
    {
      title: "Display PDF",
      description: `Display an interactive PDF viewer.

Accepts:
- Local files explicitly added to the server (use list_pdfs to see available files)
- Remote PDFs from allowed services: arxiv.org, ssrn.com, biorxiv.org, medrxiv.org, chemrxiv.org, zenodo.org, osf.io, hal.science, researchsquare.com, preprints.org, eartharxiv.org, psyarxiv.com, engrxiv.org, sportarxiv.org, agrirxiv.org, edarxiv.org`,
      inputSchema: {
        url: z.string().default(DEFAULT_PDF).describe("PDF URL"),
        page: z.number().min(1).default(1).describe("Initial page"),
      },
      outputSchema: z.object({
        url: z.string(),
        initialPage: z.number(),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ url, page }): Promise<CallToolResult> => {
      const normalized = isArxivUrl(url) ? normalizeArxivUrl(url) : url;
      const validation = validateUrl(normalized);

      if (!validation.valid) {
        return {
          content: [{ type: "text", text: validation.error! }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: `Displaying PDF: ${normalized}` }],
        structuredContent: {
          url: normalized,
          initialPage: page,
        },
        _meta: {
          widgetUUID: randomUUID(),
        },
      };
    },
  );

  // Resource: UI HTML
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.promises.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
