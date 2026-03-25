import { test, describe, expect, beforeEach } from "bun:test";
import {
  isSubagentToolName,
  toToolState,
  upsertToolPartStart,
  upsertToolPartComplete,
  applyToolPartialResultToParts,
} from "@/state/streaming/pipeline-tools.ts";
import {
  upsertHitlRequest,
  applyHitlResponse,
} from "@/state/streaming/pipeline-tools/hitl.ts";
import {
  createToolPart,
  createRunningToolState,
  resetPartIdCounter,
} from "../../test-support/fixtures/parts.ts";
import { _resetPartCounter } from "@/state/parts/id.ts";
import type { ChatMessage } from "@/types/chat.ts";
import type { Part, ToolPart } from "@/state/parts/types.ts";
import type {
  HitlRequestEvent,
  HitlResponseEvent,
  ToolStartEvent,
  ToolCompleteEvent,
  ToolPartialResultEvent,
} from "@/state/streaming/pipeline-types.ts";

beforeEach(() => {
  _resetPartCounter();
  resetPartIdCounter();
});

// ---------------------------------------------------------------------------
// shared.ts
// ---------------------------------------------------------------------------

describe("isSubagentToolName", () => {
  test('returns true for "task"', () => {
    expect(isSubagentToolName("task")).toBe(true);
  });

  test('returns true for "agent"', () => {
    expect(isSubagentToolName("agent")).toBe(true);
  });

  test('returns true for "launch_agent"', () => {
    expect(isSubagentToolName("launch_agent")).toBe(true);
  });

  test("is case insensitive", () => {
    expect(isSubagentToolName("Task")).toBe(true);
    expect(isSubagentToolName("AGENT")).toBe(true);
    expect(isSubagentToolName("Launch_Agent")).toBe(true);
  });

  test("returns false for unrelated tool names", () => {
    expect(isSubagentToolName("Read")).toBe(false);
    expect(isSubagentToolName("Bash")).toBe(false);
    expect(isSubagentToolName("mcp__task")).toBe(false);
  });
});

describe("toToolState", () => {
  const fallbackTime = "2025-01-01T00:00:00.000Z";

  test('"pending" returns { status: "pending" }', () => {
    const result = toToolState("pending", undefined, fallbackTime);
    expect(result).toEqual({ status: "pending" });
  });

  test('"running" returns { status: "running", startedAt }', () => {
    const result = toToolState("running", undefined, fallbackTime);
    expect(result).toEqual({ status: "running", startedAt: fallbackTime });
  });

  test('"running" preserves existing startedAt if already running', () => {
    const existingStartedAt = "2024-06-15T12:00:00.000Z";
    const existing = createRunningToolState({
      startedAt: existingStartedAt,
    });
    const result = toToolState("running", undefined, fallbackTime, existing);
    expect(result).toEqual({
      status: "running",
      startedAt: existingStartedAt,
    });
  });

  test('"completed" returns { status: "completed", output, durationMs: 0 }', () => {
    const result = toToolState("completed", "some output", fallbackTime);
    expect(result).toEqual({
      status: "completed",
      output: "some output",
      durationMs: 0,
    });
  });

  test('"error" returns { status: "error", error, output }', () => {
    const result = toToolState("error", "error details", fallbackTime);
    expect(result).toEqual({
      status: "error",
      error: "error details",
      output: "error details",
    });
  });

  test('"error" with empty output uses "Tool execution failed" as default', () => {
    const result = toToolState("error", "", fallbackTime);
    expect(result).toEqual({
      status: "error",
      error: "Tool execution failed",
      output: "",
    });
  });

  test('"interrupted" calculates durationMs from existing running state', () => {
    const startedAt = new Date(Date.now() - 500).toISOString();
    const existing = createRunningToolState({ startedAt });
    const result = toToolState("interrupted", "partial", fallbackTime, existing);
    expect(result.status).toBe("interrupted");
    expect((result as { durationMs?: number }).durationMs).toBeGreaterThanOrEqual(0);
    expect((result as { partialOutput: unknown }).partialOutput).toBe("partial");
  });
});

// ---------------------------------------------------------------------------
// hitl.ts
// ---------------------------------------------------------------------------

function makeHitlRequestEvent(
  overrides?: Partial<HitlRequestEvent>,
): HitlRequestEvent {
  return {
    type: "tool-hitl-request" as const,
    toolId: "tool-1",
    request: {
      requestId: "req-1",
      header: "Permission",
      question: "Allow?",
      options: [],
      multiSelect: false,
      respond: () => {},
    },
    ...overrides,
  };
}

