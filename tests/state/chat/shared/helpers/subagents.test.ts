import { describe, expect, test } from "bun:test";
import {
  isGenericSubagentTaskLabel,
  isClaudeSyntheticForegroundAgentId,
  CLAUDE_SYNTHETIC_FOREGROUND_AGENT_PREFIX,
  resolveIncomingSubagentTaskLabel,
  mergeAgentTaskLabel,
  resolveSubagentStartCorrelationId,
  isBootstrapAgentCurrentToolLabel,
  resolveAgentCurrentToolForUpdate,
  asNonEmptyString,
  upsertSyntheticTaskAgentForToolStart,
  finalizeSyntheticTaskAgentForToolComplete,
  finalizeCorrelatedSubagentDispatchForToolComplete,
} from "@/state/chat/shared/helpers/subagents.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";

// Helper to make a minimal ParallelAgent for testing
function makeAgent(overrides: Partial<ParallelAgent> & { id: string; name: string; task: string; status: ParallelAgent["status"]; startedAt: string }): ParallelAgent {
  return { ...overrides };
}

// ============================================================================
// isGenericSubagentTaskLabel
// ============================================================================
describe("isGenericSubagentTaskLabel", () => {
  test("returns true for undefined", () => {
    expect(isGenericSubagentTaskLabel(undefined)).toBe(true);
  });

  test("returns true for empty string", () => {
    expect(isGenericSubagentTaskLabel("")).toBe(true);
  });

  test("returns true for whitespace-only", () => {
    expect(isGenericSubagentTaskLabel("   ")).toBe(true);
  });

  test('returns true for "sub-agent task"', () => {
    expect(isGenericSubagentTaskLabel("sub-agent task")).toBe(true);
  });

  test('returns true for "Sub-Agent Task" (case-insensitive)', () => {
    expect(isGenericSubagentTaskLabel("Sub-Agent Task")).toBe(true);
  });

  test('returns true for "subagent task"', () => {
    expect(isGenericSubagentTaskLabel("subagent task")).toBe(true);
  });

  test('returns true for "SUBAGENT TASK" (case-insensitive)', () => {
    expect(isGenericSubagentTaskLabel("SUBAGENT TASK")).toBe(true);
  });

  test('returns true for " sub-agent task " with whitespace', () => {
    expect(isGenericSubagentTaskLabel(" sub-agent task ")).toBe(true);
  });

  test("returns false for specific task labels", () => {
    expect(isGenericSubagentTaskLabel("Fix the login bug")).toBe(false);
  });

  test("returns false for partial matches", () => {
    expect(isGenericSubagentTaskLabel("sub-agent")).toBe(false);
    expect(isGenericSubagentTaskLabel("task")).toBe(false);
  });
});

// ============================================================================
// isClaudeSyntheticForegroundAgentId
// ============================================================================
describe("isClaudeSyntheticForegroundAgentId", () => {
  test("returns true for ID with correct prefix", () => {
    expect(isClaudeSyntheticForegroundAgentId("agent-only-123")).toBe(true);
  });

  test("returns true for prefix alone", () => {
    expect(isClaudeSyntheticForegroundAgentId(CLAUDE_SYNTHETIC_FOREGROUND_AGENT_PREFIX)).toBe(true);
  });

  test("returns false for undefined", () => {
    expect(isClaudeSyntheticForegroundAgentId(undefined)).toBe(false);
  });

  test("returns false for different prefix", () => {
    expect(isClaudeSyntheticForegroundAgentId("other-prefix-123")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isClaudeSyntheticForegroundAgentId("")).toBe(false);
  });

  test("returns false when prefix appears in the middle", () => {
    expect(isClaudeSyntheticForegroundAgentId("xxx-agent-only-123")).toBe(false);
  });
});

