/**
 * PDF Viewer MCP App
 *
 * Interactive PDF viewer with horizontal page scrolling and lazy loading.
 * - Fixed height based on viewport minus insets
 * - Horizontal scroll with snap points for page switching
 * - Lazy page rendering (only visible + adjacent pages)
 * - Text selection via PDF.js TextLayer
 */
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ReadResourceResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import "./global.css";
import "./mcp-app.css";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).href;

const log = {
  info: console.log.bind(console, "[PDF-VIEWER]"),
  error: console.error.bind(console, "[PDF-VIEWER]"),
};

// State
let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
let pdfBytes: Uint8Array | null = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;
let pdfTitle = "";
let pdfId = "";
let viewerHeight = 400; // Default, updated from host context
const renderedPages = new Set<number>();
const pageElements = new Map<number, HTMLElement>();

// DOM Elements
const mainEl = document.querySelector(".main") as HTMLElement;
const loadingEl = document.getElementById("loading")!;
const loadingTextEl = document.getElementById("loading-text")!;
const errorEl = document.getElementById("error")!;
const errorMessageEl = document.getElementById("error-message")!;
const viewerEl = document.getElementById("viewer")!;
const pagesContainerEl = document.getElementById("pages-container")!;
const titleEl = document.getElementById("pdf-title")!;
const pageInputEl = document.getElementById("page-input") as HTMLInputElement;
const totalPagesEl = document.getElementById("total-pages")!;
const prevBtn = document.getElementById("prev-btn") as HTMLButtonElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
const zoomOutBtn = document.getElementById("zoom-out-btn") as HTMLButtonElement;
const zoomInBtn = document.getElementById("zoom-in-btn") as HTMLButtonElement;
const zoomLevelEl = document.getElementById("zoom-level")!;
const downloadBtn = document.getElementById("download-btn") as HTMLButtonElement;

// Create app instance
const app = new App({ name: "PDF Viewer", version: "1.0.0" });

// UI State functions
function showLoading(text: string) {
  loadingTextEl.textContent = text;
  loadingEl.style.display = "flex";
  errorEl.style.display = "none";
  viewerEl.style.display = "none";
}

function showError(message: string) {
  errorMessageEl.textContent = message;
  loadingEl.style.display = "none";
  errorEl.style.display = "block";
  viewerEl.style.display = "none";
}

function showViewer() {
  loadingEl.style.display = "none";
  errorEl.style.display = "none";
  viewerEl.style.display = "flex";
}

