import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createRalphWorkflow } from "./ralph.ts";
import { createExecutor, createRalphState, setClientProvider } from "../index.ts";
import { setSubagentBridge } from "../subagent-bridge.ts";

describe("createRalphWorkflow", () => {
  test("builds graph with expected phase nodes", () => {
    const compiled = createRalphWorkflow({ agentType: "claude" });
    const nodeIds = Array.from(compiled.nodes.keys());

    expect(nodeIds).toContain("initSession");
    expect(nodeIds).toContain("taskDecomposition");
    expect(nodeIds).toContain("implementationLoop");
    expect(nodeIds).toContain("clearBeforeReview");
    expect(nodeIds).toContain("review");
    expect(nodeIds).toContain("complete");
  });

  test("runs DAG orchestration in dependency waves", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "ralph-workflow-test-"));
    const spawnedWaves: string[][] = [];

    setClientProvider(() => ({
      createSession: async () => ({
        id: "session-1",
        send: async () => ({ type: "text", content: "" }),
        stream: async function* () {
          yield {
            type: "text",
            content: JSON.stringify([
              {
                id: "#1",
                content: "Root",
                status: "pending",
                activeForm: "Working root",
                blockedBy: [],
              },
              {
                id: "#2",
                content: "Child A",
                status: "pending",
                activeForm: "Working child A",
                blockedBy: ["#1"],
              },
              {
                id: "#3",
                content: "Child B",
                status: "pending",
                activeForm: "Working child B",
                blockedBy: ["#1"],
              },
            ]),
          };
        },
        summarize: async () => {},
        getContextUsage: async () => ({
          inputTokens: 0,
          outputTokens: 0,
          maxTokens: 200000,
          usagePercentage: 0,
        }),
        getSystemToolsTokens: () => 0,
        destroy: async () => {},
      }),
    }) as unknown as import("../../sdk/types.ts").CodingAgentClient);

    setSubagentBridge({
      spawn: async () => ({
        agentId: "review-1",
        success: true,
        output: JSON.stringify({
          findings: [],
          overall_correctness: "patch is correct",
          overall_explanation: "No findings",
          overall_confidence_score: 0.95,
        }),
        toolUses: 0,
        durationMs: 1,
      }),
      spawnParallel: async (
        agents: Array<{ agentId: string }>,
      ) => {
        spawnedWaves.push(agents.map((agent) => agent.agentId));
        return agents.map((agent) => ({
          agentId: agent.agentId,
          success: true,
          output: "ok",
          toolUses: 0,
          durationMs: 1,
        }));
      },
    } as unknown as import("../subagent-bridge.ts").SubagentGraphBridge);

    const compiled = createRalphWorkflow({ agentType: "claude" });
    const executor = createExecutor(compiled);

    const result = await executor.execute({
      initialState: createRalphState("exec-1", {
        ralphSessionId: "session-1",
        ralphSessionDir: sessionDir,
        userPrompt: "Implement in waves",
        yoloPrompt: "Implement in waves",
      }),
      workflowName: "ralph",
    });

    expect(result.status).toBe("completed");
    expect(spawnedWaves.length).toBeGreaterThanOrEqual(2);
    expect(spawnedWaves[0]).toEqual(["worker-#1"]);
    expect(spawnedWaves[1]).toEqual(["worker-#2", "worker-#3"]);

    setSubagentBridge(null);
    setClientProvider(() => null);
    await rm(sessionDir, { recursive: true, force: true });
  });

  test("re-enters decomposition when review finds actionable issues", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "ralph-workflow-fix-cycle-"));
    const decompositionPrompts: string[] = [];
    let reviewCallCount = 0;

    setClientProvider(() => ({
      createSession: async () => ({
        id: `session-${crypto.randomUUID()}`,
        send: async () => ({ type: "text", content: "" }),
        stream: async function* (message: string) {
          decompositionPrompts.push(message);
          yield {
            type: "text",
            content: JSON.stringify([
              {
                id: "#1",
                content: "Apply fixes",
                status: "pending",
                activeForm: "Applying fixes",
                blockedBy: [],
              },
            ]),
          };
        },
        summarize: async () => {},
        getContextUsage: async () => ({
          inputTokens: 0,
          outputTokens: 0,
          maxTokens: 200000,
          usagePercentage: 0,
        }),
        getSystemToolsTokens: () => 0,
        destroy: async () => {},
      }),
    }) as unknown as import("../../sdk/types.ts").CodingAgentClient);

    setSubagentBridge({
      spawn: async () => {
        reviewCallCount += 1;
        if (reviewCallCount === 1) {
          return {
            agentId: "review-1",
            success: true,
            output: JSON.stringify({
              findings: [
                {
                  title: "[P1] Fix a correctness issue",
                  body: "Apply a required correction.",
                  priority: 1,
                  confidence_score: 0.9,
                  code_location: {
                    absolute_file_path: "/tmp/file.ts",
                    line_range: { start: 1, end: 2 },
                  },
                },
              ],
              overall_correctness: "patch is incorrect",
              overall_explanation: "A correctness fix is required.",
              overall_confidence_score: 0.9,
            }),
            toolUses: 0,
            durationMs: 1,
          };
        }

        return {
          agentId: "review-2",
          success: true,
          output: JSON.stringify({
            findings: [],
            overall_correctness: "patch is correct",
            overall_explanation: "No remaining issues.",
            overall_confidence_score: 0.95,
          }),
          toolUses: 0,
          durationMs: 1,
        };
      },
      spawnParallel: async (agents: Array<{ agentId: string }>) =>
        agents.map((agent) => ({
          agentId: agent.agentId,
          success: true,
          output: "ok",
          toolUses: 0,
          durationMs: 1,
        })),
    } as unknown as import("../subagent-bridge.ts").SubagentGraphBridge);

    const compiled = createRalphWorkflow({ agentType: "claude" });
    const executor = createExecutor(compiled);

    const result = await executor.execute({
      initialState: createRalphState("exec-fix-cycle", {
        ralphSessionId: "session-fix-cycle",
        ralphSessionDir: sessionDir,
        userPrompt: "Implement the feature",
        yoloPrompt: "Implement the feature",
      }),
      workflowName: "ralph",
    });

    expect(result.status).toBe("completed");
    expect(reviewCallCount).toBe(2);
    expect(decompositionPrompts.length).toBe(2);
    expect(decompositionPrompts[1]).toContain("Review Fix Specification");

    setSubagentBridge(null);
    setClientProvider(() => null);
    await rm(sessionDir, { recursive: true, force: true });
  });

  test("retries decomposition when first parse yields no tasks", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "ralph-workflow-empty-decomp-"));
    let decompositionCalls = 0;

    setClientProvider(() => ({
      createSession: async () => ({
        id: `session-${crypto.randomUUID()}`,
        send: async () => ({ type: "text", content: "" }),
        stream: async function* () {
          decompositionCalls += 1;
          if (decompositionCalls === 1) {
            yield { type: "text", content: "[]" };
            return;
          }

          yield {
            type: "text",
            content: JSON.stringify([
              {
                id: "#1",
                content: "Recovered task",
                status: "pending",
                activeForm: "Recovering task",
                blockedBy: [],
              },
            ]),
          };
        },
        summarize: async () => {},
        getContextUsage: async () => ({
          inputTokens: 0,
          outputTokens: 0,
          maxTokens: 200000,
          usagePercentage: 0,
        }),
        getSystemToolsTokens: () => 0,
        destroy: async () => {},
      }),
    }) as unknown as import("../../sdk/types.ts").CodingAgentClient);

    setSubagentBridge({
      spawn: async () => ({
        agentId: "review-1",
        success: true,
        output: JSON.stringify({
          findings: [],
          overall_correctness: "patch is correct",
          overall_explanation: "No findings",
          overall_confidence_score: 0.95,
        }),
        toolUses: 0,
        durationMs: 1,
      }),
      spawnParallel: async (agents: Array<{ agentId: string }>) =>
        agents.map((agent) => ({
          agentId: agent.agentId,
          success: true,
          output: "ok",
          toolUses: 0,
          durationMs: 1,
        })),
    } as unknown as import("../subagent-bridge.ts").SubagentGraphBridge);

    const compiled = createRalphWorkflow({ agentType: "claude" });
    const executor = createExecutor(compiled);
    const result = await executor.execute({
      initialState: createRalphState("exec-empty-retry", {
        ralphSessionId: "session-empty-retry",
        ralphSessionDir: sessionDir,
        userPrompt: "Retry decomposition",
        yoloPrompt: "Retry decomposition",
      }),
      workflowName: "ralph",
    });

    expect(result.status).toBe("completed");
    expect(decompositionCalls).toBe(2);

    setSubagentBridge(null);
    setClientProvider(() => null);
    await rm(sessionDir, { recursive: true, force: true });
  });

  test("fails when decomposition remains empty past retry limit", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "ralph-workflow-empty-fail-"));
    let decompositionCalls = 0;

    setClientProvider(() => ({
      createSession: async () => ({
        id: `session-${crypto.randomUUID()}`,
        send: async () => ({ type: "text", content: "" }),
        stream: async function* () {
          decompositionCalls += 1;
          yield { type: "text", content: "[]" };
        },
        summarize: async () => {},
        getContextUsage: async () => ({
          inputTokens: 0,
          outputTokens: 0,
          maxTokens: 200000,
          usagePercentage: 0,
        }),
        getSystemToolsTokens: () => 0,
        destroy: async () => {},
      }),
    }) as unknown as import("../../sdk/types.ts").CodingAgentClient);

    setSubagentBridge({
      spawn: async () => ({
        agentId: "review-1",
        success: true,
        output: "",
        toolUses: 0,
        durationMs: 1,
      }),
      spawnParallel: async () => [],
    } as unknown as import("../subagent-bridge.ts").SubagentGraphBridge);

    const compiled = createRalphWorkflow({ agentType: "claude" });
    const executor = createExecutor(compiled);
    const result = await executor.execute({
      initialState: createRalphState("exec-empty-fail", {
        ralphSessionId: "session-empty-fail",
        ralphSessionDir: sessionDir,
        userPrompt: "Always empty decomposition",
        yoloPrompt: "Always empty decomposition",
      }),
      workflowName: "ralph",
    });

    expect(result.status).toBe("failed");
    expect(decompositionCalls).toBe(3);

    setSubagentBridge(null);
    setClientProvider(() => null);
    await rm(sessionDir, { recursive: true, force: true });
  });
});
