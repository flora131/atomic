/**
 * Reproduction script for three conductor interrupt bugs observed in the
 * 2026-03-25T064245 debug trace.
 *
 * Run:  bun test tests/services/workflows/conductor/interrupt-workflow-bugs.repro.ts
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Bug A — Duplicate `workflow.step.start` event on resume (banner re-shows)
 *
 *   Root cause: `emitStepStart()` is called unconditionally in
 *   `executeAgentStage()` (conductor.ts:316) even when `isResuming=true`.
 *   The `isResuming` flag is consumed by `onStageTransition` and reset
 *   before `emitStepStart` fires, so the step.start event always emits.
 *
 *   Observed: After interrupt + resume, the stage banner re-shows in the UI
 *   because a second `workflow.step.start` bus event is dispatched.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Bug B — Queued message + interrupt bypasses the drain loop
 *
 *   Root cause: When the user queues a message during a stage and then
 *   presses Ctrl+C, the queued message is consumed via `waitForResumeInput()
 *   → checkQueuedMessage()` which triggers a FULL re-execution of
 *   `executeAgentStage()` (with step.start, step.complete events) instead
 *   of being drained to the existing session within `runStageSession()`.
 *
 *   Observed: The stage banner re-shows, a new step.start/step.complete
 *   cycle fires, and the stage advances to the next node immediately after
 *   the queued message response, rather than staying in the current stage.
 *
 *   Expected: Queued messages on interrupt should be drained to the
 *   preserved session (like the normal completion drain loop at
 *   conductor.ts:505-545), NOT trigger re-execution.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Bug C — Submit handler race condition (new session instead of resume)
 *
 *   Root cause: After `interruptStreaming()` resets `isStreamingRef=false`
 *   (synchronous), the conductor's `waitForResumeInput()` has NOT yet been
 *   called (async — depends on runStageSession returning → executeAgentStage
 *   → execute loop). If the user submits a message during this window:
 *
 *     1. `waitForUserInputResolverRef.current` → null (resolver not set)
 *     2. `isStreamingRef.current` → false (interrupted)
 *     3. Falls through to `sendMessage()` → creates a new session
 *
 *   Observed in trace: After interrupt, session `a68fc48c` (runId=2) was
 *   created as a NEW chat session — not a conductor resume. The agent said
 *   "I don't have any prior context about what task was being worked on."
 *   No `workflow.step.start` was emitted; spinner was missing.
 *
 *   This is a UI-layer timing issue. At the conductor level, we demonstrate
 *   the gap by showing that `waitForResumeInput` is called asynchronously
 *   AFTER interrupt completes.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, test, mock } from "bun:test";
import { WorkflowSessionConductor } from "@/services/workflows/conductor/conductor.ts";
import type {
  ConductorConfig,
  StageContext,
  StageDefinition,
} from "@/services/workflows/conductor/types.ts";
import type {
  BaseState,
  CompiledGraph,
  NodeDefinition,
  Edge,
} from "@/services/workflows/graph/types.ts";
import type { Session, AgentMessage, SessionConfig } from "@/services/agents/types.ts";
import type { BusEvent } from "@/services/events/bus-events/types.ts";

// ---------------------------------------------------------------------------
// Test Helpers (mirrors conductor-interrupt-resume.test.ts)
// ---------------------------------------------------------------------------

function createMockSession(response: string, id = "session-1"): Session {
  return {
    id,
    send: mock(async () => ({ type: "text" as const, content: response })),
    stream: async function* (
      _message: string,
      _options?: { agent?: string; abortSignal?: AbortSignal },
    ) {
      yield { type: "text" as const, content: response } as AgentMessage;
    },
    summarize: mock(async () => {}),
    getContextUsage: mock(async () => ({
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 100000,
      usagePercentage: 0.15,
    })),
    getSystemToolsTokens: () => 0,
    destroy: mock(async () => {}),
  };
}

function agentNode(id: string): NodeDefinition<BaseState> {
  return {
    id,
    type: "agent",
    execute: mock(async () => ({})),
  };
}

function buildLinearGraph(
  nodes: NodeDefinition<BaseState>[],
): CompiledGraph<BaseState> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: Edge<BaseState>[] = [];

  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  }

  return {
    nodes: nodeMap,
    edges,
    startNode: nodes[0]!.id,
    endNodes: new Set([nodes[nodes.length - 1]!.id]),
    config: {},
  };
}

function stage(
  id: string,
  options?: Partial<StageDefinition>,
): StageDefinition {
  return {
    id,
    indicator: `[${id.toUpperCase()}]`,
    buildPrompt: (_ctx: StageContext) => `Prompt for ${id}`,
    ...options,
  };
}

function buildConfig(
  graph: CompiledGraph<BaseState>,
  sessionFactory: (config?: SessionConfig) => Promise<Session>,
  overrides?: Partial<ConductorConfig>,
): ConductorConfig {
  return {
    graph,
    createSession: sessionFactory,
    destroySession: mock(async (_session: Session) => {}),
    onStageTransition: mock((_from: string | null, _to: string) => {}),
    onTaskUpdate: mock((_tasks) => {}),
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

/** Collect dispatched bus events into an array, filtering by type prefix. */
function createEventCollector(prefix?: string) {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const dispatchEvent = mock((event: BusEvent) => {
    const e = event as unknown as { type: string; data: Record<string, unknown> };
    if (!prefix || e.type.startsWith(prefix)) {
      events.push(e);
    }
  });
  return { events, dispatchEvent };
}

