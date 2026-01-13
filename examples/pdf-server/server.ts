/**
 * PDF MCP Server
 *
 * An MCP server that indexes and serves PDF files from local directories and arxiv URLs.
 *
 * Usage:
 *   bun server.ts ./papers/ ./thesis.pdf                    # Local files
 *   bun server.ts https://arxiv.org/pdf/2301.12345.pdf      # arxiv URL
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
} from "./src/pdf-indexer.js";
import {
  loadPdfData,
  loadPdfTextChunk,
  populatePdfMetadata,
} from "./src/pdf-loader.js";
import { isArxivUrl, createArxivEntry } from "./src/arxiv.js";
import { generateClaudeMd } from "./src/claude-md.js";
import {
  ReadPdfTextInputSchema,
  ListPdfsInputSchema,
  ListPdfsOutputSchema,
  PdfTextChunkSchema,
  MAX_TOOL_RESPONSE_BYTES,
  type PdfIndex,
  type ReadPdfTextInput,
  type ListPdfsInput,
} from "./src/types.js";
import { startServer } from "./server-utils.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://pdf-viewer/mcp-app.html";

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

  // Resource: CLAUDE.md index
  server.registerResource(
    "PDF Index",
    "pdfs://index/CLAUDE.md",
    {
      mimeType: "text/markdown",
      description: "Hierarchical markdown index of all loaded PDFs",
    },
    async (): Promise<ReadResourceResult> => {
      if (!pdfIndex) {
        throw new Error("PDF index not initialized");
      }
      const markdown = generateClaudeMd(pdfIndex);
      return {
        contents: [
          {
            uri: "pdfs://index/CLAUDE.md",
            mimeType: "text/markdown",
            text: markdown,
          },
        ],
      };
    },
  );

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
        : pdfIndex.flatEntries;

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

      return {
        content: [{ type: "text", text: output.text }],
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

  // Default arxiv paper for demo
  const DEFAULT_PDF_URL = "https://arxiv.org/pdf/2312.00752.pdf"; // "Mamba: Linear-Time Sequence Modeling with Selective State Spaces"

  // Tool: view_pdf (with UI)
  registerAppTool(
    server,
    "view_pdf",
    {
      title: "View PDF",
      description: `Open an interactive PDF viewer with navigation controls.

Can view PDFs from:
- Indexed PDFs (use pdfId from list_pdfs)
- arxiv URLs (provide a URL)

Default: Opens "Practices for Governing Agentic AI Systems" paper.`,
      inputSchema: {
        pdfId: z
          .string()
          .optional()
          .describe(
            "PDF identifier from the index (e.g., 'local:abc123' or 'arxiv:2301.12345')",
          ),
        url: z
          .string()
          .url()
          .default(DEFAULT_PDF_URL)
          .describe("arxiv PDF URL to view"),
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
        // Use URL (has default from schema)
        const pdfUrl = url!; // Always defined due to .default()

        if (!isArxivUrl(pdfUrl)) {
          throw new Error(`Only arxiv URLs are supported. Got: ${pdfUrl}`);
        }

        // Check if already indexed
        const existingEntry = pdfIndex.flatEntries.find(
          (e) => e.sourcePath === pdfUrl,
        );
        if (existingEntry) {
          entry = existingEntry;
        } else {
          // Create and index on-the-fly
          const newEntry = await createArxivEntry(pdfUrl);
          if (!newEntry) {
            throw new Error(`Failed to create entry for: ${pdfUrl}`);
          }
          await populatePdfMetadata(newEntry);
          pdfIndex.flatEntries.push(newEntry);
          pdfIndex.totalPdfs++;
          pdfIndex.totalPages += newEntry.metadata.pageCount;
          pdfIndex.totalSizeBytes += newEntry.metadata.fileSizeBytes;
          entry = newEntry;
        }
      }

      // Include source URL for HTTP sources (arxiv) - allows linking to original
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

  if (sources.length === 0) {
    console.error("Usage: bun server.ts [--stdio] <source1> [source2] ...");
    console.error("");
    console.error("Sources can be:");
    console.error("  - Local directories (scanned recursively)");
    console.error("  - Individual PDF files");
    console.error(
      "  - arxiv URLs (https://arxiv.org/pdf/... or https://arxiv.org/abs/...)",
    );
    console.error("");
    console.error("Options:");
    console.error("  --stdio    Use stdio transport for MCP clients");
    process.exit(1);
  }

  // Build the PDF index
  console.error("[pdf-server] Building index...");
  pdfIndex = await buildPdfIndex(sources);
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
