import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { OpenAITransport, isOpenAIEnvironment } from "./transport";
import type { OpenAIGlobal, WindowWithOpenAI } from "./types";

describe("isOpenAIEnvironment", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    // Restore original window
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  test("returns false when window is undefined", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(isOpenAIEnvironment()).toBe(false);
  });

  test("returns false when window.openai is undefined", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(isOpenAIEnvironment()).toBe(false);
  });

  test("returns true when window.openai is an object", () => {
    (globalThis as { window?: unknown }).window = {
      openai: {},
    };
    expect(isOpenAIEnvironment()).toBe(true);
  });
});

describe("OpenAITransport", () => {
  let mockOpenAI: OpenAIGlobal;

  beforeEach(() => {
    mockOpenAI = {
      theme: "dark",
      locale: "en-US",
      displayMode: "inline",
      maxHeight: 600,
      toolInput: { location: "Tokyo" },
      toolOutput: { temperature: 22 },
      callTool: mock(() =>
        Promise.resolve({ content: { result: "success" } }),
      ) as unknown as OpenAIGlobal["callTool"],
      sendFollowUpMessage: mock(() =>
        Promise.resolve(),
      ) as unknown as OpenAIGlobal["sendFollowUpMessage"],
      openExternal: mock(() =>
        Promise.resolve(),
      ) as unknown as OpenAIGlobal["openExternal"],
      notifyIntrinsicHeight: mock(
        () => {},
      ) as unknown as OpenAIGlobal["notifyIntrinsicHeight"],
    };

    (globalThis as { window?: unknown }).window = {
      openai: mockOpenAI,
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test("throws when window.openai is not available", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => new OpenAITransport()).toThrow(
      "OpenAITransport requires window.openai",
    );
  });

  test("constructs successfully when window.openai is available", () => {
    const transport = new OpenAITransport();
    expect(transport).toBeDefined();
  });

  test("start() completes without error", async () => {
    const transport = new OpenAITransport();
    await expect(transport.start()).resolves.toBeUndefined();
  });

  test("close() calls onclose callback", async () => {
    const transport = new OpenAITransport();
    const onclose = mock(() => {});
    transport.onclose = onclose;

    await transport.close();

    expect(onclose).toHaveBeenCalled();
  });

  describe("ui/initialize request", () => {
    test("returns synthesized host info from window.openai", async () => {
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          hostInfo: { name: "ChatGPT", version: "1.0.0" },
          hostContext: {
            theme: "dark",
            locale: "en-US",
            displayMode: "inline",
          },
        },
      });
    });

    test("dynamically reports capabilities based on available methods", async () => {
      // Remove callTool to test dynamic detection
      delete mockOpenAI.callTool;

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = (response as { result: { hostCapabilities: unknown } })
        .result.hostCapabilities as Record<string, unknown>;

      // serverTools should NOT be present since callTool is missing
      expect(result.serverTools).toBeUndefined();
      // openLinks should be present since openExternal exists
      expect(result.openLinks).toBeDefined();
      // logging is always available
      expect(result.logging).toBeDefined();
    });

    test("includes availableDisplayModes when requestDisplayMode is available", async () => {
      mockOpenAI.requestDisplayMode = mock(() =>
        Promise.resolve(),
      ) as unknown as OpenAIGlobal["requestDisplayMode"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          hostContext: {
            availableDisplayModes: ["inline", "pip", "fullscreen"],
          },
        },
      });
    });
  });

  describe("tools/call request", () => {
    test("delegates to window.openai.callTool()", async () => {
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_weather",
          arguments: { location: "Tokyo" },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOpenAI.callTool).toHaveBeenCalledWith("get_weather", {
        location: "Tokyo",
      });
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        result: expect.any(Object),
      });
    });

    test("returns error when callTool is not available", async () => {
      delete mockOpenAI.callTool;
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "test_tool" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 3,
        error: {
          code: -32601,
          message: expect.stringContaining("not supported"),
        },
      });
    });
  });

  describe("ui/message request", () => {
    test("delegates to window.openai.sendFollowUpMessage()", async () => {
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 4,
        method: "ui/message",
        params: {
          role: "user",
          content: [{ type: "text", text: "Hello!" }],
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOpenAI.sendFollowUpMessage).toHaveBeenCalledWith({
        prompt: "Hello!",
      });
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 4,
        result: {},
      });
    });
  });

  describe("ui/open-link request", () => {
    test("delegates to window.openai.openExternal()", async () => {
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 5,
        method: "ui/open-link",
        params: { url: "https://example.com" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOpenAI.openExternal).toHaveBeenCalledWith({
        href: "https://example.com",
      });
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 5,
        result: {},
      });
    });
  });

  describe("ui/request-display-mode request", () => {
    test("delegates to window.openai.requestDisplayMode()", async () => {
      mockOpenAI.requestDisplayMode = mock(() =>
        Promise.resolve(),
      ) as unknown as OpenAIGlobal["requestDisplayMode"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 6,
        method: "ui/request-display-mode",
        params: { mode: "fullscreen" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOpenAI.requestDisplayMode).toHaveBeenCalledWith({
        mode: "fullscreen",
      });
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 6,
        result: { mode: "fullscreen" },
      });
    });
  });

  describe("ui/notifications/size-changed notification", () => {
    test("delegates to window.openai.notifyIntrinsicHeight()", async () => {
      const transport = new OpenAITransport();

      await transport.send({
        jsonrpc: "2.0",
        method: "ui/notifications/size-changed",
        params: { width: 400, height: 300 },
      });

      expect(mockOpenAI.notifyIntrinsicHeight).toHaveBeenCalledWith(300);
    });
  });

  describe("deliverInitialState", () => {
    test("delivers tool input notification", async () => {
      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolInputNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-input",
      );
      expect(toolInputNotification).toMatchObject({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-input",
        params: { arguments: { location: "Tokyo" } },
      });
    });

    test("delivers tool result notification", async () => {
      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      );
      expect(toolResultNotification).toBeDefined();
    });

    test("includes _meta from toolResponseMetadata in tool result", async () => {
      mockOpenAI.toolResponseMetadata = { widgetId: "abc123", version: 2 };

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      );
      expect(toolResultNotification).toMatchObject({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: {
          _meta: { widgetId: "abc123", version: 2 },
        },
      });
    });

    test("converts null _meta to undefined in tool result", async () => {
      // Simulate null being set (e.g., from JSON parsing where null is valid)
      (
        mockOpenAI as unknown as { toolResponseMetadata: null }
      ).toolResponseMetadata = null;

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      ) as { params?: { _meta?: unknown } } | undefined;
      expect(toolResultNotification).toBeDefined();
      // _meta should be undefined, not null (SDK rejects null)
      expect(toolResultNotification?.params?._meta).toBeUndefined();
    });

    test("does not deliver tool-result when toolOutput is null", async () => {
      // Simulate null being set (e.g., from JSON parsing)
      (mockOpenAI as unknown as { toolOutput: null }).toolOutput = null;

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      );
      // Should NOT deliver tool-result when toolOutput is null
      expect(toolResultNotification).toBeUndefined();
    });

    test("does not deliver notifications when data is missing", async () => {
      delete mockOpenAI.toolInput;
      delete mockOpenAI.toolOutput;

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(messages).toHaveLength(0);
    });
  });
});
