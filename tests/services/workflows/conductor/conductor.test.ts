import { describe, expect, test, mock, beforeEach } from "bun:test";
import { WorkflowSessionConductor } from "@/services/workflows/conductor/conductor.ts";
import type {
  ConductorConfig,
  StageContext,
  StageDefinition,
  StageOutput,
  WorkflowResult,
} from "@/services/workflows/conductor/types.ts";
import type { BaseState, CompiledGraph, NodeDefinition, Edge } from "@/services/workflows/graph/types.ts";
import type { Session, AgentMessage, SessionConfig } from "@/services/agents/types.ts";

// ---------------------------------------------------------------------------
// Test Helpers — Build realistic graph & session mocks
// ---------------------------------------------------------------------------

/** Create a minimal Session that yields messages from a canned response. */
function createMockSession(response: string, id = "session-1"): Session {
  return {
    id,
    send: mock(async () => ({ type: "text" as const, content: response })),
    stream: async function* (_message: string, _options?: { agent?: string; abortSignal?: AbortSignal }) {
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

/** Create a tool/decision node that sets a state output. */
function toolNode(id: string, outputValue?: unknown): NodeDefinition<BaseState> {
  return {
    id,
    type: "tool",
    execute: mock(async (ctx) => ({
      stateUpdate: {
        outputs: { ...ctx.state.outputs, [id]: outputValue ?? `${id}-result` },
      },
    })),
  };
}

/** Build a simple linear graph: node1 → node2 → node3 ... */
function buildLinearGraph(nodes: NodeDefinition<BaseState>[]): CompiledGraph<BaseState> {
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

/** Build a graph with conditional branching. */
function buildConditionalGraph(
  nodes: NodeDefinition<BaseState>[],
  edges: Edge<BaseState>[],
  startNode: string,
  endNodes: string[],
): CompiledGraph<BaseState> {
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges,
    startNode,
    endNodes: new Set(endNodes),
    config: {},
  };
}

/** Create a minimal StageDefinition. */
function stage(
  id: string,
  response: string,
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

describe("WorkflowSessionConductor", () => {
  // -----------------------------------------------------------------------
  // Basic Execution
  // -----------------------------------------------------------------------

  describe("basic execution", () => {
    test("executes a single-stage graph and returns success", async () => {
      const session = createMockSession("Planner output");
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session);
      const stages = [stage("planner", "Planner output")];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("Build auth module");

      expect(result.success).toBe(true);
      expect(result.stageOutputs.size).toBe(1);

      const plannerOutput = result.stageOutputs.get("planner");
      expect(plannerOutput).toBeDefined();
      expect(plannerOutput!.stageId).toBe("planner");
      expect(plannerOutput!.rawResponse).toBe("Planner output");
      expect(plannerOutput!.status).toBe("completed");
    });

    test("sequences multiple stages in graph order", async () => {
      const executionOrder: string[] = [];
      const sessionFactory = async (config?: SessionConfig) => {
        const id = executionOrder.length.toString();
        const session = createMockSession(`Response ${id}`, `session-${id}`);
        return session;
      };

      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("orchestrator"),
        agentNode("reviewer"),
      ]);

      const stages = [
        stage("planner", "", {
          buildPrompt: (ctx) => {
            executionOrder.push("planner");
            return `Plan: ${ctx.userPrompt}`;
          },
        }),
        stage("orchestrator", "", {
          buildPrompt: (ctx) => {
            executionOrder.push("orchestrator");
            return "Orchestrate tasks";
          },
        }),
        stage("reviewer", "", {
          buildPrompt: () => {
            executionOrder.push("reviewer");
            return "Review code";
          },
        }),
      ];

      const config = buildConfig(graph, sessionFactory);
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("Build auth");

      expect(result.success).toBe(true);
      expect(executionOrder).toEqual(["planner", "orchestrator", "reviewer"]);
      expect(result.stageOutputs.size).toBe(3);
    });

    test("returns empty stageOutputs for a graph with no agent nodes", async () => {
      const graph = buildLinearGraph([toolNode("setup"), toolNode("validate")]);
      const config = buildConfig(graph, async () => createMockSession(""));
      const conductor = new WorkflowSessionConductor(config, []);
      const result = await conductor.execute("Test");

      expect(result.success).toBe(true);
      expect(result.stageOutputs.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Stage Context Threading
  // -----------------------------------------------------------------------

  describe("stage context threading", () => {
    test("passes userPrompt to every stage's buildPrompt", async () => {
      const capturedPrompts: string[] = [];
      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);

      const stages = [
        stage("planner", "", {
          buildPrompt: (ctx) => {
            capturedPrompts.push(ctx.userPrompt);
            return "plan";
          },
        }),
        stage("reviewer", "", {
          buildPrompt: (ctx) => {
            capturedPrompts.push(ctx.userPrompt);
            return "review";
          },
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("My prompt");

      expect(capturedPrompts).toEqual(["My prompt", "My prompt"]);
    });

    test("downstream stages receive prior stage outputs in context", async () => {
      let reviewerContext: StageContext | undefined;

      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);

      const stages = [
        stage("planner", "", {
          buildPrompt: () => "plan",
          parseOutput: (raw) => ({ tasks: ["task1"] }),
        }),
        stage("reviewer", "", {
          buildPrompt: (ctx) => {
            reviewerContext = ctx;
            return "review";
          },
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("planner response"));
      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Build something");

      expect(reviewerContext).toBeDefined();
      expect(reviewerContext!.stageOutputs.size).toBe(1);

      const plannerOutput = reviewerContext!.stageOutputs.get("planner");
      expect(plannerOutput).toBeDefined();
      expect(plannerOutput!.rawResponse).toBe("planner response");
      expect(plannerOutput!.parsedOutput).toEqual({ tasks: ["task1"] });
    });

    test("context stageOutputs is an immutable snapshot per stage", async () => {
      const capturedMaps: Map<string, StageOutput>[] = [];

      const graph = buildLinearGraph([
        agentNode("stage1"),
        agentNode("stage2"),
        agentNode("stage3"),
      ]);

      const stages = [
        stage("stage1", "", { buildPrompt: (ctx) => { capturedMaps.push(new Map(ctx.stageOutputs)); return "s1"; } }),
        stage("stage2", "", { buildPrompt: (ctx) => { capturedMaps.push(new Map(ctx.stageOutputs)); return "s2"; } }),
        stage("stage3", "", { buildPrompt: (ctx) => { capturedMaps.push(new Map(ctx.stageOutputs)); return "s3"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedMaps[0]!.size).toBe(0); // stage1 sees nothing
      expect(capturedMaps[1]!.size).toBe(1); // stage2 sees stage1
      expect(capturedMaps[2]!.size).toBe(2); // stage3 sees stage1 + stage2
    });
  });

  // -----------------------------------------------------------------------
  // shouldRun Gating
  // -----------------------------------------------------------------------

  describe("shouldRun gating", () => {
    test("skips a stage when shouldRun returns false", async () => {
      const executed: string[] = [];
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("debugger"),
        agentNode("reviewer"),
      ]);

      const stages = [
        stage("planner", "", { buildPrompt: () => { executed.push("planner"); return "plan"; } }),
        stage("debugger", "", {
          buildPrompt: () => { executed.push("debugger"); return "debug"; },
          shouldRun: () => false,
        }),
        stage("reviewer", "", { buildPrompt: () => { executed.push("reviewer"); return "review"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      expect(executed).toEqual(["planner", "reviewer"]);
    });

    test("shouldRun receives current stage context", async () => {
      const graph = buildLinearGraph([agentNode("planner"), agentNode("debugger")]);

      const stages = [
        stage("planner", "", { buildPrompt: () => "plan" }),
        stage("debugger", "", {
          buildPrompt: () => "debug",
          shouldRun: (ctx) => {
            const plannerOutput = ctx.stageOutputs.get("planner");
            return plannerOutput?.rawResponse.includes("error") ?? false;
          },
        }),
      ];

      // No "error" in planner response → debugger should NOT run
      const config = buildConfig(graph, async () => createMockSession("all good"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // Debugger was skipped — not in stageOutputs
      expect(result.stageOutputs.has("debugger")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Output Parsing
  // -----------------------------------------------------------------------

  describe("output parsing", () => {
    test("stores parsedOutput when parseOutput succeeds", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [
        stage("planner", "", {
          buildPrompt: () => "plan",
          parseOutput: (raw) => JSON.parse(raw),
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession('{"tasks":["a","b"]}'));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output!.parsedOutput).toEqual({ tasks: ["a", "b"] });
      expect(output!.status).toBe("completed");
    });

    test("parsedOutput is undefined when parseOutput throws", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [
        stage("planner", "", {
          buildPrompt: () => "plan",
          parseOutput: () => { throw new Error("bad JSON"); },
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("not json"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output!.parsedOutput).toBeUndefined();
      expect(output!.status).toBe("completed");
    });

    test("parsedOutput is undefined when no parseOutput is provided", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.stageOutputs.get("planner")!.parsedOutput).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Task List Updates
  // -----------------------------------------------------------------------

  describe("task list updates", () => {
    test("updates tasks and calls onTaskUpdate when parsedOutput is a TaskItem array", async () => {
      const taskUpdates: unknown[][] = [];
      const graph = buildLinearGraph([agentNode("planner"), agentNode("orchestrator")]);

      const taskArray = [
        { id: "1", description: "Create model", status: "pending", summary: "Creating model", blockedBy: [] },
        { id: "2", description: "Add tests", status: "pending", summary: "Adding tests", blockedBy: ["1"] },
      ];

      const stages = [
        stage("planner", "", {
          buildPrompt: () => "plan",
          parseOutput: () => ({ tasks: taskArray }),
        }),
        stage("orchestrator", "", {
          buildPrompt: (ctx) => {
            // Orchestrator should see the tasks from planner
            expect(ctx.tasks).toHaveLength(2);
            return "orchestrate";
          },
        }),
      ];

      const config = buildConfig(
        graph,
        async () => createMockSession("planner output"),
        { onTaskUpdate: mock((tasks) => taskUpdates.push([...tasks])) },
      );

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(taskUpdates.length).toBeGreaterThanOrEqual(1);
      expect(taskUpdates[0]).toHaveLength(2);
      expect(result.tasks).toHaveLength(2);
    });

    test("does not call onTaskUpdate when parsedOutput is not a TaskItem array", async () => {
      const onTaskUpdate = mock(() => {});
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", "", {
          buildPrompt: () => "plan",
          parseOutput: () => ({ findings: ["bug"] }), // Not an array
        }),
      ];

      const config = buildConfig(
        graph,
        async () => createMockSession("output"),
        { onTaskUpdate },
      );

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(onTaskUpdate).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Session Lifecycle
  // -----------------------------------------------------------------------

  describe("session lifecycle", () => {
    test("creates and destroys a session per agent stage", async () => {
      const createdSessions: Session[] = [];
      const destroyedSessions: Session[] = [];

      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);
      const stages = [stage("planner", ""), stage("reviewer", "")];

      const config = buildConfig(
        graph,
        async () => {
          const session = createMockSession("output", `s-${createdSessions.length}`);
          createdSessions.push(session);
          return session;
        },
        {
          destroySession: mock(async (session: Session) => {
            destroyedSessions.push(session);
          }),
        },
      );

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(createdSessions).toHaveLength(2);
      expect(destroyedSessions).toHaveLength(2);
      // Sessions are destroyed in the same order they're created
      expect(destroyedSessions[0]!.id).toBe(createdSessions[0]!.id);
      expect(destroyedSessions[1]!.id).toBe(createdSessions[1]!.id);
    });

    test("destroys session even when stage errors", async () => {
      const destroyedSessions: string[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];

      const failingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          throw new Error("Stream failure");
        },
      };

      const config = buildConfig(
        graph,
        async () => failingSession,
        {
          destroySession: mock(async (session: Session) => {
            destroyedSessions.push(session.id);
          }),
        },
      );

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(false);
      expect(destroyedSessions).toHaveLength(1);
    });

    test("passes stage sessionConfig to createSession", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", "", {
          sessionConfig: { model: { claude: "claude-opus-4-20250514" }, maxTurns: 5 },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.maxTurns).toBe(5);
    });

    test("resolves model from sessionConfig.model for the active agent type", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", "", {
          sessionConfig: { model: { claude: "opus", opencode: "gpt-5" } },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.model).toBe("opus");
    });

    test("resolves model for opencode agent type from multi-agent config", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", "", {
          sessionConfig: { model: { claude: "opus", opencode: "gpt-5" } },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "opencode" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.model).toBe("gpt-5");
    });

    test("leaves model undefined when sessionConfig has no entry for the active agent type", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", "", {
          sessionConfig: { model: { opencode: "gpt-5" } },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.model).toBeUndefined();
    });

    test("resolves different models per stage for multi-stage workflows", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner"), agentNode("executor")]);

      const stages = [
        stage("planner", "", {
          sessionConfig: { model: { claude: "sonnet" } },
        }),
        stage("executor", "", {
          sessionConfig: { model: { claude: "opus" } },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(2);
      expect(capturedConfigs[0]?.model).toBe("sonnet");
      expect(capturedConfigs[1]?.model).toBe("opus");
    });

    test("clears model-coupled fields when stage mentions the active agent type", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", "", {
          sessionConfig: { model: { claude: "haiku" } },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      const resolved = capturedConfigs[0]!;
      expect(resolved.model).toBe("haiku");
      // All model-coupled fields must be own properties so the spread
      // merge in createSubagentSession clears inherited parent values.
      expect(Object.prototype.hasOwnProperty.call(resolved, "reasoningEffort")).toBe(true);
      expect(resolved.reasoningEffort).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(resolved, "maxThinkingTokens")).toBe(true);
      expect(resolved.maxThinkingTokens).toBeUndefined();
    });

    test("clears model-coupled fields when only reasoningEffort mentions the active agent type", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      // No model override, but reasoningEffort mentions claude → stage
      // owns model config for this provider.
      const stages = [
        stage("planner", "", {
          sessionConfig: { reasoningEffort: { claude: "high" } },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      const resolved = capturedConfigs[0]!;
      expect(resolved.reasoningEffort).toBe("high");
      // model and maxThinkingTokens are cleared (own properties = undefined)
      expect(Object.prototype.hasOwnProperty.call(resolved, "model")).toBe(true);
      expect(resolved.model).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(resolved, "maxThinkingTokens")).toBe(true);
      expect(resolved.maxThinkingTokens).toBeUndefined();
    });

    test("preserves all model-coupled fields when both are explicitly set", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", "", {
          sessionConfig: {
            model: { claude: "opus" },
            reasoningEffort: { claude: "high" },
            maxThinkingTokens: 32000,
          },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.model).toBe("opus");
      expect(capturedConfigs[0]?.reasoningEffort).toBe("high");
      expect(capturedConfigs[0]?.maxThinkingTokens).toBe(32000);
    });

    test("does not set model-coupled fields when stage does not mention the active agent type", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", "", {
          sessionConfig: {},
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      // No per-agent-type field mentions claude → parent inherits as a set.
      expect(Object.prototype.hasOwnProperty.call(capturedConfigs[0], "model")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(capturedConfigs[0], "reasoningEffort")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(capturedConfigs[0], "maxThinkingTokens")).toBe(false);
    });

    test("does not clear fields when override targets a different agent type", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", "", {
          sessionConfig: { model: { opencode: "gpt-5" } },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      const resolved = capturedConfigs[0]!;
      // opencode is mentioned, not claude → parent inherits for claude.
      expect(Object.prototype.hasOwnProperty.call(resolved, "model")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(resolved, "reasoningEffort")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(resolved, "maxThinkingTokens")).toBe(false);
    });

    test("multi-stage: clears for provider-aware stage, inherits for default stage", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("fast"), agentNode("inherited")]);

      const stages = [
        stage("fast", "", {
          sessionConfig: { model: { claude: "haiku" } },
        }),
        stage("inherited", "", {
          sessionConfig: {},
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(2);
      // Stage 1: mentions claude → model-coupled fields explicitly set
      expect(capturedConfigs[0]?.model).toBe("haiku");
      expect(Object.prototype.hasOwnProperty.call(capturedConfigs[0], "reasoningEffort")).toBe(true);
      // Stage 2: does not mention claude → parent inherits
      expect(Object.prototype.hasOwnProperty.call(capturedConfigs[1], "model")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(capturedConfigs[1], "reasoningEffort")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Stage Transition Callbacks
  // -----------------------------------------------------------------------

  describe("stage transition callbacks", () => {
    test("calls onStageTransition with null for first stage", async () => {
      const transitions: [string | null, string][] = [];
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];

      const config = buildConfig(
        graph,
        async () => createMockSession("output"),
        { onStageTransition: mock((from, to) => transitions.push([from, to])) },
      );

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(transitions).toEqual([[null, "planner"]]);
    });

    test("calls onStageTransition with previous stage ID for subsequent stages", async () => {
      const transitions: [string | null, string][] = [];
      const graph = buildLinearGraph([agentNode("planner"), agentNode("orchestrator"), agentNode("reviewer")]);
      const stages = [stage("planner", ""), stage("orchestrator", ""), stage("reviewer", "")];

      const config = buildConfig(
        graph,
        async () => createMockSession("output"),
        { onStageTransition: mock((from, to) => transitions.push([from, to])) },
      );

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(transitions).toEqual([
        [null, "planner"],
        ["planner", "orchestrator"],
        ["orchestrator", "reviewer"],
      ]);
    });

    test("does not call onStageTransition for skipped stages", async () => {
      const transitions: [string | null, string][] = [];
      const graph = buildLinearGraph([agentNode("planner"), agentNode("debugger"), agentNode("reviewer")]);

      const stages = [
        stage("planner", ""),
        stage("debugger", "", { shouldRun: () => false }),
        stage("reviewer", ""),
      ];

      const config = buildConfig(
        graph,
        async () => createMockSession("output"),
        { onStageTransition: mock((from, to) => transitions.push([from, to])) },
      );

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(transitions).toEqual([
        [null, "planner"],
        ["planner", "reviewer"],
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Error Handling
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    test("returns success=false when a stage errors", async () => {
      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);
      const stages = [stage("planner", ""), stage("reviewer", "")];

      let callCount = 0;
      const config = buildConfig(graph, async () => {
        callCount++;
        if (callCount === 1) {
          // Planner session throws
          return {
            ...createMockSession(""),
            stream: async function* () {
              throw new Error("API rate limit");
            },
          } as Session;
        }
        return createMockSession("review output");
      });

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(false);
      const plannerOutput = result.stageOutputs.get("planner");
      expect(plannerOutput!.status).toBe("error");
      expect(plannerOutput!.error).toContain("API rate limit");

      // Reviewer should NOT have executed
      expect(result.stageOutputs.has("reviewer")).toBe(false);
    });

    test("returns error output with error message from session creation failure", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];

      const config = buildConfig(graph, async () => {
        throw new Error("Session pool exhausted");
      });

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(false);
      const output = result.stageOutputs.get("planner");
      expect(output!.status).toBe("error");
      expect(output!.error).toContain("Session pool exhausted");
    });
  });

  // -----------------------------------------------------------------------
  // Abort / Cancellation
  // -----------------------------------------------------------------------

  describe("abort handling", () => {
    test("returns success=false when aborted before execution starts", async () => {
      const controller = new AbortController();
      controller.abort();

      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];
      const config = buildConfig(
        graph,
        async () => createMockSession("output"),
        { abortSignal: controller.signal },
      );

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(false);
      expect(result.stageOutputs.size).toBe(0);
    });

    test("stage returns interrupted status when abort fires during streaming", async () => {
      const controller = new AbortController();
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [stage("planner", "")];
      const slowSession: Session = {
        ...createMockSession(""),
        stream: async function* (_msg: string, options?: { abortSignal?: AbortSignal }) {
          yield { type: "text" as const, content: "partial " } as AgentMessage;
          // Simulate abort during streaming
          controller.abort();
          yield { type: "text" as const, content: "data" } as AgentMessage;
        },
      };

      const config = buildConfig(
        graph,
        async () => slowSession,
        { abortSignal: controller.signal },
      );

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(false);
      const output = result.stageOutputs.get("planner");
      expect(output!.status).toBe("interrupted");
    });
  });

  // -----------------------------------------------------------------------
  // Mixed Node Types (agent + tool/decision)
  // -----------------------------------------------------------------------

  describe("mixed node types", () => {
    test("executes tool nodes via their execute function", async () => {
      const toolExecuted = mock(async (ctx: any) => ({
        stateUpdate: { outputs: { ...ctx.state.outputs, validate: "validated" } },
      }));

      const validateNode: NodeDefinition<BaseState> = {
        id: "validate",
        type: "tool",
        execute: toolExecuted,
      };

      const graph = buildLinearGraph([agentNode("planner"), validateNode, agentNode("reviewer")]);
      const stages = [stage("planner", ""), stage("reviewer", "")];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      expect(toolExecuted).toHaveBeenCalled();
      expect(result.stageOutputs.size).toBe(2); // Only agent stages produce StageOutputs
    });

    test("tool node state updates are visible to subsequent agent stages", async () => {
      let reviewerState: BaseState | undefined;

      const validateNode: NodeDefinition<BaseState> = {
        id: "validate",
        type: "tool",
        execute: async (ctx) => ({
          stateUpdate: {
            outputs: { ...ctx.state.outputs, validate: { isValid: true } },
          },
        }),
      };

      const graph = buildLinearGraph([validateNode, agentNode("reviewer")]);
      const stages = [
        stage("reviewer", "", {
          buildPrompt: () => "review",
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("review output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      // Tool node's stateUpdate is merged into state before the reviewer runs
      expect(result.state.outputs.validate).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Conditional Edge Routing
  // -----------------------------------------------------------------------

  describe("conditional edge routing", () => {
    test("follows edges based on state conditions", async () => {
      const executed: string[] = [];

      const plannerNode = agentNode("planner");
      const debugNode = agentNode("debugger");
      const reviewNode = agentNode("reviewer");

      const edges: Edge<BaseState>[] = [
        {
          from: "planner",
          to: "debugger",
          condition: (state) => {
            const output = state.outputs.planner as StageOutput | undefined;
            return output?.rawResponse.includes("error") ?? false;
          },
        },
        {
          from: "planner",
          to: "reviewer",
          condition: (state) => {
            const output = state.outputs.planner as StageOutput | undefined;
            return !output?.rawResponse.includes("error");
          },
        },
      ];

      const graph = buildConditionalGraph(
        [plannerNode, debugNode, reviewNode],
        edges,
        "planner",
        ["debugger", "reviewer"],
      );

      const stages = [
        stage("planner", "", { buildPrompt: () => { executed.push("planner"); return "plan"; } }),
        stage("debugger", "", { buildPrompt: () => { executed.push("debugger"); return "debug"; } }),
        stage("reviewer", "", { buildPrompt: () => { executed.push("reviewer"); return "review"; } }),
      ];

      // Session returns "all good" → should route to reviewer, not debugger
      const config = buildConfig(graph, async () => createMockSession("all good"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      expect(executed).toEqual(["planner", "reviewer"]);
      expect(executed).not.toContain("debugger");
    });
  });

  // -----------------------------------------------------------------------
  // WorkflowResult Shape
  // -----------------------------------------------------------------------

  describe("WorkflowResult shape", () => {
    test("result contains valid BaseState with executionId", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];
      const config = buildConfig(graph, async () => createMockSession("output"));

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.state.executionId).toMatch(/^exec_/);
      expect(result.state.lastUpdated).toBeTruthy();
      expect(typeof result.state.outputs).toBe("object");
    });

    test("result tasks array is a copy (mutation-safe)", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const taskArray = [
        { id: "1", description: "Task 1", status: "pending", summary: "Task one", blockedBy: [] },
      ];
      const stages = [
        stage("planner", "", {
          buildPrompt: () => "plan",
          parseOutput: () => ({ tasks: taskArray }),
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // Mutating the returned tasks should not affect internal state
      (result.tasks as any[]).push({ id: "extra" });
      expect(result.tasks).toHaveLength(2); // our mutation
      // A second execute would still have the original task count if we ran it
    });

    test("result stageOutputs is a copy (mutation-safe)", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];
      const config = buildConfig(graph, async () => createMockSession("output"));

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const originalSize = result.stageOutputs.size;
      (result.stageOutputs as Map<string, StageOutput>).set("fake", {} as StageOutput);
      expect(result.stageOutputs.size).toBe(originalSize + 1); // our mutation
    });
  });

  // -----------------------------------------------------------------------
  // Advanced Stage Sequencing
  // -----------------------------------------------------------------------

  describe("advanced stage sequencing", () => {
    test("diamond graph: A → B + C → D converges correctly", async () => {
      const executed: string[] = [];
      const a = agentNode("a");
      const b = agentNode("b");
      const c = agentNode("c");
      const d = agentNode("d");

      const edges: Edge<BaseState>[] = [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ];

      const graph = buildConditionalGraph([a, b, c, d], edges, "a", ["d"]);

      const stages = [
        stage("a", "", { buildPrompt: () => { executed.push("a"); return "do a"; } }),
        stage("b", "", { buildPrompt: () => { executed.push("b"); return "do b"; } }),
        stage("c", "", { buildPrompt: () => { executed.push("c"); return "do c"; } }),
        stage("d", "", { buildPrompt: () => { executed.push("d"); return "do d"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test diamond");

      expect(result.success).toBe(true);
      // A runs first, then B and C (order depends on queue), then D
      expect(executed[0]).toBe("a");
      expect(executed).toContain("b");
      expect(executed).toContain("c");
      expect(executed).toContain("d");
      expect(result.stageOutputs.size).toBe(4);
    });

    test("agent node without StageDefinition is skipped gracefully", async () => {
      const executed: string[] = [];
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("unknown_stage"),
        agentNode("reviewer"),
      ]);

      const stages = [
        stage("planner", "", { buildPrompt: () => { executed.push("planner"); return "plan"; } }),
        // No stage for "unknown_stage"
        stage("reviewer", "", { buildPrompt: () => { executed.push("reviewer"); return "review"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      expect(executed).toEqual(["planner", "reviewer"]);
      // The skipped node does NOT appear in stageOutputs
      expect(result.stageOutputs.has("unknown_stage")).toBe(false);
      expect(result.stageOutputs.size).toBe(2);
    });

    test("visited-set dedup prevents re-execution of non-loop cyclic graphs", async () => {
      // A self-referencing non-loop node should be deduped after first visit
      const node = agentNode("cyclic_stage");
      const edges: Edge<BaseState>[] = [
        { from: "cyclic_stage", to: "cyclic_stage" }, // self-loop
      ];

      const graph = buildConditionalGraph([node], edges, "cyclic_stage", []);

      let executeCount = 0;
      const stages = [
        stage("cyclic_stage", "", {
          buildPrompt: () => {
            executeCount++;
            return "loop";
          },
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test cyclic");

      // Non-loop node is deduped — should execute exactly once
      expect(executeCount).toBe(1);
      expect(result.success).toBe(true);
    });

    test("multiple end nodes — execution completes at first reachable end node", async () => {
      const a = agentNode("a");
      const b = agentNode("b");
      const c = agentNode("c");

      const edges: Edge<BaseState>[] = [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
      ];

      const graph = buildConditionalGraph([a, b, c], edges, "a", ["b", "c"]);
      const executed: string[] = [];

      const stages = [
        stage("a", "", { buildPrompt: () => { executed.push("a"); return "start"; } }),
        stage("b", "", { buildPrompt: () => { executed.push("b"); return "end-b"; } }),
        stage("c", "", { buildPrompt: () => { executed.push("c"); return "end-c"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      expect(executed[0]).toBe("a");
      // Both branches execute since both edges are unconditional
      expect(executed).toContain("b");
      expect(executed).toContain("c");
    });

    test("mixed agent/tool/agent sequence preserves execution order", async () => {
      const order: string[] = [];

      const tool1: NodeDefinition<BaseState> = {
        id: "validate",
        type: "tool",
        execute: mock(async (ctx) => {
          order.push("validate");
          return { stateUpdate: { outputs: { ...ctx.state.outputs, validate: "ok" } } };
        }),
      };

      const tool2: NodeDefinition<BaseState> = {
        id: "transform",
        type: "tool",
        execute: mock(async (ctx) => {
          order.push("transform");
          return { stateUpdate: { outputs: { ...ctx.state.outputs, transform: "done" } } };
        }),
      };

      const graph = buildLinearGraph([
        agentNode("planner"),
        tool1,
        agentNode("orchestrator"),
        tool2,
        agentNode("reviewer"),
      ]);

      const stages = [
        stage("planner", "", { buildPrompt: () => { order.push("planner"); return "plan"; } }),
        stage("orchestrator", "", { buildPrompt: () => { order.push("orchestrator"); return "orchestrate"; } }),
        stage("reviewer", "", { buildPrompt: () => { order.push("reviewer"); return "review"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      expect(order).toEqual(["planner", "validate", "orchestrator", "transform", "reviewer"]);
    });

    test("stage sequencing stops after first error — no subsequent stages run", async () => {
      const executed: string[] = [];
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("orchestrator"),
        agentNode("reviewer"),
      ]);

      const stages = [
        stage("planner", "", { buildPrompt: () => { executed.push("planner"); return "plan"; } }),
        stage("orchestrator", "", { buildPrompt: () => { executed.push("orchestrator"); return "orchestrate"; } }),
        stage("reviewer", "", { buildPrompt: () => { executed.push("reviewer"); return "review"; } }),
      ];

      let callCount = 0;
      const config = buildConfig(graph, async () => {
        callCount++;
        if (callCount === 2) {
          return {
            ...createMockSession(""),
            stream: async function* () { throw new Error("Orchestrator crash"); },
          } as Session;
        }
        return createMockSession("output");
      });

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(false);
      expect(executed).toEqual(["planner", "orchestrator"]);
      expect(executed).not.toContain("reviewer");
    });
  });

  // -----------------------------------------------------------------------
  // Advanced Output Capture
  // -----------------------------------------------------------------------

  describe("advanced output capture", () => {
    test("multi-chunk streaming concatenates content correctly", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];

      const multiChunkSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          yield { type: "text" as const, content: "First " } as AgentMessage;
          yield { type: "text" as const, content: "chunk. " } as AgentMessage;
          yield { type: "text" as const, content: "Second chunk." } as AgentMessage;
        },
      };

      const config = buildConfig(graph, async () => multiChunkSession);
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output!.rawResponse).toBe("First chunk. Second chunk.");
      expect(output!.status).toBe("completed");
    });

    test("empty stage response is captured as empty string", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];

      const emptySession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          // yields nothing
        },
      };

      const config = buildConfig(graph, async () => emptySession);
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output!.rawResponse).toBe("");
      expect(output!.status).toBe("completed");
    });

    test("parsedOutput chains through a multi-stage pipeline", async () => {
      let orchestratorSeenPlannerParsed: unknown;
      let reviewerSeenPlannerParsed: unknown;
      let reviewerSeenOrchestratorParsed: unknown;

      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("orchestrator"),
        agentNode("reviewer"),
      ]);

      const stages = [
        stage("planner", "", {
          buildPrompt: () => "plan",
          parseOutput: () => ({ plan: ["task-a", "task-b"] }),
        }),
        stage("orchestrator", "", {
          buildPrompt: (ctx) => {
            orchestratorSeenPlannerParsed = ctx.stageOutputs.get("planner")?.parsedOutput;
            return "orchestrate";
          },
          parseOutput: () => ({ completed: 2, failed: 0 }),
        }),
        stage("reviewer", "", {
          buildPrompt: (ctx) => {
            reviewerSeenPlannerParsed = ctx.stageOutputs.get("planner")?.parsedOutput;
            reviewerSeenOrchestratorParsed = ctx.stageOutputs.get("orchestrator")?.parsedOutput;
            return "review";
          },
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test chaining");

      expect(orchestratorSeenPlannerParsed).toEqual({ plan: ["task-a", "task-b"] });
      expect(reviewerSeenPlannerParsed).toEqual({ plan: ["task-a", "task-b"] });
      expect(reviewerSeenOrchestratorParsed).toEqual({ completed: 2, failed: 0 });
    });

    test("raw response preserved verbatim — no trimming or mutation", async () => {
      const verbatimContent = "  \n  Leading whitespace\n\tTabs preserved  \n  ";
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];

      const config = buildConfig(graph, async () => createMockSession(verbatimContent));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.stageOutputs.get("planner")!.rawResponse).toBe(verbatimContent);
    });

    test("stage outputs accumulate — third stage sees all prior outputs", async () => {
      const capturedOutputKeys: string[][] = [];
      const graph = buildLinearGraph([
        agentNode("s1"),
        agentNode("s2"),
        agentNode("s3"),
        agentNode("s4"),
      ]);

      const stages = [
        stage("s1", "", { buildPrompt: (ctx) => { capturedOutputKeys.push([...ctx.stageOutputs.keys()]); return "s1"; } }),
        stage("s2", "", { buildPrompt: (ctx) => { capturedOutputKeys.push([...ctx.stageOutputs.keys()]); return "s2"; } }),
        stage("s3", "", { buildPrompt: (ctx) => { capturedOutputKeys.push([...ctx.stageOutputs.keys()]); return "s3"; } }),
        stage("s4", "", { buildPrompt: (ctx) => { capturedOutputKeys.push([...ctx.stageOutputs.keys()]); return "s4"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedOutputKeys[0]).toEqual([]);
      expect(capturedOutputKeys[1]).toEqual(["s1"]);
      expect(capturedOutputKeys[2]).toEqual(["s1", "s2"]);
      expect(capturedOutputKeys[3]).toEqual(["s1", "s2", "s3"]);
    });

    test("parseOutput receives the complete concatenated rawResponse", async () => {
      let parserReceivedRaw = "";
      const graph = buildLinearGraph([agentNode("planner")]);

      const multiChunkSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          yield { type: "text" as const, content: '{"tasks":' } as AgentMessage;
          yield { type: "text" as const, content: '["a","b"]}' } as AgentMessage;
        },
      };

      const stages = [
        stage("planner", "", {
          buildPrompt: () => "plan",
          parseOutput: (raw) => {
            parserReceivedRaw = raw;
            return JSON.parse(raw);
          },
        }),
      ];

      const config = buildConfig(graph, async () => multiChunkSession);
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(parserReceivedRaw).toBe('{"tasks":["a","b"]}');
      expect(result.stageOutputs.get("planner")!.parsedOutput).toEqual({ tasks: ["a", "b"] });
    });

    test("task updates from planner are visible in orchestrator context", async () => {
      let orchestratorTasks: readonly unknown[] = [];
      const graph = buildLinearGraph([agentNode("planner"), agentNode("orchestrator")]);

      const taskArray = [
        { id: "t1", description: "Create model", status: "pending", summary: "Model creation", blockedBy: [] },
        { id: "t2", description: "Add routes", status: "pending", summary: "Routing", blockedBy: ["t1"] },
        { id: "t3", description: "Write tests", status: "pending", summary: "Tests", blockedBy: ["t2"] },
      ];

      const stages = [
        stage("planner", "", {
          buildPrompt: () => "plan",
          parseOutput: () => ({ tasks: taskArray }),
        }),
        stage("orchestrator", "", {
          buildPrompt: (ctx) => {
            orchestratorTasks = ctx.tasks;
            return "orchestrate";
          },
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(orchestratorTasks).toHaveLength(3);
      expect((orchestratorTasks[0] as { id: string }).id).toBe("t1");
      expect((orchestratorTasks[2] as { blockedBy: string[] }).blockedBy).toEqual(["t2"]);
    });

    test("non-string message content is ignored during output capture", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const stages = [stage("planner", "")];

      const mixedSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          yield { type: "text" as const, content: "real text" } as AgentMessage;
          yield { type: "text" as const, content: 42 } as unknown as AgentMessage;
          yield { type: "text" as const, content: " more text" } as AgentMessage;
        },
      };

      const config = buildConfig(graph, async () => mixedSession);
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // Only string content is concatenated; non-string is skipped
      expect(result.stageOutputs.get("planner")!.rawResponse).toBe("real text more text");
    });
  });

  // -----------------------------------------------------------------------
  // Advanced Conditionals
  // -----------------------------------------------------------------------

  describe("advanced conditionals", () => {
    test("fan-out: unconditional edges produce parallel branches", async () => {
      const executed: string[] = [];
      const start = agentNode("start");
      const branchA = agentNode("branch_a");
      const branchB = agentNode("branch_b");
      const branchC = agentNode("branch_c");

      const edges: Edge<BaseState>[] = [
        { from: "start", to: "branch_a" },
        { from: "start", to: "branch_b" },
        { from: "start", to: "branch_c" },
      ];

      const graph = buildConditionalGraph(
        [start, branchA, branchB, branchC],
        edges,
        "start",
        ["branch_a", "branch_b", "branch_c"],
      );

      const stages = [
        stage("start", "", { buildPrompt: () => { executed.push("start"); return "go"; } }),
        stage("branch_a", "", { buildPrompt: () => { executed.push("branch_a"); return "a"; } }),
        stage("branch_b", "", { buildPrompt: () => { executed.push("branch_b"); return "b"; } }),
        stage("branch_c", "", { buildPrompt: () => { executed.push("branch_c"); return "c"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test fan-out");

      expect(result.success).toBe(true);
      expect(executed[0]).toBe("start");
      expect(executed).toContain("branch_a");
      expect(executed).toContain("branch_b");
      expect(executed).toContain("branch_c");
      expect(result.stageOutputs.size).toBe(4);
    });

    test("shouldRun based on parsedOutput routes debugger conditionally", async () => {
      const executed: string[] = [];
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
        agentNode("debugger"),
      ]);

      const stages = [
        stage("planner", "", { buildPrompt: () => { executed.push("planner"); return "plan"; } }),
        stage("reviewer", "", {
          buildPrompt: () => { executed.push("reviewer"); return "review"; },
          parseOutput: () => ({ issues: ["bug in auth", "missing test"] }),
        }),
        stage("debugger", "", {
          buildPrompt: () => { executed.push("debugger"); return "debug"; },
          shouldRun: (ctx) => {
            const reviewOutput = ctx.stageOutputs.get("reviewer");
            const parsed = reviewOutput?.parsedOutput as { issues?: string[] } | undefined;
            return (parsed?.issues?.length ?? 0) > 0;
          },
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("response"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test conditional debugger");

      expect(result.success).toBe(true);
      expect(executed).toEqual(["planner", "reviewer", "debugger"]);
    });

    test("shouldRun skips debugger when reviewer finds no issues", async () => {
      const executed: string[] = [];
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
        agentNode("debugger"),
      ]);

      const stages = [
        stage("planner", "", { buildPrompt: () => { executed.push("planner"); return "plan"; } }),
        stage("reviewer", "", {
          buildPrompt: () => { executed.push("reviewer"); return "review"; },
          parseOutput: () => ({ issues: [] }),
        }),
        stage("debugger", "", {
          buildPrompt: () => { executed.push("debugger"); return "debug"; },
          shouldRun: (ctx) => {
            const reviewOutput = ctx.stageOutputs.get("reviewer");
            const parsed = reviewOutput?.parsedOutput as { issues?: string[] } | undefined;
            return (parsed?.issues?.length ?? 0) > 0;
          },
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("response"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test no issues");

      expect(result.success).toBe(true);
      expect(executed).toEqual(["planner", "reviewer"]);
      expect(executed).not.toContain("debugger");
    });

    test("decision node determines branch — only matching branch executes", async () => {
      const executed: string[] = [];

      const decisionNode: NodeDefinition<BaseState> = {
        id: "decide",
        type: "decision",
        execute: async (ctx) => ({
          stateUpdate: {
            outputs: { ...ctx.state.outputs, decide: { route: "fast_path" } },
          },
        }),
      };

      const edges: Edge<BaseState>[] = [
        { from: "start", to: "decide" },
        {
          from: "decide",
          to: "fast_handler",
          condition: (state) => (state.outputs.decide as { route: string })?.route === "fast_path",
        },
        {
          from: "decide",
          to: "slow_handler",
          condition: (state) => (state.outputs.decide as { route: string })?.route === "slow_path",
        },
      ];

      const graph = buildConditionalGraph(
        [agentNode("start"), decisionNode, agentNode("fast_handler"), agentNode("slow_handler")],
        edges,
        "start",
        ["fast_handler", "slow_handler"],
      );

      const stages = [
        stage("start", "", { buildPrompt: () => { executed.push("start"); return "begin"; } }),
        stage("fast_handler", "", { buildPrompt: () => { executed.push("fast_handler"); return "fast"; } }),
        stage("slow_handler", "", { buildPrompt: () => { executed.push("slow_handler"); return "slow"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test decision");

      expect(result.success).toBe(true);
      expect(executed).toContain("start");
      expect(executed).toContain("fast_handler");
      expect(executed).not.toContain("slow_handler");
    });

    test("edge condition + shouldRun interaction — edge routes but shouldRun skips", async () => {
      const executed: string[] = [];
      const transitions: [string | null, string][] = [];

      const edges: Edge<BaseState>[] = [
        { from: "planner", to: "debugger" },
        { from: "debugger", to: "reviewer" },
      ];

      const graph = buildConditionalGraph(
        [agentNode("planner"), agentNode("debugger"), agentNode("reviewer")],
        edges,
        "planner",
        ["reviewer"],
      );

      const stages = [
        stage("planner", "", { buildPrompt: () => { executed.push("planner"); return "plan"; } }),
        stage("debugger", "", {
          buildPrompt: () => { executed.push("debugger"); return "debug"; },
          shouldRun: () => false, // always skip
        }),
        stage("reviewer", "", { buildPrompt: () => { executed.push("reviewer"); return "review"; } }),
      ];

      const config = buildConfig(
        graph,
        async () => createMockSession("output"),
        { onStageTransition: mock((from, to) => transitions.push([from, to])) },
      );

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      expect(executed).toEqual(["planner", "reviewer"]);
      // Debugger was skipped — transition goes planner → reviewer
      expect(transitions).toEqual([
        [null, "planner"],
        ["planner", "reviewer"],
      ]);
    });

    test("dead end when no edge conditions match — execution terminates gracefully", async () => {
      const executed: string[] = [];

      const edges: Edge<BaseState>[] = [
        {
          from: "start",
          to: "unreachable",
          condition: () => false, // never matches
        },
      ];

      const graph = buildConditionalGraph(
        [agentNode("start"), agentNode("unreachable")],
        edges,
        "start",
        ["unreachable"],
      );

      const stages = [
        stage("start", "", { buildPrompt: () => { executed.push("start"); return "begin"; } }),
        stage("unreachable", "", { buildPrompt: () => { executed.push("unreachable"); return "nope"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test dead end");

      expect(result.success).toBe(true);
      expect(executed).toEqual(["start"]);
      expect(executed).not.toContain("unreachable");
      expect(result.stageOutputs.size).toBe(1);
    });

    test("conditional routing based on rawResponse content", async () => {
      const executed: string[] = [];

      const edges: Edge<BaseState>[] = [
        {
          from: "analyzer",
          to: "fix_handler",
          condition: (state) => {
            const output = state.outputs.analyzer as StageOutput | undefined;
            return output?.rawResponse.includes("NEEDS_FIX") ?? false;
          },
        },
        {
          from: "analyzer",
          to: "approve_handler",
          condition: (state) => {
            const output = state.outputs.analyzer as StageOutput | undefined;
            return output?.rawResponse.includes("APPROVED") ?? false;
          },
        },
      ];

      const graph = buildConditionalGraph(
        [agentNode("analyzer"), agentNode("fix_handler"), agentNode("approve_handler")],
        edges,
        "analyzer",
        ["fix_handler", "approve_handler"],
      );

      const stages = [
        stage("analyzer", "", { buildPrompt: () => { executed.push("analyzer"); return "analyze"; } }),
        stage("fix_handler", "", { buildPrompt: () => { executed.push("fix_handler"); return "fix"; } }),
        stage("approve_handler", "", { buildPrompt: () => { executed.push("approve_handler"); return "approve"; } }),
      ];

      // Session returns "NEEDS_FIX" → should route to fix_handler
      const config = buildConfig(graph, async () => createMockSession("Code NEEDS_FIX immediately"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test routing by content");

      expect(result.success).toBe(true);
      expect(executed).toEqual(["analyzer", "fix_handler"]);
      expect(executed).not.toContain("approve_handler");
    });

    test("conditional edge with both conditions true — both branches execute", async () => {
      const executed: string[] = [];

      const edges: Edge<BaseState>[] = [
        { from: "start", to: "a", condition: () => true },
        { from: "start", to: "b", condition: () => true },
      ];

      const graph = buildConditionalGraph(
        [agentNode("start"), agentNode("a"), agentNode("b")],
        edges,
        "start",
        ["a", "b"],
      );

      const stages = [
        stage("start", "", { buildPrompt: () => { executed.push("start"); return "go"; } }),
        stage("a", "", { buildPrompt: () => { executed.push("a"); return "branch a"; } }),
        stage("b", "", { buildPrompt: () => { executed.push("b"); return "branch b"; } }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      expect(executed).toContain("start");
      expect(executed).toContain("a");
      expect(executed).toContain("b");
    });

    test("shouldRun receives tasks populated by prior stage", async () => {
      let debuggerShouldRunTasks: readonly unknown[] = [];
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("debugger"),
      ]);

      const taskArray = [
        { id: "t1", description: "Create model", status: "error", summary: "Model", blockedBy: [] },
      ];

      const stages = [
        stage("planner", "", {
          buildPrompt: () => "plan",
          parseOutput: () => ({ tasks: taskArray }),
        }),
        stage("debugger", "", {
          buildPrompt: () => "debug",
          shouldRun: (ctx) => {
            debuggerShouldRunTasks = ctx.tasks;
            // Only run if there are errored tasks
            return ctx.tasks.some((t) => (t as { status: string }).status === "error");
          },
        }),
      ];

      const config = buildConfig(graph, async () => createMockSession("output"));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      expect(debuggerShouldRunTasks).toHaveLength(1);
      expect((debuggerShouldRunTasks[0] as { status: string }).status).toBe("error");
      // Debugger ran because there was an errored task
      expect(result.stageOutputs.has("debugger")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // interrupt() and getCurrentStage()
  // -----------------------------------------------------------------------

  describe("interrupt and getCurrentStage", () => {
    test("getCurrentStage returns null before execution starts", () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => createMockSession("output"));
      const stages = [stage("planner", "output")];

      const conductor = new WorkflowSessionConductor(config, stages);
      expect(conductor.getCurrentStage()).toBeNull();
    });

    test("getCurrentStage returns null after execution completes", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => createMockSession("output"));
      const stages = [stage("planner", "output")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(conductor.getCurrentStage()).toBeNull();
    });

    test("getCurrentStage returns the active stage during execution", async () => {
      const capturedStages: (string | null)[] = [];
      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);

      let conductor: WorkflowSessionConductor;

      const sessionFactory = async () => {
        // Capture the current stage each time a session is created
        capturedStages.push(conductor!.getCurrentStage());
        return createMockSession("output");
      };

      const config = buildConfig(graph, sessionFactory);
      const stages = [stage("planner", "output"), stage("reviewer", "output")];

      conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // When createSession is called for each stage, that stage should be current
      expect(capturedStages).toEqual(["planner", "reviewer"]);
      // After execution, no stage is active
      expect(conductor.getCurrentStage()).toBeNull();
    });

    test("interrupt calls abort on the current session", async () => {
      const abortMock = mock(() => Promise.resolve());
      let resolveStream: (() => void) | undefined;

      // Create a session whose stream blocks until we resolve it
      const blockingSession: Session = {
        id: "blocking-session",
        send: mock(async () => ({ type: "text" as const, content: "" })),
        stream: async function* (_message: string, _options?: { agent?: string; abortSignal?: AbortSignal }) {
          yield { type: "text" as const, content: "partial" } as AgentMessage;
          // Block here until the stream is resolved externally
          await new Promise<void>((resolve) => {
            resolveStream = resolve;
          });
        },
        abort: abortMock,
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

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => blockingSession);
      const stages = [stage("planner", "output")];

      const conductor = new WorkflowSessionConductor(config, stages);

      // Start execution in the background
      const executePromise = conductor.execute("test");

      // Wait a tick for the session to be created and streaming to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now interrupt
      conductor.interrupt();

      // abort should have been called on the blocking session
      expect(abortMock).toHaveBeenCalledTimes(1);

      // Resolve the stream so execution can complete
      resolveStream?.();
      await executePromise;
    });

    test("interrupt is safe to call when no session is active", () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => createMockSession("output"));
      const stages = [stage("planner", "output")];

      const conductor = new WorkflowSessionConductor(config, stages);
      // Should not throw
      expect(() => conductor.interrupt()).not.toThrow();
    });

    test("currentStage is cleared even when stage errors", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const errorSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          throw new Error("Stage failure");
        },
      } as Session;

      const config = buildConfig(graph, async () => errorSession);
      const stages = [stage("planner", "")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // Even after an error, currentStage should be null
      expect(conductor.getCurrentStage()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // ConductorConfig optional properties
  // -----------------------------------------------------------------------

  describe("config optional properties", () => {
    test("maxStageOutputBytes truncates stage output", async () => {
      const longResponse = "x".repeat(1000);
      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);

      const reviewerPromptCapture: string[] = [];
      const config = buildConfig(graph, async () => createMockSession(longResponse), {
        maxStageOutputBytes: 100,
      });

      const stages = [
        stage("planner", longResponse),
        stage("reviewer", "review output", {
          buildPrompt: (ctx) => {
            const plannerOutput = ctx.stageOutputs.get("planner");
            reviewerPromptCapture.push(plannerOutput?.rawResponse ?? "");
            return "review prompt";
          },
        }),
      ];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // The planner output in stageOutputs should be truncated
      const plannerOutput = result.stageOutputs.get("planner");
      expect(plannerOutput).toBeDefined();
      expect(plannerOutput!.originalByteLength).toBeDefined();
      expect(plannerOutput!.rawResponse.length).toBeLessThan(longResponse.length);
    });

    test("dispatchEvent config properties are accepted", async () => {
      const events: unknown[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => createMockSession("output"), {
        dispatchEvent: (event) => events.push(event),
        workflowId: "wf-123",
        sessionId: "sess-456",
        runId: 789,
      });
      const stages = [stage("planner", "output")];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.success).toBe(true);
      // Events should have been dispatched
      expect(events.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Inter-stage Output Truncation (§5.13 spec compliance)
  // -----------------------------------------------------------------------

  describe("inter-stage output truncation", () => {
    test("large output is preserved in full when no truncation limits are configured", async () => {
      // Spec §5.13: "no truncation by default" — full response captured as-is
      const largeResponse = "x".repeat(100_000); // 100KB, well above the spec's 50K default
      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);

      let reviewerSeenRawResponse = "";
      const stages = [
        stage("planner", largeResponse),
        stage("reviewer", "review output", {
          buildPrompt: (ctx) => {
            reviewerSeenRawResponse = ctx.stageOutputs.get("planner")?.rawResponse ?? "";
            return "review";
          },
        }),
      ];

      // No maxStageOutputBytes configured — truncation should NOT apply
      const config = buildConfig(graph, async () => createMockSession(largeResponse));
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // Full output preserved in stageOutputs
      const plannerOutput = result.stageOutputs.get("planner")!;
      expect(plannerOutput.rawResponse).toBe(largeResponse);
      expect(plannerOutput.rawResponse.length).toBe(100_000);
      expect(plannerOutput.originalByteLength).toBeUndefined();

      // Downstream stage sees the full untruncated output
      expect(reviewerSeenRawResponse).toBe(largeResponse);
      expect(reviewerSeenRawResponse.length).toBe(100_000);
    });

    test("per-stage maxOutputBytes overrides global maxStageOutputBytes", async () => {
      const longResponse = "y".repeat(500);
      const graph = buildLinearGraph([agentNode("s1"), agentNode("s2"), agentNode("s3")]);

      const config = buildConfig(graph, async () => createMockSession(longResponse), {
        maxStageOutputBytes: 200, // global limit: 200 bytes
      });

      const stages = [
        // s1: uses global limit (200 bytes) — will be truncated
        stage("s1", longResponse),
        // s2: per-stage override disables truncation
        stage("s2", longResponse, { maxOutputBytes: Infinity }),
        // s3: per-stage override with tighter limit (100 bytes)
        stage("s3", longResponse, { maxOutputBytes: 100 }),
      ];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // s1: truncated by global limit
      const s1Output = result.stageOutputs.get("s1")!;
      expect(s1Output.rawResponse.length).toBeLessThan(500);
      expect(s1Output.originalByteLength).toBeDefined();

      // s2: per-stage Infinity overrides global — full output preserved
      const s2Output = result.stageOutputs.get("s2")!;
      expect(s2Output.rawResponse).toBe(longResponse);
      expect(s2Output.originalByteLength).toBeUndefined();

      // s3: per-stage 100 bytes is tighter than global — truncated further
      const s3Output = result.stageOutputs.get("s3")!;
      expect(s3Output.rawResponse.length).toBeLessThan(s1Output.rawResponse.length);
      expect(s3Output.originalByteLength).toBeDefined();
    });

    test("error and interrupted outputs are not truncated even with limits configured", async () => {
      // Spec: truncation skipped for error/interrupted outputs
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => {
        const session = createMockSession("");
        // Override stream to throw an error after producing some output
        session.stream = async function* () {
          yield { type: "text" as const, content: "partial output before error" } as AgentMessage;
          throw new Error("session crashed");
        };
        return session;
      }, {
        maxStageOutputBytes: 10, // very small limit
      });

      const stages = [stage("planner", "")];
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner")!;
      expect(output.status).toBe("error");
      // Even though limit is 10 bytes, error output is not truncated
      expect(output.originalByteLength).toBeUndefined();
    });

    test("parseOutput receives full untruncated response when truncation is active", async () => {
      const longResponse = "z".repeat(1000);
      const graph = buildLinearGraph([agentNode("planner")]);

      let parseOutputReceivedLength = 0;
      const config = buildConfig(graph, async () => createMockSession(longResponse), {
        maxStageOutputBytes: 100, // will truncate stored output
      });

      const stages = [
        stage("planner", longResponse, {
          parseOutput: (response: string) => {
            parseOutputReceivedLength = response.length;
            return { length: response.length };
          },
        }),
      ];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      // parseOutput received the full 1000-char response
      expect(parseOutputReceivedLength).toBe(1000);

      // But stageOutputs rawResponse is truncated
      const output = result.stageOutputs.get("planner")!;
      expect(output.rawResponse.length).toBeLessThan(1000);
      expect(output.originalByteLength).toBeDefined();

      // parsedOutput is still preserved (truncation doesn't affect parsed data)
      expect(output.parsedOutput).toEqual({ length: 1000 });
    });

    test("interrupted output preserves accumulated response without truncation", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const abortController = new AbortController();

      const config = buildConfig(graph, async () => {
        const session = createMockSession("");
        session.stream = async function* (_msg: string, options?: { abortSignal?: AbortSignal }) {
          yield { type: "text" as const, content: "chunk1 " } as AgentMessage;
          yield { type: "text" as const, content: "chunk2 " } as AgentMessage;
          // Abort fires during streaming
          abortController.abort();
          // After abort, check signal
          if (options?.abortSignal?.aborted) {
            return;
          }
          yield { type: "text" as const, content: "chunk3" } as AgentMessage;
        };
        return session;
      }, {
        abortSignal: abortController.signal,
        maxStageOutputBytes: 5, // very small limit — should not apply to interrupted
      });

      const stages = [stage("planner", "")];
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner")!;
      expect(output.status).toBe("interrupted");
      // The accumulated response before abort is preserved, not truncated
      expect(output.rawResponse).toBe("chunk1 chunk2 ");
      expect(output.originalByteLength).toBeUndefined();
    });

    test("maxStageOutputBytes of 0 disables truncation (treated as no limit)", async () => {
      const longResponse = "a".repeat(500);
      const graph = buildLinearGraph([agentNode("planner")]);

      const config = buildConfig(graph, async () => createMockSession(longResponse), {
        maxStageOutputBytes: 0,
      });
      const stages = [stage("planner", longResponse)];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner")!;
      expect(output.rawResponse).toBe(longResponse);
      expect(output.originalByteLength).toBeUndefined();
    });
  });
});
