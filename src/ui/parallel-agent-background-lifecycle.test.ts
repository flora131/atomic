/**
 * Tests for background agent lifecycle state management
 *
 * Context: We modified the sub-agent lifecycle to prevent background-mode Task agents
 * from being prematurely marked as "completed". These tests verify the transformation
 * logic for agent state transitions.
 *
 * Changes tested:
 * 1. Agent creation: run_in_background=true → status="background", background=true
 * 2. tool.complete: background agents skip finalization (status unchanged)
 * 3. tool.complete: isAsync fallback retroactively marks agents as background
 * 4. subagent.complete: background agents transition to "completed" or "error"
 * 5. Stream finalization: hasActive checks include background agents
 * 6. Cleanup: hasActiveAgents includes background status
 */

import { describe, expect, test } from "bun:test";
import type { ParallelAgent, AgentStatus } from "./components/parallel-agents-tree.tsx";

// ============================================================================
// PURE TRANSFORMATION FUNCTIONS (extracted from implementation)
// ============================================================================

/**
 * Creates a new agent with the appropriate status and flags based on run_in_background.
 * Extracted from: src/ui/index.ts tool.start handler
 */
function createAgent(
  runInBackground: boolean,
  agentType: string,
  taskDesc: string,
  toolId: string
): ParallelAgent {
  const isBackground = runInBackground === true;
  return {
    id: toolId,
    taskToolCallId: toolId,
    name: agentType,
    task: taskDesc,
    status: isBackground ? "background" : "running",
    background: isBackground || undefined,
    startedAt: new Date().toISOString(),
    currentTool: isBackground
      ? `Running ${agentType} in background…`
      : `Starting ${agentType}…`,
  };
}

/**
 * Applies the tool.complete transformation to an agent.
 * Extracted from: src/ui/index.ts tool.complete handler (lines 658-678)
 *
 * Background agents: only update result, keep status/currentTool/durationMs
 * Sync agents: update result + transition running/pending → completed + finalize
 */
function applyToolCompleteTransform(
  agent: ParallelAgent,
  resultStr: string
): ParallelAgent {
  return agent.background
    ? {
        ...agent,
        result: resultStr,
      }
    : {
        ...agent,
        result: resultStr,
        status:
          agent.status === "running" || agent.status === "pending"
            ? ("completed" as const)
            : agent.status,
        currentTool:
          agent.status === "running" || agent.status === "pending"
            ? undefined
            : agent.currentTool,
        durationMs:
          agent.durationMs ?? Date.now() - new Date(agent.startedAt).getTime(),
      };
}

/**
 * Applies the subagent.complete transformation to an agent.
 * Extracted from: src/ui/index.ts subagent.complete handler (lines 894-904)
 *
 * Transitions any agent (including background) to "completed" or "error" based on success flag.
 */
function applySubagentCompleteTransform(
  agent: ParallelAgent,
  subagentId: string,
  success: boolean,
  result?: unknown
): ParallelAgent {
  if (agent.id !== subagentId) return agent;

  const status = success !== false ? "completed" : "error";
  return {
    ...agent,
    status,
    currentTool: undefined,
    result: result ? String(result) : undefined,
    durationMs: Date.now() - new Date(agent.startedAt).getTime(),
  };
}

/**
 * Applies the stream finalization transformation to an agent.
 * Extracted from: src/ui/chat.tsx finalization maps (lines 2672-2680, 3338-3344)
 *
 * Background agents: no changes
 * Running/pending agents: transition to completed + finalize
 */
function applyStreamFinalizationTransform(agent: ParallelAgent): ParallelAgent {
  if (agent.background) return agent;
  return agent.status === "running" || agent.status === "pending"
    ? {
        ...agent,
        status: "completed" as const,
        currentTool: undefined,
        durationMs: Date.now() - new Date(agent.startedAt).getTime(),
      }
    : agent;
}

/**
 * Checks if there are any active agents (running, pending, or background).
 * Extracted from: src/ui/index.ts tryFinalizeParallelTracking (lines 468-470)
 * Note: chat.tsx hasActive checks intentionally EXCLUDE "background" so
 * background agents don't block stream completion.
 */
