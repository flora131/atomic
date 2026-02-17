/**
 * E2E tests for complete message stream render order
 *
 * These tests verify the complete order of parts in a message after a full
 * streaming session with text, tools, agents, and HITL events. The tests
 * simulate real streaming scenarios and verify both part types AND chronological
 * ordering via monotonically increasing IDs.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { handleTextDelta } from "./handlers.ts";
import { upsertPart, findLastPartIndex } from "./store.ts";
import { createPartId, _resetPartCounter } from "./id.ts";
import type { Part, TextPart, ToolPart, AgentPart, ReasoningPart } from "./types.ts";
import type { ChatMessage } from "../chat.tsx";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

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
 * Helper to create a ReasoningPart.
 */
function createReasoningPart(content: string, isStreaming = false): ReasoningPart {
  return {
    id: createPartId(),
    type: "reasoning",
    content,
    durationMs: 100,
    isStreaming,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Helper to create a ToolPart.
 */
function createToolPart(toolCallId: string, toolName: string, status: "pending" | "running" | "completed" = "running"): ToolPart {
  const basePart: ToolPart = {
    id: createPartId(),
    type: "tool",
    toolCallId,
    toolName,
    input: { command: "test" },
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
 * Helper to create an AgentPart.
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

/**
 * Helper to create a mock ParallelAgent.
 */
function createMockAgent(id: string, name: string, background = false): ParallelAgent {
  return {
    id,
    name,
    task: "Test task",
    status: "running",
    background,
    startedAt: new Date().toISOString(),
  };
}

/**
 * Helper to add a HITL question to a ToolPart.
 */
function addHitlQuestion(toolPart: ToolPart, requestId: string): ToolPart {
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
 * Helper to resolve a HITL question and set response.
 */
function resolveHitlQuestion(toolPart: ToolPart, answer: string): ToolPart {
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

/**
 * Verify that part IDs are monotonically increasing (chronological order).
 */
function verifyMonotonicIds(parts: Part[]): void {
  for (let i = 1; i < parts.length; i++) {
    const prevId = parts[i - 1]!.id;
    const currId = parts[i]!.id;
    expect(currId > prevId).toBe(true);
  }
}

beforeEach(() => {
  _resetPartCounter();
});

describe("Stream render order E2E", () => {
  test("simple text-only stream", () => {
    let msg = createMockMessage();
    
    // Stream text in multiple chunks
    msg = handleTextDelta(msg, "Hello ");
    msg = handleTextDelta(msg, "world");
    msg = handleTextDelta(msg, "!");
    
    // Verify single TextPart with accumulated content
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.type).toBe("text");
    const textPart = msg.parts![0] as TextPart;
    expect(textPart.content).toBe("Hello world!");
    expect(textPart.isStreaming).toBe(true);
  });

  test("text → tool → text sequence", () => {
    let msg = createMockMessage();
    
    // 1. Text before tool
    msg = handleTextDelta(msg, "Running command...");
    expect(msg.parts).toHaveLength(1);
    
    // 2. Tool starts (finalizes text, creates tool)
    msg = finalizeLastTextPart(msg);
    const toolPart = createToolPart("tool_1", "bash");
    msg.parts = upsertPart(msg.parts!, toolPart);
    expect(msg.parts).toHaveLength(2);
    
    // 3. Text after tool
    msg = handleTextDelta(msg, " Done!");
    expect(msg.parts).toHaveLength(3);
    
    // Verify order: [TextPart, ToolPart, TextPart]
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("text");
    
    // Verify content
    expect((msg.parts![0] as TextPart).content).toBe("Running command...");
    expect((msg.parts![0] as TextPart).isStreaming).toBe(false);
    expect((msg.parts![1] as ToolPart).toolName).toBe("bash");
    expect((msg.parts![2] as TextPart).content).toBe(" Done!");
    expect((msg.parts![2] as TextPart).isStreaming).toBe(true);
    
    // Verify monotonic IDs
    verifyMonotonicIds(msg.parts!);
  });

  test("text → tool → HITL → response → text", () => {
    let msg = createMockMessage();
    
    // 1. Text before tool
    msg = handleTextDelta(msg, "Need permission for:");
    msg = finalizeLastTextPart(msg);
    
    // 2. Tool starts
    let toolPart = createToolPart("tool_1", "read_file");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    // 3. HITL request
    const toolIdx = msg.parts!.findIndex(p => p.type === "tool" && (p as ToolPart).toolCallId === "tool_1");
    toolPart = addHitlQuestion(msg.parts![toolIdx] as ToolPart, "req_1");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    // 4. HITL response
    toolPart = resolveHitlQuestion(toolPart, "allow");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    // 5. Tool completes
    toolPart = {
      ...toolPart,
      state: { status: "completed", output: "file content", durationMs: 150 },
    };
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    // 6. Text after tool
    msg = handleTextDelta(msg, " Permission granted and file read.");
    
    // Verify order: [TextPart, ToolPart, TextPart]
    expect(msg.parts).toHaveLength(3);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("text");
    
    // Verify HITL state
    const tool = msg.parts![1] as ToolPart;
    expect(tool.pendingQuestion).toBeUndefined();
    expect(tool.hitlResponse).toBeDefined();
    expect(tool.hitlResponse?.answerText).toBe("allow");
    expect(tool.state.status).toBe("completed");
    
    // Verify monotonic IDs
    verifyMonotonicIds(msg.parts!);
  });

  test("text → multiple tools → text", () => {
    let msg = createMockMessage();
    
    // 1. Initial text
    msg = handleTextDelta(msg, "Starting sequence:");
    msg = finalizeLastTextPart(msg);
    
    // 2. Tool 1
    const tool1 = createToolPart("tool_1", "bash");
    msg.parts = upsertPart(msg.parts!, tool1);
    
    // 3. Tool 2
    const tool2 = createToolPart("tool_2", "view");
    msg.parts = upsertPart(msg.parts!, tool2);
    
    // 4. Final text
    msg = handleTextDelta(msg, " All done!");
    
    // Verify order: [TextPart, ToolPart, ToolPart, TextPart]
    expect(msg.parts).toHaveLength(4);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("tool");
    expect(msg.parts![3]!.type).toBe("text");
    
    // Verify tool names
    expect((msg.parts![1] as ToolPart).toolName).toBe("bash");
    expect((msg.parts![2] as ToolPart).toolName).toBe("view");
    
    // Verify content
    expect((msg.parts![0] as TextPart).content).toBe("Starting sequence:");
    expect((msg.parts![3] as TextPart).content).toBe(" All done!");
    
    // Verify monotonic IDs
    verifyMonotonicIds(msg.parts!);
  });

  test("agent spawn mid-stream", () => {
    let msg = createMockMessage();
    
    // 1. Text before agent
    msg = handleTextDelta(msg, "Spawning agent...");
    msg = finalizeLastTextPart(msg);
    
    // 2. Agent spawns
    const agent = createMockAgent("agent_1", "debugger", false);
    const agentPart = createAgentPart([agent]);
    msg.parts = upsertPart(msg.parts!, agentPart);
    
    // 3. Tool in agent context
    const toolPart = createToolPart("tool_1", "bash");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    // 4. Text after tool
    msg = handleTextDelta(msg, " Agent completed.");
    
    // Verify order: [TextPart, AgentPart, ToolPart, TextPart]
    expect(msg.parts).toHaveLength(4);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("agent");
    expect(msg.parts![2]!.type).toBe("tool");
    expect(msg.parts![3]!.type).toBe("text");
    
    // Verify agent
    const agentPartResult = msg.parts![1] as AgentPart;
    expect(agentPartResult.agents).toHaveLength(1);
    expect(agentPartResult.agents[0]!.name).toBe("debugger");
    
    // Verify monotonic IDs
    verifyMonotonicIds(msg.parts!);
  });

  test("complex realistic scenario: text → reasoning → tool (with HITL) → tool → agent → text", () => {
    let msg = createMockMessage();
    
    // 1. Initial text
    msg = handleTextDelta(msg, "Let me think about this...");
    msg = finalizeLastTextPart(msg);
    expect(msg.parts).toHaveLength(1);
    
    // 2. Reasoning part
    const reasoning = createReasoningPart("I need to check the file first", false);
    msg.parts = upsertPart(msg.parts!, reasoning);
    expect(msg.parts).toHaveLength(2);
    
    // 3. Text after reasoning
    msg = handleTextDelta(msg, " Now checking file...");
    msg = finalizeLastTextPart(msg);
    expect(msg.parts).toHaveLength(3);
    
    // 4. Tool 1 with HITL
    let tool1 = createToolPart("tool_1", "view", "running");
    msg.parts = upsertPart(msg.parts!, tool1);
    expect(msg.parts).toHaveLength(4);
    
    // 5. HITL request on tool1
    const tool1Idx = msg.parts!.findIndex(p => p.type === "tool" && (p as ToolPart).toolCallId === "tool_1");
    tool1 = addHitlQuestion(msg.parts![tool1Idx] as ToolPart, "req_1");
    msg.parts = upsertPart(msg.parts!, tool1);
    
    // 6. HITL response and tool1 completes
    tool1 = resolveHitlQuestion(tool1, "allow");
    tool1 = { ...tool1, state: { status: "completed", output: "file content", durationMs: 100 } };
    msg.parts = upsertPart(msg.parts!, tool1);
    
    // 7. Tool 2 (no HITL)
    const tool2 = createToolPart("tool_2", "edit", "completed");
    msg.parts = upsertPart(msg.parts!, tool2);
    expect(msg.parts).toHaveLength(5);
    
    // 8. Agent spawn (background)
    const agent = createMockAgent("agent_1", "task", true);
    const agentPart = createAgentPart([agent], tool2.id);
    msg.parts = upsertPart(msg.parts!, agentPart);
    expect(msg.parts).toHaveLength(6);
    
    // 9. Final text
    msg = handleTextDelta(msg, " Background task is running.");
    expect(msg.parts).toHaveLength(7);
    
    // Verify complete order
    expect(msg.parts![0]!.type).toBe("text");     // "Let me think about this..."
    expect(msg.parts![1]!.type).toBe("reasoning"); // reasoning
    expect(msg.parts![2]!.type).toBe("text");     // "Now checking file..."
    expect(msg.parts![3]!.type).toBe("tool");     // tool1 with HITL
    expect(msg.parts![4]!.type).toBe("tool");     // tool2
    expect(msg.parts![5]!.type).toBe("agent");    // agent spawn
    expect(msg.parts![6]!.type).toBe("text");     // "Background task is running."
    
    // Verify HITL on tool1
    const finalTool1 = msg.parts![3] as ToolPart;
    expect(finalTool1.hitlResponse).toBeDefined();
    expect(finalTool1.hitlResponse?.answerText).toBe("allow");
    expect(finalTool1.state.status).toBe("completed");
    
    // Verify agent is background
    const finalAgent = msg.parts![5] as AgentPart;
    expect(finalAgent.agents[0]!.background).toBe(true);
    expect(finalAgent.parentToolPartId).toBe(tool2.id);
    
    // Verify monotonic IDs (critical for chronological order)
    verifyMonotonicIds(msg.parts!);
    
    // Verify specific ID ordering
    expect(msg.parts![0]!.id < msg.parts![1]!.id).toBe(true); // text < reasoning
    expect(msg.parts![1]!.id < msg.parts![2]!.id).toBe(true); // reasoning < text
    expect(msg.parts![2]!.id < msg.parts![3]!.id).toBe(true); // text < tool1
    expect(msg.parts![3]!.id < msg.parts![4]!.id).toBe(true); // tool1 < tool2
    expect(msg.parts![4]!.id < msg.parts![5]!.id).toBe(true); // tool2 < agent
    expect(msg.parts![5]!.id < msg.parts![6]!.id).toBe(true); // agent < text
  });

  test("parts maintain chronological order via IDs", () => {
    let msg = createMockMessage();
    
    // Create parts in various orders
    const part1 = createTextPart("First", false);
    const part2 = createReasoningPart("Second", false);
    const part3 = createToolPart("tool_1", "bash", "running");
    const part4 = createTextPart("Fourth", false);
    const part5 = createToolPart("tool_2", "view", "completed");
    
    // Add parts in order
    msg.parts = upsertPart(msg.parts!, part1);
    msg.parts = upsertPart(msg.parts!, part2);
    msg.parts = upsertPart(msg.parts!, part3);
    msg.parts = upsertPart(msg.parts!, part4);
    msg.parts = upsertPart(msg.parts!, part5);
    
    // Verify all IDs are lexicographically ordered
    expect(msg.parts).toHaveLength(5);
    verifyMonotonicIds(msg.parts!);
    
    // Verify each part.id is greater than previous
    for (let i = 1; i < msg.parts!.length; i++) {
      const prevPart = msg.parts![i - 1]!;
      const currPart = msg.parts![i]!;
      
      // Lexicographic comparison
      expect(currPart.id > prevPart.id).toBe(true);
      
      // Verify the IDs follow the part_<timestamp>_<counter> format
      expect(prevPart.id).toMatch(/^part_[0-9a-f]{12}_[0-9a-f]{4}$/);
      expect(currPart.id).toMatch(/^part_[0-9a-f]{12}_[0-9a-f]{4}$/);
    }
  });

  test("empty stream produces no parts", () => {
    const msg = createMockMessage();
    
    // No streaming events
    expect(msg.parts).toHaveLength(0);
  });

  test("consecutive reasoning parts maintain order", () => {
    let msg = createMockMessage();
    
    // Multiple reasoning parts (edge case)
    const reasoning1 = createReasoningPart("First thought", false);
    msg.parts = upsertPart(msg.parts!, reasoning1);
    
    const reasoning2 = createReasoningPart("Second thought", false);
    msg.parts = upsertPart(msg.parts!, reasoning2);
    
    const reasoning3 = createReasoningPart("Third thought", false);
    msg.parts = upsertPart(msg.parts!, reasoning3);
    
    // Verify order
    expect(msg.parts).toHaveLength(3);
    expect(msg.parts![0]!.type).toBe("reasoning");
    expect(msg.parts![1]!.type).toBe("reasoning");
    expect(msg.parts![2]!.type).toBe("reasoning");
    
    // Verify content
    expect((msg.parts![0] as ReasoningPart).content).toBe("First thought");
    expect((msg.parts![1] as ReasoningPart).content).toBe("Second thought");
    expect((msg.parts![2] as ReasoningPart).content).toBe("Third thought");
    
    // Verify monotonic IDs
    verifyMonotonicIds(msg.parts!);
  });

  test("interleaved text and tool calls", () => {
    let msg = createMockMessage();
    
    // Text → Tool → Text → Tool → Text (complex interleaving)
    msg = handleTextDelta(msg, "First");
    msg = finalizeLastTextPart(msg);
    
    const tool1 = createToolPart("tool_1", "bash");
    msg.parts = upsertPart(msg.parts!, tool1);
    
    msg = handleTextDelta(msg, "Second");
    msg = finalizeLastTextPart(msg);
    
    const tool2 = createToolPart("tool_2", "view");
    msg.parts = upsertPart(msg.parts!, tool2);
    
    msg = handleTextDelta(msg, "Third");
    
    // Verify order
    expect(msg.parts).toHaveLength(5);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("text");
    expect(msg.parts![3]!.type).toBe("tool");
    expect(msg.parts![4]!.type).toBe("text");
    
    // Verify monotonic IDs
    verifyMonotonicIds(msg.parts!);
  });

  test("background agent does not break ordering", () => {
    let msg = createMockMessage();
    
    // Text → Tool (spawns background agent) → Text continues
    msg = handleTextDelta(msg, "Starting task...");
    msg = finalizeLastTextPart(msg);
    
    const toolPart = createToolPart("tool_1", "task", "running");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    // Background agent spawns
    const bgAgent = createMockAgent("agent_1", "task", true);
    const agentPart = createAgentPart([bgAgent], toolPart.id);
    msg.parts = upsertPart(msg.parts!, agentPart);
    
    // Text continues while agent runs in background
    msg = handleTextDelta(msg, " Task is running in background.");
    
    // Verify order
    expect(msg.parts).toHaveLength(4);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("agent");
    expect(msg.parts![3]!.type).toBe("text");
    
    // Verify background flag
    const agent = (msg.parts![2] as AgentPart).agents[0]!;
    expect(agent.background).toBe(true);
    
    // Verify monotonic IDs
    verifyMonotonicIds(msg.parts!);
  });

  test("HITL updates preserve tool order", () => {
    let msg = createMockMessage();
    
    // Create a tool with HITL
    let toolPart = createToolPart("tool_1", "read_file", "running");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    const originalId = toolPart.id;
    
    // Add HITL question (update)
    toolPart = addHitlQuestion(toolPart, "req_1");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    // Verify ID unchanged (update, not insert)
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.id).toBe(originalId);
    expect((msg.parts![0] as ToolPart).pendingQuestion).toBeDefined();
    
    // Resolve HITL (another update)
    toolPart = resolveHitlQuestion(toolPart, "allow");
    msg.parts = upsertPart(msg.parts!, toolPart);
    
    // Verify ID still unchanged
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.id).toBe(originalId);
    expect((msg.parts![0] as ToolPart).pendingQuestion).toBeUndefined();
    expect((msg.parts![0] as ToolPart).hitlResponse).toBeDefined();
  });
});
