/**
 * PDF Loader
 *
 * Loads PDFs using pdfjs-dist and extracts text content in chunks.
 */
import fs from "node:fs/promises";
import type { PdfEntry, PdfTextChunk, PdfBytesChunk } from "./types.js";
import {
  DEFAULT_CHUNK_SIZE_BYTES,
  DEFAULT_BINARY_CHUNK_SIZE,
} from "./types.js";

// Cache for loaded PDF data (to avoid re-fetching for chunked requests)
const pdfDataCache = new Map<string, Uint8Array>();

// Dynamic import for pdfjs-dist (ESM module)
let pdfjsLib: typeof import("pdfjs-dist");

async function getPdfjs() {
  if (!pdfjsLib) {
    // Use the legacy build for Node.js compatibility
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsLib;
}

/**
 * Load PDF binary data from a local file or URL.
 * Uses caching to avoid re-fetching for chunked requests.
 */
export async function loadPdfData(entry: PdfEntry): Promise<Uint8Array> {
  // Check cache first
  const cached = pdfDataCache.get(entry.id);
  if (cached) {
    return cached;
  }

  let data: Uint8Array;
  if (entry.sourceType === "local") {
    const buffer = await fs.readFile(entry.sourcePath);
    // Create a copy to own the buffer
    data = new Uint8Array(buffer.buffer.slice(0));
  } else {
    // Fetch from HTTP URL
    console.error(`[pdf-loader] Fetching: ${entry.sourcePath}`);
    const response = await fetch(entry.sourcePath);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch PDF: ${response.status} ${response.statusText}`,
      );
    }
    const buffer = await response.arrayBuffer();
    // Create a copy to own the buffer (avoid detachment issues)
    data = new Uint8Array(buffer.slice(0));
  }

  // Cache the data
  pdfDataCache.set(entry.id, data);
  return data;
}

/**
 * Fetch a range of bytes from an HTTP URL using Range requests.
 * Returns null if the server doesn't support Range requests.
 */
async function fetchHttpRange(
  url: string,
  start: number,
  end: number,
): Promise<{ data: Uint8Array; totalSize: number } | null> {
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
    });

    if (response.status === 206) {
      // Partial Content - Range request successful
      const contentRange = response.headers.get("Content-Range");
      const totalMatch = contentRange?.match(/\/(\d+)$/);
      const totalSize = totalMatch ? parseInt(totalMatch[1], 10) : 0;

      const buffer = await response.arrayBuffer();
      return {
        data: new Uint8Array(buffer.slice(0)),
        totalSize,
      };
    }

    // Server doesn't support Range requests
    return null;
  } catch {
    return null;
  }
}

/**
 * Load a chunk of PDF binary data.
 *
 * For HTTP sources, uses Range requests to fetch only the needed bytes.
 * Falls back to full fetch if Range requests are not supported.
 */
export async function loadPdfBytesChunk(
  entry: PdfEntry,
  offset: number = 0,
  byteCount: number = DEFAULT_BINARY_CHUNK_SIZE,
): Promise<PdfBytesChunk> {
  let chunk: Uint8Array;
  let totalBytes: number;

  // Try Range request for HTTP sources (only if not already cached)
  if (entry.sourceType === "http" && !pdfDataCache.has(entry.id)) {
    const endByte = offset + byteCount - 1;
    const rangeResult = await fetchHttpRange(entry.sourcePath, offset, endByte);

    if (rangeResult) {
      chunk = rangeResult.data;
      totalBytes = rangeResult.totalSize;

      console.error(
        `[pdf-loader] Range: offset=${offset}, bytes=${chunk.length}/${totalBytes}`,
      );

      const hasMore = offset + chunk.length < totalBytes;
      return {
        pdfId: entry.id,
        bytes: Buffer.from(chunk).toString("base64"),
        offset,
        byteCount: chunk.length,
        totalBytes,
        hasMore,
      };
    }
    // Fall through to full fetch if Range not supported
  }

  // Full fetch (local files or HTTP without Range support)
  const data = await loadPdfData(entry);
  totalBytes = data.length;

  // Clamp offset and byteCount to valid range
  const actualOffset = Math.min(offset, totalBytes);
  const actualByteCount = Math.min(byteCount, totalBytes - actualOffset);

  // Extract the chunk
  chunk = data.slice(actualOffset, actualOffset + actualByteCount);

  const hasMore = actualOffset + actualByteCount < totalBytes;

  console.error(
    `[pdf-loader] Chunk: offset=${actualOffset}, bytes=${actualByteCount}/${totalBytes}, hasMore=${hasMore}`,
  );

  return {
    pdfId: entry.id,
    bytes: Buffer.from(chunk).toString("base64"),
    offset: actualOffset,
    byteCount: chunk.length,
    totalBytes,
    hasMore,
  };
}

/**
 * Load PDF text content in chunks, respecting the byte size limit.
 *
 * Extracts text page-by-page and accumulates until hitting the size limit.
 * Returns a chunk with pagination info for continuation.
 */
export async function loadPdfTextChunk(
  entry: PdfEntry,
  startPage: number = 1,
  maxBytes: number = DEFAULT_CHUNK_SIZE_BYTES,
): Promise<PdfTextChunk> {
  const pdfjs = await getPdfjs();

  // Load PDF document - pass a copy to avoid buffer detachment
  const data = await loadPdfData(entry);
  const dataCopy = new Uint8Array(data);
  const pdf = await pdfjs.getDocument({ data: dataCopy }).promise;

  const totalPages = pdf.numPages;

  // Validate start page
  if (startPage < 1 || startPage > totalPages) {
    throw new Error(
      `Invalid startPage ${startPage}. PDF has ${totalPages} pages.`,
    );
  }

  let currentPage = startPage;
  let accumulatedText = "";
  let accumulatedBytes = 0;

  // Iterate pages until we hit the byte limit
  while (currentPage <= totalPages) {
    const page = await pdf.getPage(currentPage);

    try {
      const textContent = await page.getTextContent();

      // Extract text from page items (filter out TextMarkedContent)
      const pageText = (textContent.items as Array<{ str?: string }>)
        .map((item) => item.str || "")
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      // Format with page header
      const pageHeader = `\n\n--- Page ${currentPage} of ${totalPages} ---\n\n`;
      const formattedPage = pageHeader + pageText;
      const pageBytes = Buffer.byteLength(formattedPage, "utf-8");

      // Check if adding this page would exceed limit
      if (accumulatedBytes + pageBytes > maxBytes && currentPage > startPage) {
        // Don't include this page - we've hit the limit
        break;
      }

      accumulatedText += formattedPage;
      accumulatedBytes += pageBytes;
      currentPage++;
    } finally {
      // Clean up page resources to prevent memory leaks
      page.cleanup();
    }
  }

  // Clean up document
  await pdf.destroy();

  const hasMore = currentPage <= totalPages;

  return {
    pdfId: entry.id,
    startPage,
    endPage: currentPage - 1,
    totalPages,
    text: accumulatedText.trim(),
    textSizeBytes: accumulatedBytes,
    hasMore,
    nextStartPage: hasMore ? currentPage : undefined,
  };
}

/**
 * Populate PDF metadata by loading just the document info.
 *
 * This is more efficient than loading all pages - just reads the header.
 */
export async function populatePdfMetadata(entry: PdfEntry): Promise<void> {
  try {
    const pdfjs = await getPdfjs();
    const data = await loadPdfData(entry);

    // Update file size for HTTP entries (not known until fetched)
    if (entry.sourceType === "http" && entry.metadata.fileSizeBytes === 0) {
      entry.metadata.fileSizeBytes = data.byteLength;
    }

    // Pass a copy to pdfjs to avoid buffer detachment
    const dataCopy = new Uint8Array(data);
    const pdf = await pdfjs.getDocument({ data: dataCopy }).promise;

    try {
      // Get page count
      entry.metadata.pageCount = pdf.numPages;

      // Get document metadata
      const pdfMetadata = await pdf.getMetadata();
      const info = pdfMetadata.info as Record<string, unknown> | undefined;

      if (info) {
        // Extract standard PDF metadata fields
        if (typeof info.Title === "string" && info.Title) {
          entry.metadata.title = entry.metadata.title || info.Title;
        }
        if (typeof info.Author === "string" && info.Author) {
          entry.metadata.author = entry.metadata.author || info.Author;
        }
        if (typeof info.Subject === "string" && info.Subject) {
          entry.metadata.subject = entry.metadata.subject || info.Subject;
        }
        if (typeof info.Creator === "string") {
          entry.metadata.creator = info.Creator;
        }
        if (typeof info.Producer === "string") {
          entry.metadata.producer = info.Producer;
        }
        if (typeof info.CreationDate === "string") {
          entry.metadata.creationDate = info.CreationDate;
        }
        if (typeof info.ModDate === "string") {
          entry.metadata.modDate = info.ModDate;
        }
      }

      // Update display name from title if available
      if (
        entry.metadata.title &&
        (entry.displayName.startsWith("http:") ||
          entry.displayName === entry.id)
      ) {
        entry.displayName = entry.metadata.title;
      }

      // Estimate text size (~500 chars per page on average)
      entry.estimatedTextSize = pdf.numPages * 500;
    } finally {
      await pdf.destroy();
    }
  } catch (error) {
    console.error(
      `[pdf-loader] Error loading metadata for ${entry.sourcePath}: ${error}`,
    );
  }
}

