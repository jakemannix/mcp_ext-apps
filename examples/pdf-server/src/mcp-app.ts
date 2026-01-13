/**
 * PDF Viewer MCP App
 *
 * Interactive PDF viewer with single-page display.
 * - Fixed height (no auto-resize)
 * - Text selection via PDF.js TextLayer
 * - Page navigation, zoom, download
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

// DOM Elements
const mainEl = document.querySelector(".main") as HTMLElement;
const loadingEl = document.getElementById("loading")!;
const loadingTextEl = document.getElementById("loading-text")!;
const errorEl = document.getElementById("error")!;
const errorMessageEl = document.getElementById("error-message")!;
const viewerEl = document.getElementById("viewer")!;
const canvasEl = document.getElementById("pdf-canvas") as HTMLCanvasElement;
const textLayerEl = document.getElementById("text-layer")!;
const titleEl = document.getElementById("pdf-title")!;
const pageInputEl = document.getElementById("page-input") as HTMLInputElement;
const totalPagesEl = document.getElementById("total-pages")!;
const prevBtn = document.getElementById("prev-btn") as HTMLButtonElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
const zoomOutBtn = document.getElementById("zoom-out-btn") as HTMLButtonElement;
const zoomInBtn = document.getElementById("zoom-in-btn") as HTMLButtonElement;
const zoomLevelEl = document.getElementById("zoom-level")!;
const downloadBtn = document.getElementById("download-btn") as HTMLButtonElement;
const fullscreenBtn = document.getElementById("fullscreen-btn") as HTMLButtonElement;

// Track current display mode
let currentDisplayMode: "inline" | "fullscreen" = "inline";

// Create app instance
// autoResize disabled - app fills its container, doesn't request size changes
const app = new App(
  { name: "PDF Viewer", version: "1.0.0" },
  {},
  { autoResize: false },
);

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

// Render current page with text layer for selection
async function renderPage() {
  if (!pdfDocument) return;

  try {
    const page = await pdfDocument.getPage(currentPage);
    const viewport = page.getViewport({ scale });

    // Set canvas dimensions
    const ctx = canvasEl.getContext("2d")!;
    canvasEl.width = viewport.width;
    canvasEl.height = viewport.height;
    canvasEl.style.width = `${viewport.width}px`;
    canvasEl.style.height = `${viewport.height}px`;

    // Clear and setup text layer
    textLayerEl.innerHTML = "";
    textLayerEl.style.width = `${viewport.width}px`;
    textLayerEl.style.height = `${viewport.height}px`;

    // Render canvas
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page.render as any)({
      canvasContext: ctx,
      viewport,
    }).promise;

    // Render text layer for selection
    const textContent = await page.getTextContent();
    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: textLayerEl,
      viewport,
    });
    await textLayer.render();

    updateControls();
    updatePageContext();
  } catch (err) {
    log.error("Error rendering page:", err);
    showError(`Failed to render page ${currentPage}`);
  }
}

// Navigation
function goToPage(page: number) {
  const targetPage = Math.max(1, Math.min(page, totalPages));
  if (targetPage !== currentPage) {
    currentPage = targetPage;
    renderPage();
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
  renderPage();
}

function zoomOut() {
  scale = Math.max(scale - 0.25, 0.5);
  renderPage();
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

async function toggleFullscreen() {
  const ctx = app.getHostContext();
  if (!ctx?.availableDisplayModes?.includes("fullscreen")) {
    log.info("Fullscreen not available");
    return;
  }

  const newMode = currentDisplayMode === "fullscreen" ? "inline" : "fullscreen";
  log.info("Requesting display mode:", newMode);

  try {
    const result = await app.requestDisplayMode({ mode: newMode });
    log.info("Display mode result:", result);
    currentDisplayMode = result.mode as "inline" | "fullscreen";
    updateFullscreenButton();
  } catch (err) {
    log.error("Failed to change display mode:", err);
  }
}

function updateFullscreenButton() {
  fullscreenBtn.textContent = currentDisplayMode === "fullscreen" ? "⛶" : "⛶";
  fullscreenBtn.title = currentDisplayMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen";
}

// Event listeners
prevBtn.addEventListener("click", prevPage);
nextBtn.addEventListener("click", nextPage);
zoomOutBtn.addEventListener("click", zoomOut);
zoomInBtn.addEventListener("click", zoomIn);
downloadBtn.addEventListener("click", downloadPdf);
fullscreenBtn.addEventListener("click", toggleFullscreen);

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

    showViewer();
    renderPage();
  } catch (err) {
    log.error("Error loading PDF:", err);
    showError(err instanceof Error ? err.message : String(err));
  }
};

app.onerror = (err) => {
  log.error("App error:", err);
  showError(err instanceof Error ? err.message : String(err));
};

function handleHostContextChanged(ctx: McpUiHostContext) {
  log.info("Host context changed:", ctx);

  // Apply safe area insets
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }

  // Log containerDimensions for debugging
  if (ctx.containerDimensions) {
    log.info("Container dimensions:", ctx.containerDimensions);
  }

  // Handle display mode changes
  if (ctx.displayMode) {
    currentDisplayMode = ctx.displayMode as "inline" | "fullscreen";
    if (ctx.displayMode === "fullscreen") {
      mainEl.classList.add("fullscreen");
      log.info("Fullscreen mode enabled");
    } else {
      mainEl.classList.remove("fullscreen");
      log.info("Inline mode");
    }
    updateFullscreenButton();
  }
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
