/**
 * PDF Indexer - Simplified URL-based indexing
 */
import { createHash } from "node:crypto";
import path from "node:path";
import type { PdfIndex, PdfEntry } from "./types.js";
import { populatePdfMetadata } from "./pdf-loader.js";

/** Check if URL is from arxiv.org */
export function isArxivUrl(url: string): boolean {
  return url.startsWith("https://arxiv.org/") || url.startsWith("http://arxiv.org/");
}

/** Check if URL is a file:// URL */
export function isFileUrl(url: string): boolean {
  return url.startsWith("file://");
}

/** Convert local path to file:// URL */
export function toFileUrl(filePath: string): string {
  const abs = path.resolve(filePath);
  return `file://${abs}`;
}

/** Create a PdfEntry from a URL */
export function createEntry(url: string): PdfEntry {
  const id = createHash("sha256").update(url).digest("hex").slice(0, 8);
  const filename = new URL(url).pathname.split("/").pop()?.replace(".pdf", "") || "document";

  return {
    id,
    url,
    displayName: filename,
    metadata: { pageCount: 0, fileSizeBytes: 0 },
  };
}

/** Build index from a list of URLs */
export async function buildPdfIndex(urls: string[]): Promise<PdfIndex> {
  const entries: PdfEntry[] = [];

  for (const url of urls) {
    console.error(`[indexer] Loading: ${url}`);
    const entry = createEntry(url);
    await populatePdfMetadata(entry);
    entries.push(entry);
  }

  console.error(`[indexer] Indexed ${entries.length} PDFs`);
  return { entries };
}

/** Find entry by ID */
export function findEntryById(index: PdfIndex, id: string): PdfEntry | undefined {
  return index.entries.find((e) => e.id === id);
}
