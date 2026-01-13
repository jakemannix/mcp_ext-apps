/**
 * PDF MCP Server - Didactic Example
 *
 * Demonstrates:
 * - Chunked data through size-limited tool responses
 * - Model context updates (current page text + selection)
 * - Display modes: fullscreen with scrolling vs inline with resize
 * - External link opening (openLink)
 *
 * Usage:
 *   bun server.ts https://arxiv.org/pdf/2303.18223.pdf
 *   bun server.ts --stdio https://example.com/doc.pdf
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { buildPdfIndex, findEntryById, createEntry, isArxivUrl, isFileUrl, toFileUrl } from "./src/pdf-indexer.js";
import { loadPdfTextChunk, loadPdfBytesChunk, populatePdfMetadata } from "./src/pdf-loader.js";
import {
  ReadPdfTextInputSchema,
  ReadPdfBytesInputSchema,
  PdfTextChunkSchema,
  PdfBytesChunkSchema,
  MAX_CHUNK_BYTES,
  type PdfIndex,
} from "./src/types.js";
import { startServer } from "./server-utils.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://pdf-viewer/mcp-app.html";
const DEFAULT_PDF = "https://arxiv.org/pdf/2303.18223.pdf";

let pdfIndex: PdfIndex | null = null;

export function createServer(): McpServer {
  const server = new McpServer({ name: "PDF Server", version: "1.0.0" });

  // ============================================================================
  // Tool: list_pdfs - List all indexed PDFs
  // ============================================================================
  server.tool("list_pdfs", "List indexed PDFs", {}, async (): Promise<CallToolResult> => {
    if (!pdfIndex) throw new Error("Not initialized");
    return {
      content: [{ type: "text", text: JSON.stringify(pdfIndex.entries, null, 2) }],
      structuredContent: { entries: pdfIndex.entries },
    };
  });

  // ============================================================================
  // Tool: read_pdf_text - Chunked text extraction (app-only)
  // Demonstrates: Size-limited responses with pagination
  // ============================================================================
  registerAppTool(
    server,
    "read_pdf_text",
    {
      title: "Read PDF Text",
      description: "Extract text in chunks (demonstrates size-limited responses)",
      inputSchema: ReadPdfTextInputSchema.shape,
      outputSchema: PdfTextChunkSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args: unknown): Promise<CallToolResult> => {
      if (!pdfIndex) throw new Error("Not initialized");
      const { pdfId, startPage, maxBytes } = ReadPdfTextInputSchema.parse(args);
      const entry = findEntryById(pdfIndex, pdfId);
      if (!entry) throw new Error(`PDF not found: ${pdfId}`);

      const chunk = await loadPdfTextChunk(entry, startPage, Math.min(maxBytes, MAX_CHUNK_BYTES));
      console.error(`[read_pdf_text] pages ${chunk.startPage}-${chunk.endPage}/${chunk.totalPages}`);

      return {
        content: [{ type: "text", text: chunk.text }],
        structuredContent: chunk,
      };
    },
  );

  // ============================================================================
  // Tool: read_pdf_bytes - Chunked binary loading (app-only)
  // Demonstrates: Streaming with HTTP Range requests
  // ============================================================================
  registerAppTool(
    server,
    "read_pdf_bytes",
    {
      title: "Read PDF Bytes",
      description: "Load binary data in chunks (uses HTTP Range requests when available)",
      inputSchema: ReadPdfBytesInputSchema.shape,
      outputSchema: PdfBytesChunkSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args: unknown): Promise<CallToolResult> => {
      if (!pdfIndex) throw new Error("Not initialized");
      const { pdfId, offset, byteCount } = ReadPdfBytesInputSchema.parse(args);
      const entry = findEntryById(pdfIndex, pdfId);
      if (!entry) throw new Error(`PDF not found: ${pdfId}`);

      const chunk = await loadPdfBytesChunk(entry, offset, byteCount);

      return {
        content: [{ type: "text", text: `${chunk.byteCount} bytes at ${chunk.offset}/${chunk.totalBytes}` }],
        structuredContent: chunk,
      };
    },
  );

  // ============================================================================
  // Tool: view_pdf - Interactive viewer with UI
  // Demonstrates: App tools with UI, display modes, model context updates
  // ============================================================================
  registerAppTool(
    server,
    "view_pdf",
    {
      title: "View PDF",
      description: `Interactive PDF viewer. Demonstrates:
- Display modes: fullscreen (scrolling) vs inline (resize)
- Model context updates (page text + selection)
- External links (openLink)

Use pdfId from list_pdfs, or provide an arxiv.org URL.`,
      inputSchema: {
        pdfId: z.string().optional().describe("PDF ID from list_pdfs"),
        url: z.string().default(DEFAULT_PDF).describe("arxiv.org PDF URL"),
        page: z.number().min(1).default(1).describe("Initial page"),
      },
      outputSchema: z.object({
        pdfId: z.string(),
        title: z.string(),
        sourceUrl: z.string(),
        pageCount: z.number(),
        initialPage: z.number(),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ pdfId, url, page }): Promise<CallToolResult> => {
      if (!pdfIndex) throw new Error("Not initialized");

      let entry;
      if (pdfId) {
        entry = findEntryById(pdfIndex, pdfId);
        if (!entry) throw new Error(`PDF not found: ${pdfId}`);
      } else {
        // Check if URL is already indexed (file:// URLs must be pre-indexed)
        entry = pdfIndex.entries.find((e) => e.url === url);

        if (!entry) {
          // Dynamic URLs: only arxiv.org allowed (file:// must be in initial list)
          if (isFileUrl(url)) {
            throw new Error(`File URLs must be in the initial list. Use pdfId instead.`);
          }
          if (!isArxivUrl(url)) {
            throw new Error(`Only arxiv.org URLs can be loaded dynamically. Got: ${url}`);
          }

          entry = createEntry(url);
          await populatePdfMetadata(entry);
          pdfIndex.entries.push(entry);
        }
      }

      const result = {
        pdfId: entry.id,
        title: entry.displayName,
        sourceUrl: entry.url,
        pageCount: entry.metadata.pageCount,
        initialPage: Math.min(page, entry.metadata.pageCount),
      };

      return {
        content: [{ type: "text", text: `Viewing "${entry.displayName}" (${entry.metadata.pageCount} pages)` }],
        structuredContent: result,
      };
    },
  );

  // ============================================================================
  // Resource: UI HTML
  // ============================================================================
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return { contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  return server;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): { urls: string[]; stdio: boolean } {
  const args = process.argv.slice(2);
  const urls: string[] = [];
  let stdio = false;

  for (const arg of args) {
    if (arg === "--stdio") {
      stdio = true;
    } else if (!arg.startsWith("-")) {
      // Convert local paths to file:// URLs
      if (arg.startsWith("http://") || arg.startsWith("https://") || arg.startsWith("file://")) {
        urls.push(arg);
      } else {
        urls.push(toFileUrl(arg));
      }
    }
  }

  return { urls: urls.length > 0 ? urls : [DEFAULT_PDF], stdio };
}

async function main() {
  const { urls, stdio } = parseArgs();

  console.error(`[pdf-server] Initializing with ${urls.length} PDF(s)...`);
  pdfIndex = await buildPdfIndex(urls);
  console.error(`[pdf-server] Ready`);

  if (stdio) {
    await createServer().connect(new StdioServerTransport());
  } else {
    await startServer(createServer, { port: 3110, name: "PDF Server" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
