/**
 * Integration tests for conductor executor interrupt/queue/resume behavior.
 *
 * Tests the full stack from `executeConductorWorkflow` down to the conductor,
 * specifically verifying:
 * 1. Queue delivery on interrupt — queued message via dequeueMessage is delivered
 *    to the interrupted stage via checkQueuedMessage
 * 2. Queue delivery on completion — queued message submitted during a stage is
 *    delivered before the stage completes
 * 3. Double Ctrl+C cancellation during streaming — rejecting waitForUserInput
 *    cancels the workflow entirely
 * 4. Double Ctrl+C cancellation during paused state — when the conductor is
 *    paused (awaiting resume input), rejecting the promise cancels the workflow
 * 5. workflowActive cleanup — after any cancellation, the result includes
 *    stateUpdate.workflowActive: false
 * 6. registerConductorResume wiring — resume function is registered and
 *    deregistered after execution
 *
 * Strategy: Mock `initializeWorkflowExecutionSession` to avoid filesystem
 * side effects and return controlled IDs. Use the real
 * `WorkflowSessionConductor` with mock sessions to verify interrupt behavior
 * end-to-end at the executor level.
 */

import { describe, expect, test, mock } from "bun:test";
import type { StageDefinition, StageContext } from "@/services/workflows/conductor/types.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/index.ts";
import type { CommandContext } from "@/types/command.ts";
import type { Session, AgentMessage } from "@/services/agents/types.ts";

// ---------------------------------------------------------------------------
// Module mocks — avoid side effects from session-runtime and logging
// ---------------------------------------------------------------------------

const MOCK_SESSION_ID = "interrupt-integ-session-xyz";
const MOCK_SESSION_DIR = "/tmp/interrupt-integ-session-dir";
const MOCK_RUN_ID = 77;

mock.module("@/services/workflows/runtime/executor/session-runtime.ts", () => ({
  initializeWorkflowExecutionSession: mock(() => ({
    sessionDir: MOCK_SESSION_DIR,
    sessionId: MOCK_SESSION_ID,
    workflowRunId: MOCK_RUN_ID,
  })),
}));

mock.module("@/services/events/pipeline-logger.ts", () => ({
  pipelineLog: mock(() => {}),
  pipelineError: mock(() => {}),
}));

// ---------------------------------------------------------------------------
// Import the function under test
// ---------------------------------------------------------------------------

const { executeConductorWorkflow } = await import(
  "@/services/workflows/runtime/executor/conductor-executor.ts"
);

// ---------------------------------------------------------------------------
// Test Helpers
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

function createStage(
  id: string,
  overrides?: Partial<StageDefinition>,
): StageDefinition {
  return {
    id,
    indicator: `[${id.toUpperCase()}]`,
    buildPrompt: (_ctx: StageContext) => `Prompt for ${id}`,
    ...overrides,
  };
}

function createDefinition(
  overrides?: Partial<WorkflowDefinition>,
): WorkflowDefinition {
  const stages = overrides?.conductorStages ?? [createStage("planner")];
  return {
    name: "test-interrupt-workflow",
    description: "A test workflow for interrupt integration",
    conductorStages: stages,
    createConductorGraph: () => ({
      nodes: new Map(
        stages.map((s) => [
          s.id,
          { id: s.id, type: "agent" as const, execute: async () => ({}) },
        ]),
      ),
      edges:
        stages.length > 1
          ? stages
              .slice(0, -1)
              .map((s, i) => ({ from: s.id, to: stages[i + 1]!.id }))
          : [],
      startNode: stages[0]!.id,
      endNodes: new Set([stages[stages.length - 1]!.id]),
      config: {},
    }),
    ...overrides,
  };
}

