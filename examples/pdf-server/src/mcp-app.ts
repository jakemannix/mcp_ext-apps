/**
 * PDF Viewer MCP App
 *
 * An interactive PDF viewer using PDF.js with navigation controls.
 * Fetches PDF content via MCP resources and renders pages.
 */
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ReadResourceResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as pdfjsLib from "pdfjs-dist";
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
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;
let pdfTitle = "";

// DOM Elements
const mainEl = document.querySelector(".main") as HTMLElement;
const loadingEl = document.getElementById("loading")!;
const loadingTextEl = document.getElementById("loading-text")!;
const errorEl = document.getElementById("error")!;
const errorMessageEl = document.getElementById("error-message")!;
const viewerEl = document.getElementById("viewer")!;
const canvasEl = document.getElementById("pdf-canvas") as HTMLCanvasElement;
const titleEl = document.getElementById("pdf-title")!;
const pageInfoEl = document.getElementById("page-info")!;
const prevBtn = document.getElementById("prev-btn") as HTMLButtonElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
const zoomOutBtn = document.getElementById("zoom-out-btn") as HTMLButtonElement;
const zoomInBtn = document.getElementById("zoom-in-btn") as HTMLButtonElement;
const zoomLevelEl = document.getElementById("zoom-level")!;

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
  pageInfoEl.textContent = `Page ${currentPage} of ${totalPages}`;
  titleEl.textContent = pdfTitle;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
}

// Render current page
async function renderPage() {
  if (!pdfDocument) return;

  try {
    const page = await pdfDocument.getPage(currentPage);
    const viewport = page.getViewport({ scale });

    // Set canvas dimensions
    const ctx = canvasEl.getContext("2d")!;
    canvasEl.width = viewport.width;
    canvasEl.height = viewport.height;

    // Render
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page.render as any)({
      canvasContext: ctx,
      viewport,
    }).promise;

    updateControls();
  } catch (err) {
    log.error("Error rendering page:", err);
    showError(`Failed to render page ${currentPage}`);
  }
}

// Navigation
function goToPage(page: number) {
  if (page >= 1 && page <= totalPages) {
    currentPage = page;
    renderPage();
  }
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

// Event listeners
prevBtn.addEventListener("click", prevPage);
nextBtn.addEventListener("click", nextPage);
zoomOutBtn.addEventListener("click", zoomOut);
zoomInBtn.addEventListener("click", zoomIn);

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowLeft":
    case "PageUp":
      prevPage();
      break;
    case "ArrowRight":
    case "PageDown":
    case " ":
      nextPage();
      break;
    case "+":
    case "=":
      zoomIn();
      break;
    case "-":
      zoomOut();
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

// Create app instance
const app = new App({ name: "PDF Viewer", version: "1.0.0" });

// Handle tool result
app.ontoolresult = async (result) => {
  log.info("Received tool result:", result);

  const parsed = parseToolResult(result);
  if (!parsed) {
    showError("Invalid tool result - could not parse PDF info");
    return;
  }

  const { pdfUri, title, pageCount, initialPage } = parsed;
  pdfTitle = title;
  totalPages = pageCount;
  currentPage = initialPage;

  log.info("PDF URI:", pdfUri, "Title:", title, "Pages:", pageCount);

  showLoading("Fetching PDF content...");

  try {
    // Fetch PDF binary via MCP resource
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

    // Convert base64 to Uint8Array
    const binaryString = atob(content.blob);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Load PDF with PDF.js
    pdfDocument = await pdfjsLib.getDocument({ data: bytes }).promise;
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
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
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
