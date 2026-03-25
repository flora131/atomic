/**
 * Tests for Part type guards and type definitions.
 *
 * Validates that each type guard in `src/state/parts/types.ts` correctly
 * narrows the Part discriminated union to the expected concrete type,
 * and returns false for all other part types.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  isTextPart,
  isReasoningPart,
  isToolPart,
  isAgentPart,
  isTaskListPart,
  isSkillLoadPart,
  isTruncationPart,
  isTaskResultPart,
  type Part,
  type TextPart,
  type ReasoningPart,
  type ToolPart,
  type ToolState,
  type ToolExecutionStatus,
} from "@/state/parts/types.ts";
import {
  createTextPart,
  createReasoningPart,
  createToolPart,
  createAgentPart,
  createTaskListPart,
  createSkillLoadPart,
  createMcpSnapshotPart,
  createAgentListPart,
  createTruncationPart,
  createTaskResultPart,
  createWorkflowStepPart,
  resetPartIdCounter,
} from "../../test-support/fixtures/parts.ts";

beforeEach(() => {
  resetPartIdCounter();
});

// ---------------------------------------------------------------------------
// Factory for all 11 Part variants — used to verify "returns false for others"
// ---------------------------------------------------------------------------

function createAllPartVariants(): Part[] {
  return [
    createTextPart(),
    createReasoningPart(),
    createToolPart(),
    createAgentPart(),
    createTaskListPart(),
    createSkillLoadPart(),
    createMcpSnapshotPart(),
    createAgentListPart(),
    createTruncationPart(),
    createTaskResultPart(),
    createWorkflowStepPart(),
  ];
}

// ---------------------------------------------------------------------------
// isTextPart
// ---------------------------------------------------------------------------
describe("isTextPart", () => {
  test("returns true for TextPart", () => {
    const part = createTextPart();
    expect(isTextPart(part)).toBe(true);
  });

  test("returns false for every other part type", () => {
    const allParts = createAllPartVariants();
    for (const part of allParts) {
      if (part.type === "text") continue;
      expect(isTextPart(part)).toBe(false);
    }
  });

  test("narrows type so content field is accessible", () => {
    const part: Part = createTextPart({ content: "hello" });
    if (isTextPart(part)) {
      // This line would fail to compile without proper type narrowing
      expect(part.content).toBe("hello");
      expect(part.isStreaming).toBe(false);
    } else {
      throw new Error("Expected isTextPart to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// isReasoningPart
// ---------------------------------------------------------------------------
describe("isReasoningPart", () => {
  test("returns true for ReasoningPart", () => {
    const part = createReasoningPart();
    expect(isReasoningPart(part)).toBe(true);
  });

  test("returns false for every other part type", () => {
    const allParts = createAllPartVariants();
    for (const part of allParts) {
      if (part.type === "reasoning") continue;
      expect(isReasoningPart(part)).toBe(false);
    }
  });

  test("narrows type so durationMs and content fields are accessible", () => {
    const part: Part = createReasoningPart({ content: "thinking...", durationMs: 500 });
    if (isReasoningPart(part)) {
      expect(part.content).toBe("thinking...");
      expect(part.durationMs).toBe(500);
    } else {
      throw new Error("Expected isReasoningPart to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// isToolPart
// ---------------------------------------------------------------------------
describe("isToolPart", () => {
  test("returns true for ToolPart", () => {
    const part = createToolPart();
    expect(isToolPart(part)).toBe(true);
  });

  test("returns false for every other part type", () => {
    const allParts = createAllPartVariants();
    for (const part of allParts) {
      if (part.type === "tool") continue;
      expect(isToolPart(part)).toBe(false);
    }
  });

  test("narrows type so toolName, toolCallId, and state fields are accessible", () => {
    const part: Part = createToolPart({ toolName: "Read", toolCallId: "call_1" });
    if (isToolPart(part)) {
      expect(part.toolName).toBe("Read");
      expect(part.toolCallId).toBe("call_1");
      expect(part.state).toBeDefined();
    } else {
      throw new Error("Expected isToolPart to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// isAgentPart
// ---------------------------------------------------------------------------
describe("isAgentPart", () => {
  test("returns true for AgentPart", () => {
    const part = createAgentPart();
    expect(isAgentPart(part)).toBe(true);
  });

  test("returns false for every other part type", () => {
    const allParts = createAllPartVariants();
    for (const part of allParts) {
      if (part.type === "agent") continue;
      expect(isAgentPart(part)).toBe(false);
    }
  });

  test("narrows type so agents array is accessible", () => {
    const part: Part = createAgentPart();
    if (isAgentPart(part)) {
      expect(Array.isArray(part.agents)).toBe(true);
    } else {
      throw new Error("Expected isAgentPart to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// isTaskListPart
// ---------------------------------------------------------------------------
describe("isTaskListPart", () => {
  test("returns true for TaskListPart", () => {
    const part = createTaskListPart();
    expect(isTaskListPart(part)).toBe(true);
  });

  test("returns false for every other part type", () => {
    const allParts = createAllPartVariants();
    for (const part of allParts) {
      if (part.type === "task-list") continue;
      expect(isTaskListPart(part)).toBe(false);
    }
  });

  test("narrows type so items and expanded fields are accessible", () => {
    const part: Part = createTaskListPart({ expanded: true });
    if (isTaskListPart(part)) {
      expect(Array.isArray(part.items)).toBe(true);
      expect(part.expanded).toBe(true);
    } else {
      throw new Error("Expected isTaskListPart to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// isSkillLoadPart
// ---------------------------------------------------------------------------
describe("isSkillLoadPart", () => {
  test("returns true for SkillLoadPart", () => {
    const part = createSkillLoadPart();
    expect(isSkillLoadPart(part)).toBe(true);
  });

  test("returns false for every other part type", () => {
    const allParts = createAllPartVariants();
    for (const part of allParts) {
      if (part.type === "skill-load") continue;
      expect(isSkillLoadPart(part)).toBe(false);
    }
  });

  test("narrows type so skills array is accessible", () => {
    const part: Part = createSkillLoadPart();
    if (isSkillLoadPart(part)) {
      expect(Array.isArray(part.skills)).toBe(true);
    } else {
      throw new Error("Expected isSkillLoadPart to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// isTruncationPart
// ---------------------------------------------------------------------------
describe("isTruncationPart", () => {
  test("returns true for TruncationPart", () => {
    const part = createTruncationPart();
    expect(isTruncationPart(part)).toBe(true);
  });

  test("returns false for every other part type", () => {
    const allParts = createAllPartVariants();
    for (const part of allParts) {
      if (part.type === "truncation") continue;
      expect(isTruncationPart(part)).toBe(false);
    }
  });

  test("narrows type so summary field is accessible", () => {
    const part: Part = createTruncationPart({ summary: "Truncated 10 parts" });
    if (isTruncationPart(part)) {
      expect(part.summary).toBe("Truncated 10 parts");
    } else {
      throw new Error("Expected isTruncationPart to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// isTaskResultPart
// ---------------------------------------------------------------------------
describe("isTaskResultPart", () => {
  test("returns true for TaskResultPart", () => {
    const part = createTaskResultPart();
    expect(isTaskResultPart(part)).toBe(true);
  });

  test("returns false for every other part type", () => {
    const allParts = createAllPartVariants();
    for (const part of allParts) {
      if (part.type === "task-result") continue;
      expect(isTaskResultPart(part)).toBe(false);
    }
  });

  test("narrows type so taskId, toolName, title, and status fields are accessible", () => {
    const part: Part = createTaskResultPart({
      taskId: "t-1",
      toolName: "worker",
      title: "My Task",
      status: "completed",
    });
    if (isTaskResultPart(part)) {
      expect(part.taskId).toBe("t-1");
      expect(part.toolName).toBe("worker");
      expect(part.title).toBe("My Task");
      expect(part.status).toBe("completed");
    } else {
      throw new Error("Expected isTaskResultPart to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// Part union discriminant
// ---------------------------------------------------------------------------
describe("Part discriminated union", () => {
  test("all 11 part variants have distinct type values", () => {
    const allParts = createAllPartVariants();
    const types = allParts.map((p) => p.type);
    const uniqueTypes = new Set(types);
    expect(uniqueTypes.size).toBe(11);
  });

  test("every part has an id, type, and createdAt field", () => {
    const allParts = createAllPartVariants();
    for (const part of allParts) {
      expect(typeof part.id).toBe("string");
      expect(typeof part.type).toBe("string");
      expect(typeof part.createdAt).toBe("string");
    }
  });

  test("part type values cover the expected set", () => {
    const allParts = createAllPartVariants();
    const types = new Set(allParts.map((p) => p.type));
    const expected = [
      "text",
      "reasoning",
      "tool",
      "agent",
      "task-list",
      "skill-load",
      "mcp-snapshot",
      "agent-list",
      "truncation",
      "task-result",
      "workflow-step",
    ];
    for (const t of expected) {
      expect(types.has(t as Part["type"])).toBe(true);
    }
    expect(types.size).toBe(expected.length);
  });
});

// ---------------------------------------------------------------------------
// ToolState discriminated union
// ---------------------------------------------------------------------------
describe("ToolState", () => {
  test("pending state has only status field", () => {
    const state: ToolState = { status: "pending" };
    expect(state.status).toBe("pending");
  });

  test("running state includes startedAt", () => {
    const state: ToolState = { status: "running", startedAt: new Date().toISOString() };
    expect(state.status).toBe("running");
    expect(typeof state.startedAt).toBe("string");
  });

  test("completed state includes output and durationMs", () => {
    const state: ToolState = { status: "completed", output: { data: 42 }, durationMs: 150 };
    expect(state.status).toBe("completed");
    expect(state.output).toEqual({ data: 42 });
    expect(state.durationMs).toBe(150);
  });

  test("error state includes error message and optional output", () => {
    const state: ToolState = { status: "error", error: "timeout", output: "partial" };
    expect(state.status).toBe("error");
    expect(state.error).toBe("timeout");
    expect(state.output).toBe("partial");
  });

  test("interrupted state has optional fields", () => {
    const state: ToolState = { status: "interrupted", partialOutput: "some", durationMs: 30 };
    expect(state.status).toBe("interrupted");
    expect(state.partialOutput).toBe("some");
    expect(state.durationMs).toBe(30);
  });

  test("ToolExecutionStatus covers all five statuses", () => {
    const statuses: ToolExecutionStatus[] = [
      "pending",
      "running",
      "completed",
      "error",
      "interrupted",
    ];
    expect(statuses).toHaveLength(5);
    const unique = new Set(statuses);
    expect(unique.size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Cross-guard consistency
// ---------------------------------------------------------------------------
describe("type guard cross-checks", () => {
  test("exactly one type guard returns true for each Part variant", () => {
    const guards = [
      isTextPart,
      isReasoningPart,
      isToolPart,
      isAgentPart,
      isTaskListPart,
      isSkillLoadPart,
      isTruncationPart,
      isTaskResultPart,
    ];

    const allParts = createAllPartVariants();
    for (const part of allParts) {
      const matches = guards.filter((guard) => guard(part));
      // Parts with a guard should match exactly once; parts without a guard match zero times
      // (mcp-snapshot, agent-list, workflow-step have no dedicated guard in types.ts)
      const hasGuard = ["text", "reasoning", "tool", "agent", "task-list", "skill-load", "truncation", "task-result"]
        .includes(part.type);

      if (hasGuard) {
        expect(matches).toHaveLength(1);
      } else {
        expect(matches).toHaveLength(0);
      }
    }
  });

  test("guards work correctly when called in sequence on the same part", () => {
    const textPart: Part = createTextPart();

    // First call
    expect(isTextPart(textPart)).toBe(true);
    // Second call — guard is pure, should return same result
    expect(isTextPart(textPart)).toBe(true);

    // Other guards still return false
    expect(isReasoningPart(textPart)).toBe(false);
    expect(isToolPart(textPart)).toBe(false);
  });
});
