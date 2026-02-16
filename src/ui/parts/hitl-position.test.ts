/**
 * E2E tests for HITL inline position and sticky scroll
 *
 * These tests verify that HITL (Human-in-the-Loop) permission requests appear
 * inline at the correct position within the parts model, not as a fixed overlay.
 * The tests focus on verifying that pendingQuestion appears on the correct
 * ToolPart at the expected position in the parts array.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { handleTextDelta } from "./handlers.ts";
import { upsertPart, findLastPartIndex } from "./store.ts";
import { createPartId, _resetPartCounter } from "./id.ts";
import type { Part, TextPart, ToolPart } from "./types.ts";
import type { ChatMessage } from "../chat.tsx";

/**
 * Create a minimal ChatMessage mock for testing.
 */
function createMockMessage(): ChatMessage {
  return {
    id: "test-msg",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    parts: [],
    streaming: true,
  } as ChatMessage;
}

/**
 * Helper to finalize the last streaming TextPart.
 * Mimics what happens in chat.tsx when a tool starts.
 */
function finalizeLastTextPart(msg: ChatMessage): ChatMessage {
  const parts = [...(msg.parts ?? [])];
  const lastTextIdx = findLastPartIndex(parts, p => p.type === "text" && (p as TextPart).isStreaming);
  if (lastTextIdx >= 0) {
    parts[lastTextIdx] = { ...parts[lastTextIdx], isStreaming: false } as TextPart;
  }
  return { ...msg, parts };
}

/**
 * Helper to create a TextPart.
 */
