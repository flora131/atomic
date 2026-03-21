/**
 * Conductor Context Pressure Integration Tests
 *
 * Tests the WorkflowSessionConductor's integration with context pressure
 * monitoring and continuation sessions. Verifies that:
 * - Context usage is captured after each stage's streaming
 * - Pressure levels are computed and stored in StageOutput.contextUsage
 * - Accumulated pressure is threaded into StageContext.contextPressure
 * - Continuation sessions are created when critical threshold is exceeded
 * - Continuation limits are enforced (maxContinuationsPerStage)
 * - The onContextPressure callback is invoked with correct parameters
 * - WorkflowResult includes accumulated context pressure
 * - Backward compatibility: no-pressure-config behavior is unchanged
 */

import { describe, expect, test, mock } from "bun:test";
import { WorkflowSessionConductor } from "@/services/workflows/conductor/conductor.ts";
import type {
  ConductorConfig,
  ContextPressureConfig,
  ContextPressureSnapshot,
  StageContext,
  StageDefinition,
  StageOutput,
} from "@/services/workflows/conductor/types.ts";
import type {
  BaseState,
  CompiledGraph,
  NodeDefinition,
  Edge,
} from "@/services/workflows/graph/types.ts";
import type {
  Session,
  AgentMessage,
  SessionConfig,
  ContextUsage,
} from "@/services/agents/types.ts";
import { createDefaultContextPressureConfig } from "@/services/workflows/conductor/context-pressure.ts";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Create a session whose getContextUsage returns a specific usage. */
function createSessionWithUsage(
  response: string,
  usage: ContextUsage,
  id = "session-1",
): Session {
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
    getContextUsage: mock(async () => usage),
    getSystemToolsTokens: () => 0,
    destroy: mock(async () => {}),
  };
}

/** Create a session whose getContextUsage throws (simulating no-query-yet). */
function createSessionWithFailingUsage(response: string, id = "session-1"): Session {
  return {
    id,
    send: mock(async () => ({ type: "text" as const, content: response })),
    stream: async function* () {
      yield { type: "text" as const, content: response } as AgentMessage;
    },
    summarize: mock(async () => {}),
    getContextUsage: mock(async () => {
      throw new Error("No query completed");
    }),
    getSystemToolsTokens: () => 0,
    destroy: mock(async () => {}),
  };
}

function agentNode(id: string): NodeDefinition<BaseState> {
  return { id, type: "agent", execute: mock(async () => ({})) };
}

