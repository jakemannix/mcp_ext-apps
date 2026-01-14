/**
 * PDF Server Types - Simplified for didactic purposes
 */
import { z } from "zod";

// ============================================================================
// Core Types
// ============================================================================

export const PdfMetadataSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  pageCount: z.number(),
  fileSizeBytes: z.number(),
});
export type PdfMetadata = z.infer<typeof PdfMetadataSchema>;

export const PdfEntrySchema = z.object({
  url: z.string(), // Also serves as unique ID
  metadata: PdfMetadataSchema,
});
export type PdfEntry = z.infer<typeof PdfEntrySchema>;

export const PdfIndexSchema = z.object({
  entries: z.array(PdfEntrySchema),
});
export type PdfIndex = z.infer<typeof PdfIndexSchema>;

// ============================================================================
// Chunked Binary Loading
// ============================================================================

/** Max bytes per response chunk */
export const MAX_CHUNK_BYTES = 500 * 1024; // 500KB

export const PdfBytesChunkSchema = z.object({
  url: z.string(),
  bytes: z.string(), // base64
  offset: z.number(),
  byteCount: z.number(),
  totalBytes: z.number(),
  hasMore: z.boolean(),
});
export type PdfBytesChunk = z.infer<typeof PdfBytesChunkSchema>;

export const ReadPdfBytesInputSchema = z.object({
  url: z.string().describe("PDF URL"),
  offset: z.number().min(0).default(0).describe("Byte offset"),
  byteCount: z.number().default(MAX_CHUNK_BYTES).describe("Bytes to read"),
});
export type ReadPdfBytesInput = z.infer<typeof ReadPdfBytesInputSchema>;
