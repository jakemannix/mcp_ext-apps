/**
 * PDF Indexer
 *
 * Scans directories and builds a flat index of PDF files.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PdfIndex, PdfEntry } from "./types.js";
import { populatePdfMetadata } from "./pdf-loader.js";

/**
 * Check if a string is an HTTP(s) URL.
 */
export function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * Create a PdfEntry for an HTTP URL.
 */
export async function createHttpEntry(url: string): Promise<PdfEntry> {
  const id = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const urlPath = new URL(url).pathname;
  const filename = path.basename(urlPath, ".pdf") || url;

  return {
    id: `http:${id}`,
    sourceType: "http",
    sourcePath: url,
    displayName: filename,
    relativePath: undefined,
    metadata: { pageCount: 0, fileSizeBytes: 0 },
    estimatedTextSize: 0,
  };
}

/**
 * Build a PDF index from a list of sources.
 *
 * Sources can be:
 * - Local directories (scanned recursively)
 * - Individual PDF files
 * - HTTP(s) URLs to PDFs
 */
export async function buildPdfIndex(sources: string[]): Promise<PdfIndex> {
  const entries: PdfEntry[] = [];

  console.error(`[indexer] Building index from ${sources.length} source(s)...`);

  for (const source of sources) {
    if (isHttpUrl(source)) {
      console.error(`[indexer] Processing HTTP URL: ${source}`);
      const entry = await createHttpEntry(source);
      await populatePdfMetadata(entry);
      entries.push(entry);
      continue;
    }

    const stats = await fs.stat(source).catch(() => null);
    if (!stats) {
      console.error(`[indexer] Source not found: ${source}`);
      continue;
    }

    if (stats.isDirectory()) {
      console.error(`[indexer] Scanning directory: ${source}`);
      const dirEntries = await scanDirectory(source, source);
      entries.push(...dirEntries);
    } else if (source.toLowerCase().endsWith(".pdf")) {
      console.error(`[indexer] Processing PDF file: ${source}`);
      const entry = await createLocalEntry(source, path.dirname(source));
      if (entry) {
        entries.push(entry);
      }
    } else {
      console.error(`[indexer] Skipping non-PDF file: ${source}`);
    }
  }

  const index: PdfIndex = {
    generatedAt: new Date().toISOString(),
    entries,
    totalPdfs: entries.length,
    totalPages: entries.reduce((sum, e) => sum + e.metadata.pageCount, 0),
    totalSizeBytes: entries.reduce((sum, e) => sum + e.metadata.fileSizeBytes, 0),
  };

  console.error(
    `[indexer] Index complete: ${index.totalPdfs} PDFs, ${index.totalPages} pages, ${formatBytes(index.totalSizeBytes)}`,
  );

  return index;
}

/**
 * Recursively scan a directory for PDF files.
 */
async function scanDirectory(
  dirPath: string,
  rootPath: string,
): Promise<PdfEntry[]> {
  const entries: PdfEntry[] = [];
  const items = await fs.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    if (item.name.startsWith(".")) continue;

    const fullPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      const subEntries = await scanDirectory(fullPath, rootPath);
      entries.push(...subEntries);
    } else if (item.name.toLowerCase().endsWith(".pdf")) {
      const entry = await createLocalEntry(fullPath, rootPath);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

/**
 * Create a PdfEntry for a local PDF file.
 */
async function createLocalEntry(
  filePath: string,
  rootPath: string,
): Promise<PdfEntry | null> {
  try {
    const stats = await fs.stat(filePath);
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(rootPath, filePath);

    const id = createHash("sha256")
      .update(absolutePath)
      .digest("hex")
      .slice(0, 16);

    const entry: PdfEntry = {
      id: `local:${id}`,
      sourceType: "local",
      sourcePath: absolutePath,
      displayName: path.basename(filePath, ".pdf"),
      relativePath,
      metadata: { pageCount: 0, fileSizeBytes: stats.size },
      estimatedTextSize: 0,
    };

    await populatePdfMetadata(entry);
    return entry;
  } catch (error) {
    console.error(`[indexer] Error processing ${filePath}: ${error}`);
    return null;
  }
}

/**
 * Find an entry by ID in the index.
 */
export function findEntryById(
  index: PdfIndex,
  id: string,
): PdfEntry | undefined {
  return index.entries.find((e) => e.id === id);
}

/**
 * Filter entries by folder path prefix.
 */
export function filterEntriesByFolder(
  index: PdfIndex,
  folderPrefix: string,
): PdfEntry[] {
  return index.entries.filter(
    (e) => e.relativePath && e.relativePath.startsWith(folderPrefix),
  );
}

/**
 * Format bytes as human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
