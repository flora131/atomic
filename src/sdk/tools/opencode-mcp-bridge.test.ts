/**
 * Tests for the OpenCode MCP Bridge tool dispatch mechanism.
 *
 * Verifies that:
 * 1. The dispatch HTTP server starts and accepts tool call requests
 * 2. Tool handlers are actually invoked with correct arguments and context
 * 3. Handler errors are reported correctly
 * 4. Unknown tools return 404
 * 5. The generated MCP script contains the dispatch URL (not a placeholder)
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  startToolDispatchServer,
  stopToolDispatchServer,
  createToolMcpServerScript,
  cleanupMcpBridgeScripts,
} from "./opencode-mcp-bridge.ts";
import type { ToolDefinition, ToolContext } from "../types.ts";
import { readFileSync } from "fs";

// ============================================================================
// Helpers
// ============================================================================

function makeContext(): ToolContext {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "opencode",
    directory: process.cwd(),
    abort: new AbortController().signal,
  };
}

function makeTool(
  name: string,
  handler: ToolDefinition["handler"],
): ToolDefinition {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: {
      type: "object",
      properties: { input: { type: "string" } },
    },
    handler,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("opencode-mcp-bridge dispatch server", () => {
  afterEach(() => {
    stopToolDispatchServer();
    cleanupMcpBridgeScripts();
  });

  test("starts on a random port and handles tool calls", async () => {
    const tools = new Map<string, ToolDefinition>();
    tools.set(
      "echo",
      makeTool("echo", (input) => `echo: ${(input as Record<string, string>).input}`),
    );

    const { port, stop } = await startToolDispatchServer(tools, makeContext);
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "echo", arguments: { input: "hello" } }),
    });

    expect(res.ok).toBe(true);
    const body = (await res.json()) as { content: Array<{ type: string; text: string }> };
    expect(body.content[0]!.text).toBe("echo: hello");

    stop();
  });

  test("returns 404 for unknown tools", async () => {
    const tools = new Map<string, ToolDefinition>();
    const { port, stop } = await startToolDispatchServer(tools, makeContext);

    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "nonexistent", arguments: {} }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Tool not found");

    stop();
  });

  test("reports handler errors with isError flag", async () => {
    const tools = new Map<string, ToolDefinition>();
    tools.set(
      "failing",
      makeTool("failing", () => {
        throw new Error("handler boom");
      }),
    );

    const { port, stop } = await startToolDispatchServer(tools, makeContext);

    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "failing", arguments: {} }),
    });

    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(body.isError).toBe(true);
    expect(body.content[0]!.text).toContain("handler boom");

    stop();
  });

  test("passes context from factory to handler", async () => {
    let capturedContext: ToolContext | null = null;
    const tools = new Map<string, ToolDefinition>();
    tools.set(
      "ctx",
      makeTool("ctx", (_input, ctx) => {
        capturedContext = ctx;
        return "ok";
      }),
    );

    const customContext = (): ToolContext => ({
      sessionID: "custom-session-123",
      messageID: "msg-456",
      agent: "opencode",
      directory: "/custom/dir",
      abort: new AbortController().signal,
    });

    const { port, stop } = await startToolDispatchServer(tools, customContext);

    await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ctx", arguments: {} }),
    });

    expect(capturedContext).not.toBeNull();
    expect(capturedContext!.sessionID).toBe("custom-session-123");
    expect(capturedContext!.directory).toBe("/custom/dir");

    stop();
  });

  test("handles async tool handlers", async () => {
    const tools = new Map<string, ToolDefinition>();
    tools.set(
      "async-tool",
      makeTool("async-tool", async (input) => {
        await new Promise((r) => setTimeout(r, 10));
        return { result: (input as Record<string, string>).input };
      }),
    );

    const { port, stop } = await startToolDispatchServer(tools, makeContext);

    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "async-tool", arguments: { input: "async-data" } }),
    });

    expect(res.ok).toBe(true);
    const body = (await res.json()) as { content: Array<{ type: string; text: string }> };
    expect(body.content[0]!.text).toBe('{"result":"async-data"}');

    stop();
  });

  test("rejects non-POST requests", async () => {
    const tools = new Map<string, ToolDefinition>();
    const { port, stop } = await startToolDispatchServer(tools, makeContext);

    const res = await fetch(`http://127.0.0.1:${port}`, { method: "GET" });
    expect(res.status).toBe(405);

    stop();
  });
});

describe("opencode-mcp-bridge script generation", () => {
  afterEach(() => {
    cleanupMcpBridgeScripts();
  });

  test("generated script contains dispatch URL instead of placeholder", async () => {
    const tools: ToolDefinition[] = [
      makeTool("test-tool", () => "result"),
    ];

    const scriptPath = await createToolMcpServerScript(tools, 12345);
    const content = readFileSync(scriptPath, "utf-8");

    // Should contain the dispatch URL
    expect(content).toContain("http://127.0.0.1:12345");
    expect(content).toContain("DISPATCH_URL");

    // Should NOT contain the old placeholder
    expect(content).not.toContain("executed via MCP bridge");

    // Should contain fetch-based dispatch
    expect(content).toContain("await fetch(DISPATCH_URL");
  });

  test("generated script lists tool definitions", async () => {
    const tools: ToolDefinition[] = [
      makeTool("alpha", () => "a"),
      makeTool("beta", () => "b"),
    ];

    const scriptPath = await createToolMcpServerScript(tools, 9999);
    const content = readFileSync(scriptPath, "utf-8");

    expect(content).toContain('"alpha"');
    expect(content).toContain('"beta"');
    expect(content).toContain("Test tool: alpha");
    expect(content).toContain("Test tool: beta");
  });
});
