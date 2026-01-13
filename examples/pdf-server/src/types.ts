/**
 * PDF Server Type Definitions
 *
 * Zod schemas and TypeScript types for the PDF loading MCP server.
 */
import { z } from "zod";

// ============================================================================
// Constants
// ============================================================================

/** Default maximum chunk size in bytes (5MB) */
export const DEFAULT_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

/** Safe limit for tool response to stay under 1MB limit (~900KB) */
export const MAX_TOOL_RESPONSE_BYTES = 900 * 1024;

/** Regex to match arxiv PDF URLs: https://arxiv.org/pdf/XXXX.XXXXX.pdf */
export const ARXIV_PDF_REGEX =
  /^https:\/\/arxiv\.org\/pdf\/(\d+\.\d+)(v\d+)?\.pdf$/;

/** Regex to match arxiv abstract URLs: https://arxiv.org/abs/XXXX.XXXXX */
export const ARXIV_ABS_REGEX = /^https:\/\/arxiv\.org\/abs\/(\d+\.\d+)(v\d+)?$/;

// ============================================================================
// Source Type
// ============================================================================

export const PdfSourceTypeSchema = z.enum(["local", "arxiv"]);
export type PdfSourceType = z.infer<typeof PdfSourceTypeSchema>;

// ============================================================================
// PDF Metadata
// ============================================================================

export const PdfMetadataSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  subject: z.string().optional(),
  creator: z.string().optional(),
  producer: z.string().optional(),
  creationDate: z.string().optional(),
  modDate: z.string().optional(),
  pageCount: z.number(),
  fileSizeBytes: z.number(),
});
export type PdfMetadata = z.infer<typeof PdfMetadataSchema>;

// ============================================================================
// PDF Entry
// ============================================================================

export const PdfEntrySchema = z.object({
  /** Unique identifier: "local:<hash>" or "arxiv:<paper-id>" */
  id: z.string(),
  /** Source type discriminator */
  sourceType: PdfSourceTypeSchema,
  /** Original file path or arxiv URL */
  sourcePath: z.string(),
  /** Human-readable display name */
  displayName: z.string(),
  /** Relative path for hierarchical display (local files only) */
  relativePath: z.string().optional(),
  /** PDF metadata extracted from the file */
  metadata: PdfMetadataSchema,
  /** Estimated text size in bytes (for chunking hints) */
  estimatedTextSize: z.number(),
});
export type PdfEntry = z.infer<typeof PdfEntrySchema>;

// ============================================================================
// PDF Folder (Hierarchical Structure)
// ============================================================================

export interface PdfFolder {
  /** Folder name (empty for root) */
  name: string;
  /** PDF entries in this folder */
  entries: PdfEntry[];
  /** Subfolders */
  subfolders: PdfFolder[];
}

export const PdfFolderSchema: z.ZodType<PdfFolder> = z.lazy(() =>
  z.object({
    name: z.string(),
    entries: z.array(PdfEntrySchema),
    subfolders: z.array(PdfFolderSchema),
  }),
);

// ============================================================================
// PDF Index
// ============================================================================

export const PdfIndexSchema = z.object({
  /** ISO timestamp when index was generated */
  generatedAt: z.string(),
  /** Hierarchical folder structure */
  rootFolders: z.array(PdfFolderSchema),
  /** Flattened list of all entries for quick lookup */
  flatEntries: z.array(PdfEntrySchema),
  /** Total number of PDFs indexed */
  totalPdfs: z.number(),
  /** Total number of pages across all PDFs */
  totalPages: z.number(),
  /** Total size of all PDFs in bytes */
  totalSizeBytes: z.number(),
});
export type PdfIndex = z.infer<typeof PdfIndexSchema>;

// ============================================================================
// PDF Text Chunk (for paginated loading)
// ============================================================================

export const PdfTextChunkSchema = z.object({
  /** PDF identifier */
  pdfId: z.string(),
  /** Start page number (1-based) */
  startPage: z.number().min(1),
  /** End page number (1-based, inclusive) */
  endPage: z.number().min(1),
  /** Total number of pages in the PDF */
  totalPages: z.number(),
  /** Extracted text content */
  text: z.string(),
  /** Size of the text in bytes */
  textSizeBytes: z.number(),
  /** Whether there are more pages to load */
  hasMore: z.boolean(),
  /** Next page to start from (if hasMore is true) */
  nextStartPage: z.number().optional(),
});
export type PdfTextChunk = z.infer<typeof PdfTextChunkSchema>;

// ============================================================================
// Tool Input/Output Schemas
// ============================================================================

export const ReadPdfTextInputSchema = z.object({
  pdfId: z.string().describe("PDF identifier from the index"),
  startPage: z.number().min(1).default(1).describe("Start page (1-based)"),
  maxBytes: z
    .number()
    .default(DEFAULT_CHUNK_SIZE_BYTES)
    .describe("Maximum bytes to return in this chunk"),
});
export type ReadPdfTextInput = z.infer<typeof ReadPdfTextInputSchema>;

export const ListPdfsInputSchema = z.object({
  folder: z.string().optional().describe("Filter by folder path prefix"),
});
export type ListPdfsInput = z.infer<typeof ListPdfsInputSchema>;

export const ListPdfsOutputSchema = z.object({
  entries: z.array(PdfEntrySchema),
  totalCount: z.number(),
});
export type ListPdfsOutput = z.infer<typeof ListPdfsOutputSchema>;
