/**
 * PDF Loader - Loads PDFs and extracts content in chunks
 *
 * Demonstrates:
 * - Chunked data loading with size limits
 * - HTTP Range requests for streaming
 * - Caching for repeated requests
 */
import fs from "node:fs/promises";
import type { PdfEntry, PdfBytesChunk } from "./types.js";
import { MAX_CHUNK_BYTES } from "./types.js";
import { isFileUrl } from "./pdf-indexer.js";

// Cache for loaded PDFs
const pdfCache = new Map<string, Uint8Array>();

// Lazy-load pdfjs
let pdfjs: typeof import("pdfjs-dist");
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjs;
}

// ============================================================================
// PDF Data Loading
// ============================================================================

/** Fetch PDF data (with caching) */
export async function loadPdfData(entry: PdfEntry): Promise<Uint8Array> {
  const cached = pdfCache.get(entry.url);
  if (cached) return cached;

  console.error(`[loader] Fetching: ${entry.url}`);

  let data: Uint8Array;
  if (isFileUrl(entry.url)) {
    const filePath = entry.url.replace("file://", "");
    data = new Uint8Array(await fs.readFile(filePath));
  } else {
    const response = await fetch(entry.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }
    data = new Uint8Array(await response.arrayBuffer());
  }

  pdfCache.set(entry.url, data);
  return data;
}

/** Try HTTP Range request for partial content */
async function fetchRange(
  url: string,
  start: number,
  end: number,
): Promise<{ data: Uint8Array; total: number } | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
    });
    if (res.status !== 206) return null;

    const total = parseInt(
      res.headers.get("Content-Range")?.split("/")[1] || "0",
    );
    return { data: new Uint8Array(await res.arrayBuffer()), total };
  } catch {
    return null;
  }
}

// ============================================================================
// Chunked Binary Loading (demonstrates size-limited responses)
// ============================================================================

export async function loadPdfBytesChunk(
  entry: PdfEntry,
  offset = 0,
  byteCount = MAX_CHUNK_BYTES,
): Promise<PdfBytesChunk> {
  // Try Range request first (streaming without full download)
  if (!pdfCache.has(entry.url)) {
    const range = await fetchRange(entry.url, offset, offset + byteCount - 1);
    if (range) {
      return {
        url: entry.url,
        bytes: Buffer.from(range.data).toString("base64"),
        offset,
        byteCount: range.data.length,
        totalBytes: range.total,
        hasMore: offset + range.data.length < range.total,
      };
    }
  }

  // Fallback: load full PDF and slice
  const data = await loadPdfData(entry);
  const chunk = data.slice(offset, offset + byteCount);

  return {
    url: entry.url,
    bytes: Buffer.from(chunk).toString("base64"),
    offset,
    byteCount: chunk.length,
    totalBytes: data.length,
    hasMore: offset + chunk.length < data.length,
  };
}

// ============================================================================
// Metadata Extraction
// ============================================================================

export async function populatePdfMetadata(entry: PdfEntry): Promise<void> {
  try {
    const lib = await getPdfjs();
    const data = await loadPdfData(entry);

    entry.metadata.fileSizeBytes = data.length;

    const pdf = await lib.getDocument({ data: new Uint8Array(data) }).promise;
    entry.metadata.pageCount = pdf.numPages;

    const info = (await pdf.getMetadata()).info as
      | Record<string, unknown>
      | undefined;
    if (info?.Title) entry.metadata.title = String(info.Title);
    if (info?.Author) entry.metadata.author = String(info.Author);

    await pdf.destroy();
  } catch (err) {
    console.error(`[loader] Metadata error: ${err}`);
  }
}
