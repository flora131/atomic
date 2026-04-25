import { test, expect, describe, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getMuxBinary,
  resetMuxBinaryCache,
  isTmuxInstalled,
  isInsideTmux,
  tmuxRun,
  createSession,
  createWindow,
  createPane,
  sendLiteralText,
  sendSpecialKey,
  capturePane,
  capturePaneVisible,
  capturePaneScrollback,
  killSession,
  sessionExists,
  listSessions,
  parseListSessionsOutput,
  normalizeTmuxCapture,
  normalizeTmuxLines,
  attachSession,
  killWindow,
  switchClient,
  getCurrentSession,
  attachOrSwitch,
  isInsideAtomicSocket,
  setSessionEnv,
  getSessionEnv,
  SOCKET_NAME,
  selectWindow,
  spawnMuxAttach,
  detachAndAttachAtomic,
  parseSessionName,
  parseSessionEnvValue,
  sendViaPasteBuffer,
} from "../../../src/sdk/runtime/tmux.ts";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

/**
 * Save and restore environment variables around each test.
 * Call in a describe block to avoid duplicating the afterEach pattern.
 */
function withEnvRestore(vars: string[]) {
  const saved: Record<string, string | undefined> = {};
  for (const v of vars) saved[v] = process.env[v];

  afterEach(() => {
    for (const v of vars) {
      if (saved[v] !== undefined) {
        process.env[v] = saved[v];
      } else {
        delete process.env[v];
      }
    }
  });
}

function writeFakeCommand(directory: string, name: string): void {
  const extension = process.platform === "win32" ? ".cmd" : "";
  const commandPath = join(directory, `${name}${extension}`);
  const body = process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n";
  writeFileSync(commandPath, body);
  chmodSync(commandPath, 0o755);
}

function withMockPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  }
}

// ---------------------------------------------------------------------------
// getMuxBinary
// ---------------------------------------------------------------------------

