import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mcpAdapter from "../../packages/mcp/index.ts";
import { isCallbackServerRunning, stopCallbackServer } from "../../packages/mcp/mcp-callback-server.ts";

type SessionStartEvent = { readonly type: "session_start"; readonly reason: "startup" };
type SessionStartContext = { readonly cwd: string; readonly hasUI: false; readonly signal?: AbortSignal };
type SessionStartHandler = (event: SessionStartEvent, ctx: SessionStartContext) => Promise<void> | void;

const originalArgv = [...process.argv];
const originalCwd = process.cwd();
const originalAtomicAgentDir = process.env.ATOMIC_CODING_AGENT_DIR;

afterEach(async () => {
  process.argv = [...originalArgv];
  process.chdir(originalCwd);
  if (originalAtomicAgentDir === undefined) {
    delete process.env.ATOMIC_CODING_AGENT_DIR;
  } else {
    process.env.ATOMIC_CODING_AGENT_DIR = originalAtomicAgentDir;
  }
  await stopCallbackServer();
});

test("MCP session startup leaves OAuth callback handling lazy", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "atomic-mcp-oauth-startup-"));
  const configPath = join(tempDir, "mcp.json");
  writeFileSync(configPath, JSON.stringify({ mcpServers: {} }));
  process.chdir(tempDir);
  process.env.ATOMIC_CODING_AGENT_DIR = join(tempDir, "agent");
  process.argv = [...originalArgv, "--mcp-config", configPath];

  let sessionStart: SessionStartHandler | undefined;
  const consoleErrors: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    consoleErrors.push(args.map(String).join(" "));
  };

  try {
    mcpAdapter({
      registerFlag: () => {},
      registerCommand: () => {},
      registerTool: () => {},
      getAllTools: () => [],
      getFlag: () => undefined,
      sendMessage: () => {},
      exec: async () => ({ code: 0, stdout: "", stderr: "", killed: false }),
      on: (event: string, handler: SessionStartHandler) => {
        if (event === "session_start") sessionStart = handler;
      },
    } as never);

    assert.ok(sessionStart, "MCP adapter should register session_start");
    await sessionStart({ type: "session_start", reason: "startup" }, {
      cwd: tempDir,
      hasUI: false,
      signal: undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(isCallbackServerRunning(), false);
    assert.equal(
      consoleErrors.some((line) => line.includes("MCP OAuth initialization failed")),
      false,
    );
  } finally {
    console.error = originalConsoleError;
  }
});
