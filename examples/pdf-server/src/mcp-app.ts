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
let pdfSourceUrl: string | undefined;
let pdfId = "";
let currentRenderTask: { cancel: () => void } | null = null;

// DOM Elements
const mainEl = document.querySelector(".main") as HTMLElement;
const loadingEl = document.getElementById("loading")!;
const loadingTextEl = document.getElementById("loading-text")!;
const errorEl = document.getElementById("error")!;
const errorMessageEl = document.getElementById("error-message")!;
const viewerEl = document.getElementById("viewer")!;
const canvasContainerEl = document.querySelector(".canvas-container")!;
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
const downloadBtn = document.getElementById(
  "download-btn",
) as HTMLButtonElement;
const fullscreenBtn = document.getElementById(
  "fullscreen-btn",
) as HTMLButtonElement;
const progressContainerEl = document.getElementById("progress-container")!;
const progressBarEl = document.getElementById("progress-bar")!;
const progressTextEl = document.getElementById("progress-text")!;

// Track current display mode
let currentDisplayMode: "inline" | "fullscreen" = "inline";

// Layout constants are no longer used - we calculate dynamically from actual element dimensions

/**
 * Request the host to resize the app to fit the current PDF page.
 * Only applies in inline mode - fullscreen mode uses scrolling.
 */
function requestFitToContent() {
  if (currentDisplayMode === "fullscreen") {
    return; // Fullscreen uses scrolling
  }

  const canvasHeight = canvasEl.height;
  if (canvasHeight <= 0) {
    return; // No content yet
  }

  // Get actual element dimensions
  const canvasContainerEl = document.querySelector(
    ".canvas-container",
  ) as HTMLElement;
  const pageWrapperEl = document.querySelector(".page-wrapper") as HTMLElement;
  const toolbarEl = document.querySelector(".toolbar") as HTMLElement;

  if (!canvasContainerEl || !toolbarEl || !pageWrapperEl) {
    return;
  }

  // Get computed styles
  const containerStyle = getComputedStyle(canvasContainerEl);
  const paddingTop = parseFloat(containerStyle.paddingTop);
  const paddingBottom = parseFloat(containerStyle.paddingBottom);

  // Calculate required height:
  // toolbar + padding-top + page-wrapper height + padding-bottom + buffer
  const toolbarHeight = toolbarEl.offsetHeight;
  const pageWrapperHeight = pageWrapperEl.offsetHeight;
  const BUFFER = 10; // Buffer for sub-pixel rounding and browser quirks
  const totalHeight =
    toolbarHeight + paddingTop + pageWrapperHeight + paddingBottom + BUFFER;

  app.sendSizeChanged({ height: totalHeight });
}

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
  // Make title clickable if we have a source URL
  titleEl.textContent = pdfTitle;
  if (pdfSourceUrl) {
    titleEl.style.textDecoration = "underline";
    titleEl.style.cursor = "pointer";
    titleEl.onclick = () => {
      if (pdfSourceUrl) {
        app.openLink({ url: pdfSourceUrl });
      }
    };
  } else {
    titleEl.style.textDecoration = "none";
    titleEl.style.cursor = "default";
    titleEl.onclick = null;
  }
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

// Render state - prevents concurrent renders
let isRendering = false;
let pendingPage: number | null = null;

