import { test, expect, describe, beforeEach } from "bun:test";
import { PanelStore } from "../../../packages/workflow-sdk/src/components/orchestrator-panel-store.ts";

describe("PanelStore", () => {
  let store: PanelStore;

  beforeEach(() => {
    store = new PanelStore();
  });

  test("initializes with default values", () => {
    expect(store.version).toBe(0);
    expect(store.workflowName).toBe("");
    expect(store.agent).toBe("");
    expect(store.prompt).toBe("");
    expect(store.sessions).toEqual([]);
    expect(store.completionInfo).toBeNull();
    expect(store.fatalError).toBeNull();
    expect(store.completionReached).toBe(false);
    expect(store.exitResolve).toBeNull();
  });

  describe("subscribe", () => {
    test("calls listener on emit", () => {
      let called = 0;
      store.subscribe(() => { called++; });
      store.setWorkflowInfo("wf", "claude", [], "prompt");
      expect(called).toBe(1);
    });

    test("unsubscribe removes listener", () => {
      let called = 0;
      const unsub = store.subscribe(() => { called++; });
      unsub();
      store.setWorkflowInfo("wf", "claude", [], "prompt");
      expect(called).toBe(0);
    });

    test("multiple listeners all fire", () => {
      let a = 0;
      let b = 0;
      store.subscribe(() => { a++; });
      store.subscribe(() => { b++; });
      store.setWorkflowInfo("wf", "claude", [], "prompt");
      expect(a).toBe(1);
      expect(b).toBe(1);
    });
  });

  describe("setWorkflowInfo", () => {
    test("sets workflow metadata", () => {
      store.setWorkflowInfo("my-workflow", "copilot", [], "do stuff");
      expect(store.workflowName).toBe("my-workflow");
      expect(store.agent).toBe("copilot");
      expect(store.prompt).toBe("do stuff");
    });

    test("creates orchestrator session as first entry", () => {
      store.setWorkflowInfo("wf", "claude", [], "p");
      expect(store.sessions[0]!.name).toBe("orchestrator");
      expect(store.sessions[0]!.status).toBe("running");
      expect(store.sessions[0]!.parents).toEqual([]);
      expect(store.sessions[0]!.startedAt).toBeGreaterThan(0);
    });

    test("adds sessions with default parent of orchestrator", () => {
      store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
      expect(store.sessions).toHaveLength(2);
      expect(store.sessions[1]!.name).toBe("s1");
      expect(store.sessions[1]!.status).toBe("pending");
      expect(store.sessions[1]!.parents).toEqual(["orchestrator"]);
    });

    test("preserves explicit parents when provided", () => {
      store.setWorkflowInfo(
        "wf",
        "claude",
        [
          { name: "s1", parents: [] },
          { name: "s2", parents: ["s1"] },
        ],
        "p",
      );
      expect(store.sessions[2]!.parents).toEqual(["s1"]);
    });

    test("increments version", () => {
      expect(store.version).toBe(0);
      store.setWorkflowInfo("wf", "claude", [], "p");
      expect(store.version).toBe(1);
    });
  });

  describe("startSession", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
    });

    test("sets status to running and records startedAt", () => {
      store.startSession("s1");
      const s = store.sessions.find((s) => s.name === "s1")!;
      expect(s.status).toBe("running");
      expect(s.startedAt).toBeGreaterThan(0);
    });

    test("increments version", () => {
      const before = store.version;
      store.startSession("s1");
      expect(store.version).toBe(before + 1);
    });

    test("does not emit when session not found", () => {
      let called = 0;
      store.subscribe(() => { called++; });
      store.startSession("nonexistent");
      expect(called).toBe(0);
    });
  });

  describe("completeSession", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
      store.startSession("s1");
    });

    test("sets status to complete and records endedAt", () => {
      store.completeSession("s1");
      const s = store.sessions.find((s) => s.name === "s1")!;
      expect(s.status).toBe("complete");
      expect(s.endedAt).toBeGreaterThan(0);
    });

    test("does not emit when session not found", () => {
      let called = 0;
      store.subscribe(() => { called++; });
      store.completeSession("nonexistent");
      expect(called).toBe(0);
    });
  });

  describe("failSession", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
      store.startSession("s1");
    });

    test("sets status to error with error message and endedAt", () => {
      store.failSession("s1", "something broke");
      const s = store.sessions.find((s) => s.name === "s1")!;
      expect(s.status).toBe("error");
      expect(s.error).toBe("something broke");
      expect(s.endedAt).toBeGreaterThan(0);
    });

    test("does not emit when session not found", () => {
      let called = 0;
      store.subscribe(() => { called++; });
      store.failSession("nonexistent", "err");
      expect(called).toBe(0);
    });
  });

  describe("setCompletion", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
    });

    test("stores completion info", () => {
      store.setCompletion("wf", "/tmp/transcripts");
      expect(store.completionInfo).toEqual({
        workflowName: "wf",
        transcriptsPath: "/tmp/transcripts",
      });
    });

    test("marks orchestrator as complete", () => {
      store.setCompletion("wf", "/tmp/transcripts");
      const orch = store.sessions.find((s) => s.name === "orchestrator")!;
      expect(orch.status).toBe("complete");
      expect(orch.endedAt).toBeGreaterThan(0);
    });
  });

  describe("setFatalError", () => {
    beforeEach(() => {
      store.setWorkflowInfo("wf", "claude", [], "p");
    });

    test("stores fatal error message", () => {
      store.setFatalError("catastrophic failure");
      expect(store.fatalError).toBe("catastrophic failure");
    });

    test("marks completionReached", () => {
      store.setFatalError("err");
      expect(store.completionReached).toBe(true);
    });

    test("marks orchestrator as error", () => {
      store.setFatalError("err");
      const orch = store.sessions.find((s) => s.name === "orchestrator")!;
      expect(orch.status).toBe("error");
      expect(orch.endedAt).toBeGreaterThan(0);
    });
  });

  describe("markCompletionReached", () => {
    test("sets completionReached to true", () => {
      store.markCompletionReached();
      expect(store.completionReached).toBe(true);
    });

    test("increments version", () => {
      const before = store.version;
      store.markCompletionReached();
      expect(store.version).toBe(before + 1);
    });
  });
});