function createMockContext(
  overrides?: Partial<CommandContext>,
): CommandContext {
  const mockSession = createMockSession("stage response");
  return {
    session: null,
    state: { isStreaming: false, messageCount: 0 } as CommandContext["state"],
    addMessage: mock(() => {}),
    setStreaming: mock(() => {}),
    sendMessage: mock(() => {}),
    sendSilentMessage: mock(() => {}),
    spawnSubagent: mock(async () => ({
      success: true,
      output: "",
    })) as CommandContext["spawnSubagent"],
    streamAndWait: mock(async () => ({
      success: true,
      content: "",
      wasInterrupted: false,
    })) as unknown as CommandContext["streamAndWait"],
    clearContext: mock(async () => {}) as CommandContext["clearContext"],
    setTodoItems: mock(() => {}),
    setWorkflowSessionDir: mock(() => {}),
    setWorkflowSessionId: mock(() => {}),
    setWorkflowTaskIds: mock(() => {}),
    waitForUserInput: mock(async () => ""),
    updateWorkflowState: mock(() => {}),
    registerConductorInterrupt: mock(() => {}),
    registerConductorResume: mock(() => {}),
    createAgentSession: mock(async () => mockSession) as CommandContext["createAgentSession"],
    ...overrides,
  } as unknown as CommandContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeConductorWorkflow — interrupt/queue integration", () => {
  // -----------------------------------------------------------------------
  // 1. Queue delivery on interrupt
  // -----------------------------------------------------------------------

  describe("queue delivery on interrupt", () => {
    test("queued message from dequeueMessage is delivered to interrupted stage via checkQueuedMessage", async () => {
      // The conductor's waitForResumeInput checks checkQueuedMessage first.
      // If a message is queued, it re-executes the stage with that message
      // instead of calling waitForUserInput.
      let capturedInterruptFn: (() => void) | null = null;
      let sessionCallCount = 0;
      const streamedPrompts: string[] = [];

      let hasInterrupted = false;
      const sessionFactory = mock(async () => {
        sessionCallCount++;
        const session = createMockSession("", `session-${sessionCallCount}`);

        // The session triggers interrupt only once (first stream call).
        // On resume, the preserved session is reused — its stream must
        // complete normally to avoid an infinite interrupt loop.
        session.stream = async function* (msg: string) {
          streamedPrompts.push(msg);
          if (!hasInterrupted) {
            hasInterrupted = true;
            yield { type: "text" as const, content: "initial output" } as AgentMessage;
            // Simulate interrupt being called externally
            if (capturedInterruptFn) {
              capturedInterruptFn();
            }
          } else {
            yield { type: "text" as const, content: "resumed output" } as AgentMessage;
          }
        };

        return session;
      });

      let dequeueCallCount = 0;
      const dequeueMock = mock(() => {
        dequeueCallCount++;
        // First call (on interrupt path): return the queued message
        if (dequeueCallCount === 1) return "queued follow-up message";
        // Subsequent calls: no more messages
        return null;
      });

      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        dequeueMessage: dequeueMock,
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();
      const result = await executeConductorWorkflow(definition, "test prompt", context);

      // The workflow should complete successfully
      expect(result.success).toBe(true);

      // The dequeueMessage should have been called at least once
      expect(dequeueMock).toHaveBeenCalled();

      // The second session should have received the queued message as its prompt
      expect(streamedPrompts.length).toBeGreaterThanOrEqual(2);
      expect(streamedPrompts[1]).toBe("queued follow-up message");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Queue delivery on normal completion
  // -----------------------------------------------------------------------

  describe("queue delivery on normal completion", () => {
    test("queued message is drained to active session before stage completes", async () => {
      const streamedPrompts: string[] = [];
      let sessionCount = 0;

      const sessionFactory = mock(async () => {
        sessionCount++;
        const session = createMockSession("", `session-${sessionCount}`);
        session.stream = async function* (msg: string) {
          streamedPrompts.push(msg);
          yield { type: "text" as const, content: `response-to-${msg}` } as AgentMessage;
        };
        return session;
      });

      let dequeueCallCount = 0;
      const dequeueMock = mock(() => {
        dequeueCallCount++;
        // First call in the drain loop after initial stream: return a queued message
        if (dequeueCallCount === 1) return "additional-instruction";
        // No more queued messages
        return null;
      });

      const context = createMockContext({
        dequeueMessage: dequeueMock,
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();
      const result = await executeConductorWorkflow(definition, "initial prompt", context);

      expect(result.success).toBe(true);

      // The session should have received the initial prompt AND the queued message
      expect(streamedPrompts).toContain("additional-instruction");

      // The dequeueMessage should have been called (at least to return the message
      // and once more to confirm no more messages remain)
      expect(dequeueCallCount).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Double Ctrl+C cancellation during streaming
  // -----------------------------------------------------------------------

  describe("double Ctrl+C cancellation during streaming", () => {
    test("rejecting waitForUserInput cancels workflow with success and workflowActive=false", async () => {
      let capturedInterruptFn: (() => void) | null = null;
      let resolveStream: (() => void) | undefined;

      // Create a session that blocks during streaming, allowing us to interrupt
      const blockingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          yield { type: "text" as const, content: "partial output" } as AgentMessage;
          // Block until resolved externally
          await new Promise<void>((resolve) => {
            resolveStream = resolve;
          });
        },
        abort: mock(async () => {}) as () => Promise<void>,
      };

      // waitForUserInput will reject (simulating double Ctrl+C)
      const waitForUserInputMock = mock(() =>
        Promise.reject(new Error("User cancelled")),
      );

      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        waitForUserInput: waitForUserInputMock,
        dequeueMessage: mock(() => null),
        createAgentSession: mock(async () => blockingSession) as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();

      // Start execution in the background
      const executePromise = executeConductorWorkflow(
        definition,
        "test prompt",
        context,
      );

      // Wait for the session to start streaming
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Interrupt the conductor (first Ctrl+C)
      expect(capturedInterruptFn).not.toBeNull();
      capturedInterruptFn!();

      // Resolve the blocked stream so runStageSession can return "interrupted"
      resolveStream?.();

      // The executor will try waitForUserInput which will reject (second Ctrl+C).
      // The conductor-executor catches this and throws "Workflow cancelled".
      const result = await executePromise;

      // Workflow cancelled should be treated as success with workflowActive=false
      expect(result.success).toBe(true);
      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate!.workflowActive).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Double Ctrl+C cancellation during paused state
  // -----------------------------------------------------------------------

  describe("double Ctrl+C cancellation during paused state", () => {
    test("waitForUserInput rejection during pause propagates as workflow cancellation", async () => {
      let capturedInterruptFn: (() => void) | null = null;

      // Create a session that gets interrupted synchronously during streaming
      const sessionFactory = mock(async () => {
        const session = createMockSession("");
        session.stream = async function* () {
          yield { type: "text" as const, content: "output" } as AgentMessage;
          // Interrupt during streaming
          if (capturedInterruptFn) {
            capturedInterruptFn();
          }
        };
        return session;
      });

      // dequeueMessage returns null (no queued message), so the conductor
      // falls through to waitForResumeInput which calls waitForUserInput.
      // waitForUserInput then rejects to simulate double Ctrl+C.
      const waitForUserInputMock = mock(() =>
        Promise.reject(new Error("User cancelled")),
      );

      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        waitForUserInput: waitForUserInputMock,
        dequeueMessage: mock(() => null),
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();
      const result = await executeConductorWorkflow(definition, "test prompt", context);

      // Should be treated as a clean cancellation
      expect(result.success).toBe(true);
      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate!.workflowActive).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 5. workflowActive cleanup
  // -----------------------------------------------------------------------

  describe("workflowActive cleanup", () => {
    test("workflowActive is false in stateUpdate after normal completion", async () => {
      const context = createMockContext();
      const definition = createDefinition();

      const result = await executeConductorWorkflow(definition, "test prompt", context);

      expect(result.success).toBe(true);
      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate!.workflowActive).toBe(false);
    });

    test("workflowActive is false in stateUpdate after interrupt cancellation", async () => {
      let capturedInterruptFn: (() => void) | null = null;

      const sessionFactory = mock(async () => {
        const session = createMockSession("");
        session.stream = async function* () {
          yield { type: "text" as const, content: "output" } as AgentMessage;
          if (capturedInterruptFn) {
            capturedInterruptFn();
          }
        };
        return session;
      });

      // waitForUserInput rejects to cancel the workflow
      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        waitForUserInput: mock(() => Promise.reject(new Error("cancelled"))),
        dequeueMessage: mock(() => null),
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();
      const result = await executeConductorWorkflow(definition, "test prompt", context);

      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate!.workflowActive).toBe(false);
    });

    test("workflowActive is false in stateUpdate after stage error", async () => {
      const failingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          throw new Error("Stage execution failed");
        },
      };

      const context = createMockContext({
        createAgentSession: mock(async () => failingSession) as CommandContext["createAgentSession"],
      });
      const definition = createDefinition();

      const result = await executeConductorWorkflow(definition, "test prompt", context);

      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate!.workflowActive).toBe(false);
    });

    test("workflowActive is false after abort signal cancellation", async () => {
      const controller = new AbortController();
      controller.abort(); // Pre-abort

      const context = createMockContext();
      const definition = createDefinition();

      const result = await executeConductorWorkflow(
        definition,
        "test prompt",
        context,
        { abortSignal: controller.signal },
      );

      expect(result.success).toBe(true);
      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate!.workflowActive).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 6. registerConductorResume wiring
  // -----------------------------------------------------------------------

  describe("registerConductorResume wiring", () => {
    test("registerConductorResume is called with resume function and deregistered after", async () => {
      const registerResumeMock = mock((_fn: ((message: string | null) => void) | null) => {});

      const context = createMockContext({
        registerConductorResume: registerResumeMock,
      });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "test prompt", context);

      // First call: register with a function (conductor.resume)
      expect(registerResumeMock).toHaveBeenCalledTimes(2);
      const firstCall = registerResumeMock.mock.calls[0];
      expect(typeof firstCall![0]).toBe("function");

      // Second call: deregister with null
      const secondCall = registerResumeMock.mock.calls[1];
      expect(secondCall![0]).toBeNull();
    });

    test("registerConductorResume deregisters even when execution fails", async () => {
      const registerResumeMock = mock((_fn: ((message: string | null) => void) | null) => {});

      const failingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          throw new Error("Stage execution failed");
        },
      };

      const context = createMockContext({
        registerConductorResume: registerResumeMock,
        createAgentSession: mock(async () => failingSession) as CommandContext["createAgentSession"],
      });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "test prompt", context);

      // Should still have registered and deregistered
      expect(registerResumeMock).toHaveBeenCalledTimes(2);
      expect(typeof registerResumeMock.mock.calls[0]![0]).toBe("function");
      expect(registerResumeMock.mock.calls[1]![0]).toBeNull();
    });

    test("works when registerConductorResume is not provided", async () => {
      const context = createMockContext({
        registerConductorResume: undefined,
      });
      const definition = createDefinition();

      // Should not throw when registerConductorResume is undefined
      const result = await executeConductorWorkflow(definition, "test prompt", context);
      expect(result.success).toBe(true);
    });

    test("registerConductorResume deregisters even after interrupt cancellation", async () => {
      const registerResumeMock = mock((_fn: ((message: string | null) => void) | null) => {});
      let capturedInterruptFn: (() => void) | null = null;

      const sessionFactory = mock(async () => {
        const session = createMockSession("");
        session.stream = async function* () {
          yield { type: "text" as const, content: "output" } as AgentMessage;
          if (capturedInterruptFn) {
            capturedInterruptFn();
          }
        };
        return session;
      });

      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        registerConductorResume: registerResumeMock,
        waitForUserInput: mock(() => Promise.reject(new Error("cancelled"))),
        dequeueMessage: mock(() => null),
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();
      await executeConductorWorkflow(definition, "test prompt", context);

      // Resume should be registered then deregistered despite the cancellation
      expect(registerResumeMock).toHaveBeenCalledTimes(2);
      expect(typeof registerResumeMock.mock.calls[0]![0]).toBe("function");
      expect(registerResumeMock.mock.calls[1]![0]).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Multi-stage interrupt with queue message delivery
  // -----------------------------------------------------------------------

  describe("multi-stage interrupt with queue delivery", () => {
    test("interrupt on first stage with queued message resumes and second stage still executes", async () => {
      let capturedInterruptFn: (() => void) | null = null;
      let sessionCallCount = 0;
      const streamedPrompts: string[] = [];
      let plannerHasInterrupted = false;

      const sessionFactory = mock(async () => {
        sessionCallCount++;
        const session = createMockSession("", `session-${sessionCallCount}`);

        if (sessionCallCount === 1) {
          // First session (planner): gets interrupted once, then completes
          // normally on resume (preserved session is reused by the conductor).
          session.stream = async function* (msg: string) {
            streamedPrompts.push(msg);
            if (!plannerHasInterrupted) {
              plannerHasInterrupted = true;
              yield { type: "text" as const, content: "planner initial" } as AgentMessage;
              if (capturedInterruptFn) {
                capturedInterruptFn();
              }
            } else {
              yield { type: "text" as const, content: "planner resumed" } as AgentMessage;
            }
          };
        } else {
          // Second session (reviewer): normal execution
          session.stream = async function* (msg: string) {
            streamedPrompts.push(msg);
            yield { type: "text" as const, content: "reviewer output" } as AgentMessage;
          };
        }

        return session;
      });

      let dequeueCallCount = 0;
      const dequeueMock = mock(() => {
        dequeueCallCount++;
        if (dequeueCallCount === 1) return "queued correction";
        return null;
      });

      const stages = [createStage("planner"), createStage("reviewer")];
      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        dequeueMessage: dequeueMock,
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition({ conductorStages: stages });
      const result = await executeConductorWorkflow(definition, "test prompt", context);

      expect(result.success).toBe(true);

      // The queued message should have been delivered as the resume prompt
      expect(streamedPrompts[1]).toBe("queued correction");

      // Two sessions: planner (reused on resume) + reviewer
      expect(sessionCallCount).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Banner suppression on resume
  // -----------------------------------------------------------------------

  describe("banner suppression on resume", () => {
    test("updateWorkflowState is NOT called on resume transition", async () => {
      let capturedInterruptFn: (() => void) | null = null;
      const updateWorkflowStateMock = mock((_state: Record<string, unknown>) => {});
      let hasInterrupted = false;

      const sessionFactory = mock(async () => {
        const session = createMockSession("");
        session.stream = async function* () {
          if (!hasInterrupted) {
            hasInterrupted = true;
            yield { type: "text" as const, content: "initial output" } as AgentMessage;
            // Trigger interrupt
            if (capturedInterruptFn) {
              capturedInterruptFn();
            }
          } else {
            yield { type: "text" as const, content: "resumed output" } as AgentMessage;
          }
        };
        return session;
      });

      let dequeueCallCount = 0;
      const dequeueMock = mock(() => {
        dequeueCallCount++;
        // First call (on interrupt path): return a queued message to resume
        if (dequeueCallCount === 1) return "follow-up message";
        // Subsequent calls: no more messages
        return null;
      });

      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        dequeueMessage: dequeueMock,
        updateWorkflowState: updateWorkflowStateMock,
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();
      await executeConductorWorkflow(definition, "test prompt", context);

      // updateWorkflowState should have been called exactly ONCE — for the
      // initial stage transition, NOT for the resume transition.
      expect(updateWorkflowStateMock).toHaveBeenCalledTimes(1);
    });

    test("setStreaming and addMessage ARE called even on resume transition", async () => {
      let capturedInterruptFn: (() => void) | null = null;
      const setStreamingMock = mock((_streaming: boolean) => {});
      const addMessageMock = mock((_role: string, _content: string) => {});
      let hasInterrupted = false;

      const sessionFactory = mock(async () => {
        const session = createMockSession("");
        session.stream = async function* () {
          if (!hasInterrupted) {
            hasInterrupted = true;
            yield { type: "text" as const, content: "initial output" } as AgentMessage;
            // Trigger interrupt
            if (capturedInterruptFn) {
              capturedInterruptFn();
            }
          } else {
            yield { type: "text" as const, content: "resumed output" } as AgentMessage;
          }
        };
        return session;
      });

      let dequeueCallCount = 0;
      const dequeueMock = mock(() => {
        dequeueCallCount++;
        if (dequeueCallCount === 1) return "follow-up message";
        return null;
      });

      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        dequeueMessage: dequeueMock,
        setStreaming: setStreamingMock,
        addMessage: addMessageMock,
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();
      await executeConductorWorkflow(definition, "test prompt", context);

      // setStreaming(true) should be called for BOTH transitions (initial + resume).
      // There is also a final setStreaming(false) from the executor's cleanup.
      const setStreamingTrueCalls = setStreamingMock.mock.calls.filter(
        (call) => call[0] === true,
      );
      expect(setStreamingTrueCalls.length).toBeGreaterThanOrEqual(2);

      // addMessage("assistant", "") should be called for BOTH transitions.
      const addAssistantCalls = addMessageMock.mock.calls.filter(
        (call) => call[0] === "assistant" && call[1] === "",
      );
      expect(addAssistantCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // 9. setStreaming cleanup
  // -----------------------------------------------------------------------

  describe("setStreaming cleanup", () => {
    test("setStreaming(false) is called after workflow cancellation", async () => {
      let capturedInterruptFn: (() => void) | null = null;
      const setStreamingMock = mock((_streaming: boolean) => {});

      const sessionFactory = mock(async () => {
        const session = createMockSession("");
        session.stream = async function* () {
          yield { type: "text" as const, content: "output" } as AgentMessage;
          if (capturedInterruptFn) {
            capturedInterruptFn();
          }
        };
        return session;
      });

      const context = createMockContext({
        setStreaming: setStreamingMock,
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        waitForUserInput: mock(() => Promise.reject(new Error("cancelled"))),
        dequeueMessage: mock(() => null),
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();
      await executeConductorWorkflow(definition, "test prompt", context);

      // setStreaming should have been called with false at the end
      const lastCall = setStreamingMock.mock.calls[setStreamingMock.mock.calls.length - 1];
      expect(lastCall![0]).toBe(false);
    });

    test("setStreaming(false) is called after normal completion", async () => {
      const setStreamingMock = mock((_streaming: boolean) => {});
      const context = createMockContext({ setStreaming: setStreamingMock });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "test prompt", context);

      // The last setStreaming call should be false
      const lastCall = setStreamingMock.mock.calls[setStreamingMock.mock.calls.length - 1];
      expect(lastCall![0]).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Full interrupt/resume cycle — integration & regression
  // -----------------------------------------------------------------------

  describe("full interrupt/resume cycle — integration & regression", () => {
    test("full cycle — interrupt, queue resume, complete, banner suppressed", async () => {
      // 2-stage workflow: stage 1 is interrupted, resumed via dequeueMessage,
      // then stage 2 executes normally.
      let capturedInterruptFn: (() => void) | null = null;
      const updateWorkflowStateMock = mock((_state: Record<string, unknown>) => {});
      const addMessageMock = mock((_role: string, _content: string) => {});

      // Track which stage's session we're creating
      let sessionCallCount = 0;
      let stage1HasInterrupted = false;

      const sessionFactory = mock(async () => {
        sessionCallCount++;
        const session = createMockSession("", `session-${sessionCallCount}`);

        if (sessionCallCount === 1) {
          // Stage 1 session: interrupts once, completes on resume
          session.stream = async function* () {
            if (!stage1HasInterrupted) {
              stage1HasInterrupted = true;
              yield { type: "text" as const, content: "stage1 initial" } as AgentMessage;
              if (capturedInterruptFn) capturedInterruptFn();
            } else {
              yield { type: "text" as const, content: "stage1 resumed" } as AgentMessage;
            }
          };
        } else {
          // Stage 2 session: normal execution
          session.stream = async function* () {
            yield { type: "text" as const, content: "stage2 output" } as AgentMessage;
          };
        }

        return session;
      });

      let dequeueCallCount = 0;
      const dequeueMock = mock(() => {
        dequeueCallCount++;
        if (dequeueCallCount === 1) return "follow-up";
        return null;
      });

      const stages = [createStage("planner"), createStage("reviewer")];
      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        dequeueMessage: dequeueMock,
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
        updateWorkflowState: updateWorkflowStateMock,
        addMessage: addMessageMock,
      });

      const definition = createDefinition({ conductorStages: stages });
      const result = await executeConductorWorkflow(definition, "test prompt", context);

      // Workflow should complete successfully
      expect(result.success).toBe(true);

      // updateWorkflowState called exactly 2 times: once per stage initial
      // transition (planner + reviewer), NOT for the resume transition.
      expect(updateWorkflowStateMock).toHaveBeenCalledTimes(2);

      // addMessage("assistant", "") called 3 times:
      //   1. stage1 initial transition
      //   2. stage1 resume transition
      //   3. stage2 initial transition
      const addAssistantCalls = addMessageMock.mock.calls.filter(
        (call) => call[0] === "assistant" && call[1] === "",
      );
      expect(addAssistantCalls.length).toBe(3);
    });

    test("full cycle — interrupt, interactive resume via waitForUserInput, complete", async () => {
      // Single-stage workflow: interrupted, dequeueMessage returns null,
      // waitForUserInput resolves with "user follow-up", resumes and completes.
      let capturedInterruptFn: (() => void) | null = null;
      let hasInterrupted = false;

      const sessionFactory = mock(async () => {
        const session = createMockSession("");
        session.stream = async function* () {
          if (!hasInterrupted) {
            hasInterrupted = true;
            yield { type: "text" as const, content: "initial output" } as AgentMessage;
            if (capturedInterruptFn) capturedInterruptFn();
          } else {
            yield { type: "text" as const, content: "resumed output" } as AgentMessage;
          }
        };
        return session;
      });

      const waitForUserInputMock = mock(async () => "user follow-up");

      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        dequeueMessage: mock(() => null),
        waitForUserInput: waitForUserInputMock,
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();
      const result = await executeConductorWorkflow(definition, "test prompt", context);

      // Workflow should complete successfully
      expect(result.success).toBe(true);

      // waitForUserInput should have been called exactly once
      expect(waitForUserInputMock).toHaveBeenCalledTimes(1);
    });

    test("regression — session destroy is NOT called between interrupt and resume", async () => {
      // Single-stage workflow: interrupted, dequeueMessage returns follow-up,
      // resumes and completes. Track destroy calls to verify the preserved
      // session is NOT destroyed between interrupt and resume.
      let capturedInterruptFn: (() => void) | null = null;
      let hasInterrupted = false;
      const destroyCalls: string[] = [];

      const sessionFactory = mock(async () => {
        const session = createMockSession("");
        session.stream = async function* () {
          if (!hasInterrupted) {
            hasInterrupted = true;
            yield { type: "text" as const, content: "initial output" } as AgentMessage;
            if (capturedInterruptFn) capturedInterruptFn();
          } else {
            yield { type: "text" as const, content: "resumed output" } as AgentMessage;
          }
        };
        session.destroy = mock(async () => {
          destroyCalls.push(session.id);
        });
        return session;
      });

      let dequeueCallCount = 0;
      const dequeueMock = mock(() => {
        dequeueCallCount++;
        if (dequeueCallCount === 1) return "follow-up message";
        return null;
      });

      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        dequeueMessage: dequeueMock,
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition();
      const result = await executeConductorWorkflow(definition, "test prompt", context);

      expect(result.success).toBe(true);

      // Session.destroy should be called exactly ONCE — after the resumed
      // stage completes in the finally block, NOT between interrupt and resume.
      expect(destroyCalls.length).toBe(1);
    });

    test("regression — multiple interrupts across stages don't leak sessions", async () => {
      // 3-stage workflow: each stage is interrupted once and resumed via
      // dequeueMessage. Track session creation and destruction counts.
      let capturedInterruptFn: (() => void) | null = null;
      let sessionCreateCount = 0;
      const destroyCalls: string[] = [];

      // Track which stages have been interrupted
      const interruptedStages = new Set<number>();

      const sessionFactory = mock(async () => {
        sessionCreateCount++;
        const currentSessionNum = sessionCreateCount;
        const session = createMockSession("", `session-${currentSessionNum}`);
        session.stream = async function* () {
          if (!interruptedStages.has(currentSessionNum)) {
            interruptedStages.add(currentSessionNum);
            yield { type: "text" as const, content: `stage${currentSessionNum} initial` } as AgentMessage;
            if (capturedInterruptFn) capturedInterruptFn();
          } else {
            yield { type: "text" as const, content: `stage${currentSessionNum} resumed` } as AgentMessage;
          }
        };
        session.destroy = mock(async () => {
          destroyCalls.push(session.id);
        });
        return session;
      });

      // Each stage interrupt triggers one dequeue call returning a follow-up.
      // After the follow-up, the drain loop calls dequeue again (returns null).
      let dequeueCallCount = 0;
      const dequeueMock = mock(() => {
        dequeueCallCount++;
        // Odd calls (1, 3, 5) are the interrupt resume: return follow-up
        // Even calls (2, 4, 6) are the drain loop: return null
        if (dequeueCallCount % 2 === 1) return `follow-up-${dequeueCallCount}`;
        return null;
      });

      const stages = [
        createStage("stage-a"),
        createStage("stage-b"),
        createStage("stage-c"),
      ];

      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        dequeueMessage: dequeueMock,
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition({ conductorStages: stages });
      const result = await executeConductorWorkflow(definition, "test prompt", context);

      expect(result.success).toBe(true);

      // Exactly 3 sessions created (one per stage, reused on resume)
      expect(sessionCreateCount).toBe(3);

      // Exactly 3 destroyed (one after each stage completes)
      expect(destroyCalls.length).toBe(3);
    });

    test("regression — interrupt during first stage doesn't prevent second stage from executing", async () => {
      // 2-stage workflow: stage 1 is interrupted, dequeueMessage returns null,
      // waitForUserInput returns null (no follow-up). Stage 2 should still
      // execute normally.
      let capturedInterruptFn: (() => void) | null = null;
      let hasInterrupted = false;
      let sessionCallCount = 0;
      const streamedStages: string[] = [];

      const sessionFactory = mock(async () => {
        sessionCallCount++;
        const currentNum = sessionCallCount;
        const session = createMockSession("", `session-${currentNum}`);

        if (currentNum === 1) {
          // Stage 1: interrupts, no resume follow-up
          session.stream = async function* () {
            if (!hasInterrupted) {
              hasInterrupted = true;
              streamedStages.push("stage1-initial");
              yield { type: "text" as const, content: "stage1 output" } as AgentMessage;
              if (capturedInterruptFn) capturedInterruptFn();
            }
          };
        } else {
          // Stage 2: normal execution
          session.stream = async function* () {
            streamedStages.push("stage2");
            yield { type: "text" as const, content: "stage2 output" } as AgentMessage;
          };
        }

        return session;
      });

      // waitForUserInput returns empty string — no follow-up for the interrupted stage.
      // The conductor treats empty/whitespace-only input the same as null (advances
      // to next stage) via the check: resumeInput !== null && resumeInput.trim().length > 0
      const waitForUserInputMock = mock(async () => "");

      const stages = [createStage("planner"), createStage("reviewer")];
      const context = createMockContext({
        registerConductorInterrupt: mock((fn: (() => void) | null) => {
          capturedInterruptFn = fn;
        }),
        dequeueMessage: mock(() => null),
        waitForUserInput: waitForUserInputMock,
        createAgentSession: sessionFactory as CommandContext["createAgentSession"],
      });

      const definition = createDefinition({ conductorStages: stages });
      const result = await executeConductorWorkflow(definition, "test prompt", context);

      // Workflow should complete successfully
      expect(result.success).toBe(true);

      // Both stages should have executed
      expect(streamedStages).toContain("stage1-initial");
      expect(streamedStages).toContain("stage2");

      // Session count: 1 for stage1 + 1 for stage2 = 2
      expect(sessionCallCount).toBe(2);
    });
  });
});