// ---------------------------------------------------------------------------
// Bug A — Duplicate `workflow.step.start` event on resume
// ---------------------------------------------------------------------------

describe("Bug A: Duplicate workflow.step.start on resume", () => {
  test("interrupt + resume emits TWO step.start events for the same stage (BUG)", async () => {
    let conductor: WorkflowSessionConductor;
    let hasInterrupted = false;
    const { events, dispatchEvent } = createEventCollector("workflow.step.");

    const sessionFactory = async () => {
      const session = createMockSession("");
      session.stream = async function* () {
        if (!hasInterrupted) {
          hasInterrupted = true;
          yield { type: "text" as const, content: "partial" } as AgentMessage;
          conductor!.interrupt();
        } else {
          yield { type: "text" as const, content: "resumed" } as AgentMessage;
        }
      };
      return session;
    };

    const graph = buildLinearGraph([agentNode("planner")]);
    const config = buildConfig(graph, sessionFactory, {
      waitForResumeInput: async () => "Continue",
      dispatchEvent,
      workflowId: "ralph",
      sessionId: "test-session",
      runId: 1,
    });

    conductor = new WorkflowSessionConductor(config, [stage("planner")]);
    await conductor.execute("Build a snake game");

    // Count step.start events for the planner stage
    const stepStartEvents = events.filter(
      (e) => e.type === "workflow.step.start" && e.data.nodeId === "planner",
    );
    const stepCompleteEvents = events.filter(
      (e) => e.type === "workflow.step.complete" && e.data.nodeId === "planner",
    );

    // BUG: Currently emits 2 step.start events (one on initial, one on resume)
    // EXPECTED: Should emit exactly 1 step.start per stage execution
    //           The resume should NOT emit a second step.start.
    console.log(
      `[Bug A] step.start count for planner: ${stepStartEvents.length} (expected: 1)`,
    );
    console.log(
      `[Bug A] step.complete count for planner: ${stepCompleteEvents.length}`,
    );

    // This assertion currently FAILS — demonstrating the bug.
    // Once fixed, the conductor should only emit 1 step.start on resume.
    expect(stepStartEvents.length).toBe(1);
  });

  test("step.complete with 'interrupted' should NOT be followed by a new step.start for the same stage", async () => {
    let conductor: WorkflowSessionConductor;
    let hasInterrupted = false;
    const { events, dispatchEvent } = createEventCollector("workflow.step.");

    const sessionFactory = async () => {
      const session = createMockSession("");
      session.stream = async function* () {
        if (!hasInterrupted) {
          hasInterrupted = true;
          yield { type: "text" as const, content: "partial" } as AgentMessage;
          conductor!.interrupt();
        } else {
          yield { type: "text" as const, content: "done" } as AgentMessage;
        }
      };
      return session;
    };

    const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);
    const config = buildConfig(graph, sessionFactory, {
      waitForResumeInput: async () => "Continue",
      dispatchEvent,
      workflowId: "ralph",
      sessionId: "test-session",
      runId: 1,
    });

    conductor = new WorkflowSessionConductor(config, [
      stage("planner"),
      stage("reviewer"),
    ]);
    await conductor.execute("Build a snake game");

    // Build the ordered event timeline
    const timeline = events.map((e) => `${e.type}:${e.data.nodeId}`);
    console.log("[Bug A] Event timeline:", timeline);

    // Expected timeline for interrupt+resume of planner, then reviewer:
    //   step.start:planner → step.complete:planner(interrupted)
    //   → [resume: NO step.start] → step.complete:planner(completed)
    //   → step.start:reviewer → step.complete:reviewer(completed)
    //
    // BUG: Actual timeline has a DUPLICATE step.start:planner after the interrupt:
    //   step.start:planner → step.complete:planner(interrupted)
    //   → step.start:planner(DUPLICATE!) → step.complete:planner(completed)
    //   → step.start:reviewer → step.complete:reviewer(completed)

    const plannerStarts = timeline.filter((e) => e === "workflow.step.start:planner");

    // This assertion currently FAILS — demonstrating the bug.
    expect(plannerStarts.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bug B — Queued message + interrupt bypasses drain loop
// ---------------------------------------------------------------------------

describe("Bug B: Queued message + interrupt bypasses drain loop", () => {
  test("queued message on interrupt triggers re-execution instead of in-session drain (BUG)", async () => {
    let conductor: WorkflowSessionConductor;
    let hasInterrupted = false;
    const { events, dispatchEvent } = createEventCollector("workflow.step.");
    const streamedPrompts: string[] = [];

    const sessionFactory = async () => {
      const session = createMockSession("");
      session.stream = async function* (msg: string) {
        streamedPrompts.push(msg);
        if (!hasInterrupted) {
          hasInterrupted = true;
          yield { type: "text" as const, content: "working on it..." } as AgentMessage;
          conductor!.interrupt();
        } else {
          yield { type: "text" as const, content: "processed queued msg" } as AgentMessage;
        }
      };
      return session;
    };

    // Simulate: user queued a message during the stage, then pressed Ctrl+C.
    // checkQueuedMessage returns the queued message when called by
    // waitForResumeInput (first call), then null on subsequent calls.
    let queueCheckCount = 0;
    const checkQueuedMessage = mock(() => {
      queueCheckCount++;
      if (queueCheckCount === 1) return "also add a scoreboard";
      return null;
    });

    const waitForResumeInput = mock(async () => {
      // Should NOT be called — queued message should be consumed first
      return null;
    });

    const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);
    const config = buildConfig(graph, sessionFactory, {
      checkQueuedMessage,
      waitForResumeInput,
      dispatchEvent,
      workflowId: "ralph",
      sessionId: "test-session",
      runId: 1,
    });

    conductor = new WorkflowSessionConductor(config, [
      stage("planner"),
      stage("reviewer"),
    ]);
    const result = await conductor.execute("Build a snake game");

    const timeline = events.map(
      (e) => `${e.type}:${e.data.nodeId}(${e.data.status ?? ""})`,
    );
    console.log("[Bug B] Event timeline:", timeline);
    console.log("[Bug B] Streamed prompts:", streamedPrompts);

    // Count step.start events for planner
    const plannerStarts = events.filter(
      (e) => e.type === "workflow.step.start" && e.data.nodeId === "planner",
    );
    const plannerCompletes = events.filter(
      (e) => e.type === "workflow.step.complete" && e.data.nodeId === "planner",
    );

    // BUG: Currently emits 2 step.start and 2 step.complete for planner
    // (one set for the interrupted execution, one set for the resume).
    // This causes the stage banner to re-show in the UI.
    //
    // EXPECTED: The queued message should be drained to the preserved session
    // within the current stage execution (like the normal drain loop), NOT
    // trigger a full re-execution cycle with new step events.
    console.log(
      `[Bug B] planner step.start count: ${plannerStarts.length} (expected: 1)`,
    );
    console.log(
      `[Bug B] planner step.complete count: ${plannerCompletes.length} (expected: 1 final)`,
    );

    // This assertion currently FAILS — demonstrating the bug.
    expect(plannerStarts.length).toBe(1);
  });

  test("queued message + interrupt should send the message to the SAME stage session", async () => {
    let conductor: WorkflowSessionConductor;
    let hasInterrupted = false;
    let sessionCreateCount = 0;
    const streamedPrompts: string[] = [];

    const sessionFactory = async () => {
      sessionCreateCount++;
      const session = createMockSession("", `session-${sessionCreateCount}`);
      session.stream = async function* (msg: string) {
        streamedPrompts.push(msg);
        if (!hasInterrupted) {
          hasInterrupted = true;
          yield { type: "text" as const, content: "working..." } as AgentMessage;
          conductor!.interrupt();
        } else {
          yield { type: "text" as const, content: "handled queued" } as AgentMessage;
        }
      };
      return session;
    };

    let queueCheckCount = 0;
    const graph = buildLinearGraph([agentNode("planner")]);
    const config = buildConfig(graph, sessionFactory, {
      checkQueuedMessage: mock(() => {
        queueCheckCount++;
        if (queueCheckCount === 1) return "queued feedback";
        return null;
      }),
    });

    conductor = new WorkflowSessionConductor(config, [stage("planner")]);
    const result = await conductor.execute("Build a snake game");

    console.log(`[Bug B] Sessions created: ${sessionCreateCount} (expected: 1)`);
    console.log(`[Bug B] Streamed prompts: ${JSON.stringify(streamedPrompts)}`);

    // The queued message SHOULD be sent to the same session (preserved from
    // interrupt). The conductor currently does reuse the session, but it goes
    // through a full re-execution of executeAgentStage which emits duplicate
    // events. Verify at least that only 1 session was created.
    expect(sessionCreateCount).toBe(1);

    // The result should show the planner completed (queued message processed)
    expect(result.stageOutputs.get("planner")!.status).toBe("completed");
  });

  test("queued message on interrupt is preserved and consumed via the resume path", async () => {
    /**
     * When a queued message exists at interrupt time, the conductor
     * preserves the current session and returns "interrupted" so that
     * execute() → waitForResumeInput() can consume the queued message and
     * resume the SAME stage/session through the normal resume path.
     * This restores the spinner/streaming target before the follow-up
     * stream starts and avoids incorrectly advancing the stage.
     *
     * Expected behavior:
     * - 3 stage transitions: planner (initial), planner (resume), reviewer
     * - The resume transition carries { isResume: true }
     * - The planner output includes both the original and queued responses
     * - The reviewer stage still executes after planner completes
     */
    let conductor: WorkflowSessionConductor;
    let hasInterrupted = false;
    const stageTransitions: Array<{ from: string | null; to: string; isResume: boolean }> = [];

    const sessionFactory = async () => {
      const session = createMockSession("");
      session.stream = async function* (_msg: string) {
        if (!hasInterrupted) {
          hasInterrupted = true;
          yield { type: "text" as const, content: "planning tasks..." } as AgentMessage;
          conductor!.interrupt();
        } else {
          yield { type: "text" as const, content: "ok noted about scoreboard" } as AgentMessage;
        }
      };
      return session;
    };

    let queueCheckCount = 0;
    const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);
    const config = buildConfig(graph, sessionFactory, {
      checkQueuedMessage: mock(() => {
        queueCheckCount++;
        if (queueCheckCount === 1) return "also add a scoreboard";
        return null;
      }),
      onStageTransition: mock((from: string | null, to: string, options?: { isResume?: boolean }) => {
        stageTransitions.push({ from, to, isResume: options?.isResume ?? false });
      }),
    });

    conductor = new WorkflowSessionConductor(config, [
      stage("planner"),
      stage("reviewer"),
    ]);
    const result = await conductor.execute("Build a snake game");

    // The reviewer stage should have executed after the planner completed
    // via the resume path.
    expect(result.stageOutputs.has("reviewer")).toBe(true);

    // 3 transitions: planner (initial), planner (resume with isResume: true), reviewer.
    // The queued message is consumed via waitForResumeInput() and delivered
    // through the normal stage re-entry path rather than in-session drain.
    expect(stageTransitions).toHaveLength(3);
    expect(stageTransitions[0]).toEqual({ from: null, to: "planner", isResume: false });
    expect(stageTransitions[1]).toEqual({ from: "planner", to: "planner", isResume: true });
    expect(stageTransitions[2]).toEqual({ from: "planner", to: "reviewer", isResume: false });

    // With the resume path, the second runStageSession call overwrites the
    // first in stageOutputs, so the final planner output contains the
    // queued-message response (not the interrupted initial response).
    const plannerOutput = result.stageOutputs.get("planner");
    expect(plannerOutput?.status).toBe("completed");
    expect(plannerOutput?.rawResponse).toContain("ok noted about scoreboard");
  });
});

// ---------------------------------------------------------------------------
// Bug C — Submit handler race: message sent between interrupt and resolver
// ---------------------------------------------------------------------------

describe("Bug C: Submit handler race condition (new session instead of resume)", () => {
  /**
   * This bug lives in the React submit handler (submit.ts:119-164),
   * not in the conductor itself. The conductor correctly sets up
   * `waitForResumeInput()` → `waitForUserInput()` → creates resolver.
   *
   * The race condition is:
   *
   *   T1: Ctrl+C pressed
   *       → interruptStreaming() runs synchronously
   *       → isStreamingRef.current = false
   *       → conductor.interrupt() sets interrupted=true, calls session.abort()
   *
   *   T2: conductor.runStageSession() detects interrupt
   *       → returns StageOutput with status="interrupted" (async)
   *
   *   T3: conductor.executeAgentStage() completes (async)
   *       → emits workflow.step.complete
   *
   *   T4: conductor.execute() calls waitForResumeInput() (async)
   *       → calls context.waitForUserInput()
   *       → sets waitForUserInputResolverRef.current
   *
   *   The user can submit a message at ANY point between T1 and T4.
   *   If submitted between T1 and T4:
   *     - waitForUserInputResolverRef.current is null → skip
   *     - isStreamingRef.current is false → don't enqueue
   *     - Falls through to sendMessage() → NEW session (BUG)
   *
   *   These tests demonstrate the timing gap at the conductor level.
   */

  test("waitForResumeInput is called AFTER interrupt completes (demonstrates async gap)", async () => {
    let conductor: WorkflowSessionConductor;
    const timestamps: Array<{ event: string; time: number }> = [];
    const t0 = Date.now();

    const blockingSession: Session = {
      ...createMockSession(""),
      stream: async function* () {
        yield { type: "text" as const, content: "streaming..." } as AgentMessage;
        // Simulate some work before the interrupt is detected
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      },
      abort: mock(async () => {
        timestamps.push({ event: "session.abort", time: Date.now() - t0 });
      }),
    };

    const graph = buildLinearGraph([agentNode("planner")]);
    const config = buildConfig(graph, async () => blockingSession, {
      waitForResumeInput: async () => {
        timestamps.push({ event: "waitForResumeInput.called", time: Date.now() - t0 });
        // Simulate: by this point, the user's message has already been sent
        // as a new session (the bug). Return null to advance.
        return null;
      },
    });

    conductor = new WorkflowSessionConductor(config, [stage("planner")]);

    // Simulate: interrupt is called "immediately" (T1)
    setTimeout(() => {
      timestamps.push({ event: "conductor.interrupt", time: Date.now() - t0 });
      conductor.interrupt();
    }, 5);

    await conductor.execute("Build a snake game");

    console.log("[Bug C] Timestamp log:", timestamps);

    // Verify the async gap: interrupt happens before waitForResumeInput
    const interruptTime = timestamps.find((t) => t.event === "conductor.interrupt")!.time;
    const waitTime = timestamps.find((t) => t.event === "waitForResumeInput.called")?.time;

    if (waitTime !== undefined) {
      const gapMs = waitTime - interruptTime;
      console.log(
        `[Bug C] Gap between interrupt and waitForResumeInput: ${gapMs}ms`,
      );
      console.log(
        "[Bug C] During this gap, user submits could bypass the resolver",
      );

      // The gap demonstrates the race window. Any user input during this
      // gap will not find waitForUserInputResolverRef set, and if
      // isStreamingRef is false (from interruptStreaming), the message
      // falls through to sendMessage → new session.
      expect(gapMs).toBeGreaterThan(0);
    }
  });

  test("message submitted during async gap is lost to the conductor", async () => {
    /**
     * Simulates the exact scenario from the log trace:
     *
     *   1. Planner stage streaming
     *   2. User presses Ctrl+C → interrupt
     *   3. User types "Continue" and presses Enter
     *   4. Message bypasses conductor → creates new chat session
     *   5. New session has NO context ("I don't have any prior context")
     *   6. No workflow.step.start emitted → spinner missing
     *
     * At the conductor level, we simulate this by:
     *   - Interrupting during streaming
     *   - waitForResumeInput returning null (simulating the message
     *     being "stolen" by the normal submit path)
     *   - Verifying the conductor sees no resume input
     */
    let conductor: WorkflowSessionConductor;
    let waitForResumeInputCalled = false;
    let sessionCreateCount = 0;

    const sessionFactory = async () => {
      sessionCreateCount++;
      const session = createMockSession("", `session-${sessionCreateCount}`);
      session.stream = async function* () {
        yield { type: "text" as const, content: "planning..." } as AgentMessage;
        // Interrupt during streaming
        conductor!.interrupt();
      };
      return session;
    };

    const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);
    const config = buildConfig(graph, sessionFactory, {
      waitForResumeInput: async () => {
        waitForResumeInputCalled = true;
        // Simulate: the user's "Continue" message was already consumed by
        // the normal submit path (sendMessage), so the conductor gets null.
        return null;
      },
    });

    conductor = new WorkflowSessionConductor(config, [
      stage("planner"),
      stage("reviewer"),
    ]);
    const result = await conductor.execute("Build a snake game");

    console.log(`[Bug C] waitForResumeInput called: ${waitForResumeInputCalled}`);
    console.log(`[Bug C] Sessions created: ${sessionCreateCount}`);

    // The conductor DID call waitForResumeInput (this works correctly)
    expect(waitForResumeInputCalled).toBe(true);

    // But since it returned null (message was stolen), the conductor
    // destroyed the preserved session and advanced to reviewer.
    // The user's "Continue" message went to a completely new session
    // with NO workflow context.
    expect(result.stageOutputs.get("planner")!.status).toBe("interrupted");

    // The reviewer still executed (conductor advanced past interrupted planner)
    expect(result.stageOutputs.has("reviewer")).toBe(true);
    expect(sessionCreateCount).toBe(2); // 1 for planner, 1 for reviewer
  });

  test("demonstrates the fix: queuing message during interrupt gap should be consumed by conductor", async () => {
    /**
     * This test shows the DESIRED behavior after fixing Bug C:
     *
     *   When a user submits a message after Ctrl+C but before the
     *   conductor's waitForResumeInput() is called, the message should
     *   be enqueued (not sent as a new session), and the conductor's
     *   checkQueuedMessage() should find it.
     *
     * Fix approach: The submit handler should enqueue the message when
     * `workflowState.workflowActive === true` even if `isStreamingRef`
     * is false and no resolver is set. This ensures the conductor's
     * `checkQueuedMessage()` picks it up.
     */
    let conductor: WorkflowSessionConductor;
    let hasInterrupted = false;
    let sessionCreateCount = 0;

    const sessionFactory = async () => {
      sessionCreateCount++;
      const session = createMockSession("", `session-${sessionCreateCount}`);
      session.stream = async function* () {
        if (!hasInterrupted) {
          hasInterrupted = true;
          yield { type: "text" as const, content: "planning..." } as AgentMessage;
          conductor!.interrupt();
        } else {
          yield { type: "text" as const, content: "continuing with context" } as AgentMessage;
        }
      };
      return session;
    };

    // Simulate the FIXED submit handler: message is enqueued during the gap
    // and picked up by checkQueuedMessage.
    let queueCheckCount = 0;
    const graph = buildLinearGraph([agentNode("planner")]);
    const config = buildConfig(graph, sessionFactory, {
      checkQueuedMessage: mock(() => {
        queueCheckCount++;
        // First call (from waitForResumeInput): return the queued message
        // that the user typed during the async gap
        if (queueCheckCount === 1) return "Continue";
        return null;
      }),
      // waitForResumeInput should NOT be called when checkQueuedMessage has a message
      waitForResumeInput: mock(async () => {
        throw new Error("waitForResumeInput should not be called — checkQueuedMessage had a message");
      }),
    });

    conductor = new WorkflowSessionConductor(config, [stage("planner")]);
    const result = await conductor.execute("Build a snake game");

    // With the fix, the conductor should have:
    // 1. Found the "Continue" message via checkQueuedMessage
    // 2. Resumed the planner stage using the preserved session
    // 3. Completed the planner stage successfully
    expect(result.stageOutputs.get("planner")!.status).toBe("completed");
    expect(sessionCreateCount).toBe(1); // Preserved session reused
  });
});

// ---------------------------------------------------------------------------
// Combined regression: Full interrupt/resume cycle from the trace
// ---------------------------------------------------------------------------

describe("Regression: Full interrupt/resume cycle matching trace 2026-03-25T064245", () => {
  test("reproduces the exact trace sequence: planner interrupt → 'Continue' → new session", async () => {
    /**
     * Trace sequence:
     *   seq 2:  workflow.step.start  planner
     *   seq 3:  stream.session.start bbf9854f (planner session)
     *   seq 58: stream.session.info  cancellation
     *   seq 60: stream.session.idle  bbf9854f idle
     *   seq 61: workflow.step.complete planner (interrupted)
     *   seq 62: stream.session.start a68fc48c (NEW session! BUG)
     *
     * Expected after fix:
     *   seq 2:  workflow.step.start  planner
     *   seq 3:  stream.session.start bbf9854f
     *   seq 58: stream.session.info  cancellation
     *   seq 60: stream.session.idle  bbf9854f idle
     *   seq 61: workflow.step.complete planner (interrupted)
     *   seq 62: stream.session.start bbf9854f (RESUME — same session!)
     *   (NO second workflow.step.start for planner)
     */
    let conductor: WorkflowSessionConductor;
    let hasInterrupted = false;
    let sessionCreateCount = 0;
    const { events, dispatchEvent } = createEventCollector("workflow.step.");
    const sessionIds: string[] = [];

    const sessionFactory = async () => {
      sessionCreateCount++;
      const sid = `session-${sessionCreateCount}`;
      sessionIds.push(sid);
      const session = createMockSession("", sid);
      session.stream = async function* () {
        if (!hasInterrupted) {
          hasInterrupted = true;
          // Simulate planner streaming thinking deltas then interrupt
          yield { type: "text" as const, content: "The user wants me to decompose..." } as AgentMessage;
          conductor!.interrupt();
        } else {
          yield { type: "text" as const, content: "Continuing with the plan..." } as AgentMessage;
        }
      };
      return session;
    };

    const graph = buildLinearGraph([agentNode("planner"), agentNode("orchestrator")]);
    const config = buildConfig(graph, sessionFactory, {
      waitForResumeInput: async () => "Continue",
      dispatchEvent,
      workflowId: "ralph",
      sessionId: "18fbe5ee-36f6-4d4b-921b-31451641fd3a",
      runId: 3381042473,
    });

    conductor = new WorkflowSessionConductor(config, [
      stage("planner", { indicator: "⌕ PLANNER" }),
      stage("orchestrator", { indicator: "⚡ ORCHESTRATOR" }),
    ]);
    const result = await conductor.execute("Build a Rust TUI snake game");

    // Log the event trace for comparison
    const trace = events.map(
      (e) => `${e.type} ${e.data.nodeId} ${e.data.status ? `(${e.data.status})` : ""}`.trim(),
    );
    console.log("\n[Regression] Event trace:");
    trace.forEach((t) => console.log(`  ${t}`));
    console.log(`[Regression] Sessions created: ${sessionCreateCount}`);
    console.log(`[Regression] Session IDs: ${sessionIds}`);

    // Verify: only 1 session created for planner (preserved session reused)
    // Session 2 should be for orchestrator, not a duplicate planner session
    expect(sessionCreateCount).toBe(2); // 1 planner (reused) + 1 orchestrator

    // Verify: only 1 step.start for planner (BUG: currently 2)
    const plannerStarts = events.filter(
      (e) => e.type === "workflow.step.start" && e.data.nodeId === "planner",
    );
    expect(plannerStarts.length).toBe(1);

    // Verify: planner completed successfully after resume
    expect(result.stageOutputs.get("planner")!.status).toBe("completed");
    expect(result.stageOutputs.get("orchestrator")!.status).toBe("completed");
    expect(result.success).toBe(true);
  });
});
