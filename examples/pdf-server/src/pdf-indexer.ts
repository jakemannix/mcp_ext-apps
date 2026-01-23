/**
 * PDF Indexer
 */
import path from "node:path";
import type { PdfIndex, PdfEntry } from "./types.js";
import { populatePdfMetadata } from "./pdf-loader.js";

/** Check if URL is from arxiv.org */
export function isArxivUrl(url: string): boolean {
  return /^https?:\/\/arxiv\.org\//.test(url);
}

/** Normalize arxiv URL to PDF format */
export function normalizeArxivUrl(url: string): string {
  return url.replace(/arxiv\.org\/abs\//, "arxiv.org/pdf/");
}

/** Check if URL is a file:// URL */
export function isFileUrl(url: string): boolean {
  return url.startsWith("file://");
}

/** Convert local path to file:// URL */
export function toFileUrl(filePath: string): string {
  return `file://${path.resolve(filePath)}`;
}

/** Create a PdfEntry from a URL */
export function createEntry(url: string): PdfEntry {
  return {
    url,
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

/** Find entry by URL */
export function findEntryByUrl(
  index: PdfIndex,
  url: string,
): PdfEntry | undefined {
  return index.entries.find((e) => e.url === url);
}