// ============================================================================
// resolveIncomingSubagentTaskLabel
// ============================================================================
describe("resolveIncomingSubagentTaskLabel", () => {
  test("returns task when task is non-empty", () => {
    expect(resolveIncomingSubagentTaskLabel("My task", "my-agent")).toBe("My task");
  });

  test("returns agentType when task is empty", () => {
    expect(resolveIncomingSubagentTaskLabel("", "code-reviewer")).toBe("code-reviewer");
  });

  test("returns agentType when task is undefined", () => {
    expect(resolveIncomingSubagentTaskLabel(undefined, "explorer")).toBe("explorer");
  });

  test("returns default when both are undefined", () => {
    expect(resolveIncomingSubagentTaskLabel(undefined, undefined)).toBe("sub-agent task");
  });

  test("returns default when both are empty strings", () => {
    expect(resolveIncomingSubagentTaskLabel("", "")).toBe("sub-agent task");
  });

  test("returns default when both are whitespace-only", () => {
    expect(resolveIncomingSubagentTaskLabel("   ", "   ")).toBe("sub-agent task");
  });

  test("trims task before returning", () => {
    expect(resolveIncomingSubagentTaskLabel("  trimmed task  ", undefined)).toBe("trimmed task");
  });
});

// ============================================================================
// mergeAgentTaskLabel
// ============================================================================
describe("mergeAgentTaskLabel", () => {
  test("prefers specific incoming over generic existing", () => {
    expect(mergeAgentTaskLabel("sub-agent task", "Fix the bug", undefined)).toBe("Fix the bug");
  });

  test("keeps existing specific when incoming is generic", () => {
    expect(mergeAgentTaskLabel("Fix the bug", "sub-agent task", undefined)).toBe("Fix the bug");
  });

  test("prefers incoming specific when existing matches agentType", () => {
    expect(mergeAgentTaskLabel("explorer", "Analyze codebase", "explorer")).toBe("Analyze codebase");
  });

  test("keeps existing when both are specific and non-generic", () => {
    expect(mergeAgentTaskLabel("First task", "Second task", undefined)).toBe("First task");
  });

  test("returns resolved incoming when existing is generic", () => {
    expect(mergeAgentTaskLabel("", "explorer", "explorer")).toBe("explorer");
  });

  test("returns default when all are empty/undefined", () => {
    const result = mergeAgentTaskLabel(undefined, undefined, undefined);
    expect(result).toBe("sub-agent task");
  });
});

// ============================================================================
// resolveSubagentStartCorrelationId
// ============================================================================
describe("resolveSubagentStartCorrelationId", () => {
  test("returns sdkCorrelationId when present", () => {
    expect(resolveSubagentStartCorrelationId({
      sdkCorrelationId: "sdk-123",
      toolCallId: "tool-456",
    })).toBe("sdk-123");
  });

  test("returns toolCallId when sdkCorrelationId is absent", () => {
    expect(resolveSubagentStartCorrelationId({
      toolCallId: "tool-456",
    })).toBe("tool-456");
  });

  test("returns undefined when both are absent", () => {
    expect(resolveSubagentStartCorrelationId({})).toBeUndefined();
  });

  test("prefers sdkCorrelationId over toolCallId", () => {
    expect(resolveSubagentStartCorrelationId({
      sdkCorrelationId: "sdk",
      toolCallId: "tool",
    })).toBe("sdk");
  });
});

// ============================================================================
// isBootstrapAgentCurrentToolLabel
// ============================================================================
describe("isBootstrapAgentCurrentToolLabel", () => {
  test("returns true for 'running agentname...' format", () => {
    expect(isBootstrapAgentCurrentToolLabel("running explorer...", "explorer")).toBe(true);
  });

  test("returns true for any 'running X...' when agentName is undefined", () => {
    expect(isBootstrapAgentCurrentToolLabel("running something...", undefined)).toBe(true);
  });

  test("returns true for any 'running X...' when agentName is empty", () => {
    expect(isBootstrapAgentCurrentToolLabel("running something...", "")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isBootstrapAgentCurrentToolLabel("Running Explorer...", "explorer")).toBe(true);
    expect(isBootstrapAgentCurrentToolLabel("RUNNING EXPLORER...", "EXPLORER")).toBe(true);
  });

  test("returns false when currentTool is undefined", () => {
    expect(isBootstrapAgentCurrentToolLabel(undefined, "explorer")).toBe(false);
  });

  test("returns false when currentTool is empty", () => {
    expect(isBootstrapAgentCurrentToolLabel("", "explorer")).toBe(false);
  });

  test("returns false when format does not start with 'running '", () => {
    expect(isBootstrapAgentCurrentToolLabel("starting explorer...", "explorer")).toBe(false);
  });

  test("returns false when format does not end with '...'", () => {
    expect(isBootstrapAgentCurrentToolLabel("running explorer", "explorer")).toBe(false);
  });

  test("returns false when agent name does not match", () => {
    expect(isBootstrapAgentCurrentToolLabel("running different...", "explorer")).toBe(false);
  });
});