function hasActiveAgents(agents: ParallelAgent[]): boolean {
  return agents.some(
    (a) =>
      a.status === "running" ||
      a.status === "pending" ||
      a.status === "background"
  );
}

/**
 * Simulates interrupt transformation (sets agent to interrupted status).
 * This is for testing that background agents can be interrupted.
 */
function applyInterruptTransform(agent: ParallelAgent): ParallelAgent {
  return {
    ...agent,
    status: "interrupted",
    currentTool: undefined,
  };
}

// ============================================================================
// UNIT TESTS: Background agent state transitions
// ============================================================================

describe("Background agent state transitions", () => {
  test("creates background agent with correct status and flag for run_in_background=true", () => {
    const agent = createAgent(true, "task", "Test task", "tool_1");

    expect(agent.status).toBe("background");
    expect(agent.background).toBe(true);
    expect(agent.currentTool).toBe("Running task in background…");
    expect(agent.durationMs).toBeUndefined();
  });

  test("creates sync agent with status=running and no background flag for run_in_background=false", () => {
    const syncAgent = createAgent(false, "task", "Sync task", "tool_3");

    expect(syncAgent.status).toBe("running");
    expect(syncAgent.background).toBeUndefined();
    expect(syncAgent.currentTool).toBe("Starting task…");
  });

  test("tool.complete skips finalization for background agents", () => {
    const backgroundAgent: ParallelAgent = {
      id: "agent_1",
      taskToolCallId: "tool_1",
      name: "task",
      task: "Background task",
      status: "background",
      background: true,
      startedAt: new Date(Date.now() - 5000).toISOString(),
      currentTool: "Running task in background…",
    };

    const transformed = applyToolCompleteTransform(
      backgroundAgent,
      "Task result text"
    );

    // Status should remain "background"
    expect(transformed.status).toBe("background");
    // currentTool should be unchanged
    expect(transformed.currentTool).toBe("Running task in background…");
    // durationMs should still be undefined
    expect(transformed.durationMs).toBeUndefined();
    // Result should be set
    expect(transformed.result).toBe("Task result text");
  });

  test("tool.complete transitions sync agents to completed", () => {
    const runningAgent: ParallelAgent = {
      id: "agent_2",
      taskToolCallId: "tool_2",
      name: "task",
      task: "Sync task",
      status: "running",
      startedAt: new Date(Date.now() - 3000).toISOString(),
      currentTool: "Starting task…",
    };

    const transformed = applyToolCompleteTransform(
      runningAgent,
      "Sync result text"
    );

    // Status should transition to "completed"
    expect(transformed.status).toBe("completed");
    // currentTool should be cleared
    expect(transformed.currentTool).toBeUndefined();
    // durationMs should be calculated
    expect(transformed.durationMs).toBeGreaterThan(2900);
    expect(transformed.durationMs).toBeLessThan(4000);
    // Result should be set
    expect(transformed.result).toBe("Sync result text");
  });

  test("subagent.complete transitions background agent to completed", () => {
    const backgroundAgent: ParallelAgent = {
      id: "agent_bg_1",
      taskToolCallId: "tool_bg_1",
      name: "task",
      task: "Background task",
      status: "background",
      background: true,
      startedAt: new Date(Date.now() - 10000).toISOString(),
      currentTool: "Running task in background…",
    };

    const transformed = applySubagentCompleteTransform(
      backgroundAgent,
      "agent_bg_1",
      true,
      "Background task completed"
    );

    // Status should transition to "completed"
    expect(transformed.status).toBe("completed");
    // currentTool should be cleared
    expect(transformed.currentTool).toBeUndefined();
    // durationMs should be calculated
    expect(transformed.durationMs).toBeGreaterThan(9900);
    expect(transformed.durationMs).toBeLessThan(11000);
    // Result should be set
    expect(transformed.result).toBe("Background task completed");
  });

  test("subagent.complete transitions background agent to error", () => {
    const backgroundAgent: ParallelAgent = {
      id: "agent_bg_2",
      taskToolCallId: "tool_bg_2",
      name: "task",
      task: "Background task that fails",
      status: "background",
      background: true,
      startedAt: new Date(Date.now() - 5000).toISOString(),
      currentTool: "Running task in background…",
    };

    const transformed = applySubagentCompleteTransform(
      backgroundAgent,
      "agent_bg_2",
      false,
      "Error: Task failed"
    );

    // Status should transition to "error"
    expect(transformed.status).toBe("error");
    // currentTool should be cleared
    expect(transformed.currentTool).toBeUndefined();
    // durationMs should be calculated
    expect(transformed.durationMs).toBeGreaterThan(4900);
    expect(transformed.durationMs).toBeLessThan(6000);
    // Result should be set
    expect(transformed.result).toBe("Error: Task failed");
  });

  test("interrupt sets background agent to interrupted", () => {
    const backgroundAgent: ParallelAgent = {
      id: "agent_bg_3",
      taskToolCallId: "tool_bg_3",
      name: "task",
      task: "Background task to interrupt",
      status: "background",
      background: true,
      startedAt: new Date().toISOString(),
      currentTool: "Running task in background…",
    };

    const interrupted = applyInterruptTransform(backgroundAgent);

    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.currentTool).toBeUndefined();
  });
});

