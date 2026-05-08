/**
 * Unit tests for tmux.killWindow.
 *
 * Integration tests (those that actually invoke tmux) are skipped when the
 * tmux binary is not on PATH. All tests are isolated to a dedicated session
 * name that is torn down in afterAll.
 */

import { test, expect, describe, afterAll } from "bun:test";
import {
  killWindow,
  tmuxRun,
  killSession,
  getMuxBinary,
  RESERVED_WINDOW_NAMES,
} from "./tmux.ts";

const hasTmux = !!Bun.which("tmux");

// Unique session name to avoid collisions with real sessions.
const TEST_SESSION = `atomic-test-kw-${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------
// Guard: reserved window names and empty name
// ---------------------------------------------------------------------------

describe("killWindow — reserved window guard", () => {
  test("rejects when windowName is '0'", async () => {
    await expect(killWindow("any-session", "0")).rejects.toThrow(
      /refuses to kill reserved window: 0/,
    );
  });

  test("rejects when windowName is 'orchestrator'", async () => {
    await expect(killWindow("any-session", "orchestrator")).rejects.toThrow(
      /refuses to kill reserved window: orchestrator/,
    );
  });

  test("rejects when windowName is empty string", async () => {
    await expect(killWindow("any-session", "")).rejects.toThrow(
      /refuses to kill reserved window: <empty>/,
    );
  });
});

// ---------------------------------------------------------------------------
// RESERVED_WINDOW_NAMES invariant
// ---------------------------------------------------------------------------

describe("RESERVED_WINDOW_NAMES", () => {
  test("contains '0' and 'orchestrator'", () => {
    expect(RESERVED_WINDOW_NAMES.has("0")).toBe(true);
    expect(RESERVED_WINDOW_NAMES.has("orchestrator")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: real tmux session
// ---------------------------------------------------------------------------

describe("killWindow — integration", () => {
  if (!hasTmux) {
    test("skipped: tmux not on PATH", () => {
      expect(getMuxBinary()).toBeNull();
    });
    return;
  }

  // bun:test has no async describe setup, so create the session synchronously
  // here and tear it down in afterAll.
  const WINDOW_KEEP = "keep-me";
  const WINDOW_KILL = "kill-me";

  const sessionResult = tmuxRun([
    "new-session",
    "-d",
    "-s",
    TEST_SESSION,
    "-n",
    WINDOW_KEEP,
  ]);

  let windowResult: string | null = null;
  if (sessionResult.ok) {
    const r = tmuxRun(["new-window", "-d", "-t", TEST_SESSION, "-n", WINDOW_KILL, "-P", "-F", "#{pane_id}", "sleep infinity"]);
    windowResult = r.ok ? r.stdout : null;
  }

  afterAll(() => {
    killSession(TEST_SESSION);
  });

  test("session and second window are created successfully", () => {
    expect(sessionResult.ok).toBe(true);
    expect(windowResult).not.toBeNull();
  });

  test("killWindow removes the target window", async () => {
    if (!sessionResult.ok) return; // session setup failed; skip

    await killWindow(TEST_SESSION, WINDOW_KILL);

    const listResult = tmuxRun(["list-windows", "-t", TEST_SESSION, "-F", "#{window_name}"]);
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;

    const windows = listResult.stdout.split("\n").filter(Boolean);
    expect(windows).not.toContain(WINDOW_KILL);
    expect(windows).toContain(WINDOW_KEEP);
  });

  test("killWindow resolves even when window no longer exists (idempotent)", async () => {
    if (!sessionResult.ok) return;

    // WINDOW_KILL was already killed in the previous test; calling again should not throw.
    await expect(killWindow(TEST_SESSION, WINDOW_KILL)).resolves.toBeUndefined();
  });
});