// ============================================================================
// resolveAgentCurrentToolForUpdate
// ============================================================================
describe("resolveAgentCurrentToolForUpdate", () => {
  test("returns incoming when incomingCurrentTool is provided", () => {
    expect(resolveAgentCurrentToolForUpdate({
      incomingCurrentTool: "new-tool",
      existingCurrentTool: "old-tool",
    })).toBe("new-tool");
  });

  test("returns incoming even when it is empty string", () => {
    expect(resolveAgentCurrentToolForUpdate({
      incomingCurrentTool: "",
      existingCurrentTool: "old-tool",
    })).toBe("");
  });

  test("clears bootstrap label when no incoming and existing is bootstrap", () => {
    expect(resolveAgentCurrentToolForUpdate({
      existingCurrentTool: "running explorer...",
      agentName: "explorer",
    })).toBeUndefined();
  });

  test("keeps existing when not a bootstrap label", () => {
    expect(resolveAgentCurrentToolForUpdate({
      existingCurrentTool: "editing files",
      agentName: "explorer",
    })).toBe("editing files");
  });

  test("returns undefined when both are undefined", () => {
    expect(resolveAgentCurrentToolForUpdate({})).toBeUndefined();
  });
});

// ============================================================================
// asNonEmptyString
// ============================================================================
describe("asNonEmptyString", () => {
  test("returns trimmed string for non-empty string", () => {
    expect(asNonEmptyString("  hello  ")).toBe("hello");
  });

  test("returns undefined for empty string", () => {
    expect(asNonEmptyString("")).toBeUndefined();
  });

  test("returns undefined for whitespace-only string", () => {
    expect(asNonEmptyString("   ")).toBeUndefined();
  });

  test("returns undefined for undefined", () => {
    expect(asNonEmptyString(undefined)).toBeUndefined();
  });

  test("returns undefined for null", () => {
    expect(asNonEmptyString(null)).toBeUndefined();
  });

  test("returns undefined for number", () => {
    expect(asNonEmptyString(42)).toBeUndefined();
  });

  test("returns undefined for boolean", () => {
    expect(asNonEmptyString(true)).toBeUndefined();
  });

  test("returns undefined for object", () => {
    expect(asNonEmptyString({})).toBeUndefined();
  });

  test("returns string as-is if no extra whitespace", () => {
    expect(asNonEmptyString("hello")).toBe("hello");
  });
});

