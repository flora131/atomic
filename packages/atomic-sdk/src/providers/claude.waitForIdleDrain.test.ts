/**
 * Regression test: waitForIdle must not resolve while backgrounded Agent/Task
 * sub-agents are still in the inflight dir.
 *
 * Covers the fix in handleMarker: `await waitForInflightDrained(sessionId)`
 * must drain the inflight dir before returning [true, sliced].
 *
 * Strategy:
 * - mock.module("@anthropic-ai/claude-agent-sdk") to return a terminal
 *   assistant message so the transcript-poll loop exits immediately.
 * - Write real marker files under ~/.atomic using a fresh UUID (no collision
 *   risk). claudeHookDirs() is hardwired to os.homedir(); there is no
 *   env-var override, so we use the real dir with isolated session IDs.
 */

import {
  test,
  expect,
  mock,
  beforeAll,
  afterAll,
  afterEach,
} from "bun:test";
import { mkdir, writeFile, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";

// ---------------------------------------------------------------------------
// Stub getSessionMessages BEFORE claude.ts is imported.
// We capture and restore the real SDK to avoid cross-test contamination.
// ---------------------------------------------------------------------------
const actualClaudeSdk = await import("@anthropic-ai/claude-agent-sdk");

const fakeEndTurnMessage = {
  type: "assistant" as const,
  uuid: "fake-uuid",
  session_id: "fake-session",
  parent_tool_use_id: null,
  message: { stop_reason: "end_turn", content: [] },
};

beforeAll(() => {
  mock.module("@anthropic-ai/claude-agent-sdk", () => ({
    ...actualClaudeSdk,
    getSessionMessages: async () => [fakeEndTurnMessage],
  }));
});

afterAll(() => {
  mock.module("@anthropic-ai/claude-agent-sdk", () => ({ ...actualClaudeSdk }));
});

// Dynamic import AFTER mock is installed so claude.ts uses the stub.
const { waitForIdle } = await import("./claude.ts");
const { claudeHookDirs } = await import("./claude-stop-hook.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionPaths(sessionId: string) {
  const dirs = claudeHookDirs();
  return {
    stopDir: dirs.marker,
    stopMarker: join(dirs.marker, sessionId),
    inflightRoot: dirs.inflight,
    inflightDir: join(dirs.inflight, sessionId),
    inflightMarker: join(dirs.inflight, sessionId, "fake-agent"),
  };
}

const cleanupIds: string[] = [];

afterEach(async () => {
  for (const id of cleanupIds.splice(0)) {
    const p = sessionPaths(id);
    try { await unlink(p.stopMarker); } catch { /* ignore */ }
    try { await rm(p.inflightDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Regression test
// ---------------------------------------------------------------------------

test(
  "waitForIdle blocks while inflight marker is present, resolves after removal",
  async () => {
    const sessionId = randomUUID();
    cleanupIds.push(sessionId);
    const p = sessionPaths(sessionId);

    // Create parent dirs (normally done by createClaudeSession).
    await mkdir(p.stopDir, { recursive: true });
    await mkdir(p.inflightRoot, { recursive: true });

    // Create inflight marker: simulates a backgrounded Agent that fired
    // SubagentStart but not SubagentStop yet.
    await mkdir(p.inflightDir, { recursive: true });
    await writeFile(p.inflightMarker, JSON.stringify({ ts: Date.now() }), "utf-8");

    // Start waitForIdle — it will block on waitForInflightDrained after
    // seeing the stop marker.
    let resolved = false;
    let resolvedValue: unknown;
    const idlePromise = waitForIdle(sessionId, 0).then((v) => {
      resolved = true;
      resolvedValue = v;
    });

    // Write the stop marker so fs.watch (or the pre-attach existsSync) fires.
    await writeFile(p.stopMarker, "", "utf-8");

    // Give waitForIdle ~150ms to pick up the marker and enter the drain wait.
    await Bun.sleep(150);

    // waitForInflightDrained polls every 100ms — must NOT have resolved yet.
    expect(resolved).toBe(false);

    // Drain: remove the inflight marker.
    await unlink(p.inflightMarker);

    // waitForInflightDrained should detect the empty dir within ~200ms.
    await Bun.sleep(250);

    expect(resolved).toBe(true);
    expect(Array.isArray(resolvedValue)).toBe(true);

    // Consume the promise so Bun doesn't flag an unhandled rejection.
    await idlePromise;
  },
  5000,
);
