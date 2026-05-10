/**
 * RunManager — focused tests for terminal lifecycle (run/ended) and
 * cancellation path wired through stop().
 */

import { test, expect, describe } from "bun:test";
import { RunManager } from "./run-manager.ts";
import type { MessageConnection } from "vscode-jsonrpc";

// ─── Fake MessageConnection ───────────────────────────────────────────────────

interface Notification {
  method: string;
  params: unknown;
}

function fakeConnection(): MessageConnection & { notifications: Notification[] } {
  const notifications: Notification[] = [];
  return {
    notifications,
    sendNotification(method: string, params?: unknown) {
      notifications.push({ method, params });
    },
    sendRequest: () => Promise.resolve(undefined),
    onRequest: () => ({ dispose: () => {} }),
    onNotification: () => ({ dispose: () => {} }),
    onError: () => ({ dispose: () => {} }),
    onClose: () => ({ dispose: () => {} }),
    onUnhandledNotification: () => ({ dispose: () => {} }),
    onProgress: () => ({ dispose: () => {} }),
    sendProgress: () => Promise.resolve(),
    telemetry: { onEvent: () => ({ dispose: () => {} }) },
    trace: () => Promise.resolve(),
    initialize: () => Promise.resolve(),
    listen: () => {},
    end: () => {},
    dispose: () => {},
    hasPendingResponse: () => false,
    inspect: () => ({}),
  } as unknown as MessageConnection & { notifications: Notification[] };
}

/** Drain microtasks and macrotasks. */
async function flushAsync() {
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RunManager", () => {
  describe("stop() — cancellation path", () => {
    test("stop() marks run as cancelled in RunInfo", async () => {
      const manager = new RunManager();
      // Use a non-existent source so executeRun hangs until cancelled.
      // We don't need actual execution to test stop().
      const { runId } = await manager.start({
        source: "/dev/null/nonexistent-will-fail.ts",
        workflowName: "test-wf",
        agent: "claude",
        inputs: {},
      });

      await manager.stop(runId);
      await flushAsync();

      const info = manager.get(runId);
      expect(info).not.toBeNull();
      expect(info!.status).toBe("cancelled");
      expect(typeof info!.endedAt).toBe("string");
    });

    test("stop() emits run/ended with overall=cancelled to subscribers", async () => {
      const manager = new RunManager();
      const { runId } = await manager.start({
        source: "/dev/null/nonexistent.ts",
        workflowName: "cancel-test-wf",
        agent: "claude",
        inputs: {},
      });

      const conn = fakeConnection();
      manager.subscribe(conn, runId);

      await manager.stop(runId);
      await flushAsync();

      const ended = conn.notifications.filter((n) => n.method === "run/ended");
      expect(ended.length).toBe(1);
      const p = ended[0]!.params as { runId: string; overall: string };
      expect(p.runId).toBe(runId);
      expect(p.overall).toBe("cancelled");
    });

    test("stop() emits run/ended exactly once even if state already completed", async () => {
      const manager = new RunManager();
      const { runId } = await manager.start({
        source: "/dev/null/nonexistent.ts",
        workflowName: "double-end-wf",
        agent: "claude",
        inputs: {},
      });

      const conn = fakeConnection();
      manager.subscribe(conn, runId);

      // Manually trigger completion via getState (simulates executeRun finishing).
      const state = manager.getState(runId);
      state?.markCompletionReached();

      // Now stop() tries to cancel — should NOT emit a second run/ended.
      await manager.stop(runId);
      await flushAsync();

      const ended = conn.notifications.filter((n) => n.method === "run/ended");
      expect(ended.length).toBe(1);
      // First emission wins — completion beat cancellation.
      const p = ended[0]!.params as { overall: string };
      expect(p.overall).toBe("complete");
    });

    test("stop() on unknown runId is a no-op", async () => {
      const manager = new RunManager();
      await expect(manager.stop("does-not-exist")).resolves.toBeUndefined();
    });
  });

  describe("list()", () => {
    test("cancelled run appears in list() with scope=all", async () => {
      const manager = new RunManager();
      const { runId } = await manager.start({
        source: "/dev/null/noop.ts",
        workflowName: "list-test",
        agent: "claude",
        inputs: {},
      });
      await manager.stop(runId);
      await flushAsync();

      const all = manager.list("all");
      const match = all.find((r) => r.runId === runId);
      expect(match).toBeDefined();
      expect(match!.status).toBe("cancelled");
    });

    test("cancelled run does not appear in list('active')", async () => {
      const manager = new RunManager();
      const { runId } = await manager.start({
        source: "/dev/null/noop.ts",
        workflowName: "active-filter-test",
        agent: "claude",
        inputs: {},
      });
      await manager.stop(runId);
      await flushAsync();

      const active = manager.list("active");
      expect(active.find((r) => r.runId === runId)).toBeUndefined();
    });
  });
});
