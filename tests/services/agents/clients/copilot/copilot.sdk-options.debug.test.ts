/**
 * Unit tests for debug wiring in buildCopilotSdkOptions().
 *
 * When isPipelineDebug() is true, the builder must set logLevel="debug".
 * When a session log dir is also active, it must additionally set telemetry
 * with a filePath inside the session log directory.
 *
 * When debug is off, those fields must be absent or set to the caller's value.
 *
 * We mock the pipeline-logger module here to control isPipelineDebug() behavior
 * independently of the environment and to ensure test isolation when combined
 * with other test files that also mock this module.
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import { join } from "path";

// ─── Mock pipeline-logger so we fully control isPipelineDebug() ──────────────

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
import { buildCopilotSdkOptions } from "@/services/agents/clients/copilot/sdk-options.ts";
import type { CopilotClientOptions } from "@/services/agents/clients/copilot.ts";

// ─── Minimal client options (bypasses getBundledCopilotCliPath) ───────────────

function makeMinimalClientOptions(overrides: Partial<CopilotClientOptions> = {}): CopilotClientOptions {
  return {
    cliPath: "/usr/local/bin/copilot",
    autoStart: false,
    ...overrides,
  };
}

// ─── Test setup / teardown ────────────────────────────────────────────────────

afterEach(() => {
  _mockDebugEnabled = false;
  clearActiveSessionLogDir();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildCopilotSdkOptions() — debug wiring", () => {
  const SESSION_LOG_DIR = "/tmp/atomic-debug/2024-01-01T120000";

  test("does not force logLevel to debug when isPipelineDebug() returns false", async () => {
    _mockDebugEnabled = false;

    const options = await buildCopilotSdkOptions(makeMinimalClientOptions());

    expect(options.logLevel).not.toBe("debug");
  });

  test("does not set telemetry when isPipelineDebug() returns false", async () => {
    _mockDebugEnabled = false;
    setActiveSessionLogDir(SESSION_LOG_DIR);

    const options = await buildCopilotSdkOptions(makeMinimalClientOptions());

    expect(options.telemetry).toBeUndefined();
  });

  test("sets logLevel=debug when isPipelineDebug() returns true", async () => {
    _mockDebugEnabled = true;

    const options = await buildCopilotSdkOptions(makeMinimalClientOptions());

    expect(options.logLevel).toBe("debug");
  });

  test("does not set telemetry when isPipelineDebug() returns true but no session log dir is set", async () => {
    _mockDebugEnabled = true;
    // session log dir deliberately not set

    const options = await buildCopilotSdkOptions(makeMinimalClientOptions());

    expect(options.telemetry).toBeUndefined();
  });

  test("sets telemetry.filePath inside session log dir when isPipelineDebug() and dir is active", async () => {
    _mockDebugEnabled = true;
    setActiveSessionLogDir(SESSION_LOG_DIR);

    const options = await buildCopilotSdkOptions(makeMinimalClientOptions());

    expect(options.telemetry).toBeDefined();
    expect(options.telemetry?.filePath).toBe(
      join(SESSION_LOG_DIR, "copilot-traces.jsonl"),
    );
  });

  test("sets telemetry.exporterType=file when isPipelineDebug() and dir is active", async () => {
    _mockDebugEnabled = true;
    setActiveSessionLogDir(SESSION_LOG_DIR);

    const options = await buildCopilotSdkOptions(makeMinimalClientOptions());

    expect(options.telemetry?.exporterType).toBe("file");
  });

  test("telemetry filePath ends with copilot-traces.jsonl", async () => {
    _mockDebugEnabled = true;
    setActiveSessionLogDir(SESSION_LOG_DIR);

    const options = await buildCopilotSdkOptions(makeMinimalClientOptions());
    const filePath = options.telemetry?.filePath;

    expect(typeof filePath).toBe("string");
    expect((filePath as string).endsWith("copilot-traces.jsonl")).toBe(true);
  });

  test("does not set captureContent=true regardless of debug state", async () => {
    _mockDebugEnabled = true;
    setActiveSessionLogDir(SESSION_LOG_DIR);

    const options = await buildCopilotSdkOptions(makeMinimalClientOptions());

    // Privacy requirement: content capture must never be enabled
    expect((options.telemetry as Record<string, unknown> | undefined)?.captureContent).not.toBe(true);
  });

  test("preserves cliPath from client options regardless of debug state", async () => {
    _mockDebugEnabled = true;

    const options = await buildCopilotSdkOptions(
      makeMinimalClientOptions({ cliPath: "/custom/path/copilot" }),
    );

    expect(options.cliPath).toBe("/custom/path/copilot");
  });

  test("uses the exact session log dir provided by getActiveSessionLogDir()", async () => {
    _mockDebugEnabled = true;
    const customDir = "/custom/session/dir";
    setActiveSessionLogDir(customDir);

    const options = await buildCopilotSdkOptions(makeMinimalClientOptions());

    expect(options.telemetry?.filePath).toBe(join(customDir, "copilot-traces.jsonl"));
  });
});
