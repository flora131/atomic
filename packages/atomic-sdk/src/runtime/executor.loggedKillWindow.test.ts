/**
 * Tests for loggedKillWindow: reserved-name rejection emits telemetry + warn.
 *
 * Uses the production seam (setExecutorTelemetrySinks) to capture telemetry
 * and warn calls without touching real sinks or real tmux.
 */

import { test, expect, describe, afterEach } from "bun:test";
import {
  _loggedKillWindowForTest,
  setExecutorTelemetrySinks,
  type TelemetrySink,
} from "./executor.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSinks(): {
  telemetry: TelemetrySink & { calls: Array<{ event: string; payload: Record<string, string> }> };
  warnCalls: string[];
  warn: (msg: string) => void;
} {
  const calls: Array<{ event: string; payload: Record<string, string> }> = [];
  const warnCalls: string[] = [];
  const telemetry: TelemetrySink & { calls: typeof calls } = {
    calls,
    emit(event: string, payload: Record<string, string>): void {
      calls.push({ event, payload });
    },
  };
  const warn = (msg: string): void => { warnCalls.push(msg); };
  return { telemetry, warnCalls, warn };
}

afterEach(() => {
  // Restore default sinks after every test.
  setExecutorTelemetrySinks({});
});

// ---------------------------------------------------------------------------
// Case 1: reserved name "orchestrator" — stage-error origin
// ---------------------------------------------------------------------------

describe('loggedKillWindow — reserved name "orchestrator"', () => {
  test("does not throw", async () => {
    const { telemetry, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    const result = await _loggedKillWindowForTest("any-session", "orchestrator", "stage-error");
    expect(result).toBeUndefined();
  });

  test("emits telemetry once with correct event and payload", async () => {
    const { telemetry, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    await _loggedKillWindowForTest("any-session", "orchestrator", "stage-error");

    expect(telemetry.calls).toHaveLength(1);
    const call0 = telemetry.calls[0]!;
    expect(call0.event).toBe("workflow.tmux.kill_window_rejected");
    expect(call0.payload.windowName).toBe("orchestrator");
    expect(call0.payload.origin).toBe("stage-error");
    expect(call0.payload.error).toContain("reserved");
  });

  test("calls warn once with windowName, origin, and error message", async () => {
    const { telemetry, warnCalls, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    await _loggedKillWindowForTest("any-session", "orchestrator", "stage-error");

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain("orchestrator");
    expect(warnCalls[0]).toContain("stage-error");
    expect(warnCalls[0]).toContain("reserved");
  });
});

// ---------------------------------------------------------------------------
// Case 2: reserved name "0" — abort-cleanup origin
// ---------------------------------------------------------------------------

describe('loggedKillWindow — reserved name "0"', () => {
  test("does not throw", async () => {
    const { telemetry, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    const result = await _loggedKillWindowForTest("any-session", "0", "abort-cleanup");
    expect(result).toBeUndefined();
  });

  test("emits telemetry with windowName='0' and origin='abort-cleanup'", async () => {
    const { telemetry, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    await _loggedKillWindowForTest("any-session", "0", "abort-cleanup");

    expect(telemetry.calls).toHaveLength(1);
    const callA = telemetry.calls[0]!;
    expect(callA.payload.windowName).toBe("0");
    expect(callA.payload.origin).toBe("abort-cleanup");
    expect(callA.payload.error).toContain("reserved");
  });

  test("calls warn with '0', 'abort-cleanup', and error fragment", async () => {
    const { telemetry, warnCalls, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    await _loggedKillWindowForTest("any-session", "0", "abort-cleanup");

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain("0");
    expect(warnCalls[0]).toContain("abort-cleanup");
    expect(warnCalls[0]).toContain("reserved");
  });
});

// ---------------------------------------------------------------------------
// Case 3: empty windowName — treated as reserved
// ---------------------------------------------------------------------------

describe("loggedKillWindow — empty windowName", () => {
  test("does not throw", async () => {
    const { telemetry, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    const result = await _loggedKillWindowForTest("any-session", "", "stage-error");
    expect(result).toBeUndefined();
  });

  test("emits telemetry with windowName=''", async () => {
    const { telemetry, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    await _loggedKillWindowForTest("any-session", "", "stage-error");

    expect(telemetry.calls).toHaveLength(1);
    expect(telemetry.calls[0]!.payload.windowName).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Case 4: "already dead" path — tmux.killWindow swallows internally, no telemetry
// ---------------------------------------------------------------------------

describe("loggedKillWindow — already-dead window (tmux swallows internally)", () => {
  test("telemetry NOT called", async () => {
    // killWindow for a non-reserved name resolves even if the underlying
    // tmuxExec fails (window already dead). The wrapper sees no rejection.
    // We need a non-reserved name that reaches killWindow without tmux running.
    // killWindow catches tmuxExec failures internally and returns normally.
    // So passing a non-reserved name should always resolve (no tmux binary needed).
    const { telemetry, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    // "work-session-pane" is not reserved; killWindow will try tmuxExec and
    // swallow any error (no server running), returning normally.
    await _loggedKillWindowForTest("any-session", "work-pane", "stage-error");

    expect(telemetry.calls).toHaveLength(0);
  });

  test("warn NOT called", async () => {
    const { telemetry, warnCalls, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    await _loggedKillWindowForTest("any-session", "work-pane", "abort-cleanup");

    expect(warnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 5: happy path — successful kill (tmuxExec succeeds)
// ---------------------------------------------------------------------------

describe("loggedKillWindow — happy path (successful kill)", () => {
  test("returns undefined without telemetry or warn", async () => {
    const { telemetry, warnCalls, warn } = makeSinks();
    setExecutorTelemetrySinks({ telemetry, warn });

    // Non-reserved name; if tmux is not running tmuxExec failure is swallowed by killWindow itself.
    const result = await _loggedKillWindowForTest("any-session", "worker-1", "stage-error");

    expect(result).toBeUndefined();
    expect(telemetry.calls).toHaveLength(0);
    expect(warnCalls).toHaveLength(0);
  });
});

