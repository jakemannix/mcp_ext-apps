/**
 * PDF Indexer
 *
 * Scans directories and builds a hierarchical index of PDF files.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PdfIndex, PdfEntry, PdfFolder } from "./types.js";
import { isArxivUrl, createArxivEntry } from "./arxiv.js";
import { populatePdfMetadata } from "./pdf-loader.js";

/**
 * Build a PDF index from a list of sources.
 *
 * Sources can be:
 * - Local directories (scanned recursively)
 * - Individual PDF files
 * - arxiv URLs (https://arxiv.org/pdf/... or https://arxiv.org/abs/...)
 */
export async function buildPdfIndex(sources: string[]): Promise<PdfIndex> {
  const entries: PdfEntry[] = [];
  const rootFolders: PdfFolder[] = [];
  const arxivEntries: PdfEntry[] = [];

  console.error(`[indexer] Building index from ${sources.length} source(s)...`);

  for (const source of sources) {
    // Check if it's an arxiv URL
    if (isArxivUrl(source)) {
      console.error(`[indexer] Processing arxiv URL: ${source}`);
      const entry = await createArxivEntry(source);
      if (entry) {
        await populatePdfMetadata(entry);
        arxivEntries.push(entry);
        entries.push(entry);
      }
      continue;
    }

    // Check if it's a local path
    const stats = await fs.stat(source).catch(() => null);
    if (!stats) {
      console.error(`[indexer] Source not found: ${source}`);
      continue;
    }

    if (stats.isDirectory()) {
      console.error(`[indexer] Scanning directory: ${source}`);
      const folder = await scanDirectory(source, source);
      if (folder.entries.length > 0 || folder.subfolders.length > 0) {
        rootFolders.push(folder);
        collectEntries(folder, entries);
      }
    } else if (source.toLowerCase().endsWith(".pdf")) {
      console.error(`[indexer] Processing PDF file: ${source}`);
      const entry = await createLocalEntry(source, path.dirname(source));
      if (entry) {
        rootFolders.push({
          name: path.basename(path.dirname(source)) || ".",
          entries: [entry],
          subfolders: [],
        });
        entries.push(entry);
      }
    } else {
      console.error(`[indexer] Skipping non-PDF file: ${source}`);
    }
  }

  // Add arxiv entries as a virtual folder if any exist
  if (arxivEntries.length > 0) {
    rootFolders.push({
      name: "arxiv",
      entries: arxivEntries,
      subfolders: [],
    });
  }

  const index: PdfIndex = {
    generatedAt: new Date().toISOString(),
    rootFolders,
    flatEntries: entries,
    totalPdfs: entries.length,
    totalPages: entries.reduce((sum, e) => sum + e.metadata.pageCount, 0),
    totalSizeBytes: entries.reduce(
      (sum, e) => sum + e.metadata.fileSizeBytes,
      0,
    ),
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
): Promise<PdfFolder> {
  const entries: PdfEntry[] = [];
  const subfolders: PdfFolder[] = [];

  const items = await fs.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    // Skip hidden files/folders
    if (item.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      const subfolder = await scanDirectory(fullPath, rootPath);
      // Only include non-empty folders
      if (subfolder.entries.length > 0 || subfolder.subfolders.length > 0) {
        subfolders.push(subfolder);
      }
    } else if (item.name.toLowerCase().endsWith(".pdf")) {
      const entry = await createLocalEntry(fullPath, rootPath);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return {
    name: path.basename(dirPath),
    entries,
    subfolders,
  };
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

    // Generate stable ID from absolute path hash
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
      metadata: {
        pageCount: 0,
        fileSizeBytes: stats.size,
      },
      estimatedTextSize: 0,
    };

    // Load PDF metadata
    await populatePdfMetadata(entry);

    return entry;
  } catch (error) {
    console.error(`[indexer] Error processing ${filePath}: ${error}`);
    return null;
  }
}

/**
 * Collect all entries from a folder tree into a flat array.
 */
function collectEntries(folder: PdfFolder, entries: PdfEntry[]): void {
  entries.push(...folder.entries);
  for (const subfolder of folder.subfolders) {
    collectEntries(subfolder, entries);
  }
}

/**
 * Find an entry by ID in the index.
 */
export function findEntryById(
  index: PdfIndex,
  id: string,
): PdfEntry | undefined {
  return index.flatEntries.find((e) => e.id === id);
}

/**
 * Filter entries by folder path prefix.
 */
export function filterEntriesByFolder(
  index: PdfIndex,
  folderPrefix: string,
): PdfEntry[] {
  return index.flatEntries.filter(
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
