/**
 * Tests for conductor interrupt-pause-resume logic with queue drain (§5.1).
 *
 * Validates:
 * 1. `interrupt()` sets the `interrupted` flag and calls session.abort()
 * 2. `runStageSession()` returns `status: "interrupted"` when `interrupted` flag is true
 * 3. `execute()` loop pauses on `status === "interrupted"` and calls `waitForResumeInput()`
 * 4. `resume(message)` resolves the pause promise with the provided message
 * 5. `resume(null)` causes the loop to advance to the next node
 * 6. After interrupt + resume with message, session is reused (not destroyed)
 * 7. `checkQueuedMessage()` is called inside `runStageSession()` after initial stream completes
 * 8. `checkQueuedMessage()` is called before `waitForResumeInput()` on interrupt
 * 9. The `interrupted` flag is reset to `false` after being consumed
 * 10. Multiple sequential interrupts work correctly
 * 11. `emitStepComplete` emits "interrupted" status for interrupted stages
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
// Test Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Session that yields messages from a canned response. */
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

/** Create an agent node definition. */
function agentNode(id: string): NodeDefinition<BaseState> {
  return {
    id,
    type: "agent",
    execute: mock(async () => ({})),
  };
}

/** Build a simple linear graph: node1 -> node2 -> node3 ... */
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

/** Create a minimal StageDefinition. */
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

