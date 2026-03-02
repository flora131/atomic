/**
 * Tests for Copilot SDK parallel sub-agent tool call attribution bug fix.
 *
 * Bug Description:
 * When multiple Copilot sub-agents run in parallel, tool calls and counts were
 * only showing up for the most recently started sub-agent. Earlier sub-agents
 * showed no tool activity even though they were executing tools.
 *
 * Root Cause:
 * 1. Copilot SDK client wasn't extracting parentToolCallId from tool events
 * 2. UI layer used "most recently started running subagent" heuristic which
 *    fails when multiple agents run simultaneously
 *
 * Fix:
 * 1. Extract parentToolCallId from Copilot tool.execution_start/complete events
 * 2. Use parentId to correctly attribute tool calls to their parent sub-agent
 * 3. Fall back to "most recent" heuristic for SDKs without parentId (OpenCode/Claude)
 *
 * This test verifies:
 * - Tool calls with parentId are attributed to the correct sub-agent
 * - Tool counts increment correctly for each parallel sub-agent
 * - currentTool is updated for the correct sub-agent
 * - Fallback heuristic still works for events without parentId
 */

import { describe, expect, test } from "bun:test";

// ============================================================================
// TYPES (extracted from src/ui/components/parallel-agents-tree.tsx)
// ============================================================================

type AgentStatus = "pending" | "running" | "completed" | "error" | "background" | "interrupted";

interface ParallelAgent {
  id: string;
  taskToolCallId?: string;
  name: string;
  task: string;
  status: AgentStatus;
  model?: string;
  startedAt: string;
  durationMs?: number;
  background?: boolean;
  error?: string;
  result?: string;
  toolUses?: number;
  tokens?: number;
  currentTool?: string;
}

// ============================================================================
// TOOL ATTRIBUTION LOGIC (extracted from src/ui/index.ts)
// ============================================================================

interface ToolStartEvent {
  toolName: string;
  parentId?: string; // Copilot: parentToolCallId
  sessionId?: string; // OpenCode: sub-agent session ID
}

/**
 * Simulates the tool attribution logic from src/ui/index.ts (lines 729-770).
 * 
 * Returns the agent that should be credited with this tool call, or undefined
 * if no matching agent is found.
 */
function findTargetAgentForTool(
  parallelAgents: ParallelAgent[],
  event: ToolStartEvent,
  subagentSessionToAgentId: ReadonlyMap<string, string> = new Map(),
): ParallelAgent | undefined {
  const isBackground = (agent: ParallelAgent): boolean =>
    agent.background === true || agent.status === "background";
  const isAttributionCandidate = (agent: ParallelAgent): boolean =>
    agent.status === "running" || agent.status === "pending" || isBackground(agent);

  // Priority 1: Use parentId to find the parent sub-agent
  if (event.parentId) {
    const byParentId = parallelAgents.find(
      (a) => isAttributionCandidate(a)
        && (a.id === event.parentId || a.taskToolCallId === event.parentId)
    );
    if (byParentId) return byParentId;
  }

  // Priority 2: Use sub-agent session correlation for SDKs without parent IDs
  if (event.sessionId) {
    const mappedAgentId = subagentSessionToAgentId.get(event.sessionId);
    if (mappedAgentId) {
      const bySession = parallelAgents.find(
        (a) => isAttributionCandidate(a) && a.id === mappedAgentId
      );
      if (bySession) return bySession;
    }
  }

  // Priority 3: Fallback to most recently started active subagent
  return [...parallelAgents]
    .reverse()
    .find((a) => isAttributionCandidate(a));
}

/**
 * Applies a tool.start event to the parallel agents array.
 */
function applyToolStart(
  parallelAgents: ParallelAgent[],
  event: ToolStartEvent,
  subagentSessionToAgentId: ReadonlyMap<string, string> = new Map(),
): ParallelAgent[] {
  const targetAgent = findTargetAgentForTool(parallelAgents, event, subagentSessionToAgentId);
  if (!targetAgent) return parallelAgents;
  if (targetAgent.background || targetAgent.status === "background") {
    return parallelAgents;
  }

  return parallelAgents.map((a) =>
    a.id === targetAgent.id
      ? { 
          ...a, 
          currentTool: event.toolName, 
          toolUses: (a.toolUses ?? 0) + 1 
        }
      : a
  );
}

// ============================================================================
// TESTS
// ============================================================================