// Render current page with text layer for selection
async function renderPage() {
  if (!pdfDocument) return;

  // If already rendering, queue this page for later
  if (isRendering) {
    pendingPage = currentPage;
    // Cancel current render to speed up
    if (currentRenderTask) {
      currentRenderTask.cancel();
    }
    return;
  }

  isRendering = true;
  pendingPage = null;

  try {
    const pageToRender = currentPage;
    const page = await pdfDocument.getPage(pageToRender);
    const viewport = page.getViewport({ scale });

    // Get fresh context and clear canvas
    const ctx = canvasEl.getContext("2d")!;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    // Set canvas dimensions
    canvasEl.width = viewport.width;
    canvasEl.height = viewport.height;
    canvasEl.style.width = `${viewport.width}px`;
    canvasEl.style.height = `${viewport.height}px`;

    // Clear and setup text layer
    textLayerEl.innerHTML = "";
    textLayerEl.style.width = `${viewport.width}px`;
    textLayerEl.style.height = `${viewport.height}px`;

    // Render canvas - track the task so we can cancel it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderTask = (page.render as any)({
      canvasContext: ctx,
      viewport,
    });
    currentRenderTask = renderTask;

    try {
      await renderTask.promise;
    } catch (renderErr) {
      // Ignore RenderingCancelledException - it's expected when we cancel
      if (
        renderErr instanceof Error &&
        renderErr.name === "RenderingCancelledException"
      ) {
        log.info("Render cancelled");
        return;
      }
      throw renderErr;
    } finally {
      currentRenderTask = null;
    }

    // Only continue if this is still the page we want
    if (pageToRender !== currentPage) {
      return;
    }

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

    // Request host to resize app to fit content (inline mode only)
    requestFitToContent();
  } catch (err) {
    log.error("Error rendering page:", err);
    showError(`Failed to render page ${currentPage}`);
  } finally {
    isRendering = false;

    // If there's a pending page, render it now
    if (pendingPage !== null && pendingPage !== currentPage) {
      currentPage = pendingPage;
      renderPage();
    } else if (pendingPage === currentPage) {
      // Re-render the same page (e.g., after zoom change during render)
      renderPage();
    }
  }
}

// Page persistence
function getStorageKey(): string | null {
  const ctx = app.getHostContext();
  const toolId = ctx?.toolInfo?.id;
  if (!pdfSourceUrl || toolId === undefined) {
    return null;
  }
  return `pdf:${pdfSourceUrl}:${toolId}`;
}

function saveCurrentPage() {
  const key = getStorageKey();
  if (key) {
    try {
      localStorage.setItem(key, String(currentPage));
    } catch {
      // Ignore storage errors
    }
  }
}