/** Create a ConductorConfig with common defaults. */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowSessionConductor — interrupt-pause-resume (§5.1)", () => {
  // -----------------------------------------------------------------------
  // 1. interrupt() sets the interrupted flag and calls session.abort()
  // -----------------------------------------------------------------------

  describe("interrupt() flag behavior", () => {
    test("interrupt sets the interrupted flag and calls session.abort()", async () => {
      const abortMock = mock(() => Promise.resolve());
      let resolveStream: (() => void) | undefined;

      const blockingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          yield { type: "text" as const, content: "partial" } as AgentMessage;
          await new Promise<void>((resolve) => {
            resolveStream = resolve;
          });
        },
        abort: abortMock,
      };

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => blockingSession);
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      const executePromise = conductor.execute("test");

      await new Promise((resolve) => setTimeout(resolve, 20));

      conductor.interrupt();

      expect(abortMock).toHaveBeenCalledTimes(1);

      resolveStream?.();
      const result = await executePromise;

      // The stage should have returned interrupted status
      const output = result.stageOutputs.get("planner");
      expect(output).toBeDefined();
      expect(output!.status).toBe("interrupted");
    });

    test("interrupted flag is reset after being consumed by runStageSession", async () => {
      // Use a session that completes normally after interrupt is set
      let streamCallCount = 0;
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
      ]);

      let conductor: WorkflowSessionConductor;

      const sessionFactory = async () => {
        streamCallCount++;
        if (streamCallCount === 1) {
          // First session: conductor.interrupt() is called during streaming
          const session = createMockSession("partial");
          session.stream = async function* () {
            yield { type: "text" as const, content: "partial" } as AgentMessage;
            // Simulate interrupt during first stage
            conductor!.interrupt();
          };
          return session;
        }
        // Second session: normal execution
        return createMockSession("reviewer output");
      };

      const config = buildConfig(graph, sessionFactory, {
        // waitForResumeInput returns null so conductor advances past interrupted stage
        waitForResumeInput: async () => null,
      });
      const stages = [stage("planner"), stage("reviewer")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // Planner was interrupted, but since waitForResumeInput returns null,
      // the conductor should advance to reviewer
      expect(result.stageOutputs.has("reviewer")).toBe(true);
      expect(result.stageOutputs.get("reviewer")!.status).toBe("completed");
    });
  });

  // -----------------------------------------------------------------------
  // 2. runStageSession returns "interrupted" when interrupted flag is set
  // -----------------------------------------------------------------------

  describe("runStageSession interrupt detection", () => {
    test("returns interrupted status when interrupt() is called during streaming", async () => {
      let conductor: WorkflowSessionConductor;

      const interruptingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          yield { type: "text" as const, content: "before " } as AgentMessage;
          conductor!.interrupt();
          yield { type: "text" as const, content: "after" } as AgentMessage;
        },
      };

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => interruptingSession);
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output).toBeDefined();
      expect(output!.status).toBe("interrupted");
      expect(output!.rawResponse).toBe("before after");
    });

    test("interrupt during streaming catch block returns interrupted, not error", async () => {
      let conductor: WorkflowSessionConductor;

      const throwingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          conductor!.interrupt();
          throw new Error("Stream aborted");
        },
      };

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => throwingSession);
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output).toBeDefined();
      expect(output!.status).toBe("interrupted");
    });
  });

  // -----------------------------------------------------------------------
  // 3. execute() loop pauses on interrupted and calls waitForResumeInput()
  // -----------------------------------------------------------------------

  describe("execute loop pause behavior", () => {
    test("calls waitForResumeInput when stage returns interrupted", async () => {
      const waitForResumeInputMock = mock(async () => null);
      let conductor: WorkflowSessionConductor;

      const interruptingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          yield { type: "text" as const, content: "output" } as AgentMessage;
          conductor!.interrupt();
        },
      };

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => interruptingSession, {
        waitForResumeInput: waitForResumeInputMock,
      });
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(waitForResumeInputMock).toHaveBeenCalledTimes(1);
    });

    test("checks checkQueuedMessage before calling waitForResumeInput on interrupt", async () => {
      const callOrder: string[] = [];
      let queueCheckCount = 0;
      const checkQueuedMessageMock = mock(() => {
        queueCheckCount++;
        callOrder.push("checkQueuedMessage");
        // Return a message on the first call (in waitForResumeInput),
        // null on subsequent calls (in the queue drain loop)
        return queueCheckCount === 1 ? "queued msg" : null;
      });
      const waitForResumeInputMock = mock(async () => {
        callOrder.push("waitForResumeInput");
        return null;
      });

      let conductor: WorkflowSessionConductor;
      let hasInterrupted = false;

      const sessionFactory = async () => {
        const session: Session = {
          ...createMockSession(""),
          // The session only interrupts once — on resume the preserved
          // session is reused and must complete normally.
          stream: async function* () {
            if (!hasInterrupted) {
              hasInterrupted = true;
              yield {
                type: "text" as const,
                content: "initial",
              } as AgentMessage;
              conductor!.interrupt();
            } else {
              yield {
                type: "text" as const,
                content: "resumed output",
              } as AgentMessage;
            }
          },
        };
        return session;
      };

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, sessionFactory, {
        checkQueuedMessage: checkQueuedMessageMock,
        waitForResumeInput: waitForResumeInputMock,
      });
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // checkQueuedMessage should have been called, and since it returned a message,
      // waitForResumeInput should NOT have been called
      expect(callOrder).toContain("checkQueuedMessage");
      expect(callOrder).not.toContain("waitForResumeInput");
    });
  });

  // -----------------------------------------------------------------------
  // 4. resume(message) resolves the pause promise
  // -----------------------------------------------------------------------

  describe("resume method", () => {
    test("resume(null) causes the loop to advance to the next node", async () => {
      let conductor: WorkflowSessionConductor;
      let sessionCallCount = 0;

      const sessionFactory = async () => {
        sessionCallCount++;
        if (sessionCallCount === 1) {
          const session: Session = {
            ...createMockSession(""),
            stream: async function* () {
              yield {
                type: "text" as const,
                content: "planner output",
              } as AgentMessage;
              conductor!.interrupt();
            },
          };
          return session;
        }
        return createMockSession("reviewer output");
      };

      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
      ]);
      const config = buildConfig(graph, sessionFactory, {
        waitForResumeInput: async () => null,
      });
      const stages = [stage("planner"), stage("reviewer")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // Planner was interrupted, waitForResumeInput returned null,
      // so reviewer should have executed
      expect(result.stageOutputs.has("reviewer")).toBe(true);
      expect(result.stageOutputs.get("reviewer")!.status).toBe("completed");
      expect(result.stageOutputs.get("reviewer")!.rawResponse).toBe(
        "reviewer output",
      );
    });

    test("resume(message) re-executes the same stage with the follow-up message", async () => {
      let conductor: WorkflowSessionConductor;
      const streamedMessages: string[] = [];
      let hasInterrupted = false;

      const sessionFactory = async () => {
        // The conductor preserves the session on interrupt and reuses it.
        // The stream must only interrupt once; on resume it completes normally.
        const session: Session = {
          ...createMockSession(""),
          stream: async function* (msg: string) {
            streamedMessages.push(msg);
            if (!hasInterrupted) {
              hasInterrupted = true;
              yield {
                type: "text" as const,
                content: "initial output",
              } as AgentMessage;
              conductor!.interrupt();
            } else {
              yield {
                type: "text" as const,
                content: "resumed output",
              } as AgentMessage;
            }
          },
        };
        return session;
      };

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, sessionFactory, {
        waitForResumeInput: async () => "follow-up message",
      });
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // The preserved session should have received the follow-up message as prompt
      expect(streamedMessages.length).toBeGreaterThanOrEqual(2);
      expect(streamedMessages[1]).toBe("follow-up message");
      expect(result.stageOutputs.get("planner")!.status).toBe("completed");
    });
  });

  // -----------------------------------------------------------------------
  // 5. Session preservation for resume
  // -----------------------------------------------------------------------

  describe("session preservation on resume", () => {
    test("preserved session is reused on resume instead of creating a new one", async () => {
      let conductor: WorkflowSessionConductor;
      const destroyedSessions: string[] = [];
      let sessionCallCount = 0;
      let hasInterrupted = false;

      const sessionFactory = async () => {
        sessionCallCount++;
        const session = createMockSession("output", `session-${sessionCallCount}`);
        // The session only interrupts once; on resume the preserved
        // session completes normally.
        session.stream = async function* () {
          if (!hasInterrupted) {
            hasInterrupted = true;
            yield {
              type: "text" as const,
              content: "initial",
            } as AgentMessage;
            conductor!.interrupt();
          } else {
            yield {
              type: "text" as const,
              content: "resumed",
            } as AgentMessage;
          }
        };
        return session;
      };

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, sessionFactory, {
        destroySession: mock(async (session: Session) => {
          destroyedSessions.push(session.id);
        }),
        waitForResumeInput: async () => "resume message",
      });
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // With session preservation, the conductor reuses the interrupted session
      // on resume instead of creating a new one. Only 1 session is created.
      expect(sessionCallCount).toBe(1);
      // The preserved session is destroyed once after the resumed stage completes.
      expect(destroyedSessions).toHaveLength(1);
      expect(destroyedSessions[0]).toBe("session-1");
    });

    test("preserved session is destroyed when resume returns null (no follow-up)", async () => {
      let conductor: WorkflowSessionConductor;
      const destroyedSessions: string[] = [];
      let sessionCallCount = 0;

      const sessionFactory = async () => {
        sessionCallCount++;
        const sessionId = `session-${sessionCallCount}`;
        if (sessionCallCount === 1) {
          // First session (planner): interrupts during streaming
          const session = createMockSession("output", sessionId);
          session.stream = async function* () {
            yield {
              type: "text" as const,
              content: "initial output",
            } as AgentMessage;
            conductor!.interrupt();
          };
          return session;
        }
        // Second session (reviewer): completes normally
        return createMockSession("reviewer output", sessionId);
      };

      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
      ]);
      const config = buildConfig(graph, sessionFactory, {
        destroySession: mock(async (session: Session) => {
          destroyedSessions.push(session.id);
        }),
        // Return null = no follow-up, should destroy preserved session
        waitForResumeInput: async () => null,
      });
      const stages = [stage("planner"), stage("reviewer")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // The planner session was interrupted; waitForResumeInput returned null,
      // so the preserved session should have been destroyed immediately (lines 227-231).
      expect(destroyedSessions).toContain("session-1");

      // The conductor should advance to the reviewer stage after destroying the preserved session.
      expect(result.stageOutputs.has("reviewer")).toBe(true);
      expect(result.stageOutputs.get("reviewer")!.status).toBe("completed");

      // session-1 was the interrupted (planner) session destroyed on null resume;
      // session-2 is the reviewer session destroyed after normal completion.
      expect(sessionCallCount).toBe(2);
      expect(destroyedSessions).toHaveLength(2);
    });

    test("preserved session is cleaned up at end of execute() if never reused", async () => {
      let conductor: WorkflowSessionConductor;
      const destroyedSessions: string[] = [];
      let sessionCallCount = 0;

      // Use a pre-aborted abort signal so the conductor exits the loop
      // before it can resume the interrupted stage.
      const abortController = new AbortController();

      const sessionFactory = async () => {
        sessionCallCount++;
        const session = createMockSession("output", `session-${sessionCallCount}`);
        session.stream = async function* () {
          yield {
            type: "text" as const,
            content: "initial output",
          } as AgentMessage;
          conductor!.interrupt();
        };
        return session;
      };

      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
      ]);
      const config = buildConfig(graph, sessionFactory, {
        destroySession: mock(async (session: Session) => {
          destroyedSessions.push(session.id);
        }),
        abortSignal: abortController.signal,
        // waitForResumeInput resolves after abort fires, returning null
        waitForResumeInput: async () => {
          // Abort before returning so the main loop exits
          abortController.abort();
          return null;
        },
      });
      const stages = [stage("planner"), stage("reviewer")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // The workflow was aborted, so it should not be successful
      expect(result.success).toBe(false);

      // The preserved session from the interrupted planner stage should be
      // cleaned up in the finally block at the end of execute() (lines 255-259).
      // It was destroyed either in the null-resume path or the finally block.
      expect(destroyedSessions).toContain("session-1");
      expect(sessionCallCount).toBe(1);
    });

    test("session is preserved (not destroyed) on error-path interrupt in catch block", async () => {
      let conductor: WorkflowSessionConductor;
      const destroyedSessions: string[] = [];
      let sessionCallCount = 0;
      let hasInterrupted = false;

      const sessionFactory = async () => {
        sessionCallCount++;
        const session = createMockSession("output", `session-${sessionCallCount}`);
        session.stream = async function* () {
          if (!hasInterrupted) {
            hasInterrupted = true;
            conductor!.interrupt();
            // Throw an error after interrupting — this triggers the catch block
            // (lines 567-572) which should preserve the session, not destroy it.
            throw new Error("Stream aborted due to interrupt");
          } else {
            yield {
              type: "text" as const,
              content: "resumed output",
            } as AgentMessage;
          }
        };
        return session;
      };

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, sessionFactory, {
        destroySession: mock(async (session: Session) => {
          destroyedSessions.push(session.id);
        }),
        // Resume with a follow-up so the preserved session is reused
        waitForResumeInput: async () => "follow-up after error interrupt",
      });
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // The session should have been preserved through the catch-block interrupt
      // and then reused on resume. Only 1 session should have been created.
      expect(sessionCallCount).toBe(1);

      // After resume, the stage should complete successfully
      expect(result.stageOutputs.get("planner")!.status).toBe("completed");

      // The preserved session is destroyed once — after the resumed stage completes
      expect(destroyedSessions).toHaveLength(1);
      expect(destroyedSessions[0]).toBe("session-1");
    });

    test("multiple interrupt-resume cycles reuse and destroy sessions correctly", async () => {
      let conductor: WorkflowSessionConductor;
      const destroyedSessions: string[] = [];
      let sessionCallCount = 0;
      // Track which stages have been interrupted (each only once)
      const interruptedStages = new Set<string>();

      const sessionFactory = async () => {
        sessionCallCount++;
        const session = createMockSession("output", `session-${sessionCallCount}`);
        session.stream = async function* () {
          const currentStage = conductor.getCurrentStage() ?? "unknown";
          if (!interruptedStages.has(currentStage)) {
            interruptedStages.add(currentStage);
            yield {
              type: "text" as const,
              content: `${currentStage}-partial`,
            } as AgentMessage;
            conductor!.interrupt();
          } else {
            yield {
              type: "text" as const,
              content: `${currentStage}-complete`,
            } as AgentMessage;
          }
        };
        return session;
      };

      const graph = buildLinearGraph([
        agentNode("stageA"),
        agentNode("stageB"),
        agentNode("stageC"),
      ]);
      const config = buildConfig(graph, sessionFactory, {
        destroySession: mock(async (session: Session) => {
          destroyedSessions.push(session.id);
        }),
        waitForResumeInput: async () => "resume",
      });
      const stages = [stage("stageA"), stage("stageB"), stage("stageC")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // All stages should have completed
      expect(result.success).toBe(true);
      expect(result.stageOutputs.has("stageA")).toBe(true);
      expect(result.stageOutputs.has("stageB")).toBe(true);
      expect(result.stageOutputs.has("stageC")).toBe(true);

      // Each stage interrupts once and is resumed — the preserved session is reused
      // each time, so only one session is created per stage (not two).
      expect(sessionCallCount).toBe(3);

      // Each session should be destroyed exactly once after its resumed stage completes.
      expect(destroyedSessions).toHaveLength(3);
      expect(destroyedSessions).toContain("session-1");
      expect(destroyedSessions).toContain("session-2");
      expect(destroyedSessions).toContain("session-3");

      // Each stage's final output should be "completed"
      expect(result.stageOutputs.get("stageA")!.status).toBe("completed");
      expect(result.stageOutputs.get("stageB")!.status).toBe("completed");
      expect(result.stageOutputs.get("stageC")!.status).toBe("completed");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Queue drain in runStageSession
  // -----------------------------------------------------------------------

  describe("queue drain during normal completion", () => {
    test("drains queued messages to the active session before completing", async () => {
      let queueCallCount = 0;
      const streamedMessages: string[] = [];

      const session = createMockSession("initial output");
      session.stream = async function* (msg: string) {
        streamedMessages.push(msg);
        yield {
          type: "text" as const,
          content: `response-to-${msg}`,
        } as AgentMessage;
      };

      const checkQueuedMessageMock = mock(() => {
        queueCallCount++;
        if (queueCallCount === 1) {
          return "queued-message-1";
        }
        return null; // No more queued messages
      });

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session, {
        checkQueuedMessage: checkQueuedMessageMock,
      });
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output).toBeDefined();
      expect(output!.status).toBe("completed");

      // The session should have received both the original prompt and the queued message
      expect(streamedMessages).toContain("queued-message-1");

      // The accumulated response should include both responses
      expect(output!.rawResponse).toContain("response-to-");
    });

    test("multiple queued messages are drained sequentially", async () => {
      let queueCallCount = 0;
      const streamedMessages: string[] = [];

      const session = createMockSession("");
      session.stream = async function* (msg: string) {
        streamedMessages.push(msg);
        yield {
          type: "text" as const,
          content: `[${msg}]`,
        } as AgentMessage;
      };

      const checkQueuedMessageMock = mock(() => {
        queueCallCount++;
        if (queueCallCount === 1) return "queued-1";
        if (queueCallCount === 2) return "queued-2";
        return null;
      });

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session, {
        checkQueuedMessage: checkQueuedMessageMock,
      });
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output!.status).toBe("completed");
      // All three messages processed: initial prompt + 2 queued
      expect(streamedMessages).toHaveLength(3);
      expect(streamedMessages[1]).toBe("queued-1");
      expect(streamedMessages[2]).toBe("queued-2");
    });

    test("interrupt during queue drain returns interrupted status", async () => {
      let conductor: WorkflowSessionConductor;
      let queueCallCount = 0;

      const session = createMockSession("");
      session.stream = async function* (msg: string) {
        yield { type: "text" as const, content: msg } as AgentMessage;
        // After processing queued message, simulate interrupt
        if (msg === "queued-message") {
          conductor!.interrupt();
        }
      };

      const checkQueuedMessageMock = mock(() => {
        queueCallCount++;
        if (queueCallCount === 1) return "queued-message";
        return null;
      });

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session, {
        checkQueuedMessage: checkQueuedMessageMock,
      });
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output).toBeDefined();
      expect(output!.status).toBe("interrupted");
      // The accumulated response should include both the initial and queued responses
      expect(output!.rawResponse).toContain("queued-message");
    });

    test("no queue drain when checkQueuedMessage is not configured", async () => {
      const session = createMockSession("normal output");

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session);
      // No checkQueuedMessage configured
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.stageOutputs.get("planner")!.status).toBe("completed");
      expect(result.stageOutputs.get("planner")!.rawResponse).toBe(
        "normal output",
      );
    });
  });

  // -----------------------------------------------------------------------
  // 7. Queue drain with streamSession (adapter pipeline)
  // -----------------------------------------------------------------------

  describe("queue drain with streamSession adapter", () => {
    test("uses streamSession for queued messages when available", async () => {
      let queueCallCount = 0;
      const streamSessionCalls: string[] = [];

      const streamSessionMock = mock(
        async (session: Session, prompt: string) => {
          streamSessionCalls.push(prompt);
          return `adapted-${prompt}`;
        },
      );

      const checkQueuedMessageMock = mock(() => {
        queueCallCount++;
        if (queueCallCount === 1) return "queued-via-adapter";
        return null;
      });

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(
        graph,
        async () => createMockSession("initial"),
        {
          streamSession: streamSessionMock,
          checkQueuedMessage: checkQueuedMessageMock,
        },
      );
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.stageOutputs.get("planner")!.status).toBe("completed");
      // streamSession should have been called for both the initial prompt and the queued message
      expect(streamSessionCalls).toContain("queued-via-adapter");
    });
  });

  // -----------------------------------------------------------------------
  // 8. emitStepComplete with "interrupted" status
  // -----------------------------------------------------------------------

  describe("emitStepComplete interrupted status", () => {
    test("emits workflow.step.complete with interrupted status", async () => {
      let conductor: WorkflowSessionConductor;
      const events: Array<{ type: string; data: Record<string, unknown> }> = [];

      const interruptingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          yield { type: "text" as const, content: "output" } as AgentMessage;
          conductor!.interrupt();
        },
      };

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => interruptingSession, {
        dispatchEvent: mock((event: BusEvent) => {
          events.push(event as unknown as { type: string; data: Record<string, unknown> });
        }),
        workflowId: "wf-test",
        sessionId: "sess-test",
        runId: 1,
      });
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // Find the workflow.step.complete event
      const completeEvent = events.find(
        (e) => e.type === "workflow.step.complete",
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent!.data.status).toBe("interrupted");
    });
  });

  // -----------------------------------------------------------------------
  // 9. Multiple sequential interrupts
  // -----------------------------------------------------------------------

  describe("multiple sequential interrupts", () => {
    test("interrupt stage A, resume, interrupt stage B, resume — works correctly", async () => {
      let conductor: WorkflowSessionConductor;
      const executionOrder: Array<{ stage: string; action: string }> = [];
      let waitCallCount = 0;
      // Track which stages have been interrupted so each only interrupts once
      const interruptedStages = new Set<string>();

      const sessionFactory = async () => {
        const session = createMockSession("");

        // Each stage interrupts once, then completes on resume.
        // The conductor preserves and reuses the session, so the same
        // session's stream function is called again on resume.
        session.stream = async function* (_msg: string) {
          const currentStage = conductor.getCurrentStage() ?? "unknown";
          if (!interruptedStages.has(currentStage)) {
            interruptedStages.add(currentStage);
            executionOrder.push({ stage: currentStage, action: "stream-interrupted" });
            yield {
              type: "text" as const,
              content: `${currentStage}-partial`,
            } as AgentMessage;
            conductor!.interrupt();
          } else {
            executionOrder.push({ stage: currentStage, action: "stream-completed" });
            yield {
              type: "text" as const,
              content: `${currentStage}-complete`,
            } as AgentMessage;
          }
        };

        return session;
      };

      const graph = buildLinearGraph([
        agentNode("stageA"),
        agentNode("stageB"),
      ]);
      const config = buildConfig(graph, sessionFactory, {
        waitForResumeInput: async () => {
          waitCallCount++;
          return "resume";
        },
      });
      const stages = [stage("stageA"), stage("stageB")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // Both stages should have completed
      expect(result.success).toBe(true);
      expect(result.stageOutputs.has("stageA")).toBe(true);
      expect(result.stageOutputs.has("stageB")).toBe(true);

      // waitForResumeInput should have been called twice (once per interrupt)
      expect(waitCallCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Backward compatibility — no config callbacks
  // -----------------------------------------------------------------------

  describe("backward compatibility", () => {
    test("works without checkQueuedMessage or waitForResumeInput configured", async () => {
      let conductor: WorkflowSessionConductor;

      const interruptingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          yield { type: "text" as const, content: "output" } as AgentMessage;
          conductor!.interrupt();
        },
      };

      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
      ]);
      // No checkQueuedMessage, no waitForResumeInput
      const config = buildConfig(graph, async () => {
        // First call returns interrupting session, second returns normal
        const session =
          conductor.getCurrentStage() === null
            ? interruptingSession
            : createMockSession("reviewer output");
        return session;
      });
      const stages = [stage("planner"), stage("reviewer")];

      conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // Without waitForResumeInput, the conductor should advance past
      // the interrupted stage (waitForResumeInput returns null)
      expect(result.success).toBe(true);
      expect(result.stageOutputs.has("reviewer")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 11. Queue drain on interrupt path (via checkQueuedMessage in waitForResumeInput)
  // -----------------------------------------------------------------------

  describe("queue drain on interrupt path", () => {
    test("checkQueuedMessage returns message on interrupt — waitForResumeInput not called", async () => {
      let conductor: WorkflowSessionConductor;
      const waitForResumeInputMock = mock(async () => "user input");
      let hasInterrupted = false;

      const sessionFactory = async () => {
        const session: Session = {
          ...createMockSession(""),
          // Only interrupt once; on resume the preserved session completes.
          stream: async function* () {
            if (!hasInterrupted) {
              hasInterrupted = true;
              yield {
                type: "text" as const,
                content: "initial",
              } as AgentMessage;
              conductor!.interrupt();
            } else {
              yield {
                type: "text" as const,
                content: "resumed output",
              } as AgentMessage;
            }
          },
        };
        return session;
      };

      let checkCallCount = 0;
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, sessionFactory, {
        checkQueuedMessage: mock(() => {
          checkCallCount++;
          // First call in waitForResumeInput: return a queued message
          if (checkCallCount === 1) return "queued-on-interrupt";
          // Subsequent calls in the queue drain loop: no more messages
          return null;
        }),
        waitForResumeInput: waitForResumeInputMock,
      });
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // waitForResumeInput should NOT have been called because
      // checkQueuedMessage returned a message first
      expect(waitForResumeInputMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 12. Resume-aware stage transitions
  // -----------------------------------------------------------------------

  describe("resume-aware stage transitions", () => {
    test("onStageTransition receives { isResume: true } when resuming interrupted stage", async () => {
      let conductor: WorkflowSessionConductor;
      const transitionCalls: Array<{ from: string | null; to: string; options?: { isResume?: boolean } }> = [];
      let hasInterrupted = false;

      const sessionFactory = async () => {
        const session = createMockSession("");
        session.stream = async function* () {
          if (!hasInterrupted) {
            hasInterrupted = true;
            yield { type: "text" as const, content: "initial" } as AgentMessage;
            conductor!.interrupt();
          } else {
            yield { type: "text" as const, content: "resumed" } as AgentMessage;
          }
        };
        return session;
      };

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, sessionFactory, {
        onStageTransition: mock((from: string | null, to: string, options?: { isResume?: boolean }) => {
          transitionCalls.push({ from, to, options });
        }),
        waitForResumeInput: async () => "follow-up",
      });
      const stages = [stage("planner")];

      conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // First call: normal transition (no isResume)
      expect(transitionCalls[0]!.options?.isResume).toBeUndefined();
      // Second call: resume transition
      expect(transitionCalls[1]!.options).toEqual({ isResume: true });
    });

    test("onStageTransition does NOT receive isResume when advancing normally (no interrupt)", async () => {
      const transitionCalls: Array<{ from: string | null; to: string; options?: { isResume?: boolean } }> = [];

      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);
      const config = buildConfig(graph, async () => createMockSession("output"), {
        onStageTransition: mock((from: string | null, to: string, options?: { isResume?: boolean }) => {
          transitionCalls.push({ from, to, options });
        }),
      });
      const stages = [stage("planner"), stage("reviewer")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // Both transitions should have no isResume option
      expect(transitionCalls).toHaveLength(2);
      expect(transitionCalls[0]!.options).toBeUndefined();
      expect(transitionCalls[1]!.options).toBeUndefined();
    });

    test("isResuming flag is reset after resume transition", async () => {
      let conductor: WorkflowSessionConductor;
      const transitionCalls: Array<{ from: string | null; to: string; options?: { isResume?: boolean } }> = [];
      let hasInterrupted = false;

      const sessionFactory = async () => {
        const session = createMockSession("");
        session.stream = async function* () {
          if (!hasInterrupted) {
            hasInterrupted = true;
            yield { type: "text" as const, content: "initial" } as AgentMessage;
            conductor!.interrupt();
          } else {
            yield { type: "text" as const, content: "completed" } as AgentMessage;
          }
        };
        return session;
      };

      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);
      const config = buildConfig(graph, sessionFactory, {
        onStageTransition: mock((from: string | null, to: string, options?: { isResume?: boolean }) => {
          transitionCalls.push({ from, to, options });
        }),
        waitForResumeInput: async () => "resume message",
      });
      const stages = [stage("planner"), stage("reviewer")];

      conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // Should have 3 transitions:
      // 1. planner (initial) - no isResume
      // 2. planner (resume) - isResume: true
      // 3. reviewer (normal advance) - no isResume (flag was reset)
      expect(transitionCalls).toHaveLength(3);
      expect(transitionCalls[0]!.to).toBe("planner");
      expect(transitionCalls[0]!.options).toBeUndefined();
      expect(transitionCalls[1]!.to).toBe("planner");
      expect(transitionCalls[1]!.options).toEqual({ isResume: true });
      expect(transitionCalls[2]!.to).toBe("reviewer");
      expect(transitionCalls[2]!.options).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 13. Error propagation still works after interrupt changes
  // -----------------------------------------------------------------------

  describe("error handling preserved", () => {
    test("stage errors still break the loop (not confused with interrupts)", async () => {
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
      ]);
      const stages = [stage("planner"), stage("reviewer")];

      const failingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          throw new Error("API rate limit");
        },
      };

      const config = buildConfig(graph, async () => failingSession);
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(false);
      const plannerOutput = result.stageOutputs.get("planner");
      expect(plannerOutput!.status).toBe("error");
      expect(plannerOutput!.error).toContain("API rate limit");
      expect(result.stageOutputs.has("reviewer")).toBe(false);
    });
  });
});
