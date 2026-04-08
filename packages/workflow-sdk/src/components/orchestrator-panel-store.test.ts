import { test, expect, describe, mock, beforeEach } from "bun:test";
import { PanelStore } from "./orchestrator-panel-store.ts";

describe("PanelStore", () => {
  let store: PanelStore;

  beforeEach(() => {
    store = new PanelStore();
  });

  // ── 1. Initial state ────────────────────────────────────────────────────────

  describe("initial state", () => {
    test("version starts at 0", () => {
      expect(store.version).toBe(0);
    });

    test("workflowName starts as empty string", () => {
      expect(store.workflowName).toBe("");
    });

    test("agent starts as empty string", () => {
      expect(store.agent).toBe("");
    });

    test("prompt starts as empty string", () => {
      expect(store.prompt).toBe("");
    });

    test("sessions starts as empty array", () => {
      expect(store.sessions).toEqual([]);
    });

    test("completionInfo starts as null", () => {
      expect(store.completionInfo).toBeNull();
    });

    test("fatalError starts as null", () => {
      expect(store.fatalError).toBeNull();
    });

    test("completionReached starts as false", () => {
      expect(store.completionReached).toBe(false);
    });

    test("exitResolve starts as null", () => {
      expect(store.exitResolve).toBeNull();
    });
  });

  // ── 2. setWorkflowInfo ──────────────────────────────────────────────────────

  describe("setWorkflowInfo", () => {
    test("sets workflowName, agent, and prompt", () => {
      store.setWorkflowInfo("my-workflow", "claude", [], "do something");
      expect(store.workflowName).toBe("my-workflow");
      expect(store.agent).toBe("claude");
      expect(store.prompt).toBe("do something");
    });

    test("creates orchestrator session as first session with running status", () => {
      store.setWorkflowInfo("wf", "claude", [], "prompt");
      const orch = store.sessions[0]!;
      expect(orch.name).toBe("orchestrator");
      expect(orch.status).toBe("running");
      expect(orch.parents).toEqual([]);
      expect(orch.startedAt).toBeGreaterThan(0);
      expect(orch.endedAt).toBeNull();
    });

    test("creates pending sessions for provided panel sessions", () => {
      store.setWorkflowInfo("wf", "claude", [
        { name: "task-a", parents: ["p1"] },
        { name: "task-b", parents: ["p1", "p2"] },
      ], "prompt");

      expect(store.sessions).toHaveLength(3);

      const taskA = store.sessions[1]!;
      expect(taskA.name).toBe("task-a");
      expect(taskA.status).toBe("pending");
      expect(taskA.parents).toEqual(["p1"]);
      expect(taskA.startedAt).toBeNull();
      expect(taskA.endedAt).toBeNull();

      const taskB = store.sessions[2]!;
      expect(taskB.name).toBe("task-b");
      expect(taskB.status).toBe("pending");
      expect(taskB.parents).toEqual(["p1", "p2"]);
    });

    test("increments version by exactly 1", () => {
      expect(store.version).toBe(0);
      store.setWorkflowInfo("wf", "claude", [], "prompt");
      expect(store.version).toBe(1);
    });

    test("calls subscribed listener", () => {
      const listener = mock(() => {});
      store.subscribe(listener);
      store.setWorkflowInfo("wf", "claude", [], "prompt");
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ── 3. setWorkflowInfo with empty parents ───────────────────────────────────

  describe("setWorkflowInfo with empty parents", () => {
    test("sessions with empty parents array default to ['orchestrator']", () => {
      store.setWorkflowInfo("wf", "claude", [
        { name: "s1", parents: [] },
        { name: "s2", parents: [] },
      ], "prompt");

      expect(store.sessions[1]!.parents).toEqual(["orchestrator"]);
      expect(store.sessions[2]!.parents).toEqual(["orchestrator"]);
    });

    test("sessions with explicit parents are not overridden", () => {
      store.setWorkflowInfo("wf", "claude", [
        { name: "s1", parents: ["other"] },
      ], "prompt");

      expect(store.sessions[1]!.parents).toEqual(["other"]);
    });
  });

  // ── 4. startSession ─────────────────────────────────────────────────────────

  describe("startSession", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [{ name: "worker", parents: [] }], "prompt");
    });

    test("changes session status to running", () => {
      store.startSession("worker");
      const s = store.sessions.find((s) => s.name === "worker")!;
      expect(s.status).toBe("running");
    });

    test("sets startedAt to a positive timestamp", () => {
      store.startSession("worker");
      const s = store.sessions.find((s) => s.name === "worker")!;
      expect(s.startedAt).toBeGreaterThan(0);
    });

    test("bumps version by exactly 1", () => {
      const before = store.version;
      store.startSession("worker");
      expect(store.version).toBe(before + 1);
    });
  });

  // ── 5. startSession with unknown name ───────────────────────────────────────

  describe("startSession with unknown name", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [{ name: "worker", parents: [] }], "prompt");
    });

    test("does not emit (version unchanged) when session not found", () => {
      const before = store.version;
      store.startSession("nonexistent");
      expect(store.version).toBe(before);
    });

    test("does not mutate existing sessions", () => {
      const before = store.sessions.map((s) => ({ ...s }));
      store.startSession("nonexistent");
      store.sessions.forEach((s, i) => {
        expect(s.name).toBe(before[i]!.name);
        expect(s.status).toBe(before[i]!.status);
      });
    });

    test("does not notify listeners when session not found", () => {
      const listener = mock(() => {});
      store.subscribe(listener);
      store.startSession("nonexistent");
      expect(listener).toHaveBeenCalledTimes(0);
    });
  });

  // ── 6. completeSession ──────────────────────────────────────────────────────

  describe("completeSession", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [{ name: "worker", parents: [] }], "prompt");
      store.startSession("worker");
    });

    test("changes status to complete", () => {
      store.completeSession("worker");
      const s = store.sessions.find((s) => s.name === "worker")!;
      expect(s.status).toBe("complete");
    });

    test("sets endedAt to a positive timestamp", () => {
      store.completeSession("worker");
      const s = store.sessions.find((s) => s.name === "worker")!;
      expect(s.endedAt).toBeGreaterThan(0);
    });

    test("bumps version by exactly 1", () => {
      const before = store.version;
      store.completeSession("worker");
      expect(store.version).toBe(before + 1);
    });

    test("does not emit when session not found", () => {
      const before = store.version;
      store.completeSession("nonexistent");
      expect(store.version).toBe(before);
    });
  });

  // ── 7. failSession ──────────────────────────────────────────────────────────

  describe("failSession", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [{ name: "worker", parents: [] }], "prompt");
      store.startSession("worker");
    });

    test("changes status to error", () => {
      store.failSession("worker", "connection timeout");
      const s = store.sessions.find((s) => s.name === "worker")!;
      expect(s.status).toBe("error");
    });

    test("stores the error message on the session", () => {
      store.failSession("worker", "connection timeout");
      const s = store.sessions.find((s) => s.name === "worker")!;
      expect(s.error).toBe("connection timeout");
    });

    test("sets endedAt to a positive timestamp", () => {
      store.failSession("worker", "err");
      const s = store.sessions.find((s) => s.name === "worker")!;
      expect(s.endedAt).toBeGreaterThan(0);
    });

    test("bumps version by exactly 1", () => {
      const before = store.version;
      store.failSession("worker", "err");
      expect(store.version).toBe(before + 1);
    });
  });

  // ── 8. setCompletion ────────────────────────────────────────────────────────

  describe("setCompletion", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [], "prompt");
    });

    test("stores completionInfo with workflowName and transcriptsPath", () => {
      store.setCompletion("my-wf", "/tmp/transcripts");
      expect(store.completionInfo).toEqual({
        workflowName: "my-wf",
        transcriptsPath: "/tmp/transcripts",
      });
    });

    test("marks orchestrator session as complete", () => {
      store.setCompletion("my-wf", "/tmp/transcripts");
      const orch = store.sessions.find((s) => s.name === "orchestrator")!;
      expect(orch.status).toBe("complete");
    });

    test("sets orchestrator endedAt to a positive timestamp", () => {
      store.setCompletion("my-wf", "/tmp/transcripts");
      const orch = store.sessions.find((s) => s.name === "orchestrator")!;
      expect(orch.endedAt).toBeGreaterThan(0);
    });

    test("bumps version by exactly 1", () => {
      const before = store.version;
      store.setCompletion("my-wf", "/tmp/transcripts");
      expect(store.version).toBe(before + 1);
    });
  });

  // ── 9. setFatalError ────────────────────────────────────────────────────────

  describe("setFatalError", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [], "prompt");
    });

    test("stores the fatalError message", () => {
      store.setFatalError("disk full");
      expect(store.fatalError).toBe("disk full");
    });

    test("sets completionReached to true", () => {
      store.setFatalError("disk full");
      expect(store.completionReached).toBe(true);
    });

    test("marks orchestrator session as error", () => {
      store.setFatalError("disk full");
      const orch = store.sessions.find((s) => s.name === "orchestrator")!;
      expect(orch.status).toBe("error");
    });

    test("sets orchestrator endedAt to a positive timestamp", () => {
      store.setFatalError("disk full");
      const orch = store.sessions.find((s) => s.name === "orchestrator")!;
      expect(orch.endedAt).toBeGreaterThan(0);
    });

    test("bumps version by exactly 1", () => {
      const before = store.version;
      store.setFatalError("disk full");
      expect(store.version).toBe(before + 1);
    });
  });

  // ── 10. subscribe / unsubscribe ─────────────────────────────────────────────

  describe("subscribe / unsubscribe", () => {
    test("listener is called when an emit occurs", () => {
      const listener = mock(() => {});
      store.subscribe(listener);
      store.markCompletionReached();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    test("listener is not called after unsubscribing", () => {
      const listener = mock(() => {});
      const unsubscribe = store.subscribe(listener);
      unsubscribe();
      store.markCompletionReached();
      expect(listener).toHaveBeenCalledTimes(0);
    });

    test("multiple unsubscribes are safe (idempotent)", () => {
      const listener = mock(() => {});
      const unsubscribe = store.subscribe(listener);
      unsubscribe();
      unsubscribe(); // second call should not throw
      store.markCompletionReached();
      expect(listener).toHaveBeenCalledTimes(0);
    });

    test("multiple listeners all receive the emit", () => {
      const a = mock(() => {});
      const b = mock(() => {});
      store.subscribe(a);
      store.subscribe(b);
      store.markCompletionReached();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    test("unsubscribing one listener does not affect others", () => {
      const a = mock(() => {});
      const b = mock(() => {});
      const unsubA = store.subscribe(a);
      store.subscribe(b);
      unsubA();
      store.markCompletionReached();
      expect(a).toHaveBeenCalledTimes(0);
      expect(b).toHaveBeenCalledTimes(1);
    });
  });

  // ── 11. version increments ──────────────────────────────────────────────────

  describe("version increments", () => {
    test("each setWorkflowInfo call increments version by exactly 1", () => {
      store.setWorkflowInfo("wf", "claude", [], "p");
      expect(store.version).toBe(1);
      store.setWorkflowInfo("wf2", "copilot", [], "p2");
      expect(store.version).toBe(2);
    });

    test("startSession increments version by exactly 1", () => {
      store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
      const before = store.version;
      store.startSession("s1");
      expect(store.version).toBe(before + 1);
    });

    test("completeSession increments version by exactly 1", () => {
      store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
      store.startSession("s1");
      const before = store.version;
      store.completeSession("s1");
      expect(store.version).toBe(before + 1);
    });

    test("failSession increments version by exactly 1", () => {
      store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
      store.startSession("s1");
      const before = store.version;
      store.failSession("s1", "err");
      expect(store.version).toBe(before + 1);
    });

    test("setCompletion increments version by exactly 1", () => {
      store.setWorkflowInfo("wf", "claude", [], "p");
      const before = store.version;
      store.setCompletion("wf", "/tmp");
      expect(store.version).toBe(before + 1);
    });

    test("setFatalError increments version by exactly 1", () => {
      store.setWorkflowInfo("wf", "claude", [], "p");
      const before = store.version;
      store.setFatalError("err");
      expect(store.version).toBe(before + 1);
    });

    test("markCompletionReached increments version by exactly 1", () => {
      const before = store.version;
      store.markCompletionReached();
      expect(store.version).toBe(before + 1);
    });

    test("resolveExit does not increment version (no emit)", () => {
      store.exitResolve = () => {};
      const before = store.version;
      store.resolveExit();
      expect(store.version).toBe(before);
    });
  });

  // ── 12. resolveExit ─────────────────────────────────────────────────────────

  describe("resolveExit", () => {
    test("calls the exitResolve callback", () => {
      const resolver = mock(() => {});
      store.exitResolve = resolver;
      store.resolveExit();
      expect(resolver).toHaveBeenCalledTimes(1);
    });

    test("sets exitResolve to null after calling it", () => {
      store.exitResolve = () => {};
      store.resolveExit();
      expect(store.exitResolve).toBeNull();
    });
  });

  // ── 13. resolveExit idempotency ─────────────────────────────────────────────

  describe("resolveExit idempotency", () => {
    test("calling resolveExit twice only invokes callback once", () => {
      const resolver = mock(() => {});
      store.exitResolve = resolver;
      store.resolveExit();
      store.resolveExit(); // second call: exitResolve is now null, so callback should NOT fire again
      expect(resolver).toHaveBeenCalledTimes(1);
    });
  });

  // ── 14. resolveExit with no callback ────────────────────────────────────────

  describe("resolveExit with no callback", () => {
    test("is a no-op when exitResolve is null", () => {
      expect(store.exitResolve).toBeNull();
      expect(() => store.resolveExit()).not.toThrow();
    });

    test("does not change any state when exitResolve is null", () => {
      const versionBefore = store.version;
      store.resolveExit();
      expect(store.version).toBe(versionBefore);
      expect(store.exitResolve).toBeNull();
    });
  });

  // ── 15. markCompletionReached ───────────────────────────────────────────────

  describe("markCompletionReached", () => {
    test("sets completionReached to true", () => {
      expect(store.completionReached).toBe(false);
      store.markCompletionReached();
      expect(store.completionReached).toBe(true);
    });

    test("emits (version increments)", () => {
      const before = store.version;
      store.markCompletionReached();
      expect(store.version).toBe(before + 1);
    });

    test("notifies subscribed listeners", () => {
      const listener = mock(() => {});
      store.subscribe(listener);
      store.markCompletionReached();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    test("is idempotent for the completionReached flag", () => {
      store.markCompletionReached();
      store.markCompletionReached();
      expect(store.completionReached).toBe(true);
    });
  });

  // ── 16. Full lifecycle ──────────────────────────────────────────────────────

  describe("full lifecycle", () => {
    test("setWorkflowInfo → startSession → completeSession → setCompletion → markCompletionReached → resolveExit", () => {
      // Track all emits throughout
      const emitCount = { value: 0 };
      store.subscribe(() => { emitCount.value++; });

      // Step 1: set up workflow
      store.setWorkflowInfo("pipeline", "claude", [
        { name: "step-1", parents: [] },
        { name: "step-2", parents: ["step-1"] },
      ], "run the pipeline");

      expect(store.workflowName).toBe("pipeline");
      expect(store.sessions).toHaveLength(3);
      expect(store.sessions[0]!.status).toBe("running"); // orchestrator
      expect(store.sessions[1]!.status).toBe("pending"); // step-1
      expect(store.sessions[2]!.status).toBe("pending"); // step-2

      // Step 2: start step-1
      store.startSession("step-1");
      expect(store.sessions.find((s) => s.name === "step-1")!.status).toBe("running");

      // Step 3: complete step-1
      store.completeSession("step-1");
      expect(store.sessions.find((s) => s.name === "step-1")!.status).toBe("complete");

      // Start and complete step-2
      store.startSession("step-2");
      store.completeSession("step-2");
      expect(store.sessions.find((s) => s.name === "step-2")!.status).toBe("complete");

      // Step 4: set completion
      store.setCompletion("pipeline", "/transcripts/pipeline");
      expect(store.completionInfo).toEqual({
        workflowName: "pipeline",
        transcriptsPath: "/transcripts/pipeline",
      });
      expect(store.sessions.find((s) => s.name === "orchestrator")!.status).toBe("complete");

      // Step 5: mark completion reached
      store.markCompletionReached();
      expect(store.completionReached).toBe(true);

      // Step 6: resolveExit
      const exitCallback = mock(() => {});
      store.exitResolve = exitCallback;
      store.resolveExit();
      expect(exitCallback).toHaveBeenCalledTimes(1);
      expect(store.exitResolve).toBeNull();

      // Verify total emit count: setWorkflowInfo(1) + start(1) + complete(1) + start(1) + complete(1) + setCompletion(1) + markCompletionReached(1) = 7
      // resolveExit does NOT emit
      expect(emitCount.value).toBe(7);
    });
  });
});
