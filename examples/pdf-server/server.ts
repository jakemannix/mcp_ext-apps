/**
 * PDF MCP Server
 *
 * An MCP server that indexes and serves PDF files from local directories and HTTP URLs.
 *
 * Usage:
 *   bun server.ts ./papers/ ./thesis.pdf                    # Local files
 *   bun server.ts https://example.com/doc.pdf               # HTTP URL
 *   bun server.ts --stdio ./docs/                           # stdio mode for MCP clients
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  buildPdfIndex,
  findEntryById,
  filterEntriesByFolder,
  isHttpUrl,
  createHttpEntry,
} from "./src/pdf-indexer.js";
import {
  loadPdfData,
  loadPdfTextChunk,
  loadPdfBytesChunk,
  populatePdfMetadata,
} from "./src/pdf-loader.js";
import {
  ReadPdfTextInputSchema,
  ReadPdfBytesInputSchema,
  ListPdfsInputSchema,
  ListPdfsOutputSchema,
  PdfTextChunkSchema,
  PdfBytesChunkSchema,
  MAX_TOOL_RESPONSE_BYTES,
  DEFAULT_BINARY_CHUNK_SIZE,
  type PdfIndex,
  type ReadPdfTextInput,
  type ReadPdfBytesInput,
  type ListPdfsInput,
} from "./src/types.js";
import { startServer } from "./server-utils.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://pdf-viewer/mcp-app.html";

// Default demo paper: "A Survey of Large Language Models" from arXiv (75 pages, ~2.5MB)
const DEFAULT_PDF_URL = "https://arxiv.org/pdf/2303.18223.pdf";

// Global index - populated at startup
let pdfIndex: PdfIndex | null = null;

/**
 * Creates a new MCP server instance with PDF tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "PDF Server",
    version: "1.0.0",
  });

  // Resource template: PDF metadata
  server.registerResource(
    "PDF Metadata",
    new ResourceTemplate("pdfs://metadata/{pdfId}", { list: undefined }),
    {
      mimeType: "application/json",
      description: "JSON metadata for a specific PDF",
    },
    async (uri: URL, variables): Promise<ReadResourceResult> => {
      if (!pdfIndex) {
        throw new Error("PDF index not initialized");
      }
      const pdfId = Array.isArray(variables.pdfId)
        ? variables.pdfId[0]
        : variables.pdfId;
      const entry = findEntryById(pdfIndex, pdfId as string);
      if (!entry) {
        throw new Error(`PDF not found: ${pdfId}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(entry, null, 2),
          },
        ],
      };
    },
  );

  // Tool: list_pdfs
  server.tool(
    "list_pdfs",
    "List all indexed PDFs with their metadata",
    ListPdfsInputSchema.shape,
    async (args: unknown): Promise<CallToolResult> => {
      if (!pdfIndex) {
        throw new Error("PDF index not initialized");
      }
      const input = ListPdfsInputSchema.parse(args) as ListPdfsInput;
      const entries = input.folder
        ? filterEntriesByFolder(pdfIndex, input.folder)
        : pdfIndex.entries;

      const output = ListPdfsOutputSchema.parse({
        entries,
        totalCount: entries.length,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  // Tool: read_pdf_text (app-only - used by view_pdf UI for chunked loading)
  registerAppTool(
    server,
    "read_pdf_text",
    {
      title: "Read PDF Text",
      description:
        "Extract text from a PDF with chunked pagination for large documents",
      inputSchema: ReadPdfTextInputSchema.shape,
      outputSchema: PdfTextChunkSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args: unknown): Promise<CallToolResult> => {
      if (!pdfIndex) {
        throw new Error("PDF index not initialized");
      }
      const input = ReadPdfTextInputSchema.parse(args) as ReadPdfTextInput;
      const entry = findEntryById(pdfIndex, input.pdfId);
      if (!entry) {
        throw new Error(`PDF not found: ${input.pdfId}`);
      }

      // Use safe byte limit to avoid exceeding MCP response limits
      const maxBytes = Math.min(
        input.maxBytes ?? MAX_TOOL_RESPONSE_BYTES,
        MAX_TOOL_RESPONSE_BYTES,
      );
      const chunk = await loadPdfTextChunk(
        entry,
        input.startPage ?? 1,
        maxBytes,
      );
      const output = PdfTextChunkSchema.parse(chunk);

      // Log chunk info for debugging
      console.error(
        `[read_pdf_text] Chunk: pages ${output.startPage}-${output.endPage}/${output.totalPages}, ` +
          `${(output.textSizeBytes / 1024).toFixed(1)}KB, hasMore=${output.hasMore}`,
      );

      return {
        content: [{ type: "text", text: output.text }],
        structuredContent: output,
      };
    },
  );

  // Tool: read_pdf_bytes (app-only - chunked binary loading for large PDFs)
  registerAppTool(
    server,
    "read_pdf_bytes",
    {
      title: "Read PDF Bytes",
      description:
        "Load PDF binary data in chunks. First call fetches and caches the PDF, " +
        "subsequent calls serve from cache. Use offset/byteCount for pagination.",
      inputSchema: ReadPdfBytesInputSchema.shape,
      outputSchema: PdfBytesChunkSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args: unknown): Promise<CallToolResult> => {
      if (!pdfIndex) {
        throw new Error("PDF index not initialized");
      }
      const input = ReadPdfBytesInputSchema.parse(args) as ReadPdfBytesInput;
      const entry = findEntryById(pdfIndex, input.pdfId);
      if (!entry) {
        throw new Error(`PDF not found: ${input.pdfId}`);
      }

      const chunk = await loadPdfBytesChunk(
        entry,
        input.offset ?? 0,
        input.byteCount ?? DEFAULT_BINARY_CHUNK_SIZE,
      );
      const output = PdfBytesChunkSchema.parse(chunk);

      return {
        content: [
          {
            type: "text",
            text: `PDF chunk: ${output.byteCount} bytes at offset ${output.offset}/${output.totalBytes}`,
          },
        ],
        structuredContent: output,
      };
    },
  );

  // Resource template: PDF binary content (for viewer)
  server.registerResource(
    "PDF Content",
    new ResourceTemplate("pdfs://content/{pdfId}", { list: undefined }),
    {
      mimeType: "application/pdf",
      description: "Raw PDF binary content as base64 blob",
    },
    async (uri: URL, variables): Promise<ReadResourceResult> => {
      if (!pdfIndex) {
        throw new Error("PDF index not initialized");
      }
      const rawPdfId = Array.isArray(variables.pdfId)
        ? variables.pdfId[0]
        : variables.pdfId;
      // Decode URL-encoded pdfId (e.g., arxiv%3A2301.00001 -> arxiv:2301.00001)
      const pdfId = decodeURIComponent(rawPdfId as string);
      const entry = findEntryById(pdfIndex, pdfId);
      if (!entry) {
        throw new Error(`PDF not found: ${pdfId}`);
      }

      // Load PDF binary data
      const data = await loadPdfData(entry);
      const base64 = Buffer.from(data).toString("base64");

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/pdf",
            blob: base64,
          },
        ],
      };
    },
  );


  // Tool: view_pdf (with UI)
  registerAppTool(
    server,
    "view_pdf",
    {
      title: "View PDF",
      description: `Open an interactive PDF viewer with navigation controls.

Can view PDFs from:
- Indexed PDFs (use pdfId from list_pdfs)
- Any HTTP(s) URL to a PDF`,
      inputSchema: {
        pdfId: z
          .string()
          .optional()
          .describe(
            "PDF identifier from the index (e.g., 'local:abc123' or 'http:abc123')",
          ),
        url: z
          .string()
          .optional()
          .describe("HTTP(s) URL to a PDF file"),
        page: z
          .number()
          .min(1)
          .default(1)
          .describe("Initial page to display (1-based)"),
        maxChunkBytes: z
          .number()
          .default(500 * 1024) // 500KB
          .describe(
            "Maximum bytes per chunk when reading text (default: 500KB)",
          ),
      },
      outputSchema: z.object({
        pdfId: z.string(),
        pdfUri: z.string(),
        title: z.string(),
        sourceUrl: z.string().optional(),
        pageCount: z.number(),
        initialPage: z.number(),
        maxChunkBytes: z.number(),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ pdfId, url, page, maxChunkBytes }): Promise<CallToolResult> => {
      if (!pdfIndex) {
        throw new Error("PDF index not initialized");
      }

      let entry;

      if (pdfId) {
        // Look up by ID (takes precedence over url)
        entry = findEntryById(pdfIndex, pdfId);
        if (!entry) {
          throw new Error(
            `PDF not found: ${pdfId}. Use list_pdfs to see available PDFs.`,
          );
        }
      } else {
        // Use URL (default to demo paper if not provided)
        const pdfUrl = url ?? DEFAULT_PDF_URL;

        if (!isHttpUrl(pdfUrl)) {
          throw new Error(`URL must be HTTP(s). Got: ${pdfUrl}`);
        }

        // Check if already indexed
        const existingEntry = pdfIndex.entries.find(
          (e) => e.sourcePath === pdfUrl,
        );
        if (existingEntry) {
          entry = existingEntry;
        } else {
          // Create and index on-the-fly
          const newEntry = await createHttpEntry(pdfUrl);
          await populatePdfMetadata(newEntry);
          pdfIndex.entries.push(newEntry);
          pdfIndex.totalPdfs++;
          pdfIndex.totalPages += newEntry.metadata.pageCount;
          pdfIndex.totalSizeBytes += newEntry.metadata.fileSizeBytes;
          entry = newEntry;
        }
      }

      // Include source URL for HTTP sources - allows linking to original
      const sourceUrl = entry.sourcePath.startsWith("http")
        ? entry.sourcePath
        : undefined;

      const result = {
        pdfId: entry.id,
        pdfUri: `pdfs://content/${encodeURIComponent(entry.id)}`,
        title: entry.displayName,
        sourceUrl,
        pageCount: entry.metadata.pageCount,
        initialPage: Math.min(page ?? 1, entry.metadata.pageCount),
        maxChunkBytes: maxChunkBytes ?? 500 * 1024,
      };

      return {
        content: [
          {
            type: "text",
            text: `Opening PDF viewer for "${entry.displayName}" (${entry.metadata.pageCount} pages)`,
          },
        ],
        structuredContent: result,
      };
    },
  );

  // Register the MCP App resource (the UI)
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}

/**
 * Parse CLI arguments.
 */
function parseArgs(): { sources: string[]; stdio: boolean } {
  const args = process.argv.slice(2);
  const sources: string[] = [];
  let stdio = false;

  for (const arg of args) {
    if (arg === "--stdio") {
      stdio = true;
    } else if (!arg.startsWith("-")) {
      sources.push(arg);
    }
  }

  return { sources, stdio };
}

async function main() {
  const { sources, stdio } = parseArgs();

  // Use default paper if no sources provided
  const effectiveSources = sources.length > 0 ? sources : [DEFAULT_PDF_URL];
  if (sources.length === 0) {
    console.error(
      `[pdf-server] No sources provided, using default: ${DEFAULT_PDF_URL}`,
    );
  }

  // Build the PDF index
  console.error("[pdf-server] Building index...");
  pdfIndex = await buildPdfIndex(effectiveSources);
  console.error(`[pdf-server] Ready: ${pdfIndex.totalPdfs} PDFs indexed`);

  if (stdio) {
    await createServer().connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3110", 10);
    await startServer(createServer, { port, name: "PDF Server" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