// ============================================================================
// upsertSyntheticTaskAgentForToolStart
// ============================================================================
describe("upsertSyntheticTaskAgentForToolStart", () => {
  const baseArgs = {
    agents: [] as ParallelAgent[],
    toolName: "Task",
    toolId: "tool-1",
    input: { description: "Do something", agent_type: "explorer" },
    startedAt: "2024-01-01T00:00:00Z",
  };

  test("creates new synthetic agent for opencode provider", () => {
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "opencode",
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("tool-1");
    expect(result[0].name).toBe("explorer");
    expect(result[0].task).toBe("Do something");
    expect(result[0].status).toBe("running");
  });

  test("creates new synthetic agent for claude provider", () => {
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "claude",
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("running");
  });

  test("returns unchanged for copilot provider", () => {
    const agents: ParallelAgent[] = [];
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "copilot",
      agents,
    });
    expect(result).toBe(agents);
  });

  test("returns unchanged for unsupported provider", () => {
    const agents: ParallelAgent[] = [];
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: undefined,
      agents,
    });
    expect(result).toBe(agents);
  });

  test("returns unchanged when agentId is set", () => {
    const agents: ParallelAgent[] = [];
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "opencode",
      agents,
      agentId: "some-agent-id",
    });
    expect(result).toBe(agents);
  });

  test("returns unchanged for non-subagent tool name", () => {
    const agents: ParallelAgent[] = [];
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "opencode",
      agents,
      toolName: "ReadFile",
    });
    expect(result).toBe(agents);
  });

  test("sets background status when mode is background", () => {
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "opencode",
      input: { description: "Do something", mode: "background" },
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("background");
    expect(result[0].background).toBe(true);
  });

  test("sets background status when run_in_background is true", () => {
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "opencode",
      input: { description: "Do something", run_in_background: true },
    });
    expect(result[0].status).toBe("background");
    expect(result[0].background).toBe(true);
  });

  test("updates existing synthetic agent with same placeholder ID", () => {
    const existing = makeAgent({
      id: "tool-1",
      taskToolCallId: "tool-1",
      name: "agent",
      task: "sub-agent task",
      status: "pending",
      startedAt: "2024-01-01T00:00:00Z",
    });
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "opencode",
      agents: [existing],
    });
    expect(result).toHaveLength(1);
    expect(result[0].task).toBe("Do something");
    expect(result[0].name).toBe("explorer");
    expect(result[0].status).toBe("running");
  });

  test("does not replace real agent with same toolCallId", () => {
    const realAgent = makeAgent({
      id: "real-agent-id",
      taskToolCallId: "tool-1",
      name: "real",
      task: "real task",
      status: "running",
      startedAt: "2024-01-01T00:00:00Z",
    });
    const agents = [realAgent];
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "opencode",
      agents,
    });
    expect(result).toBe(agents);
  });

  test("returns unchanged when input has no execution details and no existing synthetic", () => {
    const agents: ParallelAgent[] = [];
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "opencode",
      input: {},
      agents,
    });
    expect(result).toBe(agents);
  });

  test("parses agent type from various input keys", () => {
    for (const key of ["subagent_type", "subagentType", "agent_type", "agentType", "agent", "type"]) {
      const result = upsertSyntheticTaskAgentForToolStart({
        ...baseArgs,
        provider: "opencode",
        input: { description: "Test", [key]: "custom-agent" },
      });
      expect(result[0].name).toBe("custom-agent");
    }
  });

  test("parses task label from description, task, or title input keys", () => {
    for (const key of ["description", "task", "title"]) {
      const result = upsertSyntheticTaskAgentForToolStart({
        ...baseArgs,
        provider: "opencode",
        input: { [key]: "Custom label" },
      });
      expect(result[0].task).toBe("Custom label");
    }
  });

  test("works with 'agent' tool name (lowercase)", () => {
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "opencode",
      toolName: "agent",
    });
    expect(result).toHaveLength(1);
  });

  test("works with 'launch_agent' tool name", () => {
    const result = upsertSyntheticTaskAgentForToolStart({
      ...baseArgs,
      provider: "opencode",
      toolName: "launch_agent",
    });
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// finalizeSyntheticTaskAgentForToolComplete
// ============================================================================
describe("finalizeSyntheticTaskAgentForToolComplete", () => {
  const synthetic = makeAgent({
    id: "tool-1",
    taskToolCallId: "tool-1",
    name: "explorer",
    task: "Do something",
    status: "running",
    startedAt: "2024-01-01T00:00:00Z",
  });

  const baseArgs = {
    agents: [synthetic],
    toolName: "Task",
    toolId: "tool-1",
    success: true,
    output: "done",
    completedAtMs: new Date("2024-01-01T00:01:00Z").getTime(),
  };

  test("marks synthetic agent as completed on success", () => {
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "opencode",
    });
    expect(result[0].status).toBe("completed");
  });

  test("marks synthetic agent as error on failure", () => {
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "opencode",
      success: false,
      error: "something failed",
    });
    expect(result[0].status).toBe("error");
    expect(result[0].error).toBe("something failed");
  });

  test("marks synthetic agent as interrupted for abort-like errors", () => {
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "claude",
      success: false,
      error: "Operation was aborted",
    });
    expect(result[0].status).toBe("interrupted");
  });

  test("marks interrupted for cancel errors", () => {
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "claude",
      success: false,
      error: "User cancelled the operation",
    });
    expect(result[0].status).toBe("interrupted");
  });

  test("marks interrupted for interrupt errors", () => {
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "opencode",
      success: false,
      error: "Process was interrupted",
    });
    expect(result[0].status).toBe("interrupted");
  });

  test("computes durationMs from startedAt and completedAtMs", () => {
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "opencode",
    });
    expect(result[0].durationMs).toBe(60_000);
  });

  test("sets result from string output on success", () => {
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "opencode",
      output: "result text",
    });
    expect(result[0].result).toBe("result text");
  });

  test("does not set result from non-string output", () => {
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "opencode",
      output: { key: "value" },
    });
    expect(result[0].result).toBeUndefined();
  });

  test("returns unchanged for copilot provider", () => {
    const agents = [synthetic];
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "copilot",
      agents,
    });
    expect(result).toBe(agents);
  });

  test("returns unchanged when agentId is set", () => {
    const agents = [synthetic];
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "opencode",
      agents,
      agentId: "some-agent",
    });
    expect(result).toBe(agents);
  });

  test("returns unchanged for non-subagent tool name", () => {
    const agents = [synthetic];
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "opencode",
      agents,
      toolName: "ReadFile",
    });
    expect(result).toBe(agents);
  });

  test("returns unchanged when no matching synthetic agent exists", () => {
    const agents = [synthetic];
    const result = finalizeSyntheticTaskAgentForToolComplete({
      ...baseArgs,
      provider: "opencode",
      agents,
      toolId: "different-tool",
    });
    expect(result).toBe(agents);
  });
});