function updateControls() {
  titleEl.textContent = pdfTitle;
  pageInputEl.value = String(currentPage);
  pageInputEl.max = String(totalPages);
  totalPagesEl.textContent = `of ${totalPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
}

// Extract text from current page and update model context
async function updatePageContext() {
  if (!pdfDocument) return;

  try {
    const page = await pdfDocument.getPage(currentPage);
    const textContent = await page.getTextContent();
    const pageText = (textContent.items as Array<{ str?: string }>)
      .map((item) => item.str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    app.updateModelContext({
      structuredContent: {
        pdfId,
        currentPage,
        totalPages,
        pageText: pageText.slice(0, 5000),
      },
    });
  } catch (err) {
    log.error("Error updating context:", err);
  }
}

// Create placeholder elements for all pages
function createPagePlaceholders() {
  pagesContainerEl.innerHTML = "";
  renderedPages.clear();
  pageElements.clear();

  for (let i = 1; i <= totalPages; i++) {
    const pageWrapper = document.createElement("div");
    pageWrapper.className = "page-wrapper";
    pageWrapper.dataset.page = String(i);

    const placeholder = document.createElement("div");
    placeholder.className = "page-placeholder";
    placeholder.textContent = `Page ${i}`;
    pageWrapper.appendChild(placeholder);

    pagesContainerEl.appendChild(pageWrapper);
    pageElements.set(i, pageWrapper);
  }
}

// Render a single page
async function renderPageContent(pageNum: number) {
  if (!pdfDocument || renderedPages.has(pageNum)) return;

  const pageWrapper = pageElements.get(pageNum);
  if (!pageWrapper) return;

  renderedPages.add(pageNum);

  try {
    const page = await pdfDocument.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    // Clear placeholder
    pageWrapper.innerHTML = "";

    // Create canvas
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-canvas";
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    // Create text layer
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "text-layer";
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;

    pageWrapper.appendChild(canvas);
    pageWrapper.appendChild(textLayerDiv);

    // Render canvas
    const ctx = canvas.getContext("2d")!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page.render as any)({
      canvasContext: ctx,
      viewport,
    }).promise;

    // Render text layer
    const textContent = await page.getTextContent();
    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport,
    });
    await textLayer.render();
  } catch (err) {
    log.error(`Error rendering page ${pageNum}:`, err);
    pageWrapper.innerHTML = `<div class="page-error">Failed to load page ${pageNum}</div>`;
  }
}

// Lazy load visible pages and adjacent ones
function loadVisiblePages() {
  // Render current page and 1 on each side
  const pagesToRender = [
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ].filter((p) => p >= 1 && p <= totalPages);

  pagesToRender.forEach((pageNum) => renderPageContent(pageNum));
}

// Scroll to a specific page
function scrollToPage(pageNum: number) {
  const pageWrapper = pageElements.get(pageNum);
  if (pageWrapper) {
    pageWrapper.scrollIntoView({ behavior: "smooth", inline: "start" });
  }
}

// Navigation
function goToPage(page: number) {
  const targetPage = Math.max(1, Math.min(page, totalPages));
  if (targetPage !== currentPage) {
    currentPage = targetPage;
    scrollToPage(currentPage);
    loadVisiblePages();
    updateControls();
    updatePageContext();
  }
  pageInputEl.value = String(currentPage);
}

function prevPage() {
  goToPage(currentPage - 1);
}

function nextPage() {
  goToPage(currentPage + 1);
}

function zoomIn() {
  scale = Math.min(scale + 0.25, 3.0);
  reRenderAllPages();
}

function zoomOut() {
  scale = Math.max(scale - 0.25, 0.5);
  reRenderAllPages();
}

function reRenderAllPages() {
  renderedPages.clear();
  loadVisiblePages();
  updateControls();
}

function downloadPdf() {
  if (!pdfBytes) return;
  const buffer = new Uint8Array(pdfBytes).buffer;
  const blob = new Blob([buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${pdfTitle || "document"}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Detect current page from scroll position
function handleScroll() {
  const container = pagesContainerEl;

  // Find which page is most visible
  let bestPage = 1;
  let bestVisibility = 0;

  pageElements.forEach((el, pageNum) => {
    const rect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const visibleWidth = Math.min(rect.right, containerRect.right) - Math.max(rect.left, containerRect.left);
    const visibility = Math.max(0, visibleWidth) / rect.width;

    if (visibility > bestVisibility) {
      bestVisibility = visibility;
      bestPage = pageNum;
    }
  });

  if (bestPage !== currentPage) {
    currentPage = bestPage;
    loadVisiblePages();
    updateControls();
    updatePageContext();
  }
}

// Event listeners
prevBtn.addEventListener("click", prevPage);
nextBtn.addEventListener("click", nextPage);
zoomOutBtn.addEventListener("click", zoomOut);
zoomInBtn.addEventListener("click", zoomIn);
downloadBtn.addEventListener("click", downloadPdf);

pageInputEl.addEventListener("change", () => {
  const page = parseInt(pageInputEl.value, 10);
  if (!isNaN(page)) {
    goToPage(page);
  } else {
    pageInputEl.value = String(currentPage);
  }
});

pageInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    pageInputEl.blur();
  }
});

// Scroll listener for page detection
pagesContainerEl.addEventListener("scroll", handleScroll);
pagesContainerEl.addEventListener("scrollend", () => {
  // Ensure we load pages after scroll settles
  loadVisiblePages();
});

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  if (document.activeElement === pageInputEl) return;

  switch (e.key) {
    case "ArrowLeft":
    case "PageUp":
      prevPage();
      e.preventDefault();
      break;
    case "ArrowRight":
    case "PageDown":
    case " ":
      nextPage();
      e.preventDefault();
      break;
    case "+":
    case "=":
      zoomIn();
      e.preventDefault();
      break;
    case "-":
      zoomOut();
      e.preventDefault();
      break;
  }
});

// Parse tool result
function parseToolResult(result: CallToolResult): {
  pdfId: string;
  pdfUri: string;
  title: string;
  pageCount: number;
  initialPage: number;
} | null {
  return result.structuredContent as {
    pdfId: string;
    pdfUri: string;
    title: string;
    pageCount: number;
    initialPage: number;
  } | null;
}

// Handle tool result
app.ontoolresult = async (result) => {
  log.info("Received tool result:", result);

  const parsed = parseToolResult(result);
  if (!parsed) {
    showError("Invalid tool result - could not parse PDF info");
    return;
  }

  pdfId = parsed.pdfId;
  const { pdfUri, title, pageCount, initialPage } = parsed;
  pdfTitle = title;
  totalPages = pageCount;
  currentPage = initialPage;

  log.info("PDF URI:", pdfUri, "Title:", title, "Pages:", pageCount);

  showLoading("Fetching PDF content...");

  try {
    const resourceResult = await app.request(
      { method: "resources/read", params: { uri: pdfUri } },
      ReadResourceResultSchema,
    );

    const content = resourceResult.contents[0];
    if (!content || !("blob" in content)) {
      throw new Error("Resource response did not contain blob data");
    }

    log.info("PDF received, blob size:", content.blob.length);

    showLoading("Loading PDF document...");

    const binaryString = atob(content.blob);
    pdfBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      pdfBytes[i] = binaryString.charCodeAt(i);
    }

    pdfDocument = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    totalPages = pdfDocument.numPages;

    log.info("PDF loaded, pages:", totalPages);

    // Create placeholders for all pages
    createPagePlaceholders();

    showViewer();

    // Initial render
    scrollToPage(currentPage);
    loadVisiblePages();
    updateControls();
    updatePageContext();
  } catch (err) {
    log.error("Error loading PDF:", err);
    showError(err instanceof Error ? err.message : String(err));
  }
};

app.onerror = (err) => {
  log.error("App error:", err);
  showError(err instanceof Error ? err.message : String(err));
};

function updateViewerHeight(ctx: McpUiHostContext) {
  // Calculate available height from viewport minus insets
  const insets = ctx.safeAreaInsets || { top: 0, bottom: 0, left: 0, right: 0 };
  const toolbarHeight = 48; // Approximate toolbar height
  viewerHeight = Math.max(300, window.innerHeight - insets.top - insets.bottom - toolbarHeight);

  // Set fixed height on pages container
  pagesContainerEl.style.height = `${viewerHeight}px`;
}

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
  updateViewerHeight(ctx);
}

app.onhostcontextchanged = handleHostContextChanged;

// Connect to host
app.connect().then(() => {
  log.info("Connected to host");
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