function loadSavedPage(): number | null {
  const key = getStorageKey();
  if (!key) return null;
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const page = parseInt(saved, 10);
      if (!isNaN(page) && page >= 1) {
        return page;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

// Navigation
function goToPage(page: number) {
  const targetPage = Math.max(1, Math.min(page, totalPages));
  if (targetPage !== currentPage) {
    currentPage = targetPage;
    saveCurrentPage();
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
  fullscreenBtn.title =
    currentDisplayMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen";
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
    case "Escape":
      if (currentDisplayMode === "fullscreen") {
        toggleFullscreen();
        e.preventDefault();
      }
      break;
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

// Horizontal scroll/swipe to change pages
let horizontalScrollAccumulator = 0;
const SCROLL_THRESHOLD = 50; // pixels of horizontal scroll to trigger page change

canvasContainerEl.addEventListener(
  "wheel",
  (event) => {
    const e = event as WheelEvent;
    // Only handle horizontal scroll (touchpad swipe or shift+scroll)
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
      return; // Vertical scroll - let it scroll normally
    }

    // Check if navigation would be valid before preventing default
    const wouldGoNext = e.deltaX > 0 && currentPage < totalPages;
    const wouldGoPrev = e.deltaX < 0 && currentPage > 1;
    if (!wouldGoNext && !wouldGoPrev) {
      return; // Don't prevent default - let browser handle (e.g., back navigation)
    }

    e.preventDefault();
    horizontalScrollAccumulator += e.deltaX;

    if (horizontalScrollAccumulator > SCROLL_THRESHOLD) {
      nextPage();
      horizontalScrollAccumulator = 0;
    } else if (horizontalScrollAccumulator < -SCROLL_THRESHOLD) {
      prevPage();
      horizontalScrollAccumulator = 0;
    }
  },
  { passive: false },
);

// Parse tool result
function parseToolResult(result: CallToolResult): {
  pdfId: string;
  pdfUri: string;
  title: string;
  sourceUrl?: string;
  pageCount: number;
  initialPage: number;
} | null {
  return result.structuredContent as {
    pdfId: string;
    pdfUri: string;
    title: string;
    sourceUrl?: string;
    pageCount: number;
    initialPage: number;
  } | null;
}

// Chunked binary loading types
interface PdfBytesChunk {
  pdfId: string;
  bytes: string;
  offset: number;
  byteCount: number;
  totalBytes: number;
  hasMore: boolean;
}

// Update progress bar
function updateProgress(loaded: number, total: number) {
  const percent = Math.round((loaded / total) * 100);
  progressBarEl.style.width = `${percent}%`;
  progressTextEl.textContent = `${(loaded / 1024).toFixed(0)} KB / ${(total / 1024).toFixed(0)} KB (${percent}%)`;
}

// Load PDF in chunks with progress
async function loadPdfInChunks(pdfIdToLoad: string): Promise<Uint8Array> {
  const CHUNK_SIZE = 500 * 1024; // 500KB chunks
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let totalBytes = 0;
  let hasMore = true;

  // Show progress UI
  progressContainerEl.style.display = "block";
  updateProgress(0, 1);

  while (hasMore) {
    const result = await app.callServerTool({
      name: "read_pdf_bytes",
      arguments: {
        pdfId: pdfIdToLoad,
        offset,
        byteCount: CHUNK_SIZE,
      },
    });

    // Check for errors
    if (result.isError) {
      const errorText = result.content
        ?.map((c) => ("text" in c ? c.text : ""))
        .join(" ");
      throw new Error(`Tool error: ${errorText}`);
    }

    if (!result.structuredContent) {
      throw new Error("No structuredContent in tool response");
    }

    const chunk = result.structuredContent as unknown as PdfBytesChunk;
    totalBytes = chunk.totalBytes;
    hasMore = chunk.hasMore;

    // Decode base64 chunk
    const binaryString = atob(chunk.bytes);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    chunks.push(bytes);

    offset += chunk.byteCount;
    updateProgress(offset, totalBytes);
  }

  // Combine all chunks
  const fullPdf = new Uint8Array(totalBytes);
  let pos = 0;
  for (const chunk of chunks) {
    fullPdf.set(chunk, pos);
    pos += chunk.length;
  }

  log.info(
    `PDF loaded: ${(totalBytes / 1024).toFixed(0)} KB in ${chunks.length} chunks`,
  );
  return fullPdf;
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
  const { title, sourceUrl, pageCount, initialPage } = parsed;
  pdfTitle = title;
  pdfSourceUrl = sourceUrl;
  totalPages = pageCount;

  // Restore saved page or use initial page from tool result
  const savedPage = loadSavedPage();
  currentPage =
    savedPage && savedPage <= pageCount ? savedPage : initialPage;

  log.info(
    "PDF ID:",
    pdfId,
    "Title:",
    title,
    "Pages:",
    pageCount,
    "Starting at:",
    currentPage,
    savedPage ? "(restored)" : "",
  );

  showLoading("Loading PDF in chunks...");

  try {
    // Load PDF using chunked binary API
    pdfBytes = await loadPdfInChunks(pdfId);

    showLoading("Rendering PDF...");

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
    const wasFullscreen = currentDisplayMode === "fullscreen";
    currentDisplayMode = ctx.displayMode as "inline" | "fullscreen";
    if (ctx.displayMode === "fullscreen") {
      mainEl.classList.add("fullscreen");
      log.info("Fullscreen mode enabled");
    } else {
      mainEl.classList.remove("fullscreen");
      log.info("Inline mode");
      // When exiting fullscreen, request resize to fit content
      if (wasFullscreen && pdfDocument) {
        requestFitToContent();
      }
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
