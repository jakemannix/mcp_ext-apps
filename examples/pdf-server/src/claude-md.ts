/**
 * CLAUDE.md Index Generator
 *
 * Generates a hierarchical markdown index of all PDFs in the library
 * with usage instructions for the read_pdf_text tool.
 */
import type { PdfEntry, PdfFolder, PdfIndex } from "./types.js";

/**
 * Format bytes into a human-readable string (e.g., "1.5 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  // Use 0 decimals for bytes, 1 decimal for larger units
  const decimals = i === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

/**
 * Render a single PDF entry as a markdown list item.
 */
function renderEntry(entry: PdfEntry): string {
  const parts: string[] = [];

  // ID and display name
  parts.push(`- **\`${entry.id}\`**: ${entry.displayName}`);

  // Metadata details
  const details: string[] = [];
  details.push(`${entry.metadata.pageCount} pages`);
  details.push(formatBytes(entry.metadata.fileSizeBytes));

  if (entry.metadata.author) {
    details.push(`by ${entry.metadata.author}`);
  }

  if (entry.metadata.title && entry.metadata.title !== entry.displayName) {
    details.push(`"${entry.metadata.title}"`);
  }

  parts[0] += ` (${details.join(", ")})`;

  return parts.join("");
}

/**
 * Render a folder and its contents as markdown.
 * Uses heading levels h3-h6 based on depth, then falls back to bold text.
 */
export function renderFolder(
  folder: PdfFolder,
  depth: number,
  lines: string[],
): void {
  // Determine heading level (depth 0 = h3, depth 3 = h6, depth 4+ = bold)
  const headingLevel = Math.min(depth + 3, 6);

  if (folder.name) {
    if (headingLevel <= 6) {
      lines.push(`${"#".repeat(headingLevel)} ${folder.name}`);
    } else {
      lines.push(`**${folder.name}**`);
    }
    lines.push("");
  }

  // Render entries in this folder
  for (const entry of folder.entries) {
    lines.push(renderEntry(entry));
  }

  if (folder.entries.length > 0 && folder.subfolders.length > 0) {
    lines.push("");
  }

  // Recursively render subfolders
  for (const subfolder of folder.subfolders) {
    renderFolder(subfolder, depth + 1, lines);
  }
}

/**
 * Generate a CLAUDE.md markdown index from the PDF index.
 */
export function generateClaudeMd(index: PdfIndex): string {
  const lines: string[] = [];

  // Header
  lines.push("# PDF Library Index");
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total PDFs**: ${index.totalPdfs}`);
  lines.push(`- **Total Pages**: ${index.totalPages.toLocaleString()}`);
  lines.push(`- **Total Size**: ${formatBytes(index.totalSizeBytes)}`);
  lines.push(`- **Generated**: ${index.generatedAt}`);
  lines.push("");

  // How to Use section
  lines.push("## How to Use");
  lines.push("");
  lines.push(
    "Use the `read_pdf_text` tool to extract text from any PDF in this library.",
  );
  lines.push("The tool supports chunked reading for large documents.");
  lines.push("");
  lines.push("### Basic Usage");
  lines.push("");
  lines.push("```json");
  lines.push(`{`);
  lines.push(`  "pdfId": "<id from list below>",`);
  lines.push(`  "startPage": 1`);
  lines.push(`}`);
  lines.push("```");
  lines.push("");
  lines.push("### Paginated Reading");
  lines.push("");
  lines.push("For large PDFs, use the `nextStartPage` from the response:");
  lines.push("");
  lines.push("```json");
  lines.push(`{`);
  lines.push(`  "pdfId": "<id>",`);
  lines.push(`  "startPage": 10,`);
  lines.push(`  "maxBytes": 100000`);
  lines.push(`}`);
  lines.push("```");
  lines.push("");
  lines.push(
    "The response includes `hasMore: true` and `nextStartPage` when more pages are available.",
  );
  lines.push("");

  // Contents section
  lines.push("## Contents");
  lines.push("");

  if (index.rootFolders.length === 0 && index.flatEntries.length === 0) {
    lines.push("*No PDFs indexed.*");
    lines.push("");
  } else {
    // Render hierarchical folder structure
    for (const folder of index.rootFolders) {
      renderFolder(folder, 0, lines);
      lines.push("");
    }
  }

  return lines.join("\n");
}
