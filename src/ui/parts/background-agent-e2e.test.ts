/**
 * E2E tests for background agent icon and persistence
 *
 * These tests verify that background agents are properly represented in the parts
 * model — they have the correct status, persist after tool.complete, and can be
 * identified for icon rendering.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { shouldFinalizeOnToolComplete } from "./guards.ts";
import { upsertPart } from "./store.ts";
import { createPartId, _resetPartCounter } from "./id.ts";
import type { Part, AgentPart } from "./types.ts";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

/**
 * Helper function to create a test agent with default values.
 */
function createAgent(overrides: Partial<ParallelAgent> = {}): ParallelAgent {
  return {
    id: "agent-1",
    name: "test-agent",
    task: "Test task",
    status: "running",
    startedAt: new Date().toISOString(),
    background: false,
    ...overrides,
  };
}

/**
 * Helper function to create an AgentPart.
 */
function createAgentPart(agents: ParallelAgent[], parentToolPartId?: string): AgentPart {
  return {
    id: createPartId(),
    type: "agent",
    agents,
    parentToolPartId,
    createdAt: new Date().toISOString(),
  };
}

describe("Background agent icon and persistence E2E", () => {
  beforeEach(() => {
    _resetPartCounter();
  });

  test("Background agent has background status in AgentPart", () => {
    // Create a background agent
    const backgroundAgent = createAgent({
      id: "bg-agent-1",
      name: "codebase-analyzer",
      background: true,
      status: "running",
    });

    // Create an AgentPart containing the background agent
    const agentPart = createAgentPart([backgroundAgent]);

    // Verify the agent has the background flag set
    expect(agentPart.agents).toHaveLength(1);
    expect(agentPart.agents[0]?.background).toBe(true);
    expect(agentPart.agents[0]?.status).toBe("running");
  });

  test("Background agent persists after tool.complete", () => {
    // Create a background agent
    const backgroundAgent = createAgent({
      id: "bg-agent-1",
      background: true,
      status: "running",
    });

    // Simulate tool.complete event - verify shouldFinalizeOnToolComplete returns false
    const shouldFinalize = shouldFinalizeOnToolComplete(backgroundAgent);

    // Background agent should NOT be finalized on tool.complete
    expect(shouldFinalize).toBe(false);
  });

  test("Foreground agent is removed/finalized after tool.complete", () => {
    // Create a foreground agent
    const foregroundAgent = createAgent({
      id: "fg-agent-1",
      background: false,
      status: "running",
    });

    // Simulate tool.complete event - verify shouldFinalizeOnToolComplete returns true
    const shouldFinalize = shouldFinalizeOnToolComplete(foregroundAgent);

    // Foreground agent SHOULD be finalized on tool.complete
    expect(shouldFinalize).toBe(true);
  });

  test("Background agent icon distinguishable from foreground", () => {
    // Create both background and foreground agents
    const backgroundAgent = createAgent({
      id: "bg-agent-1",
      name: "background-worker",
      background: true,
      status: "running",
    });

    const foregroundAgent = createAgent({
      id: "fg-agent-1",
      name: "foreground-worker",
      background: false,
      status: "running",
    });

    // Create AgentParts
    const bgPart = createAgentPart([backgroundAgent]);
    const fgPart = createAgentPart([foregroundAgent]);

    // Verify AgentPart.agent.background field enables UI to render different icons
    expect(bgPart.agents[0]?.background).toBe(true);
    expect(fgPart.agents[0]?.background).toBe(false);

    // UI can distinguish based on this field for icon rendering
    const bgIconType = bgPart.agents[0]?.background ? "background-icon" : "foreground-icon";
    const fgIconType = fgPart.agents[0]?.background ? "background-icon" : "foreground-icon";

    expect(bgIconType).toBe("background-icon");
    expect(fgIconType).toBe("foreground-icon");
  });

  test("Background agent completion", () => {
    // Create a background agent
    const backgroundAgent = createAgent({
      id: "bg-agent-1",
      background: true,
      status: "running",
    });

    // Create AgentPart
    let parts: Part[] = [];
    const agentPart = createAgentPart([backgroundAgent]);
    parts = upsertPart(parts, agentPart);

    // Verify initial state
    expect(parts).toHaveLength(1);
    expect((parts[0] as AgentPart).agents[0]?.status).toBe("running");
    expect((parts[0] as AgentPart).agents[0]?.background).toBe(true);

    // Simulate background agent completion
    const completedAgent: ParallelAgent = {
      ...backgroundAgent,
      status: "completed",
      durationMs: 5000,
      result: "Task completed successfully",
    };

    const updatedAgentPart: AgentPart = {
      ...agentPart,
      agents: [completedAgent],
    };

    parts = upsertPart(parts, updatedAgentPart);

    // Verify status transition
    expect(parts).toHaveLength(1);
    expect((parts[0] as AgentPart).agents[0]?.status).toBe("completed");
    expect((parts[0] as AgentPart).agents[0]?.background).toBe(true);
    expect((parts[0] as AgentPart).agents[0]?.durationMs).toBe(5000);
    expect((parts[0] as AgentPart).agents[0]?.result).toBe("Task completed successfully");

    // Even completed background agents should not be finalized on tool.complete
    expect(shouldFinalizeOnToolComplete(completedAgent)).toBe(false);
  });

  test("Mixed foreground/background agents in same message", () => {
    // Create multiple agents with different background flags
    const backgroundAgent1 = createAgent({
      id: "bg-agent-1",
      name: "background-worker-1",
      background: true,
      status: "running",
    });

    const foregroundAgent1 = createAgent({
      id: "fg-agent-1",
      name: "foreground-worker-1",
      background: false,
      status: "running",
    });

    const backgroundAgent2 = createAgent({
      id: "bg-agent-2",
      name: "background-worker-2",
      background: true,
      status: "running",
    });

    const foregroundAgent2 = createAgent({
      id: "fg-agent-2",
      name: "foreground-worker-2",
      background: false,
      status: "completed",
      durationMs: 3000,
    });

    // Create AgentPart containing all agents
    const agentPart = createAgentPart([
      backgroundAgent1,
      foregroundAgent1,
      backgroundAgent2,
      foregroundAgent2,
    ]);

    // Verify each agent has correct flags
    expect(agentPart.agents).toHaveLength(4);
    
    // Background agent 1
    expect(agentPart.agents[0]?.background).toBe(true);
    expect(agentPart.agents[0]?.status).toBe("running");
    expect(shouldFinalizeOnToolComplete(agentPart.agents[0]!)).toBe(false);

    // Foreground agent 1
    expect(agentPart.agents[1]?.background).toBe(false);
    expect(agentPart.agents[1]?.status).toBe("running");
    expect(shouldFinalizeOnToolComplete(agentPart.agents[1]!)).toBe(true);

    // Background agent 2
    expect(agentPart.agents[2]?.background).toBe(true);
    expect(agentPart.agents[2]?.status).toBe("running");
    expect(shouldFinalizeOnToolComplete(agentPart.agents[2]!)).toBe(false);

    // Foreground agent 2 (completed)
    expect(agentPart.agents[3]?.background).toBe(false);
    expect(agentPart.agents[3]?.status).toBe("completed");
    expect(shouldFinalizeOnToolComplete(agentPart.agents[3]!)).toBe(true);
  });

  test("Agent with 'background' status persists (legacy flag)", () => {
    // Test the legacy "background" status (in addition to background flag)
    const agentWithBackgroundStatus = createAgent({
      id: "agent-1",
      background: false, // flag is false
      status: "background", // but status is "background"
    });

    // Should still not be finalized due to status
    expect(shouldFinalizeOnToolComplete(agentWithBackgroundStatus)).toBe(false);
  });

  test("Background agent with error status persists", () => {
    // Create a background agent that encountered an error
    const backgroundAgentWithError = createAgent({
      id: "bg-agent-1",
      background: true,
      status: "error",
      error: "Something went wrong",
    });

    // Even with error status, background agents should not be finalized on tool.complete
    expect(shouldFinalizeOnToolComplete(backgroundAgentWithError)).toBe(false);

    // Create AgentPart to verify error state is preserved
    const agentPart = createAgentPart([backgroundAgentWithError]);
    expect(agentPart.agents[0]?.status).toBe("error");
    expect(agentPart.agents[0]?.error).toBe("Something went wrong");
    expect(agentPart.agents[0]?.background).toBe(true);
  });

  test("Background agent lifecycle: pending → running → completed", () => {
    // Test the full lifecycle of a background agent
    const agentId = "bg-lifecycle-1";
    let parts: Part[] = [];

    // 1. Create pending background agent
    const pendingAgent = createAgent({
      id: agentId,
      background: true,
      status: "pending",
    });
    let agentPart = createAgentPart([pendingAgent]);
    parts = upsertPart(parts, agentPart);

    expect((parts[0] as AgentPart).agents[0]?.status).toBe("pending");
    expect(shouldFinalizeOnToolComplete(pendingAgent)).toBe(false);

    // 2. Transition to running
    const runningAgent: ParallelAgent = {
      ...pendingAgent,
      status: "running",
    };
    agentPart = { ...agentPart, agents: [runningAgent] };
    parts = upsertPart(parts, agentPart);

    expect((parts[0] as AgentPart).agents[0]?.status).toBe("running");
    expect(shouldFinalizeOnToolComplete(runningAgent)).toBe(false);

    // 3. Transition to completed
    const completedAgent: ParallelAgent = {
      ...runningAgent,
      status: "completed",
      durationMs: 10000,
      result: "Background task finished",
    };
    agentPart = { ...agentPart, agents: [completedAgent] };
    parts = upsertPart(parts, agentPart);

    expect((parts[0] as AgentPart).agents[0]?.status).toBe("completed");
    expect((parts[0] as AgentPart).agents[0]?.durationMs).toBe(10000);
    expect(shouldFinalizeOnToolComplete(completedAgent)).toBe(false);
  });

  test("Multiple AgentParts with different background flags", () => {
    // Test scenario where multiple AgentParts exist in the same message
    let parts: Part[] = [];

    // Create first AgentPart with background agent
    const bgAgent1 = createAgent({
      id: "bg-1",
      name: "background-analyzer",
      background: true,
      status: "running",
    });
    const agentPart1 = createAgentPart([bgAgent1]);
    parts = upsertPart(parts, agentPart1);

    // Create second AgentPart with foreground agent
    const fgAgent1 = createAgent({
      id: "fg-1",
      name: "foreground-executor",
      background: false,
      status: "running",
    });
    const agentPart2 = createAgentPart([fgAgent1]);
    parts = upsertPart(parts, agentPart2);

    // Create third AgentPart with mixed agents
    const bgAgent2 = createAgent({
      id: "bg-2",
      name: "background-watcher",
      background: true,
      status: "running",
    });
    const fgAgent2 = createAgent({
      id: "fg-2",
      name: "foreground-reporter",
      background: false,
      status: "completed",
      durationMs: 2000,
    });
    const agentPart3 = createAgentPart([bgAgent2, fgAgent2]);
    parts = upsertPart(parts, agentPart3);

    // Verify all parts are present
    expect(parts).toHaveLength(3);

    // Verify first AgentPart (background only)
    const part1 = parts[0] as AgentPart;
    expect(part1.agents).toHaveLength(1);
    expect(part1.agents[0]?.background).toBe(true);
    expect(shouldFinalizeOnToolComplete(part1.agents[0]!)).toBe(false);

    // Verify second AgentPart (foreground only)
    const part2 = parts[1] as AgentPart;
    expect(part2.agents).toHaveLength(1);
    expect(part2.agents[0]?.background).toBe(false);
    expect(shouldFinalizeOnToolComplete(part2.agents[0]!)).toBe(true);

    // Verify third AgentPart (mixed)
    const part3 = parts[2] as AgentPart;
    expect(part3.agents).toHaveLength(2);
    expect(part3.agents[0]?.background).toBe(true);
    expect(part3.agents[1]?.background).toBe(false);
    expect(shouldFinalizeOnToolComplete(part3.agents[0]!)).toBe(false);
    expect(shouldFinalizeOnToolComplete(part3.agents[1]!)).toBe(true);
  });
});