function createTextPart(content: string, isStreaming = false): TextPart {
  return {
    id: createPartId(),
    type: "text",
    content,
    isStreaming,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Helper to create a ToolPart.
 */
function createToolPart(
  toolCallId: string,
  toolName: string,
  status: "pending" | "running" | "completed" = "running"
): ToolPart {
  const basePart: ToolPart = {
    id: createPartId(),
    type: "tool",
    toolCallId,
    toolName,
    input: { path: "/etc/passwd" },
    state: status === "completed" 
      ? { status: "completed", output: "success", durationMs: 200 }
      : status === "running"
      ? { status: "running", startedAt: new Date().toISOString() }
      : { status: "pending" },
    createdAt: new Date().toISOString(),
  };
  return basePart;
}

/**
 * Helper to add a pendingQuestion to a ToolPart.
 */
function addPendingQuestion(toolPart: ToolPart, requestId: string): ToolPart {
  return {
    ...toolPart,
    pendingQuestion: {
      requestId,
      header: "Permission needed",
      question: "Allow this operation?",
      options: [
        { label: "Allow", value: "allow" },
        { label: "Deny", value: "deny" },
      ],
      multiSelect: false,
      respond: () => {},
    },
  };
}

/**
 * Helper to replace pendingQuestion with hitlResponse.
 */
function respondToHitl(toolPart: ToolPart, answer: string): ToolPart {
  return {
    ...toolPart,
    pendingQuestion: undefined,
    hitlResponse: {
      cancelled: false,
      responseMode: "option",
      answerText: answer,
      displayText: `User answered: "${answer}"`,
    },
  };
}

describe("HITL inline position", () => {
  beforeEach(() => {
    _resetPartCounter();
  });

  test("HITL appears at correct ToolPart position after text → tool.start → permission.request", () => {
    // Simulate: text → tool.start → permission.request
    let msg = createMockMessage();
    
    // 1. Text streaming
    msg = handleTextDelta(msg, "I'll read the file.");
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.type).toBe("text");
    
    // 2. Finalize text before tool starts
    msg = finalizeLastTextPart(msg);
    
    // 3. Tool starts
    const toolPart = createToolPart("tc-1", "read_file", "running");
    msg.parts = upsertPart(msg.parts ?? [], toolPart);
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    
    // 4. Permission request adds pendingQuestion to the ToolPart
    const toolWithQuestion = addPendingQuestion(toolPart, "req-1");
    msg.parts = upsertPart(msg.parts ?? [], toolWithQuestion);
    
    // Verify position: pendingQuestion is on the ToolPart that comes after the TextPart
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    
    const toolPartAtIndex1 = msg.parts![1] as ToolPart;
    expect(toolPartAtIndex1.pendingQuestion).toBeDefined();
    expect(toolPartAtIndex1.pendingQuestion?.requestId).toBe("req-1");
  });

  test("HITL position is inline with tool (not a separate part)", () => {
    // Verify that pendingQuestion is directly on the ToolPart, not a separate part
    let parts: Part[] = [];
    
    const toolPart = createToolPart("tc-2", "bash", "running");
    parts = upsertPart(parts, toolPart);
    
    // Add pendingQuestion
    const toolWithQuestion = addPendingQuestion(toolPart, "req-2");
    parts = upsertPart(parts, toolWithQuestion);
    
    // Verify: only 1 part exists (the ToolPart), not 2
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe("tool");
    expect((parts[0] as ToolPart).pendingQuestion).toBeDefined();
    expect((parts[0] as ToolPart).pendingQuestion?.requestId).toBe("req-2");
  });

  test("After HITL response, hitlResponse replaces pendingQuestion at same position", () => {
    let parts: Part[] = [];
    
    // 1. Create tool with pendingQuestion
    const toolPart = createToolPart("tc-3", "write_file", "running");
    const toolWithQuestion = addPendingQuestion(toolPart, "req-3");
    parts = upsertPart(parts, toolWithQuestion);
    
    expect(parts).toHaveLength(1);
    const toolBefore = parts[0] as ToolPart;
    expect(toolBefore.pendingQuestion).toBeDefined();
    expect(toolBefore.pendingQuestion?.requestId).toBe("req-3");
    expect(toolBefore.hitlResponse).toBeUndefined();
    
    // 2. User responds to HITL
    const toolWithResponse = respondToHitl(toolWithQuestion, "allow");
    parts = upsertPart(parts, toolWithResponse);
    
    // Verify: same position (index 0), pendingQuestion cleared, hitlResponse set
    expect(parts).toHaveLength(1);
    const toolAfter = parts[0] as ToolPart;
    expect(toolAfter.pendingQuestion).toBeUndefined();
    expect(toolAfter.hitlResponse).toBeDefined();
    expect(toolAfter.hitlResponse?.answerText).toBe("allow");
    
    // Verify it's the same ToolPart ID (same position)
    expect(toolAfter.id).toBe(toolWithQuestion.id);
  });

  test("Multiple sequential HITL requests maintain correct positions", () => {
    let msg = createMockMessage();
    
    // Scenario: tool1 → HITL1 → tool2 → HITL2
    
    // 1. Tool 1 with HITL
    const tool1 = createToolPart("tc-4", "read_file", "running");
    const tool1WithQuestion = addPendingQuestion(tool1, "req-4");
    msg.parts = upsertPart(msg.parts ?? [], tool1WithQuestion);
    
    // 2. Tool 2 with HITL
    const tool2 = createToolPart("tc-5", "bash", "running");
    const tool2WithQuestion = addPendingQuestion(tool2, "req-5");
    msg.parts = upsertPart(msg.parts ?? [], tool2WithQuestion);
    
    // Verify: 2 parts, each with its own pendingQuestion
    expect(msg.parts).toHaveLength(2);
    
    const toolPart1 = msg.parts![0] as ToolPart;
    expect(toolPart1.type).toBe("tool");
    expect(toolPart1.toolCallId).toBe("tc-4");
    expect(toolPart1.pendingQuestion).toBeDefined();
    expect(toolPart1.pendingQuestion?.requestId).toBe("req-4");
    
    const toolPart2 = msg.parts![1] as ToolPart;
    expect(toolPart2.type).toBe("tool");
    expect(toolPart2.toolCallId).toBe("tc-5");
    expect(toolPart2.pendingQuestion).toBeDefined();
    expect(toolPart2.pendingQuestion?.requestId).toBe("req-5");
    
    // Verify they maintain separate HITL states
    expect(toolPart1.pendingQuestion?.requestId).not.toBe(toolPart2.pendingQuestion?.requestId);
  });

  test("HITL on second tool in sequence: text → tool1(complete) → tool2(HITL)", () => {
    let msg = createMockMessage();
    
    // 1. Text
    msg = handleTextDelta(msg, "Starting operations.");
    msg = finalizeLastTextPart(msg);
    
    // 2. Tool 1 completes (no HITL)
    const tool1 = createToolPart("tc-6", "list_files", "completed");
    msg.parts = upsertPart(msg.parts ?? [], tool1);
    
    // 3. Tool 2 with HITL
    const tool2 = createToolPart("tc-7", "delete_file", "running");
    const tool2WithQuestion = addPendingQuestion(tool2, "req-6");
    msg.parts = upsertPart(msg.parts ?? [], tool2WithQuestion);
    
    // Verify structure: TextPart, Tool1Part (no HITL), Tool2Part (with HITL)
    expect(msg.parts).toHaveLength(3);
    
    expect(msg.parts![0]!.type).toBe("text");
    
    const toolPart1 = msg.parts![1] as ToolPart;
    expect(toolPart1.type).toBe("tool");
    expect(toolPart1.toolCallId).toBe("tc-6");
    expect(toolPart1.state.status).toBe("completed");
    expect(toolPart1.pendingQuestion).toBeUndefined();
    
    const toolPart2 = msg.parts![2] as ToolPart;
    expect(toolPart2.type).toBe("tool");
    expect(toolPart2.toolCallId).toBe("tc-7");
    expect(toolPart2.pendingQuestion).toBeDefined();
    expect(toolPart2.pendingQuestion?.requestId).toBe("req-6");
    
    // Verify HITL is specifically on tool2, not tool1
    expect(toolPart2.pendingQuestion?.requestId).toBe("req-6");
  });

  test("HITL maintains position across message updates", () => {
    let msg = createMockMessage();
    
    // Build up a message with text → tool → more text
    msg = handleTextDelta(msg, "Before tool");
    msg = finalizeLastTextPart(msg);
    
    const tool = createToolPart("tc-8", "sensitive_operation", "running");
    const toolWithQuestion = addPendingQuestion(tool, "req-7");
    msg.parts = upsertPart(msg.parts ?? [], toolWithQuestion);
    
    msg = handleTextDelta(msg, "After tool");
    
    // Verify: text1 → tool (with HITL) → text2
    expect(msg.parts).toHaveLength(3);
    expect(msg.parts![0]!.type).toBe("text");
    expect((msg.parts![0] as TextPart).content).toBe("Before tool");
    
    const toolPart = msg.parts![1] as ToolPart;
    expect(toolPart.type).toBe("tool");
    expect(toolPart.pendingQuestion).toBeDefined();
    expect(toolPart.pendingQuestion?.requestId).toBe("req-7");
    
    expect(msg.parts![2]!.type).toBe("text");
    expect((msg.parts![2] as TextPart).content).toBe("After tool");
    
    // Verify HITL is at index 1 (between the two text parts)
    const hitlPosition = 1;
    expect((msg.parts![hitlPosition] as ToolPart).pendingQuestion).toBeDefined();
  });

  test("HITL position persists during streaming text after tool", () => {
    let msg = createMockMessage();
    
    // Tool with HITL
    const tool = createToolPart("tc-9", "dangerous_cmd", "running");
    const toolWithQuestion = addPendingQuestion(tool, "req-8");
    msg.parts = upsertPart(msg.parts ?? [], toolWithQuestion);
    
    // Stream text after tool
    msg = handleTextDelta(msg, "Waiting for permission...");
    msg = handleTextDelta(msg, " Please approve.");
    
    // Verify: tool (with HITL) → streaming text
    expect(msg.parts).toHaveLength(2);
    
    const toolPart = msg.parts![0] as ToolPart;
    expect(toolPart.type).toBe("tool");
    expect(toolPart.pendingQuestion).toBeDefined();
    expect(toolPart.pendingQuestion?.requestId).toBe("req-8");
    
    const textPart = msg.parts![1] as TextPart;
    expect(textPart.type).toBe("text");
    expect(textPart.content).toBe("Waiting for permission... Please approve.");
    expect(textPart.isStreaming).toBe(true);
    
    // HITL remains at position 0
    expect((msg.parts![0] as ToolPart).pendingQuestion?.requestId).toBe("req-8");
  });

  test("Complex scenario: multiple tools with mixed HITL states", () => {
    let msg = createMockMessage();
    
    // Simulate: text → tool1(no HITL) → tool2(HITL) → tool3(no HITL) → tool4(HITL)
    
    msg = handleTextDelta(msg, "Starting complex operation");
    msg = finalizeLastTextPart(msg);
    
    // Tool 1 - no HITL
    const tool1 = createToolPart("tc-10", "safe_read", "completed");
    msg.parts = upsertPart(msg.parts ?? [], tool1);
    
    // Tool 2 - with HITL
    const tool2 = createToolPart("tc-11", "sensitive_read", "running");
    const tool2WithQuestion = addPendingQuestion(tool2, "req-9");
    msg.parts = upsertPart(msg.parts ?? [], tool2WithQuestion);
    
    // Tool 3 - no HITL
    const tool3 = createToolPart("tc-12", "list_dir", "completed");
    msg.parts = upsertPart(msg.parts ?? [], tool3);
    
    // Tool 4 - with HITL
    const tool4 = createToolPart("tc-13", "write_config", "running");
    const tool4WithQuestion = addPendingQuestion(tool4, "req-10");
    msg.parts = upsertPart(msg.parts ?? [], tool4WithQuestion);
    
    // Verify structure
    expect(msg.parts).toHaveLength(5);
    
    expect(msg.parts![0]!.type).toBe("text");
    
    const t1 = msg.parts![1] as ToolPart;
    expect(t1.toolCallId).toBe("tc-10");
    expect(t1.pendingQuestion).toBeUndefined();
    
    const t2 = msg.parts![2] as ToolPart;
    expect(t2.toolCallId).toBe("tc-11");
    expect(t2.pendingQuestion).toBeDefined();
    expect(t2.pendingQuestion?.requestId).toBe("req-9");
    
    const t3 = msg.parts![3] as ToolPart;
    expect(t3.toolCallId).toBe("tc-12");
    expect(t3.pendingQuestion).toBeUndefined();
    
    const t4 = msg.parts![4] as ToolPart;
    expect(t4.toolCallId).toBe("tc-13");
    expect(t4.pendingQuestion).toBeDefined();
    expect(t4.pendingQuestion?.requestId).toBe("req-10");
    
    // Verify only tools 2 and 4 have HITL
    const partsWithHitl = msg.parts!.filter(
      p => p.type === "tool" && (p as ToolPart).pendingQuestion !== undefined
    );
    expect(partsWithHitl).toHaveLength(2);
  });

  test("HITL response preserves part order and positions", () => {
    let msg = createMockMessage();
    
    // Create 3 tools with HITL
    const tool1 = createToolPart("tc-14", "op1", "running");
    const tool1WithQuestion = addPendingQuestion(tool1, "req-11");
    msg.parts = upsertPart(msg.parts ?? [], tool1WithQuestion);
    
    const tool2 = createToolPart("tc-15", "op2", "running");
    const tool2WithQuestion = addPendingQuestion(tool2, "req-12");
    msg.parts = upsertPart(msg.parts ?? [], tool2WithQuestion);
    
    const tool3 = createToolPart("tc-16", "op3", "running");
    const tool3WithQuestion = addPendingQuestion(tool3, "req-13");
    msg.parts = upsertPart(msg.parts ?? [], tool3WithQuestion);
    
    // Respond to middle tool (tool2)
    const tool2WithResponse = respondToHitl(tool2WithQuestion, "allow");
    msg.parts = upsertPart(msg.parts ?? [], tool2WithResponse);
    
    // Verify: 3 tools maintain their positions
    expect(msg.parts).toHaveLength(3);
    
    const t1 = msg.parts![0] as ToolPart;
    expect(t1.toolCallId).toBe("tc-14");
    expect(t1.pendingQuestion?.requestId).toBe("req-11");
    expect(t1.hitlResponse).toBeUndefined();
    
    const t2 = msg.parts![1] as ToolPart;
    expect(t2.toolCallId).toBe("tc-15");
    expect(t2.pendingQuestion).toBeUndefined();
    expect(t2.hitlResponse).toBeDefined();
    expect(t2.hitlResponse?.answerText).toBe("allow");
    
    const t3 = msg.parts![2] as ToolPart;
    expect(t3.toolCallId).toBe("tc-16");
    expect(t3.pendingQuestion?.requestId).toBe("req-13");
    expect(t3.hitlResponse).toBeUndefined();
    
    // Verify order is maintained
    expect(t1.id < t2.id).toBe(true);
    expect(t2.id < t3.id).toBe(true);
  });
});
