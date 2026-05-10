/**
 * DaemonWorkflowContext — focused unit tests.
 *
 * Verifies:
 *   - stage() registers in RunState and settles the exit promise
 *   - stage() accepts the simple (name, opts) form
 *   - stage() accepts the full SDK (SessionRunOptions, _, _, run) form
 *   - stage() calls the run callback with a valid DaemonSessionContext
 *   - stage() marks RunState complete/error based on exit code
 *   - stage() propagates spawn failures as errors
 *   - transcript() and getMessages() read completed stage data
 *   - transcript() and getMessages() throw for unknown stages
 */

import { test, expect, describe, beforeEach, mock } from "bun:test";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DaemonWorkflowContext, attachDaemonHILWatchers } from "./daemon-workflow-context.ts";
import type { DaemonSessionContext } from "./daemon-workflow-context.ts";
import type { ISupervisor } from "./ui-protocol/methods.ts";
import { RunState } from "./run-state.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRunState(runId = randomUUID(), agent: "claude" | "opencode" | "copilot" = "claude"): RunState {
  return new RunState({
    runId,
    workflowName: "test-wf",
    agent,
    projectRoot: "/tmp",
  });
}

interface SpawnCall {
  runId: string;
  stageName: string;
  agent: string;
  args: string[];
  env?: Record<string, string>;
  onExit?: (exitCode: number, signal?: string) => void;
}

/**
 * Build a fake ISupervisor whose spawn() resolves immediately and fires
 * onExit with the given exitCode after a microtask.
 */
function makeFakeSupervisor(exitCode = 0): ISupervisor & { calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  return {
    calls,
    async spawn(params) {
      calls.push(params as SpawnCall);
      const pid = 12345;
      // Fire onExit asynchronously so the promise seam is exercised.
      if (params.onExit) {
        const cb = params.onExit;
        queueMicrotask(() => cb(exitCode));
      }
      return { pid };
    },
    sendInput: mock(() => {}),
    getScrollback: mock(() => ({ data: "", headOffset: 0 })),
    kill: mock(() => {}),
  } as ISupervisor & { calls: SpawnCall[] };
}