// ============================================================================
// finalizeCorrelatedSubagentDispatchForToolComplete
// ============================================================================
describe("finalizeCorrelatedSubagentDispatchForToolComplete", () => {
  const agent = makeAgent({
    id: "agent-1",
    taskToolCallId: "tool-1",
    name: "explorer",
    task: "Explore",
    status: "running",
    startedAt: "2024-01-01T00:00:00Z",
  });

  const baseArgs = {
    agents: [agent],
    toolName: "Task",
    toolId: "tool-1",
    success: true,
    completedAtMs: new Date("2024-01-01T00:01:00Z").getTime(),
  };

  test("marks correlated running agent as completed on success", () => {
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      provider: "opencode",
    });
    expect(result[0].status).toBe("completed");
    expect(result[0].currentTool).toBeUndefined();
  });

  test("marks correlated running agent as error on failure", () => {
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      provider: "opencode",
      success: false,
      error: "failed",
    });
    expect(result[0].status).toBe("error");
    expect(result[0].error).toBe("failed");
  });

  test("marks as interrupted for abort-like errors", () => {
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      provider: "opencode",
      success: false,
      error: "aborted by user",
    });
    expect(result[0].status).toBe("interrupted");
  });

  test("skips copilot provider", () => {
    const agents = [agent];
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      provider: "copilot",
      agents,
    });
    expect(result).toBe(agents);
  });

  test("returns unchanged when agentId is set", () => {
    const agents = [agent];
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      agents,
      agentId: "some-id",
    });
    expect(result).toBe(agents);
  });

  test("returns unchanged for non-subagent tool name", () => {
    const agents = [agent];
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      agents,
      toolName: "ReadFile",
    });
    expect(result).toBe(agents);
  });

  test("does not re-finalize already completed agents", () => {
    const completedAgent = makeAgent({
      ...agent,
      status: "completed",
    });
    const agents = [completedAgent];
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      provider: "opencode",
      agents,
      success: false,
      error: "should not override",
    });
    expect(result).toBe(agents);
    expect(result[0].status).toBe("completed");
  });

  test("does not re-finalize already errored agents", () => {
    const erroredAgent = makeAgent({
      ...agent,
      status: "error",
      error: "original error",
    });
    const agents = [erroredAgent];
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      provider: "opencode",
      agents,
    });
    expect(result).toBe(agents);
  });

  test("does not re-finalize interrupted agents", () => {
    const interruptedAgent = makeAgent({
      ...agent,
      status: "interrupted",
    });
    const agents = [interruptedAgent];
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      provider: "opencode",
      agents,
    });
    expect(result).toBe(agents);
  });

  test("computes durationMs from startedAt and completedAtMs", () => {
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      provider: "opencode",
    });
    expect(result[0].durationMs).toBe(60_000);
  });

  test("returns same array reference when no agents match toolId", () => {
    const agents = [agent];
    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      ...baseArgs,
      provider: "opencode",
      agents,
      toolId: "no-match",
    });
    expect(result).toBe(agents);
  });
});
