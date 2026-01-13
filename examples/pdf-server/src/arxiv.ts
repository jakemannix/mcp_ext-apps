/**
 * arxiv URL Handling
 *
 * Parses arxiv URLs and fetches metadata from the arxiv API.
 */
import type { PdfEntry, PdfMetadata } from "./types.js";
import { ARXIV_PDF_REGEX, ARXIV_ABS_REGEX } from "./types.js";

/**
 * Normalize an arxiv URL to the PDF format.
 * Converts /abs/ URLs to /pdf/ URLs.
 *
 * @returns Normalized PDF URL or null if not an arxiv URL
 */
export function normalizeArxivUrl(url: string): string | null {
  // Already a PDF URL
  if (ARXIV_PDF_REGEX.test(url)) {
    return url;
  }

  // Convert abs URL to PDF URL
  const absMatch = url.match(ARXIV_ABS_REGEX);
  if (absMatch) {
    const arxivId = absMatch[1];
    const version = absMatch[2] || "";
    return `https://arxiv.org/pdf/${arxivId}${version}.pdf`;
  }

  return null;
}

/**
 * Extract the arxiv paper ID from a URL.
 *
 * @returns Paper ID like "2301.12345" or "2301.12345v2", or null if not an arxiv URL
 */
export function extractArxivId(url: string): string | null {
  const pdfMatch = url.match(ARXIV_PDF_REGEX);
  if (pdfMatch) {
    const id = pdfMatch[1];
    const version = pdfMatch[2] || "";
    return `${id}${version}`;
  }

  const absMatch = url.match(ARXIV_ABS_REGEX);
  if (absMatch) {
    const id = absMatch[1];
    const version = absMatch[2] || "";
    return `${id}${version}`;
  }

  return null;
}

/**
 * Check if a string is an arxiv URL (PDF or abs).
 */
export function isArxivUrl(url: string): boolean {
  return ARXIV_PDF_REGEX.test(url) || ARXIV_ABS_REGEX.test(url);
}

/**
 * Fetch metadata from the arxiv API.
 *
 * Uses the OAI-PMH API endpoint: https://export.arxiv.org/api/query
 */
export async function fetchArxivMetadata(
  url: string,
): Promise<Partial<PdfMetadata>> {
  const arxivId = extractArxivId(url);
  if (!arxivId) {
    return {};
  }

  // Strip version suffix for API query
  const baseId = arxivId.replace(/v\d+$/, "");
  const apiUrl = `https://export.arxiv.org/api/query?id_list=${baseId}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      console.error(`[arxiv] Failed to fetch metadata: ${response.status}`);
      return {};
    }

    const xml = await response.text();

    // Parse XML response (simple regex extraction)
    // The arxiv API returns Atom XML with <entry> elements
    // The first <title> is the feed title (query info), we want the entry title
    const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
    if (!entryMatch) {
      console.error("[arxiv] No entry found in API response");
      return {};
    }
    const entryXml = entryMatch[1];

    const titleMatch = entryXml.match(/<title>([^<]+)<\/title>/);
    const authorMatches = [
      ...entryXml.matchAll(/<author>\s*<name>([^<]+)<\/name>/g),
    ];
    const summaryMatch = entryXml.match(/<summary>([\s\S]*?)<\/summary>/);

    // Clean up extracted values
    const title = titleMatch?.[1]
      ?.replace(/\s+/g, " ")
      .trim()
      // Remove "Title: " prefix that sometimes appears
      .replace(/^Title:\s*/i, "");

    const authors = authorMatches.map((m) => m[1].trim()).join(", ");

    // Truncate abstract to reasonable length for subject field
    const abstract = summaryMatch?.[1]
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    return {
      title: title || undefined,
      author: authors || undefined,
      subject: abstract || undefined,
    };
  } catch (error) {
    console.error(`[arxiv] Error fetching metadata: ${error}`);
    return {};
  }
}

/**
 * Create a PdfEntry for an arxiv URL.
 *
 * Fetches metadata from the arxiv API. The page count and file size
 * will be populated later when the PDF is actually loaded.
 */
export async function createArxivEntry(url: string): Promise<PdfEntry | null> {
  const normalizedUrl = normalizeArxivUrl(url);
  if (!normalizedUrl) {
    return null;
  }

  const arxivId = extractArxivId(normalizedUrl);
  if (!arxivId) {
    return null;
  }

  console.error(`[arxiv] Creating entry for ${arxivId}`);

  // Fetch metadata from arxiv API
  const apiMetadata = await fetchArxivMetadata(normalizedUrl);

  const metadata: PdfMetadata = {
    ...apiMetadata,
    pageCount: 0, // Will be populated on first PDF load
    fileSizeBytes: 0, // Will be populated on first PDF load
  };

  return {
    id: `arxiv:${arxivId}`,
    sourceType: "arxiv",
    sourcePath: normalizedUrl,
    displayName: apiMetadata.title || `arxiv:${arxivId}`,
    relativePath: undefined, // arxiv entries are flat
    metadata,
    estimatedTextSize: 0, // Will be computed on first load
  };
}