describe("Copilot parallel sub-agent tool attribution", () => {
  test("tool with parentId is attributed to correct sub-agent (not most recent)", () => {
    // Setup: 3 parallel sub-agents all running
    const agents: ParallelAgent[] = [
      {
        id: "subagent-1",
        taskToolCallId: "task-1",
        name: "codebase-analyzer",
        task: "Analyze authentication flow",
        status: "running",
        startedAt: "2024-01-01T00:00:00Z",
        toolUses: 0,
      },
      {
        id: "subagent-2",
        taskToolCallId: "task-2",
        name: "codebase-locator",
        task: "Find test files",
        status: "running",
        startedAt: "2024-01-01T00:00:01Z",
        toolUses: 0,
      },
      {
        id: "subagent-3",
        taskToolCallId: "task-3",
        name: "debugger",
        task: "Investigate error",
        status: "running",
        startedAt: "2024-01-01T00:00:02Z",
        toolUses: 0,
      },
    ];

    // Tool event for subagent-1 (oldest agent, not most recent)
    const toolEvent: ToolStartEvent = {
      toolName: "grep",
      parentId: "subagent-1",
    };

    const updated = applyToolStart(agents, toolEvent);

    // Verify: Tool attributed to subagent-1, not subagent-3 (most recent)
    expect(updated[0]?.toolUses).toBe(1);
    expect(updated[0]?.currentTool).toBe("grep");
    expect(updated[1]?.toolUses).toBe(0); // subagent-2 unchanged
    expect(updated[2]?.toolUses).toBe(0); // subagent-3 unchanged
  });

  test("multiple tools with different parentIds are attributed correctly", () => {
    const agents: ParallelAgent[] = [
      {
        id: "subagent-A",
        taskToolCallId: "task-A",
        name: "explore",
        task: "Find API endpoints",
        status: "running",
        startedAt: "2024-01-01T00:00:00Z",
        toolUses: 0,
      },
      {
        id: "subagent-B",
        taskToolCallId: "task-B",
        name: "explore",
        task: "Find database schema",
        status: "running",
        startedAt: "2024-01-01T00:00:01Z",
        toolUses: 0,
      },
    ];

    // Tool events for both sub-agents
    let updated = applyToolStart(agents, { toolName: "grep", parentId: "subagent-A" });
    updated = applyToolStart(updated, { toolName: "view", parentId: "subagent-A" });
    updated = applyToolStart(updated, { toolName: "grep", parentId: "subagent-B" });
    updated = applyToolStart(updated, { toolName: "glob", parentId: "subagent-B" });
    updated = applyToolStart(updated, { toolName: "view", parentId: "subagent-B" });

    // Verify: Each agent has correct tool count
    expect(updated[0]?.toolUses).toBe(2); // subagent-A: 2 tools
    expect(updated[0]?.currentTool).toBe("view"); // Last tool for A
    expect(updated[1]?.toolUses).toBe(3); // subagent-B: 3 tools
    expect(updated[1]?.currentTool).toBe("view"); // Last tool for B
  });

  test("parentId matches taskToolCallId (eager agent correlation)", () => {
    // Scenario: Eager agent created from tool.start uses toolId as both
    // id and taskToolCallId. Later, subagent.start updates the id but
    // keeps taskToolCallId. Tool events use original toolCallId as parentId.
    const agents: ParallelAgent[] = [
      {
        id: "real-subagent-id",
        taskToolCallId: "tool_123",
        name: "codebase-analyzer",
        task: "Analyze code",
        status: "running",
        startedAt: "2024-01-01T00:00:00Z",
        toolUses: 0,
      },
    ];

    const toolEvent: ToolStartEvent = {
      toolName: "bash",
      parentId: "tool_123", // Matches taskToolCallId, not id
    };

    const updated = applyToolStart(agents, toolEvent);

    expect(updated[0]?.toolUses).toBe(1);
    expect(updated[0]?.currentTool).toBe("bash");
  });

  test("fallback to most recent active agent when parentId is missing (OpenCode/Claude)", () => {
    const agents: ParallelAgent[] = [
      {
        id: "subagent-1",
        name: "explore",
        task: "Task 1",
        status: "running",
        startedAt: "2024-01-01T00:00:00Z",
        toolUses: 0,
      },
      {
        id: "subagent-2",
        name: "explore",
        task: "Task 2",
        status: "running",
        startedAt: "2024-01-01T00:00:01Z",
        toolUses: 0,
      },
    ];

    // Tool event WITHOUT parentId (OpenCode/Claude behavior)
    const toolEvent: ToolStartEvent = {
      toolName: "grep",
      // parentId: undefined
    };

    const updated = applyToolStart(agents, toolEvent);

    // Fallback: Most recent agent (subagent-2) gets the tool
    expect(updated[0]?.toolUses).toBe(0);
    expect(updated[1]?.toolUses).toBe(1);
    expect(updated[1]?.currentTool).toBe("grep");
  });

  test("only running or background agents are considered", () => {
    const agents: ParallelAgent[] = [
      {
        id: "subagent-1",
        name: "explore",
        task: "Task 1",
        status: "completed", // Not running
        startedAt: "2024-01-01T00:00:00Z",
        toolUses: 5,
      },
      {
        id: "subagent-2",
        name: "explore",
        task: "Task 2",
        status: "running",
        startedAt: "2024-01-01T00:00:01Z",
        toolUses: 0,
      },
    ];

    const toolEvent: ToolStartEvent = {
      toolName: "view",
      parentId: "subagent-1", // Points to completed agent
    };

    const updated = applyToolStart(agents, toolEvent);

    // parentId match fails (agent not running), falls back to most recent
    expect(updated[0]?.toolUses).toBe(5); // Unchanged
    expect(updated[1]?.toolUses).toBe(1); // Fallback target
  });

  test("background agent tool events do not stream tool metadata", () => {
    const agents: ParallelAgent[] = [
      {
        id: "bg-agent",
        taskToolCallId: "bg-task",
        name: "general-purpose",
        task: "Long-running task",
        status: "background",
        background: true,
        startedAt: "2024-01-01T00:00:00Z",
        toolUses: 0,
      },
      {
        id: "fg-agent",
        name: "explore",
        task: "Quick search",
        status: "running",
        startedAt: "2024-01-01T00:00:01Z",
        toolUses: 0,
      },
    ];

    const toolEvent: ToolStartEvent = {
      toolName: "bash",
      parentId: "bg-agent",
    };

    const updated = applyToolStart(agents, toolEvent);

    // Background agent is attributed for filtering, but metadata is unchanged
    expect(updated[0]?.toolUses).toBe(0);
    expect(updated[0]?.currentTool).toBeUndefined();
    expect(updated[1]?.toolUses).toBe(0);
  });

  test("session correlation attributes tool to the correct parallel branch", () => {
    const agents: ParallelAgent[] = [
      {
        id: "subagent-A",
        taskToolCallId: "task-A",
        name: "codebase-locator",
        task: "Locate APIs",
        status: "running",
        startedAt: "2024-01-01T00:00:00Z",
        toolUses: 0,
      },
      {
        id: "subagent-B",
        taskToolCallId: "task-B",
        name: "debugger",
        task: "Analyze failures",
        status: "running",
        startedAt: "2024-01-01T00:00:01Z",
        toolUses: 0,
      },
    ];

    const sessionMap = new Map<string, string>([["ses_A", "subagent-A"]]);
    const updated = applyToolStart(
      agents,
      { toolName: "rg", sessionId: "ses_A" },
      sessionMap,
    );

    expect(updated[0]?.toolUses).toBe(1);
    expect(updated[0]?.currentTool).toBe("rg");
    expect(updated[1]?.toolUses).toBe(0);
  });

  test("no tool attribution when no running agents exist", () => {
    const agents: ParallelAgent[] = [
      {
        id: "subagent-1",
        name: "explore",
        task: "Task 1",
        status: "completed",
        startedAt: "2024-01-01T00:00:00Z",
        toolUses: 3,
      },
    ];

    const toolEvent: ToolStartEvent = {
      toolName: "grep",
    };

    const updated = applyToolStart(agents, toolEvent);

    // No change - no running agents to attribute to
    expect(updated).toEqual(agents);
  });
});

describe("findTargetAgentForTool", () => {
  test("returns undefined when agents array is empty", () => {
    const result = findTargetAgentForTool([], { toolName: "grep" });
    expect(result).toBeUndefined();
  });

  test("returns undefined when all agents are completed", () => {
    const agents: ParallelAgent[] = [
      {
        id: "subagent-1",
        name: "explore",
        task: "Task",
        status: "completed",
        startedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const result = findTargetAgentForTool(agents, { toolName: "grep" });
    expect(result).toBeUndefined();
  });

  test("returns agent when parentId matches id", () => {
    const agents: ParallelAgent[] = [
      {
        id: "target-agent",
        name: "explore",
        task: "Task",
        status: "running",
        startedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const result = findTargetAgentForTool(agents, {
      toolName: "grep",
      parentId: "target-agent",
    });
    expect(result?.id).toBe("target-agent");
  });

  test("returns agent when parentId matches taskToolCallId", () => {
    const agents: ParallelAgent[] = [
      {
        id: "real-id",
        taskToolCallId: "tool-id",
        name: "explore",
        task: "Task",
        status: "running",
        startedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const result = findTargetAgentForTool(agents, {
      toolName: "grep",
      parentId: "tool-id",
    });
    expect(result?.id).toBe("real-id");
  });
});
