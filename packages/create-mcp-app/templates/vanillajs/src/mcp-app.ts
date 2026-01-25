/**
 * MCP App using vanilla JavaScript
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./global.css";
import "./mcp-app.css";

function extractTime(result: CallToolResult): string {
  const textContent = result.content?.find((c) => c.type === "text");
  return textContent && "text" in textContent ? textContent.text : "[ERROR]";
}

const mainEl = document.querySelector(".main") as HTMLElement;
const serverTimeEl = document.getElementById("server-time")!;
const getTimeBtn = document.getElementById("get-time-btn")!;

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

// 1. Create app instance
const app = new App({ name: "MCP App", version: "1.0.0" });

// 2. Register handlers BEFORE connecting
app.onteardown = async () => {
  console.info("App is being torn down");
  return {};
};

app.ontoolinput = (params) => {
  console.info("Received tool call input:", params);
};

app.ontoolresult = (result) => {
  console.info("Received tool call result:", result);
  serverTimeEl.textContent = extractTime(result);
};

app.ontoolcancelled = (params) => {
  console.info("Tool call cancelled:", params.reason);
};

app.onerror = console.error;

app.onhostcontextchanged = handleHostContextChanged;

getTimeBtn.addEventListener("click", async () => {
  try {
    console.info("Calling get-time tool...");
    const result = await app.callServerTool({
      name: "get-time",
      arguments: {},
    });
    console.info("get-time result:", result);
    serverTimeEl.textContent = extractTime(result);
  } catch (e) {
    console.error(e);
    serverTimeEl.textContent = "[ERROR]";
  }
});

// 3. Connect to host
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