function buildLinearGraph(
  nodes: NodeDefinition<BaseState>[],
): CompiledGraph<BaseState> {
  const edges: Edge<BaseState>[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  }
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
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
    name: id.charAt(0).toUpperCase() + id.slice(1),
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

function normalUsage(percentage = 10): ContextUsage {
  return {
    inputTokens: 5000,
    outputTokens: 3000,
    maxTokens: 100000,
    usagePercentage: percentage,
  };
}

function elevatedUsage(percentage = 50): ContextUsage {
  return {
    inputTokens: 25000,
    outputTokens: 15000,
    maxTokens: 100000,
    usagePercentage: percentage,
  };
}

function criticalUsage(percentage = 70): ContextUsage {
  return {
    inputTokens: 40000,
    outputTokens: 30000,
    maxTokens: 100000,
    usagePercentage: percentage,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowSessionConductor — context pressure monitoring", () => {
  // -----------------------------------------------------------------------
  // Backward Compatibility
  // -----------------------------------------------------------------------

  describe("backward compatibility (no contextPressure config)", () => {
    test("StageOutput has no contextUsage when monitoring is disabled", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () =>
        createSessionWithUsage("output", normalUsage()),
      );
      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output!.contextUsage).toBeUndefined();
    });

    test("StageContext has no contextPressure when monitoring is disabled", async () => {
      let capturedContext: StageContext | undefined;
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () =>
        createSessionWithUsage("output", normalUsage()),
      );
      const stages = [
        stage("planner", {
          buildPrompt: (ctx) => {
            capturedContext = ctx;
            return "prompt";
          },
        }),
      ];
      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedContext!.contextPressure).toBeUndefined();
    });

    test("WorkflowResult has no contextPressure when monitoring is disabled", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () =>
        createSessionWithUsage("output", normalUsage()),
      );
      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      const result = await conductor.execute("test");

      expect(result.contextPressure).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Context Usage Capture
  // -----------------------------------------------------------------------

  describe("context usage capture", () => {
    test("captures context usage snapshot in StageOutput when monitoring is enabled", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(
        graph,
        async () => createSessionWithUsage("output", normalUsage(15)),
        { contextPressure: pressureConfig },
      );
      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output!.contextUsage).toBeDefined();
      expect(output!.contextUsage!.usagePercentage).toBe(15);
      expect(output!.contextUsage!.level).toBe("normal");
    });

    test("captures snapshots for each stage independently", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      let callCount = 0;
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("orchestrator"),
        agentNode("reviewer"),
      ]);

      const usages: ContextUsage[] = [
        normalUsage(10),
        elevatedUsage(50),
        normalUsage(20),
      ];

      const config = buildConfig(
        graph,
        async () => {
          const usage = usages[callCount]!;
          callCount++;
          return createSessionWithUsage(`output-${callCount}`, usage);
        },
        { contextPressure: pressureConfig },
      );

      const stages = [
        stage("planner"),
        stage("orchestrator"),
        stage("reviewer"),
      ];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.stageOutputs.get("planner")!.contextUsage!.level).toBe("normal");
      expect(result.stageOutputs.get("orchestrator")!.contextUsage!.level).toBe("elevated");
      expect(result.stageOutputs.get("reviewer")!.contextUsage!.level).toBe("normal");
    });

    test("contextUsage is undefined when getContextUsage fails", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(
        graph,
        async () => createSessionWithFailingUsage("output"),
        { contextPressure: pressureConfig },
      );
      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      // Stage still completes successfully
      expect(output!.status).toBe("completed");
      expect(output!.contextUsage).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Accumulated Pressure in StageContext
  // -----------------------------------------------------------------------

  describe("accumulated pressure in StageContext", () => {
    test("downstream stages receive accumulated pressure from prior stages", async () => {
      const capturedContexts: StageContext[] = [];
      const pressureConfig = createDefaultContextPressureConfig();
      let callCount = 0;

      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
      ]);

      const usages: ContextUsage[] = [
        normalUsage(15),
        normalUsage(20),
      ];

      const config = buildConfig(
        graph,
        async () => {
          const usage = usages[callCount]!;
          callCount++;
          return createSessionWithUsage("output", usage);
        },
        { contextPressure: pressureConfig },
      );

      const stages = [
        stage("planner", {
          buildPrompt: (ctx) => {
            capturedContexts.push(ctx);
            return "plan";
          },
        }),
        stage("reviewer", {
          buildPrompt: (ctx) => {
            capturedContexts.push(ctx);
            return "review";
          },
        }),
      ];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // Planner gets empty pressure (no prior stages)
      const plannerCtx = capturedContexts[0]!;
      expect(plannerCtx.contextPressure).toBeDefined();
      expect(plannerCtx.contextPressure!.totalInputTokens).toBe(0);
      expect(plannerCtx.contextPressure!.stageSnapshots.size).toBe(0);

      // Reviewer gets planner's accumulated pressure
      const reviewerCtx = capturedContexts[1]!;
      expect(reviewerCtx.contextPressure).toBeDefined();
      expect(reviewerCtx.contextPressure!.totalInputTokens).toBeGreaterThan(0);
      expect(reviewerCtx.contextPressure!.stageSnapshots.size).toBe(1);
      expect(reviewerCtx.contextPressure!.stageSnapshots.has("planner")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // WorkflowResult Accumulated Pressure
  // -----------------------------------------------------------------------

  describe("WorkflowResult accumulated pressure", () => {
    test("includes accumulated pressure in result", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
      ]);
      let callCount = 0;

      const config = buildConfig(
        graph,
        async () => {
          callCount++;
          return createSessionWithUsage(`output-${callCount}`, normalUsage(15));
        },
        { contextPressure: pressureConfig },
      );

      const stages = [stage("planner"), stage("reviewer")];
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.contextPressure).toBeDefined();
      expect(result.contextPressure!.stageSnapshots.size).toBe(2);
      expect(result.contextPressure!.totalInputTokens).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // onContextPressure Callback
  // -----------------------------------------------------------------------

  describe("onContextPressure callback", () => {
    test("invoked after each stage with snapshot data", async () => {
      const pressureCalls: Array<[string, ContextPressureSnapshot, boolean]> = [];
      const pressureConfig = createDefaultContextPressureConfig();
      const graph = buildLinearGraph([agentNode("planner")]);

      const config = buildConfig(
        graph,
        async () => createSessionWithUsage("output", normalUsage(30)),
        {
          contextPressure: pressureConfig,
          onContextPressure: (stageId, snapshot, continuation) => {
            pressureCalls.push([stageId, snapshot, continuation]);
          },
        },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      await conductor.execute("test");

      expect(pressureCalls).toHaveLength(1);
      expect(pressureCalls[0]![0]).toBe("planner");
      expect(pressureCalls[0]![1].usagePercentage).toBe(30);
      expect(pressureCalls[0]![1].level).toBe("normal");
      expect(pressureCalls[0]![2]).toBe(false); // No continuation needed
    });

    test("indicates continuation=true when critical pressure triggers continuation", async () => {
      const pressureCalls: Array<[string, ContextPressureSnapshot, boolean]> = [];
      const pressureConfig = createDefaultContextPressureConfig();
      let callCount = 0;

      const graph = buildLinearGraph([agentNode("orchestrator")]);

      const config = buildConfig(
        graph,
        async () => {
          callCount++;
          // First session: critical usage → triggers continuation
          // Second session: normal usage → completes
          const usage = callCount === 1 ? criticalUsage(70) : normalUsage(10);
          return createSessionWithUsage(`output-${callCount}`, usage);
        },
        {
          contextPressure: pressureConfig,
          onContextPressure: (stageId, snapshot, continuation) => {
            pressureCalls.push([stageId, snapshot, continuation]);
          },
        },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("orchestrator")]);
      await conductor.execute("test");

      // First call: critical, continuation=true
      expect(pressureCalls[0]![2]).toBe(true);
      // Second call: normal, continuation=false
      expect(pressureCalls[1]![2]).toBe(false);
    });

    test("not invoked when getContextUsage fails", async () => {
      const pressureCalls: unknown[] = [];
      const pressureConfig = createDefaultContextPressureConfig();
      const graph = buildLinearGraph([agentNode("planner")]);

      const config = buildConfig(
        graph,
        async () => createSessionWithFailingUsage("output"),
        {
          contextPressure: pressureConfig,
          onContextPressure: (...args) => {
            pressureCalls.push(args);
          },
        },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      await conductor.execute("test");

      expect(pressureCalls).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Continuation Sessions
  // -----------------------------------------------------------------------

  describe("continuation sessions", () => {
    test("creates a continuation session when critical threshold is exceeded", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      let sessionCount = 0;

      const graph = buildLinearGraph([agentNode("orchestrator")]);

      const config = buildConfig(
        graph,
        async () => {
          sessionCount++;
          // First: critical, triggers continuation
          // Second: normal, completes
          const usage = sessionCount === 1 ? criticalUsage(70) : normalUsage(10);
          return createSessionWithUsage(`response-${sessionCount}`, usage);
        },
        { contextPressure: pressureConfig },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("orchestrator")]);
      const result = await conductor.execute("test");

      // Two sessions were created for the single stage
      expect(sessionCount).toBe(2);

      const output = result.stageOutputs.get("orchestrator")!;
      expect(output.status).toBe("completed");
      // Response is accumulated from both sessions
      expect(output.rawResponse).toContain("response-1");
      expect(output.rawResponse).toContain("response-2");
      // Continuation records are attached
      expect(output.continuations).toBeDefined();
      expect(output.continuations).toHaveLength(1);
      expect(output.continuations![0]!.stageId).toBe("orchestrator");
      expect(output.continuations![0]!.continuationIndex).toBe(0);
    });

    test("destroys the pre-continuation session before creating a new one", async () => {
      const destroyedSessions: string[] = [];
      const pressureConfig = createDefaultContextPressureConfig();
      let sessionCount = 0;

      const graph = buildLinearGraph([agentNode("orchestrator")]);

      const config = buildConfig(
        graph,
        async () => {
          sessionCount++;
          const usage = sessionCount === 1 ? criticalUsage(70) : normalUsage(10);
          return createSessionWithUsage(
            `response-${sessionCount}`,
            usage,
            `s-${sessionCount}`,
          );
        },
        {
          contextPressure: pressureConfig,
          destroySession: mock(async (session: Session) => {
            destroyedSessions.push(session.id);
          }),
        },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("orchestrator")]);
      await conductor.execute("test");

      // Both sessions should be destroyed (first before continuation, second after completion)
      expect(destroyedSessions).toHaveLength(2);
      expect(destroyedSessions).toContain("s-1");
      expect(destroyedSessions).toContain("s-2");
    });

    test("continuation prompt includes original prompt and partial response", async () => {
      const capturedPrompts: string[] = [];
      const pressureConfig = createDefaultContextPressureConfig();
      let sessionCount = 0;

      const graph = buildLinearGraph([agentNode("orchestrator")]);

      const config = buildConfig(
        graph,
        async () => {
          sessionCount++;
          const usage = sessionCount === 1 ? criticalUsage(70) : normalUsage(10);
          const session = createSessionWithUsage(`response-${sessionCount}`, usage);
          // Intercept the prompt sent to the session
          const originalStream = session.stream;
          session.stream = async function* (msg, opts) {
            capturedPrompts.push(msg);
            yield* originalStream.call(session, msg, opts);
          };
          return session;
        },
        { contextPressure: pressureConfig },
      );

      const conductor = new WorkflowSessionConductor(config, [
        stage("orchestrator", {
          buildPrompt: () => "Build the auth module with JWT",
        }),
      ]);
      await conductor.execute("test");

      expect(capturedPrompts).toHaveLength(2);
      // First: original prompt
      expect(capturedPrompts[0]).toBe("Build the auth module with JWT");
      // Second: continuation prompt referencing the original
      expect(capturedPrompts[1]).toContain("Continuation Session");
      expect(capturedPrompts[1]).toContain("Build the auth module with JWT");
      expect(capturedPrompts[1]).toContain("response-1");
    });

    test("enforces maxContinuationsPerStage limit", async () => {
      const pressureConfig = createDefaultContextPressureConfig({
        maxContinuationsPerStage: 2,
      });
      let sessionCount = 0;

      const graph = buildLinearGraph([agentNode("orchestrator")]);

      const config = buildConfig(
        graph,
        async () => {
          sessionCount++;
          // Every session reports critical usage
          return createSessionWithUsage(`r-${sessionCount}`, criticalUsage(80));
        },
        { contextPressure: pressureConfig },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("orchestrator")]);
      const result = await conductor.execute("test");

      // 1 original + 2 continuations = 3 sessions
      expect(sessionCount).toBe(3);

      const output = result.stageOutputs.get("orchestrator")!;
      expect(output.continuations).toHaveLength(2);
      // Stage completes after hitting the limit (no more continuations)
      expect(output.status).toBe("completed");
    });

    test("no continuation when enableContinuation is false", async () => {
      const pressureConfig = createDefaultContextPressureConfig({
        enableContinuation: false,
      });
      let sessionCount = 0;

      const graph = buildLinearGraph([agentNode("orchestrator")]);

      const config = buildConfig(
        graph,
        async () => {
          sessionCount++;
          return createSessionWithUsage("output", criticalUsage(80));
        },
        { contextPressure: pressureConfig },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("orchestrator")]);
      const result = await conductor.execute("test");

      // Only 1 session — no continuations
      expect(sessionCount).toBe(1);
      const output = result.stageOutputs.get("orchestrator")!;
      expect(output.continuations).toBeUndefined();
      // Context usage is still captured
      expect(output.contextUsage).toBeDefined();
      expect(output.contextUsage!.level).toBe("critical");
    });

    test("no continuation when pressure is only elevated", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      let sessionCount = 0;

      const graph = buildLinearGraph([agentNode("orchestrator")]);

      const config = buildConfig(
        graph,
        async () => {
          sessionCount++;
          return createSessionWithUsage("output", elevatedUsage(50));
        },
        { contextPressure: pressureConfig },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("orchestrator")]);
      const result = await conductor.execute("test");

      expect(sessionCount).toBe(1);
      const output = result.stageOutputs.get("orchestrator")!;
      expect(output.contextUsage!.level).toBe("elevated");
      expect(output.continuations).toBeUndefined();
    });

    test("accumulated pressure reflects continuations across the workflow", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      let sessionCount = 0;

      const graph = buildLinearGraph([
        agentNode("orchestrator"),
        agentNode("reviewer"),
      ]);

      const config = buildConfig(
        graph,
        async () => {
          sessionCount++;
          // Orchestrator sessions: critical then normal
          // Reviewer session: normal
          if (sessionCount === 1) {
            return createSessionWithUsage(`r-${sessionCount}`, criticalUsage(70));
          }
          return createSessionWithUsage(`r-${sessionCount}`, normalUsage(15));
        },
        { contextPressure: pressureConfig },
      );

      const stages = [stage("orchestrator"), stage("reviewer")];
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.contextPressure).toBeDefined();
      expect(result.contextPressure!.totalContinuations).toBe(1);
      expect(result.contextPressure!.continuations).toHaveLength(1);
      expect(result.contextPressure!.stageSnapshots.size).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Error & Abort with Context Pressure
  // -----------------------------------------------------------------------

  describe("error and abort paths with context pressure", () => {
    test("stage error during continuation preserves partial response and continuations", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      let sessionCount = 0;

      const graph = buildLinearGraph([agentNode("orchestrator")]);

      const config = buildConfig(
        graph,
        async () => {
          sessionCount++;
          if (sessionCount === 1) {
            return createSessionWithUsage("partial-work", criticalUsage(70));
          }
          // Second session throws
          return {
            id: "failing",
            send: mock(async () => ({ type: "text" as const, content: "" })),
            stream: async function* () {
              throw new Error("API quota exceeded");
            },
            summarize: mock(async () => {}),
            getContextUsage: mock(async () => normalUsage()),
            getSystemToolsTokens: () => 0,
            destroy: mock(async () => {}),
          } as Session;
        },
        { contextPressure: pressureConfig },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("orchestrator")]);
      const result = await conductor.execute("test");

      expect(result.success).toBe(false);
      const output = result.stageOutputs.get("orchestrator")!;
      expect(output.status).toBe("error");
      // Partial response from first session is preserved
      expect(output.rawResponse).toContain("partial-work");
      // Continuation records are preserved
      expect(output.continuations).toHaveLength(1);
    });

    test("abort during continuation preserves continuations and partial response", async () => {
      const controller = new AbortController();
      const pressureConfig = createDefaultContextPressureConfig();
      let sessionCount = 0;

      const graph = buildLinearGraph([agentNode("orchestrator")]);

      const config = buildConfig(
        graph,
        async () => {
          sessionCount++;
          if (sessionCount === 1) {
            return createSessionWithUsage("before-abort", criticalUsage(70));
          }
          // Second session: abort fires during streaming
          return {
            id: "aborting",
            send: mock(async () => ({ type: "text" as const, content: "" })),
            stream: async function* () {
              yield { type: "text" as const, content: "mid-stream" } as AgentMessage;
              controller.abort();
              yield { type: "text" as const, content: "-more" } as AgentMessage;
            },
            summarize: mock(async () => {}),
            getContextUsage: mock(async () => normalUsage()),
            getSystemToolsTokens: () => 0,
            destroy: mock(async () => {}),
          } as Session;
        },
        {
          contextPressure: pressureConfig,
          abortSignal: controller.signal,
        },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("orchestrator")]);
      const result = await conductor.execute("test");

      expect(result.success).toBe(false);
      const output = result.stageOutputs.get("orchestrator")!;
      expect(output.status).toBe("interrupted");
      expect(output.rawResponse).toContain("before-abort");
      expect(output.continuations).toHaveLength(1);
    });
  });
});