function makeCtx(supervisor: ISupervisor, sessionsBaseDir?: string): DaemonWorkflowContext {
  const runId = randomUUID();
  const state = makeRunState(runId);
  return new DaemonWorkflowContext({
    runId,
    agent: "claude",
    inputs: { prompt: "hello" },
    state,
    supervisor,
    sessionsBaseDir,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DaemonWorkflowContext", () => {
  describe("stage() — simple (name, opts) form", () => {
    test("resolves with a SessionHandle when subprocess exits 0", async () => {
      const supervisor = makeFakeSupervisor(0);
      const ctx = makeCtx(supervisor);

      const handle = await ctx.stage("scout");

      expect(handle.name).toBe("scout");
      expect(typeof handle.id).toBe("string");
      expect(handle.result).toBeUndefined();
    });

    test("rejects when subprocess exits non-zero", async () => {
      const supervisor = makeFakeSupervisor(1);
      const ctx = makeCtx(supervisor);

      await expect(ctx.stage("failing-stage")).rejects.toThrow(
        'Stage "failing-stage" subprocess exited with code 1',
      );
    });

    test("passes args and env to supervisor.spawn", async () => {
      const supervisor = makeFakeSupervisor(0);
      const ctx = makeCtx(supervisor);

      await ctx.stage("tool-stage", { args: ["--foo", "bar"], env: { MY_VAR: "1" } });

      expect(supervisor.calls).toHaveLength(1);
      expect(supervisor.calls[0]!.args).toEqual(["--foo", "bar"]);
      expect(supervisor.calls[0]!.env).toEqual({ MY_VAR: "1" });
    });

    test("calls supervisor.spawn with correct runId and stageName", async () => {
      const supervisor = makeFakeSupervisor(0);
      const runId = randomUUID();
      const state = makeRunState(runId);
      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "claude",
        inputs: {},
        state,
        supervisor,
      });

      await ctx.stage("my-stage");

      expect(supervisor.calls[0]!.runId).toBe(runId);
      expect(supervisor.calls[0]!.stageName).toBe("my-stage");
      expect(supervisor.calls[0]!.agent).toBe("claude");
    });
  });

  describe("stage() — full SDK (options, _, _, run) form", () => {
    test("extracts name from SessionRunOptions object", async () => {
      const supervisor = makeFakeSupervisor(0);
      const ctx = makeCtx(supervisor);

      const handle = await ctx.stage({ name: "sdk-stage", description: "test" }, {}, {});

      expect(handle.name).toBe("sdk-stage");
    });

    test("invokes run callback with DaemonSessionContext", async () => {
      const supervisor = makeFakeSupervisor(0);
      const ctx = makeCtx(supervisor);

      let receivedCtx: DaemonSessionContext | null = null;
      await ctx.stage(
        { name: "callback-stage" },
        {},
        {},
        async (s) => {
          receivedCtx = s;
        },
      );

      expect(receivedCtx).not.toBeNull();
      expect(receivedCtx!.agent).toBe("claude");
      expect(receivedCtx!.inputs).toEqual({ prompt: "hello" });
      expect(typeof receivedCtx!.sessionId).toBe("string");
    });

    test("callback result is returned in handle.result", async () => {
      const supervisor = makeFakeSupervisor(0);
      const ctx = makeCtx(supervisor);

      const handle = await ctx.stage(
        { name: "result-stage" },
        {},
        {},
        async (_s) => ({ answer: 42 }),
      );

      expect(handle.result).toEqual({ answer: 42 });
    });

    test("stage nested stage() from within run callback", async () => {
      const supervisor = makeFakeSupervisor(0);
      const ctx = makeCtx(supervisor);

      await ctx.stage({ name: "outer" }, {}, {}, async (s) => {
        await s.stage("inner");
      });

      // Claude full SDK-form stages stay on the daemon's headless provider
      // path until Claude has a daemon-native pane transport; only the
      // explicit simple-form nested stage uses the subprocess supervisor.
      const names = supervisor.calls.map((c) => c.stageName).sort();
      expect(names).toContain("inner");
    });

    test("non-headless OpenCode SDK stages spawn a daemon PTY instead of silently running headless", async () => {
      const runId = randomUUID();
      const state = makeRunState(runId, "opencode");
      const supervisor = makeFakeSupervisor(0);
      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "opencode",
        inputs: {},
        state,
        supervisor,
      });

      await expect(
        ctx.stage({ name: "visible-opencode" }, {}, {}, async () => undefined),
      ).rejects.toThrow("waiting for opencode stage");

      expect(supervisor.calls).toHaveLength(1);
      expect(supervisor.calls[0]!.stageName).toBe("visible-opencode");
      expect(supervisor.calls[0]!.args).toEqual(["--port", "0"]);
    });
  });

  describe("stage() — RunState integration", () => {
    test("adds stage to RunState before spawn", async () => {
      const runId = randomUUID();
      const state = makeRunState(runId);
      const addStageSpy = mock(state.addStage.bind(state));
      state.addStage = addStageSpy;

      const supervisor = makeFakeSupervisor(0);
      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "claude",
        inputs: {},
        state,
        supervisor,
      });

      await ctx.stage("run-state-stage");

      expect(addStageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: "run-state-stage" }),
      );
    });

    test("snapshot shows stage complete after successful exit", async () => {
      const runId = randomUUID();
      const state = makeRunState(runId);
      const supervisor = makeFakeSupervisor(0);
      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "claude",
        inputs: {},
        state,
        supervisor,
      });

      await ctx.stage("complete-stage");

      const snap = state.getSnapshot();
      const stageRow = snap.sessions.find((s) => s.name === "complete-stage");
      expect(stageRow).toBeDefined();
      expect(stageRow!.status).toBe("complete");
    });

    test("snapshot shows stage error after non-zero exit", async () => {
      const runId = randomUUID();
      const state = makeRunState(runId);
      const supervisor = makeFakeSupervisor(2);
      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "claude",
        inputs: {},
        state,
        supervisor,
      });

      await ctx.stage("error-stage").catch(() => {});

      const snap = state.getSnapshot();
      const stageRow = snap.sessions.find((s) => s.name === "error-stage");
      expect(stageRow).toBeDefined();
      expect(stageRow!.status).toBe("error");
    });

    test("infers sequential graph parents from awaited stage order", async () => {
      const runId = randomUUID();
      const state = makeRunState(runId);
      const supervisor = makeFakeSupervisor(0);
      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "claude",
        inputs: {},
        state,
        supervisor,
      });

      await ctx.stage("scout");
      await ctx.stage("summarize");

      const snap = state.getSnapshot();
      expect(snap.sessions.find((s) => s.name === "scout")?.parents).toEqual(["orchestrator"]);
      expect(snap.sessions.find((s) => s.name === "summarize")?.parents).toEqual(["scout"]);
    });

    test("infers parallel siblings and fan-in parents", async () => {
      const runId = randomUUID();
      const state = makeRunState(runId);
      const supervisor = makeFakeSupervisor(0);
      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "claude",
        inputs: {},
        state,
        supervisor,
      });

      await Promise.all([ctx.stage("left"), ctx.stage("right")]);
      await ctx.stage("merge");

      const snap = state.getSnapshot();
      expect(snap.sessions.find((s) => s.name === "left")?.parents).toEqual(["orchestrator"]);
      expect(snap.sessions.find((s) => s.name === "right")?.parents).toEqual(["orchestrator"]);
      expect(snap.sessions.find((s) => s.name === "merge")?.parents).toEqual(["left", "right"]);
    });
  });

  describe("stage() — spawn failure", () => {
    test("rejects and records error in RunState when spawn throws", async () => {
      const runId = randomUUID();
      const state = makeRunState(runId);

      const failSupervisor: ISupervisor = {
        async spawn() {
          throw new Error("PTY spawn failed");
        },
        sendInput: mock(() => {}),
        getScrollback: mock(() => ({ data: "", headOffset: 0 })),
        kill: mock(() => {}),
      };

      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "claude",
        inputs: {},
        state,
        supervisor: failSupervisor,
      });

      await expect(ctx.stage("bad-stage")).rejects.toThrow("PTY spawn failed");

      const snap = state.getSnapshot();
      const stageRow = snap.sessions.find((s) => s.name === "bad-stage");
      expect(stageRow!.status).toBe("error");
    });
  });

  describe("daemon HIL watcher bridge", () => {
    type EventHandler = (event: { data?: unknown }) => void;

    function makeEventSession() {
      const handlers = new Map<string, Set<EventHandler>>();
      return {
        on(eventType: string, handler: EventHandler): () => void {
          let bucket = handlers.get(eventType);
          if (!bucket) {
            bucket = new Set<EventHandler>();
            handlers.set(eventType, bucket);
          }
          bucket.add(handler);
          return () => bucket?.delete(handler);
        },
        emit(eventType: string, data: unknown): void {
          for (const handler of handlers.get(eventType) ?? []) handler({ data });
        },
      };
    }

    test("Copilot ask_user events mark the stage awaiting_input and then running", async () => {
      const state = makeRunState(randomUUID(), "copilot");
      state.addStage({ name: "ask-color" });
      state.sessionStarted("ask-color");
      const session = makeEventSession();

      const unsubscribe = await attachDaemonHILWatchers({
        agent: "copilot",
        stageName: "ask-color",
        state,
        client: {},
        session,
        getSessionId: () => "copilot-session-1",
      });

      session.emit("tool.execution_start", {
        toolName: "ask_user",
        toolCallId: "tool-1",
      });
      let snap = state.getSnapshot();
      expect(snap.sessions.find((s) => s.name === "ask-color")?.status).toBe("awaiting_input");
      expect(snap.overall).toBe("needs_review");

      session.emit("tool.execution_complete", { toolCallId: "tool-1" });
      snap = state.getSnapshot();
      expect(snap.sessions.find((s) => s.name === "ask-color")?.status).toBe("running");

      unsubscribe();
      state.dispose();
    });

    test("Copilot elicitation events also drive awaiting_input status", async () => {
      const state = makeRunState(randomUUID(), "copilot");
      state.addStage({ name: "select-option" });
      state.sessionStarted("select-option");
      const session = makeEventSession();

      const unsubscribe = await attachDaemonHILWatchers({
        agent: "copilot",
        stageName: "select-option",
        state,
        client: {},
        session,
        getSessionId: () => "copilot-session-2",
      });

      session.emit("elicitation.requested", { requestId: "req-1" });
      expect(state.getSnapshot().sessions.find((s) => s.name === "select-option")?.status)
        .toBe("awaiting_input");

      session.emit("elicitation.completed", { requestId: "req-1" });
      expect(state.getSnapshot().sessions.find((s) => s.name === "select-option")?.status)
        .toBe("running");

      unsubscribe();
      state.dispose();
    });

    test("OpenCode question events from the daemon event stream drive awaiting_input status", async () => {
      type OpencodeEvent = { type: string; properties: { sessionID?: string } };
      const queue: OpencodeEvent[] = [];
      let resolveNext: ((value: IteratorResult<OpencodeEvent>) => void) | null = null;
      let closed = false;
      const stream: AsyncIterable<OpencodeEvent> = {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<OpencodeEvent>> {
              const value = queue.shift();
              if (value) return Promise.resolve({ value, done: false });
              if (closed) return Promise.resolve({ value: undefined, done: true });
              return new Promise((resolve) => { resolveNext = resolve; });
            },
          };
        },
      };
      const push = (event: OpencodeEvent): void => {
        if (resolveNext) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve({ value: event, done: false });
          return;
        }
        queue.push(event);
      };
      const close = (): void => {
        closed = true;
        if (resolveNext) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve({ value: undefined, done: true });
        }
      };

      const state = makeRunState(randomUUID(), "opencode");
      state.addStage({ name: "ask-color" });
      state.sessionStarted("ask-color");

      const unsubscribe = await attachDaemonHILWatchers({
        agent: "opencode",
        stageName: "ask-color",
        state,
        client: { event: { subscribe: async () => ({ stream }) } },
        session: {},
        getSessionId: () => "oc-session-1",
      });

      push({ type: "question.asked", properties: { sessionID: "oc-session-1" } });
      await Promise.resolve();
      expect(state.getSnapshot().sessions.find((s) => s.name === "ask-color")?.status)
        .toBe("awaiting_input");

      push({ type: "question.replied", properties: { sessionID: "oc-session-1" } });
      await Promise.resolve();
      expect(state.getSnapshot().sessions.find((s) => s.name === "ask-color")?.status)
        .toBe("running");

      close();
      unsubscribe();
      state.dispose();
    });
  });

  describe("transcript() and getMessages()", () => {
    test("transcript() throws for unknown stage name", async () => {
      const supervisor = makeFakeSupervisor(0);
      const ctx = makeCtx(supervisor);

      await expect(ctx.transcript("nonexistent")).rejects.toThrow(
        'No transcript for "nonexistent"',
      );
    });

    test("getMessages() throws for unknown stage name", async () => {
      const supervisor = makeFakeSupervisor(0);
      const ctx = makeCtx(supervisor);

      await expect(ctx.getMessages("nonexistent")).rejects.toThrow(
        'No messages for "nonexistent"',
      );
    });

    test("transcript() reads inbox.md from stage session dir", async () => {
      const baseDir = join(tmpdir(), "daemon-ctx-test-" + randomUUID());
      const supervisor = makeFakeSupervisor(0);
      const runId = randomUUID();
      const state = makeRunState(runId);
      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "claude",
        inputs: {},
        state,
        supervisor,
        sessionsBaseDir: baseDir,
      });

      // Run the stage so it gets registered in completedStages.
      await ctx.stage("transcript-stage");

      // Write inbox.md to the expected location.
      const stageDir = join(baseDir, runId, "transcript-stage");
      await mkdir(stageDir, { recursive: true });
      await writeFile(join(stageDir, "inbox.md"), "# Hello world");

      const result = await ctx.transcript("transcript-stage");
      expect(result.content).toBe("# Hello world");
      expect(result.path).toContain("inbox.md");
    });

    test("getMessages() reads messages.json from stage session dir", async () => {
      const baseDir = join(tmpdir(), "daemon-ctx-test-" + randomUUID());
      const supervisor = makeFakeSupervisor(0);
      const runId = randomUUID();
      const state = makeRunState(runId);
      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "claude",
        inputs: {},
        state,
        supervisor,
        sessionsBaseDir: baseDir,
      });

      await ctx.stage("msgs-stage");

      const stageDir = join(baseDir, runId, "msgs-stage");
      await mkdir(stageDir, { recursive: true });
      const messages = [{ role: "user", content: "hi" }];
      await writeFile(join(stageDir, "messages.json"), JSON.stringify(messages));

      const result = await ctx.getMessages("msgs-stage");
      expect(result).toEqual(messages);
    });

    test("transcript() accepts a SessionHandle reference", async () => {
      const baseDir = join(tmpdir(), "daemon-ctx-test-" + randomUUID());
      const supervisor = makeFakeSupervisor(0);
      const runId = randomUUID();
      const state = makeRunState(runId);
      const ctx = new DaemonWorkflowContext({
        runId,
        agent: "claude",
        inputs: {},
        state,
        supervisor,
        sessionsBaseDir: baseDir,
      });

      const handle = await ctx.stage("handle-stage");

      const stageDir = join(baseDir, runId, "handle-stage");
      await mkdir(stageDir, { recursive: true });
      await writeFile(join(stageDir, "inbox.md"), "transcript content");

      const result = await ctx.transcript(handle);
      expect(result.content).toBe("transcript content");
    });
  });
});