function makeHitlResponseEvent(
  overrides?: Partial<HitlResponseEvent>,
): HitlResponseEvent {
  return {
    type: "tool-hitl-response" as const,
    toolId: "tool-1",
    response: {
      answerText: "yes",
      cancelled: false,
      responseMode: "option" as const,
      displayText: "Allowed",
    },
    ...overrides,
  };
}

describe("upsertHitlRequest", () => {
  test("creates new ToolPart with pendingQuestion when no matching part exists", () => {
    const event = makeHitlRequestEvent();
    const result = upsertHitlRequest([], event);

    expect(result).toHaveLength(1);
    const part = result[0] as ToolPart;
    expect(part.type).toBe("tool");
    expect(part.toolCallId).toBe("tool-1");
    expect(part.toolName).toBe("AskUserQuestion");
    expect(part.pendingQuestion).toBe(event.request);
    expect(part.input).toEqual({
      header: "Permission",
      question: "Allow?",
      options: [],
    });
  });

  test("updates existing ToolPart with pendingQuestion when matching toolId found", () => {
    const existingPart = createToolPart({
      toolCallId: "tool-1",
      toolName: "AskUserQuestion",
      input: { existing: "data" },
    });
    const parts: Part[] = [existingPart];
    const event = makeHitlRequestEvent();

    const result = upsertHitlRequest(parts, event);

    expect(result).toHaveLength(1);
    const updated = result[0] as ToolPart;
    expect(updated.toolCallId).toBe("tool-1");
    expect(updated.pendingQuestion).toBe(event.request);
    // Existing non-empty input should be preserved
    expect(updated.input).toEqual({ existing: "data" });
  });
});

describe("applyHitlResponse", () => {
  test("updates ToolPart output with answer and response metadata", () => {
    const toolPart = createToolPart({
      toolCallId: "tool-1",
      toolName: "AskUserQuestion",
      pendingQuestion: makeHitlRequestEvent().request,
    });
    const message: ChatMessage = {
      id: "msg-1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      parts: [toolPart],
    };
    const event = makeHitlResponseEvent();

    const result = applyHitlResponse(message, event);
    const updatedPart = result.parts![0] as ToolPart;

    expect(updatedPart.pendingQuestion).toBeUndefined();
    expect(updatedPart.hitlResponse).toBe(event.response);
    const output = updatedPart.output as Record<string, unknown>;
    expect(output.answer).toBe("yes");
    expect(output.cancelled).toBe(false);
    expect(output.responseMode).toBe("option");
    expect(output.displayText).toBe("Allowed");
  });

  test("returns unchanged message when no matching tool part found", () => {
    const toolPart = createToolPart({
      toolCallId: "other-tool",
      toolName: "Read",
    });
    const message: ChatMessage = {
      id: "msg-1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      parts: [toolPart],
    };
    const event = makeHitlResponseEvent({ toolId: "nonexistent" });

    const result = applyHitlResponse(message, event);

    expect(result).toBe(message); // Same reference — no change
  });

  test("returns unchanged message when parts is empty", () => {
    const message: ChatMessage = {
      id: "msg-1",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      parts: [],
    };
    const event = makeHitlResponseEvent();

    const result = applyHitlResponse(message, event);

    expect(result).toBe(message);
  });
});

// ---------------------------------------------------------------------------
// tool-parts.ts
// ---------------------------------------------------------------------------

