/**
 * Unit tests for debug wiring in buildClaudeSdkOptions().
 *
 * When isPipelineDebug() is true and a session log dir is active, the builder
 * must set options.debug = true and options.debugFile to a path inside the
 * session log directory.  When debug is off (or no session dir is set), those
 * fields must be absent.
 *
 * We mock the pipeline-logger module here to control isPipelineDebug() behavior
 * independently of the environment and to ensure test isolation when combined
 * with other test files that also mock this module.
 */

import { describe, test, expect, afterEach, mock, beforeAll } from "bun:test";
import { join } from "path";

// ─── Mock pipeline-logger so we fully control isPipelineDebug() ──────────────
// We define the mock function at module scope so tests can override it.

let _mockDebugEnabled = false;

mock.module("@/services/events/pipeline-logger.ts", () => ({
  isPipelineDebug: () => _mockDebugEnabled,
  resetPipelineDebugCache: () => {},
  pipelineLog: () => {},
  pipelineError: () => {},
}));

// ─── Imports (after mock registration so they pick up the mock) ───────────────

import {
  setActiveSessionLogDir,
  clearActiveSessionLogDir,
} from "@/services/events/debug-subscriber/config.ts";
import { buildClaudeSdkOptions } from "@/services/agents/clients/claude/options-builder.ts";
import type { SessionConfig } from "@/services/agents/contracts/session.ts";

// ─── Minimal args fixture ─────────────────────────────────────────────────────

function makeMinimalArgs(config: SessionConfig = {}) {
  return {
    config,
    sessionId: "test-session",
    registeredHooks: {},
    registeredTools: new Map(),
    supportedReasoningEfforts: new Set(["low", "medium", "high", "max"] as const),
    adaptiveThinkingModels: new Set<string>(),
    allowedTools: [],
    disallowedTools: [],
    executablePath: "/usr/local/bin/claude",
    resolveToolPermission: async (
      _sessionId: string,
      _toolName: string,
      toolInput: Record<string, unknown>,
    ) => ({ behavior: "allow" as const, updatedInput: toolInput }),
  };
}

// ─── Test setup / teardown ────────────────────────────────────────────────────

afterEach(() => {
  _mockDebugEnabled = false;
  clearActiveSessionLogDir();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildClaudeSdkOptions() — debug wiring", () => {
  const SESSION_LOG_DIR = "/tmp/atomic-debug/2024-01-01T120000";

  test("omits debug and debugFile when isPipelineDebug() returns false", () => {
    _mockDebugEnabled = false;
    setActiveSessionLogDir(SESSION_LOG_DIR);

    const options = buildClaudeSdkOptions(makeMinimalArgs());

    expect(options.debug).toBeUndefined();
    expect((options as Record<string, unknown>).debugFile).toBeUndefined();
  });

  test("omits debug and debugFile when isPipelineDebug() returns true but no session log dir is set", () => {
    _mockDebugEnabled = true;
    // session log dir deliberately not set

    const options = buildClaudeSdkOptions(makeMinimalArgs());

    expect(options.debug).toBeUndefined();
    expect((options as Record<string, unknown>).debugFile).toBeUndefined();
  });

  test("sets debug=true when isPipelineDebug() returns true and session log dir is active", () => {
    _mockDebugEnabled = true;
    setActiveSessionLogDir(SESSION_LOG_DIR);

    const options = buildClaudeSdkOptions(makeMinimalArgs());

    expect(options.debug).toBe(true);
  });

  test("sets debugFile inside the session log dir when isPipelineDebug() returns true", () => {
    _mockDebugEnabled = true;
    setActiveSessionLogDir(SESSION_LOG_DIR);

    const options = buildClaudeSdkOptions(makeMinimalArgs());

    expect((options as Record<string, unknown>).debugFile).toBe(
      join(SESSION_LOG_DIR, "claude-debug.txt"),
    );
  });

  test("debugFile path ends with claude-debug.txt", () => {
    _mockDebugEnabled = true;
    setActiveSessionLogDir(SESSION_LOG_DIR);

    const options = buildClaudeSdkOptions(makeMinimalArgs());
    const debugFile = (options as Record<string, unknown>).debugFile as string;

    expect(debugFile.endsWith("claude-debug.txt")).toBe(true);
  });

  test("uses the exact session log dir provided by getActiveSessionLogDir()", () => {
    _mockDebugEnabled = true;
    const customDir = "/custom/session/dir";
    setActiveSessionLogDir(customDir);

    const options = buildClaudeSdkOptions(makeMinimalArgs());

    expect((options as Record<string, unknown>).debugFile).toBe(
      join(customDir, "claude-debug.txt"),
    );
  });

  test("debug and debugFile are absent when debug is off, regardless of session dir", () => {
    _mockDebugEnabled = false;
    setActiveSessionLogDir(SESSION_LOG_DIR);

    const options = buildClaudeSdkOptions(makeMinimalArgs());

    // Neither field should be set when debug is off
    expect(options.debug).not.toBe(true);
    expect((options as Record<string, unknown>).debugFile).toBeUndefined();
  });
});
