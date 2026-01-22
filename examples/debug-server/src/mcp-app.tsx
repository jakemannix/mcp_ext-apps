/**
 * @file Debug MCP App - Comprehensive testing UI for MCP Apps SDK features.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useAutoResize, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./mcp-app.module.css";

// ============================================================================
// Types
// ============================================================================

interface LogEntry {
  id: number;
  timestamp: number;
  type: string;
  payload: unknown;
}

type LogAction =
  | { type: "add"; entry: Omit<LogEntry, "id"> }
  | { type: "clear" };

// ============================================================================
// Utilities
// ============================================================================

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

let logIdCounter = 0;
function logReducer(state: LogEntry[], action: LogAction): LogEntry[] {
  switch (action.type) {
    case "add":
      return [...state, { ...action.entry, id: ++logIdCounter }];
    case "clear":
      return [];
  }
}

// ============================================================================
// Components
// ============================================================================

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <section className={`${styles.section} ${isOpen ? "" : styles.collapsed}`}>
      <header
        className={styles.sectionHeader}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={styles.toggle}>{isOpen ? "▼" : "▶"}</span>
        <h2>{title}</h2>
      </header>
      {isOpen && <div className={styles.sectionContent}>{children}</div>}
    </section>
  );
}

function EventLog({
  entries,
  filter,
  onFilterChange,
  onClear,
}: {
  entries: LogEntry[];
  filter: string;
  onFilterChange: (filter: string) => void;
  onClear: () => void;
}) {
  const filteredEntries = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((e) => e.type === filter);
  }, [entries, filter]);

  const eventTypes = useMemo(() => {
    const types = new Set(entries.map((e) => e.type));
    return ["all", ...Array.from(types).sort()];
  }, [entries]);

  return (
    <div className={styles.eventLog}>
      <div className={styles.logControls}>
        <select value={filter} onChange={(e) => onFilterChange(e.target.value)}>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t} {t !== "all" && `(${entries.filter((e) => e.type === t).length})`}
            </option>
          ))}
        </select>
        <button onClick={onClear}>Clear Log</button>
        <span className={styles.logCount}>
          {filteredEntries.length} / {entries.length} entries
        </span>
      </div>
      <div className={styles.logEntries}>
        {filteredEntries.map((entry) => (
          <div key={entry.id} className={`${styles.logEntry} ${styles[`log-${entry.type}`] || ""}`}>
            <span className={styles.logTime}>{formatTime(entry.timestamp)}</span>
            <span className={styles.logType}>{entry.type}</span>
            <pre className={styles.logPayload}>
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function StylesPanel({ hostContext }: { hostContext?: McpUiHostContext }) {
  const variables = hostContext?.styles?.variables;
  const theme = hostContext?.theme;

  const groupedVariables = useMemo(() => {
    if (!variables) return {};
    const groups: Record<string, Array<[string, string]>> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (!value) continue;
      const match = key.match(/^--([^-]+)/);
      const group = match ? match[1] : "other";
      if (!groups[group]) groups[group] = [];
      groups[group].push([key, value]);
    }
    return groups;
  }, [variables]);

  if (!variables || Object.keys(variables).length === 0) {
    return <p className={styles.noData}>No host styles available</p>;
  }

  return (
    <div className={styles.stylesPanel}>
      <div className={styles.themeInfo}>
        <strong>Theme:</strong> <code>{theme || "not set"}</code>
      </div>
      {Object.entries(groupedVariables).map(([group, vars]) => (
        <div key={group} className={styles.styleGroup}>
          <h4>{group}</h4>
          <div className={styles.styleGrid}>
            {vars.map(([key, value]) => (
              <div key={key} className={styles.styleItem}>
                <div
                  className={styles.styleSwatch}
                  style={{ background: value }}
                  title={value}
                />
                <code className={styles.styleKey}>{key.replace(/^--/, "")}</code>
                <code className={styles.styleValue}>{value}</code>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HostInfoPanel({ hostContext }: { hostContext?: McpUiHostContext }) {
  return (
    <div className={styles.infoPanel}>
      <div className={styles.infoGroup}>
        <h4>Host Context</h4>
        <pre>{JSON.stringify(hostContext ?? {}, null, 2)}</pre>
      </div>
    </div>
  );
}

function CallbackStatusPanel({
  callbacks,
}: {
  callbacks: Map<string, { count: number; lastPayload?: unknown }>;
}) {
  return (
    <table className={styles.callbackTable}>
      <thead>
        <tr>
          <th>Callback</th>
          <th>Count</th>
          <th>Last Payload</th>
        </tr>
      </thead>
      <tbody>
        {Array.from(callbacks.entries()).map(([name, { count, lastPayload }]) => (
          <tr key={name}>
            <td><code>{name}</code></td>
            <td>{count}</td>
            <td>
              {lastPayload !== undefined ? (
                <pre>{JSON.stringify(lastPayload, null, 2)}</pre>
              ) : (
                <span className={styles.noData}>-</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================================
// Main App
// ============================================================================

function DebugApp() {
  const [log, dispatchLog] = useReducer(logReducer, []);
  const [logFilter, setLogFilter] = useState("all");
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [callbacks, setCallbacks] = useState<Map<string, { count: number; lastPayload?: unknown }>>(
    () => new Map([
      ["ontoolinput", { count: 0 }],
      ["ontoolinputpartial", { count: 0 }],
      ["ontoolresult", { count: 0 }],
      ["ontoolcancelled", { count: 0 }],
      ["onhostcontextchanged", { count: 0 }],
      ["onteardown", { count: 0 }],
      ["oncalltool", { count: 0 }],
      ["onlisttools", { count: 0 }],
      ["onerror", { count: 0 }],
    ])
  );

  const addLog = useCallback((type: string, payload: unknown) => {
    dispatchLog({ type: "add", entry: { timestamp: Date.now(), type, payload } });
  }, []);

  const trackCallback = useCallback((name: string, payload?: unknown) => {
    setCallbacks((prev) => {
      const next = new Map(prev);
      const current = next.get(name) || { count: 0 };
      next.set(name, { count: current.count + 1, lastPayload: payload });
      return next;
    });
  }, []);

  const { app, error } = useApp({
    appInfo: { name: "Debug App", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = async (input) => {
        addLog("tool-input", input);
        trackCallback("ontoolinput", input);
      };

      app.ontoolinputpartial = (input) => {
        addLog("tool-input-partial", input);
        trackCallback("ontoolinputpartial", input);
      };

      app.ontoolresult = async (result) => {
        addLog("tool-result", result);
        trackCallback("ontoolresult", result);
        setToolResult(result);
      };

      app.ontoolcancelled = (params) => {
        addLog("tool-cancelled", params);
        trackCallback("ontoolcancelled", params);
      };

      app.onhostcontextchanged = (ctx) => {
        addLog("host-context-changed", ctx);
        trackCallback("onhostcontextchanged", ctx);
        setHostContext((prev) => ({ ...prev, ...ctx }));
      };

      app.onteardown = async (params) => {
        addLog("teardown", params);
        trackCallback("onteardown", params);
        return {};
      };

      app.oncalltool = async (params) => {
        addLog("call-tool", params);
        trackCallback("oncalltool", params);
        return { content: [{ type: "text", text: "App handled tool call" }] };
      };

      app.onlisttools = async (params) => {
        addLog("list-tools", params);
        trackCallback("onlisttools", params);
        return { tools: [] };
      };

      app.onerror = (error) => {
        addLog("error", error);
        trackCallback("onerror", error);
      };
    },
  });

  useEffect(() => {
    if (app) {
      addLog("connected", { success: true });
      setHostContext(app.getHostContext());
    }
  }, [app, addLog]);

  useHostStyles(app, hostContext);
  useAutoResize(app);

  if (error) {
    return (
      <main className={styles.main}>
        <div className={styles.error}>
          <strong>Connection Error:</strong> {error.message}
        </div>
      </main>
    );
  }

  if (!app) {
    return (
      <main className={styles.main}>
        <div className={styles.loading}>Connecting to host...</div>
      </main>
    );
  }

  return (
    <DebugAppInner
      app={app}
      hostContext={hostContext}
      toolResult={toolResult}
      log={log}
      logFilter={logFilter}
      setLogFilter={setLogFilter}
      clearLog={() => dispatchLog({ type: "clear" })}
      addLog={addLog}
      callbacks={callbacks}
    />
  );
}

interface DebugAppInnerProps {
  app: App;
  hostContext?: McpUiHostContext;
  toolResult: CallToolResult | null;
  log: LogEntry[];
  logFilter: string;
  setLogFilter: (filter: string) => void;
  clearLog: () => void;
  addLog: (type: string, payload: unknown) => void;
  callbacks: Map<string, { count: number; lastPayload?: unknown }>;
}

function DebugAppInner({
  app,
  hostContext,
  log,
  logFilter,
  setLogFilter,
  clearLog,
  addLog,
  callbacks,
}: DebugAppInnerProps) {
  // Message panel state
  const [messageText, setMessageText] = useState("Hello from debug app!");

  // Tool call state
  const [toolName, setToolName] = useState("debug-echo");
  const [toolArgs, setToolArgs] = useState('{"message": "test"}');

  // Context update state
  const [contextText, setContextText] = useState("Debug context update");

  // Handlers
  const handleSendMessage = useCallback(async () => {
    try {
      addLog("send-message", { text: messageText });
      const result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: messageText }],
      });
      addLog("send-message-result", result);
    } catch (e) {
      addLog("error", e);
    }
  }, [app, messageText, addLog]);

  const handleCallTool = useCallback(async () => {
    try {
      const args = JSON.parse(toolArgs);
      addLog("call-server-tool", { name: toolName, arguments: args });
      const result = await app.callServerTool({ name: toolName, arguments: args });
      addLog("call-server-tool-result", result);
    } catch (e) {
      addLog("error", e);
    }
  }, [app, toolName, toolArgs, addLog]);

  const handleUpdateContext = useCallback(async () => {
    try {
      addLog("update-context", { text: contextText });
      await app.updateModelContext({
        content: [{ type: "text", text: contextText }],
      });
      addLog("update-context-done", {});
    } catch (e) {
      addLog("error", e);
    }
  }, [app, contextText, addLog]);

  const handleSendLog = useCallback(async () => {
    try {
      await app.sendLog({ level: "info", data: "Test log from debug app" });
      addLog("send-log-done", {});
    } catch (e) {
      addLog("error", e);
    }
  }, [app, addLog]);

  const handleOpenLink = useCallback(async () => {
    try {
      const result = await app.openLink({ url: "https://modelcontextprotocol.io" });
      addLog("open-link-result", result);
    } catch (e) {
      addLog("error", e);
    }
  }, [app, addLog]);

  return (
    <main
      className={styles.main}
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <h1 className={styles.title}>MCP Apps Debug Server</h1>

      <div className={styles.columns}>
        <div className={styles.leftColumn}>
          <CollapsibleSection title="Event Log" defaultOpen={true}>
            <EventLog
              entries={log}
              filter={logFilter}
              onFilterChange={setLogFilter}
              onClear={clearLog}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Callback Status" defaultOpen={false}>
            <CallbackStatusPanel callbacks={callbacks} />
          </CollapsibleSection>
        </div>

        <div className={styles.rightColumn}>
          <CollapsibleSection title="Host Styles" defaultOpen={true}>
            <StylesPanel hostContext={hostContext} />
          </CollapsibleSection>

          <CollapsibleSection title="Host Info" defaultOpen={false}>
            <HostInfoPanel hostContext={hostContext} />
          </CollapsibleSection>

          <CollapsibleSection title="Actions" defaultOpen={true}>
            <div className={styles.actionGroup}>
              <h4>Send Message</h4>
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={2}
              />
              <button onClick={handleSendMessage}>Send Message</button>
            </div>

            <div className={styles.actionGroup}>
              <h4>Call Server Tool</h4>
              <input
                type="text"
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
                placeholder="Tool name"
              />
              <textarea
                value={toolArgs}
                onChange={(e) => setToolArgs(e.target.value)}
                placeholder='{"arg": "value"}'
                rows={2}
              />
              <button onClick={handleCallTool}>Call Tool</button>
            </div>

            <div className={styles.actionGroup}>
              <h4>Update Context</h4>
              <input
                type="text"
                value={contextText}
                onChange={(e) => setContextText(e.target.value)}
                placeholder="Context text"
              />
              <button onClick={handleUpdateContext}>Update Context</button>
            </div>

            <div className={styles.actionGroup}>
              <h4>Other Actions</h4>
              <div className={styles.buttonRow}>
                <button onClick={handleSendLog}>Send Log</button>
                <button onClick={handleOpenLink}>Open Link</button>
              </div>
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </main>
  );
}

// ============================================================================
// Mount
// ============================================================================

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DebugApp />
  </StrictMode>
);