function makeToolStartEvent(
  overrides?: Partial<ToolStartEvent>,
): ToolStartEvent {
  return {
    type: "tool-start" as const,
    toolId: "tool-1",
    toolName: "Read",
    input: { file_path: "/tmp/test.ts" },
    startedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeToolCompleteEvent(
  overrides?: Partial<ToolCompleteEvent>,
): ToolCompleteEvent {
  return {
    type: "tool-complete" as const,
    toolId: "tool-1",
    output: "file contents here",
    success: true,
    ...overrides,
  };
}

describe("upsertToolPartStart", () => {
  test("creates new ToolPart with running state", () => {
    const event = makeToolStartEvent();
    const result = upsertToolPartStart([], event);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const toolPart = result.find(
      (p) => p.type === "tool" && (p as ToolPart).toolCallId === "tool-1",
    ) as ToolPart;
    expect(toolPart).toBeDefined();
    expect(toolPart.toolName).toBe("Read");
    expect(toolPart.input).toEqual({ file_path: "/tmp/test.ts" });
    expect(toolPart.state).toEqual({
      status: "running",
      startedAt: "2025-01-01T00:00:00.000Z",
    });
  });

  test("updates existing ToolPart to running state", () => {
    const existingPart = createToolPart({
      toolCallId: "tool-1",
      toolName: "unknown",
      state: { status: "pending" },
    });
    const parts: Part[] = [existingPart];
    const event = makeToolStartEvent();

    const result = upsertToolPartStart(parts, event);

    expect(result).toHaveLength(1);
    const updated = result[0] as ToolPart;
    expect(updated.toolCallId).toBe("tool-1");
    expect(updated.toolName).toBe("Read");
    expect(updated.state.status).toBe("running");
  });
});

describe("upsertToolPartComplete", () => {
  test("marks successful tool as completed with durationMs", () => {
    const startedAt = new Date(Date.now() - 100).toISOString();
    const existingPart = createToolPart({
      toolCallId: "tool-1",
      toolName: "Read",
      state: { status: "running", startedAt },
    });
    const parts: Part[] = [existingPart];
    const event = makeToolCompleteEvent({
      output: "result data",
      success: true,
    });

    const result = upsertToolPartComplete(parts, event);

    expect(result).toHaveLength(1);
    const updated = result[0] as ToolPart;
    expect(updated.state.status).toBe("completed");
    if (updated.state.status === "completed") {
      expect(updated.state.durationMs).toBeGreaterThanOrEqual(0);
      expect(updated.state.output).toBe("result data");
    }
    expect(updated.output).toBe("result data");
  });

  test("marks failed tool as error with error message", () => {
    const existingPart = createToolPart({
      toolCallId: "tool-1",
      toolName: "Read",
      state: { status: "running", startedAt: new Date().toISOString() },
    });
    const parts: Part[] = [existingPart];
    const event = makeToolCompleteEvent({
      success: false,
      error: "File not found",
      output: null,
    });

    const result = upsertToolPartComplete(parts, event);

    expect(result).toHaveLength(1);
    const updated = result[0] as ToolPart;
    expect(updated.state.status).toBe("error");
    if (updated.state.status === "error") {
      expect(updated.state.error).toBe("File not found");
    }
  });

  test("creates new completed ToolPart when no existing part", () => {
    const event = makeToolCompleteEvent({
      toolId: "new-tool",
      toolName: "Bash",
      output: "ok",
      success: true,
    });

    const result = upsertToolPartComplete([], event);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const toolPart = result.find(
      (p) => p.type === "tool" && (p as ToolPart).toolCallId === "new-tool",
    ) as ToolPart;
    expect(toolPart).toBeDefined();
    expect(toolPart.toolName).toBe("Bash");
    expect(toolPart.state.status).toBe("completed");
    if (toolPart.state.status === "completed") {
      expect(toolPart.state.durationMs).toBe(0);
    }
  });
});

describe("applyToolPartialResultToParts", () => {
  test("appends partial output to existing ToolPart", () => {
    const existingPart = createToolPart({
      toolCallId: "tool-1",
      toolName: "Bash",
      state: { status: "running", startedAt: new Date().toISOString() },
    });
    const parts: Part[] = [existingPart];

    const event: ToolPartialResultEvent = {
      type: "tool-partial-result",
      toolId: "tool-1",
      partialOutput: "line 1\n",
    };

    const result1 = applyToolPartialResultToParts(parts, event);
    const updated1 = result1[0] as ToolPart;
    expect(updated1.partialOutput).toBe("line 1\n");

    // Apply a second partial result to the updated parts
    const event2: ToolPartialResultEvent = {
      type: "tool-partial-result",
      toolId: "tool-1",
      partialOutput: "line 2\n",
    };
    const result2 = applyToolPartialResultToParts(result1, event2);
    const updated2 = result2[0] as ToolPart;
    expect(updated2.partialOutput).toBe("line 1\nline 2\n");
  });

  test("returns parts unchanged when no matching toolId", () => {
    const existingPart = createToolPart({
      toolCallId: "tool-1",
      toolName: "Bash",
    });
    const parts: Part[] = [existingPart];

    const event: ToolPartialResultEvent = {
      type: "tool-partial-result",
      toolId: "nonexistent",
      partialOutput: "data",
    };

    const result = applyToolPartialResultToParts(parts, event);

    expect(result).toBe(parts); // Same reference — no change
  });
});
