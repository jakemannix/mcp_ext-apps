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
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  buildPdfIndex,
  findEntryById,
  filterEntriesByFolder,
} from "./src/pdf-indexer.js";
import { loadPdfTextChunk } from "./src/pdf-loader.js";
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

  // Tool: read_pdf_text (app-only visibility for chunked reading)
  server.tool(
    "read_pdf_text",
    "Extract text from a PDF with chunked pagination for large documents",
    ReadPdfTextInputSchema.shape,
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