describe("getMuxBinary", () => {
  beforeEach(() => {
    resetMuxBinaryCache();
  });

  afterEach(() => {
    resetMuxBinaryCache();
  });

  test("returns 'tmux' on unix when tmux is available", () => {
    // On this Linux CI host, tmux should be resolvable (or we skip)
    const binary = getMuxBinary();
    if (process.platform !== "win32") {
      // On Unix, it returns "tmux" if installed, null otherwise
      if (Bun.which("tmux")) {
        expect(binary).toBe("tmux");
      } else {
        expect(binary).toBeNull();
      }
    }
  });

  test("caches the result after first call", () => {
    const first = getMuxBinary();
    const second = getMuxBinary();
    expect(first).toBe(second);
  });

  test("resetMuxBinaryCache clears cached value", () => {
    getMuxBinary(); // populate cache
    resetMuxBinaryCache();
    // After reset, the next call re-resolves (doesn't throw, returns consistent result)
    const result = getMuxBinary();
    expect(typeof result === "string" || result === null).toBe(true);
  });

  test.serial("ignores tmux-only shims on Windows", () => {
    const originalPath = process.env.PATH;
    const tempDir = mkdtempSync(join(tmpdir(), "atomic-mux-"));
    try {
      writeFakeCommand(tempDir, "tmux");
      process.env.PATH = tempDir;
      resetMuxBinaryCache();

      withMockPlatform("win32", () => {
        expect(getMuxBinary()).toBeNull();
        expect(isTmuxInstalled()).toBe(false);
      });
    } finally {
      process.env.PATH = originalPath;
      resetMuxBinaryCache();
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  test.serial("prefers native psmux on Windows", () => {
    const originalPath = process.env.PATH;
    const tempDir = mkdtempSync(join(tmpdir(), "atomic-mux-"));
    try {
      writeFakeCommand(tempDir, "psmux");
      writeFakeCommand(tempDir, "pmux");
      writeFakeCommand(tempDir, "tmux");
      process.env.PATH = tempDir;
      resetMuxBinaryCache();

      withMockPlatform("win32", () => {
        expect(getMuxBinary()).toBe("psmux");
        expect(isTmuxInstalled()).toBe(true);
      });
    } finally {
      process.env.PATH = originalPath;
      resetMuxBinaryCache();
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// isTmuxInstalled
// ---------------------------------------------------------------------------

describe("isTmuxInstalled", () => {
  beforeEach(() => {
    resetMuxBinaryCache();
  });

  afterEach(() => {
    resetMuxBinaryCache();
  });

  test("returns boolean consistent with getMuxBinary", () => {
    const binary = getMuxBinary();
    expect(isTmuxInstalled()).toBe(binary !== null);
  });
});

// ---------------------------------------------------------------------------
// isInsideTmux
// ---------------------------------------------------------------------------

describe("isInsideTmux", () => {
  withEnvRestore(["TMUX", "PSMUX"]);

  test("returns true when TMUX env var is set", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    delete process.env.PSMUX;
    expect(isInsideTmux()).toBe(true);
  });

  test("returns true when PSMUX env var is set", () => {
    delete process.env.TMUX;
    process.env.PSMUX = "1";
    expect(isInsideTmux()).toBe(true);
  });

  test("returns true when both TMUX and PSMUX are set", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    process.env.PSMUX = "1";
    expect(isInsideTmux()).toBe(true);
  });

  test("returns false when neither env var is set", () => {
    delete process.env.TMUX;
    delete process.env.PSMUX;
    expect(isInsideTmux()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tmuxRun — success and failure paths
// ---------------------------------------------------------------------------

describe("tmuxRun", () => {
  beforeEach(() => {
    resetMuxBinaryCache();
  });

  afterEach(() => {
    resetMuxBinaryCache();
  });

  test("returns ok:true with stdout for valid commands", () => {
    const result = tmuxRun(["list-sessions"]);
    // Even if no sessions exist, tmux returns ok:false (exit code 1)
    // but the structure is always correct
    expect(result).toHaveProperty("ok");
    if (result.ok) {
      expect(typeof result.stdout).toBe("string");
    } else {
      expect(typeof result.stderr).toBe("string");
    }
  });

  test("returns ok:false with stderr for invalid tmux subcommand", () => {
    const result = tmuxRun(["completely-invalid-subcommand-xyz"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  });

});

// ---------------------------------------------------------------------------
// normalizeTmuxCapture — pure function
// ---------------------------------------------------------------------------

describe("normalizeTmuxCapture", () => {
  test("collapses whitespace to single spaces", () => {
    expect(normalizeTmuxCapture("hello   world")).toBe("hello world");
  });

  test("strips carriage returns", () => {
    expect(normalizeTmuxCapture("hello\r\nworld")).toBe("hello world");
  });

  test("collapses newlines to spaces", () => {
    expect(normalizeTmuxCapture("line1\nline2\nline3")).toBe("line1 line2 line3");
  });

  test("trims leading and trailing whitespace", () => {
    expect(normalizeTmuxCapture("  hello  ")).toBe("hello");
  });

  test("handles empty string", () => {
    expect(normalizeTmuxCapture("")).toBe("");
  });

  test("handles whitespace-only input", () => {
    expect(normalizeTmuxCapture("   \n\n   \r\n   ")).toBe("");
  });

  test("handles tabs and mixed whitespace", () => {
    expect(normalizeTmuxCapture("hello\t\tworld\n  foo")).toBe("hello world foo");
  });

  test("preserves single spaces between words", () => {
    expect(normalizeTmuxCapture("a b c")).toBe("a b c");
  });
});

// ---------------------------------------------------------------------------
// normalizeTmuxLines — pure function
// ---------------------------------------------------------------------------

describe("normalizeTmuxLines", () => {
  test("trims trailing whitespace per line", () => {
    const input = "hello   \nworld   ";
    const result = normalizeTmuxLines(input);
    expect(result).toBe("hello\nworld");
  });

  test("preserves leading whitespace on non-first lines", () => {
    const input = "top\n    deeper";
    expect(normalizeTmuxLines(input)).toBe("top\n    deeper");
  });

  test("final trim removes leading whitespace from entire result", () => {
    const input = "  indented\n    deeper";
    // The final .trim() strips leading whitespace from the whole string
    expect(normalizeTmuxLines(input)).toBe("indented\n    deeper");
  });

  test("trims overall result", () => {
    const input = "\n\nhello\nworld\n\n";
    expect(normalizeTmuxLines(input)).toBe("hello\nworld");
  });

  test("handles empty string", () => {
    expect(normalizeTmuxLines("")).toBe("");
  });

  test("handles single line", () => {
    expect(normalizeTmuxLines("hello   ")).toBe("hello");
  });

  test("preserves internal blank lines", () => {
    const input = "line1\n\nline3";
    expect(normalizeTmuxLines(input)).toBe("line1\n\nline3");
  });

  test("trimEnd strips carriage returns (CR is whitespace)", () => {
    // JS trimEnd treats \r as whitespace, so it gets stripped
    expect(normalizeTmuxLines("hello\r  ")).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// parseSessionName — pure function
// ---------------------------------------------------------------------------

describe("parseSessionName", () => {
  test("parses chat session with agent", () => {
    const result = parseSessionName("atomic-chat-claude-a1b2c3d4");
    expect(result).toEqual({ type: "chat", agent: "claude" });
  });

  test("parses chat session with copilot agent", () => {
    const result = parseSessionName("atomic-chat-copilot-abcd1234");
    expect(result).toEqual({ type: "chat", agent: "copilot" });
  });

  test("parses chat session with opencode agent", () => {
    const result = parseSessionName("atomic-chat-opencode-abcd1234");
    expect(result).toEqual({ type: "chat", agent: "opencode" });
  });

  test("parses workflow session with agent", () => {
    const result = parseSessionName("atomic-wf-claude-ralph-a1b2c3d4");
    expect(result).toEqual({ type: "workflow", agent: "claude" });
  });

  test("parses workflow session with hyphenated workflow name", () => {
    const result = parseSessionName("atomic-wf-opencode-my-cool-workflow-a1b2c3d4");
    expect(result).toEqual({ type: "workflow", agent: "opencode" });
  });

  test("returns type but no agent for legacy chat name (no agent segment)", () => {
    const result = parseSessionName("atomic-chat-a1b2c3d4");
    expect(result.type).toBe("chat");
    expect(result.agent).toBeUndefined();
  });

  test("returns type but no agent for legacy workflow name (no agent segment)", () => {
    const result = parseSessionName("atomic-wf-ralph-a1b2c3d4");
    expect(result.type).toBe("workflow");
    expect(result.agent).toBeUndefined();
  });

  test("returns empty object for unrelated session name", () => {
    const result = parseSessionName("my-random-session");
    expect(result).toEqual({});
  });

  test("returns empty object for empty string", () => {
    const result = parseSessionName("");
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// parseSessionEnvValue — pure function
// ---------------------------------------------------------------------------

describe("parseSessionEnvValue", () => {
  test("returns only the exact requested key from psmux-noisy output", () => {
    const value = parseSessionEnvValue(
      [
        "ATOMIC_AGENT=claude",
        "PSMUX_CONFIG_FILE=C:\\dev\\atomic\\src\\sdk\\runtime\\tmux.conf",
        "PSMUX_TARGET_SESSION=atomic__atomic-senv-abc12345",
      ].join("\n"),
      "ATOMIC_AGENT",
    );

    expect(value).toBe("claude");
  });

  test("returns null when psmux returns other environment keys", () => {
    const value = parseSessionEnvValue(
      [
        "ATOMIC_AGENT=claude",
        "PSMUX_CONFIG_FILE=C:\\dev\\atomic\\src\\sdk\\runtime\\tmux.conf",
      ].join("\n"),
      "NONEXISTENT_KEY",
    );

    expect(value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseListSessionsOutput — pure function
// ---------------------------------------------------------------------------

describe("parseListSessionsOutput", () => {
  const delimiter = "__ATOMIC_SESSION_FIELD__";

  test("filters psmux internal target sessions and metadata leakage", () => {
    const output = [
      [
        "pwsh -NoProfile -Command Start-Sleep -Seconds 1",
        "1",
        "50.175.4.2 59740 10.1.0.4 22",
        "0",
      ].join(delimiter),
      "PSMUX_CONFIG_FILE=C:\\dev\\atomic\\src\\sdk\\runtime\\tmux.conf",
      "PSMUX_TARGET_SESSION=atomic__pwsh -NoProfile -Command Start-Sleep -Seconds 1]",
      [
        "atomic-chat-copilot-abc12345",
        "1",
        "1700000000",
        "0",
      ].join(delimiter),
    ].join("\n");

    const sessions = parseListSessionsOutput(output, () => null);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.name).toBe("atomic-chat-copilot-abc12345");
    expect(sessions[0]!.type).toBe("chat");
    expect(sessions[0]!.agent).toBe("copilot");
    expect(JSON.stringify(sessions)).not.toContain("PSMUX");
    expect(JSON.stringify(sessions)).not.toContain("Start-Sleep");
  });

  test("keeps Atomic-managed sessions that rely on session env for agent", () => {
    const output = [
      "atomic-senv-abc12345",
      "1",
      "1700000000",
      "1",
    ].join(delimiter);

    const sessions = parseListSessionsOutput(output, (name, key) =>
      name === "atomic-senv-abc12345" && key === "ATOMIC_AGENT" ? "claude" : null
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.name).toBe("atomic-senv-abc12345");
    expect(sessions[0]!.attached).toBe(true);
    expect(sessions[0]!.agent).toBe("claude");
  });

  test("ignores malformed formatter rows", () => {
    const sessions = parseListSessionsOutput(
      [
        "atomic-chat-claude-missing-fields",
        ["atomic-chat-claude-good1234", "1", "1700000000", "0"].join(delimiter),
      ].join("\n"),
      () => null,
    );

    expect(sessions.map((s) => s.name)).toEqual(["atomic-chat-claude-good1234"]);
  });

  test("uses only the exact requested environment key for agent fallback", () => {
    const output = [
      "atomic-senv-abc12345",
      "1",
      "1700000000",
      "0",
    ].join(delimiter);

    const sessions = parseListSessionsOutput(output, (_name, key) =>
      key === "ATOMIC_AGENT"
        ? "claude"
        : "PSMUX_CONFIG_FILE=C:\\dev\\atomic\\tmux.conf"
    );

    expect(sessions[0]!.agent).toBe("claude");
  });
});

// ===========================================================================
// Integration tests — real tmux sessions
// ===========================================================================

const TEST_SESSION = `atomic-test-${crypto.randomUUID().slice(0, 8)}`;
const tmuxAvailable = Bun.which("tmux") !== null;

describe.if(tmuxAvailable)("tmux integration: session lifecycle", () => {
  afterAll(() => {
    // Guaranteed cleanup
    killSession(TEST_SESSION);
  });

  test("createSession creates a detached session and returns pane id", () => {
    const paneId = createSession(TEST_SESSION, "bash", "test-win");
    expect(paneId).toMatch(/^%\d+$/);
  });

  test("sessionExists returns true for existing session", () => {
    expect(sessionExists(TEST_SESSION)).toBe(true);
  });

  test("sessionExists returns false for non-existent session", () => {
    expect(sessionExists("nonexistent-session-xyz-99999")).toBe(false);
  });

  test("createWindow adds a new window and returns pane id", () => {
    const paneId = createWindow(TEST_SESSION, "second-win", "bash");
    expect(paneId).toMatch(/^%\d+$/);
  });

  test("createPane splits and returns a new pane id", () => {
    const paneId = createPane(TEST_SESSION, "bash");
    expect(paneId).toMatch(/^%\d+$/);
  });

  test("killSession removes the session", () => {
    killSession(TEST_SESSION);
    expect(sessionExists(TEST_SESSION)).toBe(false);
  });

  test("killSession does not throw for already-dead session", () => {
    expect(() => killSession(TEST_SESSION)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Integration: keystroke sending + pane capture
// ---------------------------------------------------------------------------

const CAPTURE_SESSION = `atomic-cap-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("tmux integration: send keys and capture", () => {
  let paneId: string;

  beforeAll(async () => {
    paneId = createSession(CAPTURE_SESSION, "bash", "capture-test");
    // Wait for bash prompt to be ready
    await Bun.sleep(500);
  });

  afterAll(() => {
    killSession(CAPTURE_SESSION);
  });

  test("sendLiteralText sends text to pane", async () => {
    sendLiteralText(paneId, "echo TESTMARKER_LITERAL");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("TESTMARKER_LITERAL");
  });

  test("sendLiteralText normalizes newlines to spaces", async () => {
    sendLiteralText(paneId, "echo hello\nworld");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    // Newlines replaced with spaces, so it runs as "echo hello world"
    expect(captured).toContain("hello world");
  });

  test("sendSpecialKey sends C-m (enter)", async () => {
    sendLiteralText(paneId, "echo SPECIAL_KEY_TEST");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("SPECIAL_KEY_TEST");
  });

  test("capturePane returns visible content", () => {
    const captured = capturePane(paneId);
    expect(typeof captured).toBe("string");
    expect(captured.length).toBeGreaterThan(0);
  });

  test("capturePane with start parameter captures scrollback", async () => {
    // Generate some output to create scrollback
    sendLiteralText(paneId, "echo SCROLLBACK_TEST");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(200);

    const captured = capturePane(paneId, -50);
    expect(typeof captured).toBe("string");
    expect(captured).toContain("SCROLLBACK_TEST");
  });

  test("capturePaneVisible returns visible portion", () => {
    const visible = capturePaneVisible(paneId);
    expect(typeof visible).toBe("string");
  });

  test("capturePaneVisible returns empty string for invalid pane", () => {
    const visible = capturePaneVisible("%99999");
    expect(visible).toBe("");
  });

  test("capturePaneScrollback returns recent history", async () => {
    sendLiteralText(paneId, "echo SCROLLBACK_HISTORY");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(200);

    const scrollback = capturePaneScrollback(paneId, 100);
    expect(scrollback).toContain("SCROLLBACK_HISTORY");
  });

  test("capturePaneScrollback returns empty string for invalid pane", () => {
    const scrollback = capturePaneScrollback("%99999", 50);
    expect(scrollback).toBe("");
  });

  test("capturePaneScrollback uses default lines parameter", () => {
    const scrollback = capturePaneScrollback(paneId);
    expect(typeof scrollback).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Error paths: functions that throw via internal tmux() helper
// ---------------------------------------------------------------------------

describe.if(tmuxAvailable)("tmux error paths", () => {
  test("capturePane throws for non-existent pane", () => {
    expect(() => capturePane("%99999")).toThrow(/capture-pane failed/);
  });

  test("capturePane with start parameter throws for invalid pane", () => {
    expect(() => capturePane("%99999", -50)).toThrow(/capture-pane failed/);
  });

  test("createSession throws for duplicate session name", () => {
    const dupSession = `atomic-dup-${crypto.randomUUID().slice(0, 8)}`;
    try {
      createSession(dupSession, "bash", "first");
      expect(() => createSession(dupSession, "bash", "second")).toThrow();
    } finally {
      killSession(dupSession);
    }
  });

  test("sendLiteralText throws for invalid pane", () => {
    expect(() => sendLiteralText("%99999", "hello")).toThrow(/send-keys failed/);
  });

  test("sendSpecialKey throws for invalid pane", () => {
    expect(() => sendSpecialKey("%99999", "C-m")).toThrow(/send-keys failed/);
  });
});

// ---------------------------------------------------------------------------
// Integration: attachSession error path
// ---------------------------------------------------------------------------

describe.if(tmuxAvailable)("attachSession error path", () => {
  test("attachSession throws for non-existent session with stderr detail", () => {
    expect(() => attachSession("nonexistent-session-xyz-99999")).toThrow(/Failed to attach.*nonexistent-session-xyz-99999/);
  });
});

// ---------------------------------------------------------------------------
// killWindow
// ---------------------------------------------------------------------------

const KILLWIN_SESSION = `atomic-kw-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("killWindow", () => {
  afterAll(() => {
    killSession(KILLWIN_SESSION);
  });

  test("killWindow removes a window and does not throw", () => {
    createSession(KILLWIN_SESSION, "bash", "main");
    createWindow(KILLWIN_SESSION, "to-kill", "bash");
    expect(() => killWindow(KILLWIN_SESSION, "to-kill")).not.toThrow();
  });

  test("killWindow does not throw for non-existent window", () => {
    expect(() => killWindow(KILLWIN_SESSION, "nonexistent-window-xyz")).not.toThrow();
  });

  test("killWindow does not throw for non-existent session", () => {
    expect(() => killWindow("nonexistent-session-xyz-99999", "whatever")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createSession / createWindow with cwd parameter
// ---------------------------------------------------------------------------

const CWD_SESSION = `atomic-cwd-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("createSession and createWindow with cwd", () => {
  afterAll(() => {
    killSession(CWD_SESSION);
  });

  test("createSession with cwd creates a session in the given directory", async () => {
    const paneId = createSession(CWD_SESSION, "bash", "cwd-test", "/tmp");
    expect(paneId).toMatch(/^%\d+$/);
    await Bun.sleep(300);
    const captured = capturePane(paneId);
    expect(typeof captured).toBe("string");
  });

  test("createWindow with cwd creates a window in the given directory", () => {
    const paneId = createWindow(CWD_SESSION, "cwd-win", "bash", "/tmp");
    expect(paneId).toMatch(/^%\d+$/);
  });
});

// ---------------------------------------------------------------------------
// getCurrentSession
// ---------------------------------------------------------------------------

describe("getCurrentSession", () => {
  withEnvRestore(["TMUX", "PSMUX"]);

  test("returns null when not inside tmux", () => {
    delete process.env.TMUX;
    delete process.env.PSMUX;
    expect(getCurrentSession()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// switchClient — error path (not inside tmux)
// ---------------------------------------------------------------------------

describe.if(tmuxAvailable)("switchClient", () => {
  test("throws when called with non-existent session", () => {
    expect(() => switchClient("nonexistent-session-xyz-99999")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// attachOrSwitch
// ---------------------------------------------------------------------------

describe.if(tmuxAvailable)("attachOrSwitch", () => {
  withEnvRestore(["TMUX", "PSMUX"]);

  test("outside tmux: calls attachSession (throws for non-existent session)", () => {
    delete process.env.TMUX;
    delete process.env.PSMUX;
    expect(() => attachOrSwitch("nonexistent-session-xyz-99999")).toThrow(/Failed to attach/);
  });

  test("inside tmux: calls switchClient (throws for non-existent session)", () => {
    process.env.TMUX = "/tmp/tmux-fake/default,12345,0";
    delete process.env.PSMUX;
    expect(() => attachOrSwitch("nonexistent-session-xyz-99999")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// isInsideAtomicSocket
// ---------------------------------------------------------------------------

describe("isInsideAtomicSocket", () => {
  withEnvRestore(["TMUX", "PSMUX"]);

  test("returns true when TMUX points to atomic socket", () => {
    process.env.TMUX = `/tmp/tmux-1000/${SOCKET_NAME},12345,0`;
    delete process.env.PSMUX;
    expect(isInsideAtomicSocket()).toBe(true);
  });

  test("returns true when PSMUX points to atomic socket", () => {
    delete process.env.TMUX;
    process.env.PSMUX = `/tmp/tmux-1000/${SOCKET_NAME},99999,0`;
    expect(isInsideAtomicSocket()).toBe(true);
  });

  test("returns false when TMUX points to a different socket", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    delete process.env.PSMUX;
    expect(isInsideAtomicSocket()).toBe(false);
  });

  test("returns false when neither env var is set", () => {
    delete process.env.TMUX;
    delete process.env.PSMUX;
    expect(isInsideAtomicSocket()).toBe(false);
  });

  test("returns false for empty TMUX env var", () => {
    process.env.TMUX = "";
    delete process.env.PSMUX;
    expect(isInsideAtomicSocket()).toBe(false);
  });

  test("handles TMUX with no comma separator", () => {
    process.env.TMUX = `/tmp/tmux-1000/${SOCKET_NAME}`;
    delete process.env.PSMUX;
    expect(isInsideAtomicSocket()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tmuxRun — no binary available
// ---------------------------------------------------------------------------

describe("tmuxRun — no binary on PATH", () => {
  let originalPath: string | undefined;

  beforeEach(() => {
    resetMuxBinaryCache();
    originalPath = process.env.PATH;
    // Point PATH to an empty directory so no binaries are found
    process.env.PATH = "/nonexistent-empty-dir";
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    resetMuxBinaryCache();
  });

  test.serial("returns ok:false when no mux binary found", () => {
    const result = tmuxRun(["list-sessions"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stderr).toContain("No terminal multiplexer");
    }
  });
});

// ---------------------------------------------------------------------------
// buildAttachArgs / spawnMuxAttach / detachAndAttachAtomic — no binary
// ---------------------------------------------------------------------------

describe("no-binary error paths", () => {
  let originalPath: string | undefined;

  beforeEach(() => {
    resetMuxBinaryCache();
    originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-empty-dir";
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    resetMuxBinaryCache();
  });

  test.serial("spawnMuxAttach throws when no binary found", () => {
    expect(() => spawnMuxAttach("any-session")).toThrow(/No terminal multiplexer/);
  });

  test.serial("detachAndAttachAtomic throws when no binary found", () => {
    expect(() => detachAndAttachAtomic("any-session")).toThrow(/No terminal multiplexer/);
  });

  test.serial("attachSession throws when no binary found", () => {
    expect(() => attachSession("any-session")).toThrow(/No terminal multiplexer/);
  });
});

// ---------------------------------------------------------------------------
// Integration: createSession / createWindow with envVars (buildEnvArgs)
// ---------------------------------------------------------------------------

const ENV_SESSION = `atomic-env-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("createSession and createWindow with envVars", () => {
  afterAll(() => {
    killSession(ENV_SESSION);
  });

  test("createSession passes envVars to the pane", async () => {
    const paneId = createSession(
      ENV_SESSION,
      "bash",
      "env-test",
      undefined,
      { MY_TEST_VAR: "hello_from_env" },
    );
    expect(paneId).toMatch(/^%\d+$/);
    await Bun.sleep(300);

    // Verify the env var is set inside the pane
    sendLiteralText(paneId, "echo $MY_TEST_VAR");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("hello_from_env");
  });

  test("createWindow passes envVars to the pane", async () => {
    const paneId = createWindow(
      ENV_SESSION,
      "env-win",
      "bash",
      undefined,
      { ANOTHER_TEST_VAR: "win_env_val" },
    );
    expect(paneId).toMatch(/^%\d+$/);
    await Bun.sleep(300);

    sendLiteralText(paneId, "echo $ANOTHER_TEST_VAR");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("win_env_val");
  });
});

// ---------------------------------------------------------------------------
// Integration: sendViaPasteBuffer
// ---------------------------------------------------------------------------

const PASTE_SESSION = `atomic-pst-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("sendViaPasteBuffer", () => {
  let paneId: string;

  beforeAll(async () => {
    paneId = createSession(PASTE_SESSION, "bash", "paste-test");
    await Bun.sleep(500);
  });

  afterAll(() => {
    killSession(PASTE_SESSION);
  });

  test("sends text via paste buffer", async () => {
    sendViaPasteBuffer(paneId, "echo PASTE_BUFFER_TEST");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("PASTE_BUFFER_TEST");
  });

  test("normalizes newlines to spaces", async () => {
    sendViaPasteBuffer(paneId, "echo paste\nnewline\ntest");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("paste newline test");
  });
});

// ---------------------------------------------------------------------------
// Integration: selectWindow
// ---------------------------------------------------------------------------

const SELECT_SESSION = `atomic-sel-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("selectWindow", () => {
  afterAll(() => {
    killSession(SELECT_SESSION);
  });

  test("selects a window without throwing", () => {
    createSession(SELECT_SESSION, "bash", "win-a");
    createWindow(SELECT_SESSION, "win-b", "bash");
    expect(() => selectWindow(`${SELECT_SESSION}:win-a`)).not.toThrow();
    expect(() => selectWindow(`${SELECT_SESSION}:win-b`)).not.toThrow();
  });

  test("throws for non-existent window", () => {
    expect(() => selectWindow(`${SELECT_SESSION}:nonexistent`)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getCurrentSession — inside tmux path (query fails when not a real client)
// ---------------------------------------------------------------------------

describe.if(tmuxAvailable)("getCurrentSession — inside tmux env", () => {
  withEnvRestore(["TMUX", "PSMUX"]);

  test("returns null when inside tmux but not on the atomic socket", () => {
    // TMUX points to a non-atomic socket — getCurrentSession should bail
    // early via the isInsideAtomicSocket() guard without querying the
    // atomic server (which would pick an arbitrary session).
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    delete process.env.PSMUX;
    const result = getCurrentSession();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe.if(tmuxAvailable)("listSessions", () => {
  const LIST_SESSION = `atomic-chat-claude-${crypto.randomUUID().slice(0, 8)}`;

  afterAll(() => {
    killSession(LIST_SESSION);
  });

  test.serial("returns an empty array when no sessions exist on a clean server", () => {
    // If there are no sessions specifically named our test session,
    // listSessions should at least return an array.
    const sessions = listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });

  test.serial("includes a session after creation with parsed type and agent", () => {
    createSession(LIST_SESSION, "sleep 60");
    const sessions = listSessions();
    const found = sessions.find((s) => s.name === LIST_SESSION);
    expect(found).toBeDefined();
    expect(found!.windows).toBeGreaterThanOrEqual(1);
    expect(typeof found!.created).toBe("string");
    expect(typeof found!.attached).toBe("boolean");
    expect(found!.type).toBe("chat");
    expect(found!.agent).toBe("claude");

    const d = new Date(found!.created);
    expect(Number.isNaN(d.getTime())).toBe(false);
  });

  test.serial("session is gone after kill", () => {
    killSession(LIST_SESSION);
    const sessions = listSessions();
    const found = sessions.find((s) => s.name === LIST_SESSION);
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setSessionEnv / getSessionEnv
// ---------------------------------------------------------------------------

const ENV_VAR_SESSION = `atomic-senv-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("setSessionEnv / getSessionEnv", () => {
  afterAll(() => {
    killSession(ENV_VAR_SESSION);
  });

  test.serial("setSessionEnv stores and getSessionEnv retrieves a value", () => {
    createSession(ENV_VAR_SESSION, "sleep 60");
    setSessionEnv(ENV_VAR_SESSION, "ATOMIC_AGENT", "claude");
    expect(getSessionEnv(ENV_VAR_SESSION, "ATOMIC_AGENT")).toBe("claude");

    const sessions = listSessions();
    const found = sessions.find((s) => s.name === ENV_VAR_SESSION);
    expect(found).toBeDefined();
    expect(found!.agent).toBe("claude");
  });

  test.serial("getSessionEnv returns null for unset key", () => {
    expect(getSessionEnv(ENV_VAR_SESSION, "NONEXISTENT_KEY")).toBeNull();
  });

  test.serial("getSessionEnv returns null for non-existent session", () => {
    expect(getSessionEnv("nonexistent-session-xyz-99999", "ATOMIC_AGENT")).toBeNull();
  });

});