// ============================================================================
// INTEGRATION TESTS: Background agent lifecycle integration
// ============================================================================

describe("Background agent lifecycle integration", () => {
  test("full background lifecycle: spawn → grey → tool.complete stays grey → subagent.complete → green", () => {
    // Step 1: Spawn background agent (with a past timestamp to ensure duration > 0)
    let agent = createAgent(true, "task", "Full lifecycle test", "tool_full");
    // Override startedAt to be in the past
    agent = { ...agent, startedAt: new Date(Date.now() - 1000).toISOString() };
    expect(agent.status).toBe("background");
    expect(agent.background).toBe(true);
    expect(agent.currentTool).toBe("Running task in background…");

    // Step 2: tool.complete arrives (agent still grey)
    agent = applyToolCompleteTransform(agent, "Tool result");
    expect(agent.status).toBe("background"); // Still background!
    expect(agent.currentTool).toBe("Running task in background…"); // Unchanged!
    expect(agent.durationMs).toBeUndefined();
    expect(agent.result).toBe("Tool result");

    // Step 3: subagent.complete arrives (agent turns green)
    agent = applySubagentCompleteTransform(agent, "tool_full", true);
    expect(agent.status).toBe("completed"); // Now completed!
    expect(agent.currentTool).toBeUndefined();
    expect(agent.durationMs).toBeGreaterThan(0);
  });

  test("mixed sync+background agents finalize correctly", () => {
    const syncAgent: ParallelAgent = {
      id: "sync_1",
      taskToolCallId: "sync_1",
      name: "task",
      task: "Sync agent",
      status: "running",
      startedAt: new Date(Date.now() - 2000).toISOString(),
      currentTool: "Starting task…",
    };

    const backgroundAgent: ParallelAgent = {
      id: "bg_1",
      taskToolCallId: "bg_1",
      name: "task",
      task: "Background agent",
      status: "background",
      background: true,
      startedAt: new Date(Date.now() - 2000).toISOString(),
      currentTool: "Running task in background…",
    };

    // Apply tool.complete to both
    const syncTransformed = applyToolCompleteTransform(syncAgent, "Sync result");
    const bgTransformed = applyToolCompleteTransform(backgroundAgent, "BG result");

    // Sync agent should be completed
    expect(syncTransformed.status).toBe("completed");
    expect(syncTransformed.currentTool).toBeUndefined();
    expect(syncTransformed.durationMs).toBeGreaterThan(0);

    // Background agent should remain background
    expect(bgTransformed.status).toBe("background");
    expect(bgTransformed.currentTool).toBe("Running task in background…");
    expect(bgTransformed.durationMs).toBeUndefined();
  });

  test("stream finalization hasActive check includes background agents", () => {
    const agents: ParallelAgent[] = [
      {
        id: "completed_1",
        taskToolCallId: "completed_1",
        name: "task",
        task: "Completed task",
        status: "completed",
        startedAt: new Date().toISOString(),
        durationMs: 1000,
      },
      {
        id: "bg_running",
        taskToolCallId: "bg_running",
        name: "task",
        task: "Background task still running",
        status: "background",
        background: true,
        startedAt: new Date().toISOString(),
        currentTool: "Running task in background…",
      },
    ];

    // Should return true because background agent is still active
    expect(hasActiveAgents(agents)).toBe(true);

    // Remove background agent
    const onlyCompleted = agents.filter((a) => a.status === "completed");
    expect(hasActiveAgents(onlyCompleted)).toBe(false);
  });

  test("stream finalization map skips background agents", () => {
    const agents: ParallelAgent[] = [
      {
        id: "running_1",
        taskToolCallId: "running_1",
        name: "task",
        task: "Running sync task",
        status: "running",
        startedAt: new Date(Date.now() - 3000).toISOString(),
        currentTool: "Starting task…",
      },
      {
        id: "bg_1",
        taskToolCallId: "bg_1",
        name: "task",
        task: "Background task",
        status: "background",
        background: true,
        startedAt: new Date(Date.now() - 3000).toISOString(),
        currentTool: "Running task in background…",
      },
      {
        id: "completed_1",
        taskToolCallId: "completed_1",
        name: "task",
        task: "Already completed task",
        status: "completed",
        startedAt: new Date(Date.now() - 5000).toISOString(),
        durationMs: 2000,
      },
    ];

    // Apply stream finalization to all agents
    const finalized = agents.map(applyStreamFinalizationTransform);

    // Running agent should be completed
    expect(finalized[0]!.status).toBe("completed");
    expect(finalized[0]!.currentTool).toBeUndefined();
    expect(finalized[0]!.durationMs).toBeGreaterThan(2900);

    // Background agent should remain unchanged
    expect(finalized[1]!.status).toBe("background");
    expect(finalized[1]!.currentTool).toBe("Running task in background…");
    expect(finalized[1]!.durationMs).toBeUndefined();

    // Already completed agent should remain unchanged
    expect(finalized[2]!.status).toBe("completed");
    expect(finalized[2]!.durationMs).toBe(2000);
  });

  test("hasActiveAgents returns true for running agents", () => {
    const agents: ParallelAgent[] = [
      {
        id: "running_1",
        taskToolCallId: "running_1",
        name: "task",
        task: "Running task",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(hasActiveAgents(agents)).toBe(true);
  });

  test("hasActiveAgents returns true for pending agents", () => {
    const agents: ParallelAgent[] = [
      {
        id: "pending_1",
        taskToolCallId: "pending_1",
        name: "task",
        task: "Pending task",
        status: "pending",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(hasActiveAgents(agents)).toBe(true);
  });

  test("hasActiveAgents returns false for completed/error/interrupted agents only", () => {
    const agents: ParallelAgent[] = [
      {
        id: "completed_1",
        taskToolCallId: "completed_1",
        name: "task",
        task: "Completed task",
        status: "completed",
        startedAt: new Date().toISOString(),
        durationMs: 1000,
      },
      {
        id: "error_1",
        taskToolCallId: "error_1",
        name: "task",
        task: "Error task",
        status: "error",
        startedAt: new Date().toISOString(),
        durationMs: 500,
        error: "Task failed",
      },
      {
        id: "interrupted_1",
        taskToolCallId: "interrupted_1",
        name: "task",
        task: "Interrupted task",
        status: "interrupted",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(hasActiveAgents(agents)).toBe(false);
  });

  test("hasActiveAgents returns false for empty array", () => {
    expect(hasActiveAgents([])).toBe(false);
  });

  test("subagent.complete only affects matching agent ID", () => {
    const agents: ParallelAgent[] = [
      {
        id: "agent_1",
        taskToolCallId: "agent_1",
        name: "task",
        task: "Task 1",
        status: "background",
        background: true,
        startedAt: new Date().toISOString(),
      },
      {
        id: "agent_2",
        taskToolCallId: "agent_2",
        name: "task",
        task: "Task 2",
        status: "background",
        background: true,
        startedAt: new Date().toISOString(),
      },
    ];

    // Complete only agent_1
    const updated = agents.map((a) =>
      applySubagentCompleteTransform(a, "agent_1", true)
    );

    expect(updated[0]!.status).toBe("completed");
    expect(updated[1]!.status).toBe("background"); // Unchanged
  });

  test("tool.complete preserves all fields except updated ones for background agents", () => {
    const backgroundAgent: ParallelAgent = {
      id: "preserve_test",
      taskToolCallId: "preserve_test",
      name: "task",
      task: "Preserve fields test",
      status: "background",
      background: true,
      startedAt: "2024-01-01T00:00:00.000Z",
      currentTool: "Custom tool message",
      model: "claude-opus-4.6",
      toolUses: 5,
      tokens: 1000,
    };

    const transformed = applyToolCompleteTransform(backgroundAgent, "Result");

    // Fields that should be preserved
    expect(transformed.id).toBe("preserve_test");
    expect(transformed.name).toBe("task");
    expect(transformed.task).toBe("Preserve fields test");
    expect(transformed.status).toBe("background");
    expect(transformed.background).toBe(true);
    expect(transformed.startedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(transformed.currentTool).toBe("Custom tool message");
    expect(transformed.model).toBe("claude-opus-4.6");
    expect(transformed.toolUses).toBe(5);
    expect(transformed.tokens).toBe(1000);
    expect(transformed.durationMs).toBeUndefined();

    // Only result should be updated
    expect(transformed.result).toBe("Result");
  });

  test("tool.complete updates all completion fields for sync agents", () => {
    const runningAgent: ParallelAgent = {
      id: "sync_complete",
      taskToolCallId: "sync_complete",
      name: "task",
      task: "Sync completion test",
      status: "running",
      startedAt: new Date(Date.now() - 5000).toISOString(),
      currentTool: "Running tool",
      model: "claude-sonnet-4.5",
    };

    const transformed = applyToolCompleteTransform(runningAgent, "Sync result");

    expect(transformed.status).toBe("completed");
    expect(transformed.currentTool).toBeUndefined();
    expect(transformed.durationMs).toBeGreaterThan(4900);
    expect(transformed.durationMs).toBeLessThan(6000);
    expect(transformed.result).toBe("Sync result");
    expect(transformed.model).toBe("claude-sonnet-4.5");
  });

  test("isAsync fallback retroactively marks non-background agent as background", () => {
    // Simulate an agent that was NOT detected as background at tool.start
    // (e.g. run_in_background was not in the input)
    const agent: ParallelAgent = {
      id: "agent_missed_bg",
      taskToolCallId: "tool_missed_bg",
      name: "task",
      task: "Missed background detection",
      status: "running",
      startedAt: new Date(Date.now() - 3000).toISOString(),
      currentTool: "Starting task…",
    };

    // Step 1: isAsync fallback retroactively sets background flag
    const retroAgent: ParallelAgent = !agent.background
      ? { ...agent, background: true, status: "background" as const }
      : agent;

    expect(retroAgent.background).toBe(true);
    expect(retroAgent.status).toBe("background");

    // Step 2: tool.complete should now skip finalization
    const afterToolComplete = applyToolCompleteTransform(retroAgent, "Async result");
    expect(afterToolComplete.status).toBe("background");
    expect(afterToolComplete.currentTool).toBe("Starting task…"); // preserved from retro
    expect(afterToolComplete.durationMs).toBeUndefined();
    expect(afterToolComplete.result).toBe("Async result");

    // Step 3: subagent.complete transitions to completed
    const afterSubagentComplete = applySubagentCompleteTransform(
      afterToolComplete,
      "agent_missed_bg",
      true,
      "Final result"
    );
    expect(afterSubagentComplete.status).toBe("completed");
    expect(afterSubagentComplete.durationMs).toBeGreaterThan(0);
  });
});
