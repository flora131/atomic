/**
 * Integration tests for dual-population output comparison
 *
 * These tests verify that the dual-population mechanism produces
 * consistent parts[] data alongside the legacy content/segments model.
 * The codebase maintains both representations during a transition period.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createPartId, _resetPartCounter } from "./id.ts";
import { handleTextDelta } from "./handlers.ts";
import { upsertPart, findLastPartIndex } from "./store.ts";
import type { ChatMessage } from "../chat.tsx";
import type { Part, TextPart, ToolPart, AgentPart, ToolState } from "./types.ts";

/**
 * Create a minimal ChatMessage mock for testing.
 * Mimics the structure used in chat.tsx for dual-population.
 */
function createMockMessage(): ChatMessage {
  return {
    id: "test-msg",
    role: "assistant",
    content: "",
    parts: [],
    streaming: true,
    createdAt: new Date(),
  } as ChatMessage;
}

beforeEach(() => _resetPartCounter());

describe("Dual-population integration tests", () => {
  test("text streaming produces TextPart with matching content", () => {
    // Simulate text chunks being added
    let msg = createMockMessage();
    
    // First chunk
    msg = handleTextDelta(msg, "Hello ");
    msg.content = "Hello "; // Legacy field update (mimics chat.tsx)
    
    // Verify parts[] is dual-populated
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.type).toBe("text");
    const textPart1 = msg.parts![0] as TextPart;
    expect(textPart1.content).toBe("Hello ");
    expect(textPart1.isStreaming).toBe(true);
    
    // Second chunk
    msg = handleTextDelta(msg, "world!");
    msg.content = "Hello world!"; // Legacy field update
    
    // Verify parts[] appends to streaming TextPart
    expect(msg.parts).toHaveLength(1);
    const textPart2 = msg.parts![0] as TextPart;
    expect(textPart2.content).toBe("Hello world!");
    expect(textPart2.isStreaming).toBe(true);
    
    // Verify consistency: legacy content matches parts text
    expect(msg.content).toBe(textPart2.content);
  });

  test("tool start creates ToolPart and finalizes TextPart", () => {
    // Simulate: text → tool.start
    let msg = createMockMessage();
    
    // Add some text first
    msg = handleTextDelta(msg, "Running tool...");
    msg.content = "Running tool...";
    
    expect(msg.parts).toHaveLength(1);
    expect((msg.parts![0] as TextPart).isStreaming).toBe(true);
    
    // Simulate tool.start (mimics chat.tsx handleToolStart dual-population)
    const parts = [...msg.parts!];
    const lastTextIdx = findLastPartIndex(parts, p => p.type === "text" && (p as TextPart).isStreaming);
    if (lastTextIdx >= 0) {
      parts[lastTextIdx] = { ...parts[lastTextIdx], isStreaming: false } as TextPart;
    }
    
    // Create ToolPart
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      toolCallId: "tool_123",
      toolName: "bash",
      input: { command: "ls" },
      state: { status: "running", startedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    
    msg.parts = upsertPart(parts, toolPart);
    
    // Verify: TextPart is finalized (isStreaming=false)
    expect(msg.parts).toHaveLength(2);
    expect((msg.parts![0] as TextPart).isStreaming).toBe(false);
    
    // Verify: ToolPart exists with correct state
    expect(msg.parts![1]!.type).toBe("tool");
    const tool = msg.parts![1] as ToolPart;
    expect(tool.toolCallId).toBe("tool_123");
    expect(tool.toolName).toBe("bash");
    expect(tool.state.status).toBe("running");
    expect((tool.state as { status: "running"; startedAt: string }).startedAt).toBeTruthy();
  });

  test("tool complete updates ToolPart state to completed", () => {
    // Setup: message with a running ToolPart (use past timestamp to ensure durationMs > 0)
    let msg = createMockMessage();
    const startedAt = new Date(Date.now() - 100).toISOString(); // 100ms ago
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      toolCallId: "tool_456",
      toolName: "view",
      input: { path: "/test.txt" },
      state: { status: "running", startedAt },
      createdAt: new Date().toISOString(),
    };
    msg.parts = [toolPart];
    
    // Simulate tool.complete (mimics chat.tsx handleToolComplete dual-population)
    const parts = [...msg.parts!];
    const toolPartIdx = parts.findIndex(
      p => p.type === "tool" && (p as ToolPart).toolCallId === "tool_456"
    );
    
    expect(toolPartIdx).toBe(0);
    
    const existingToolPart = parts[toolPartIdx] as ToolPart;
    const startTime = new Date((existingToolPart.state as { status: "running"; startedAt: string }).startedAt).getTime();
    const durationMs = Date.now() - startTime;
    
    const newState: ToolState = {
      status: "completed",
      output: "File contents",
      durationMs,
    };
    
    parts[toolPartIdx] = {
      ...existingToolPart,
      output: "File contents",
      state: newState,
    };
    
    msg.parts = parts;
    
    // Verify: ToolPart state transitioned to completed
    const updatedTool = msg.parts![0] as ToolPart;
    expect(updatedTool.state.status).toBe("completed");
    expect((updatedTool.state as { status: "completed"; output: unknown; durationMs: number }).output).toBe("File contents");
    expect((updatedTool.state as { status: "completed"; output: unknown; durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });

  test("tool error updates ToolPart state to error", () => {
    // Setup: message with a running ToolPart
    let msg = createMockMessage();
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      toolCallId: "tool_789",
      toolName: "bash",
      input: { command: "invalid" },
      state: { status: "running", startedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    msg.parts = [toolPart];
    
    // Simulate tool.error (mimics chat.tsx handleToolComplete with error)
    const parts = [...msg.parts!];
    const toolPartIdx = parts.findIndex(
      p => p.type === "tool" && (p as ToolPart).toolCallId === "tool_789"
    );
    
    const existingToolPart = parts[toolPartIdx] as ToolPart;
    const newState: ToolState = {
      status: "error",
      error: "Command not found",
      output: undefined,
    };
    
    parts[toolPartIdx] = {
      ...existingToolPart,
      state: newState,
    };
    
    msg.parts = parts;
    
    // Verify: ToolPart state transitioned to error
    const updatedTool = msg.parts![0] as ToolPart;
    expect(updatedTool.state.status).toBe("error");
    expect((updatedTool.state as { status: "error"; error: string }).error).toBe("Command not found");
  });

  test("sub-agent creates AgentPart in parts[]", () => {
    // Simulate sub-agent start (mimics chat.tsx parallelAgents effect dual-population)
    let msg = createMockMessage();
    
    const parallelAgents = [
      {
        id: "agent_1",
        name: "explorer",
        description: "Finding files",
        status: "running" as const,
        result: null,
        type: "agent",
      },
    ];
    
    // Find existing AgentPart or create new one
    const existingAgentPartIdx = (msg.parts ?? []).findIndex(p => p.type === "agent");
    const agentPart: AgentPart = existingAgentPartIdx >= 0
      ? { ...(msg.parts![existingAgentPartIdx] as AgentPart), agents: parallelAgents }
      : {
          id: createPartId(),
          type: "agent",
          agents: parallelAgents,
          createdAt: new Date().toISOString(),
        };
    
    msg.parts = upsertPart(msg.parts ?? [], agentPart);
    
    // Verify: AgentPart exists with agents
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.type).toBe("agent");
    const agent = msg.parts![0] as AgentPart;
    expect(agent.agents).toHaveLength(1);
    expect(agent.agents[0]!.name).toBe("explorer");
    expect(agent.agents[0]!.status).toBe("running");
  });

  test("permission request sets pendingQuestion on ToolPart", () => {
    // Setup: message with a running ToolPart (HITL tool)
    let msg = createMockMessage();
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      toolCallId: "tool_hitl",
      toolName: "AskUserQuestion",
      input: { question: "Continue?" },
      state: { status: "running", startedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    msg.parts = [toolPart];
    
    // Simulate permission.request (mimics chat.tsx handlePermissionRequest dual-population)
    const parts = [...msg.parts!];
    const toolPartIdx = parts.findIndex(
      p => p.type === "tool" && (p as ToolPart).toolCallId === "tool_hitl"
    );
    
    const existingToolPart = parts[toolPartIdx] as ToolPart;
    const mockRespond = (answer: string | string[]) => {
      // Mock respond function
    };
    
    parts[toolPartIdx] = {
      ...existingToolPart,
      pendingQuestion: {
        requestId: "req_123",
        header: "Confirmation",
        question: "Continue with operation?",
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
        ],
        multiSelect: false,
        respond: mockRespond,
      },
    };
    
    msg.parts = parts;
    
    // Verify: pendingQuestion is set on ToolPart
    const updatedTool = msg.parts![0] as ToolPart;
    expect(updatedTool.pendingQuestion).toBeDefined();
    expect(updatedTool.pendingQuestion!.requestId).toBe("req_123");
    expect(updatedTool.pendingQuestion!.question).toBe("Continue with operation?");
    expect(updatedTool.pendingQuestion!.options).toHaveLength(2);
  });

  test("HITL response clears pendingQuestion and sets hitlResponse", () => {
    // Setup: message with ToolPart that has pendingQuestion
    let msg = createMockMessage();
    const mockRespond = (answer: string | string[]) => {
      // Mock respond function
    };
    
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      toolCallId: "tool_hitl",
      toolName: "AskUserQuestion",
      input: { question: "Continue?" },
      state: { status: "running", startedAt: new Date().toISOString() },
      pendingQuestion: {
        requestId: "req_123",
        header: "Confirmation",
        question: "Continue?",
        options: [{ label: "Yes", value: "yes" }],
        multiSelect: false,
        respond: mockRespond,
      },
      createdAt: new Date().toISOString(),
    };
    msg.parts = [toolPart];
    
    // Simulate HITL response (mimics chat.tsx handleHumanInputResponse dual-population)
    const parts = [...msg.parts!];
    const toolPartIdx = parts.findIndex(
      p => p.type === "tool" && (p as ToolPart).toolCallId === "tool_hitl"
    );
    
    const existingToolPart = parts[toolPartIdx] as ToolPart;
    parts[toolPartIdx] = {
      ...existingToolPart,
      pendingQuestion: undefined, // Clear pendingQuestion
      hitlResponse: {
        answerText: "yes",
        displayText: "Yes",
        cancelled: false,
        responseMode: "user",
      },
    };
    
    msg.parts = parts;
    
    // Verify: pendingQuestion cleared, hitlResponse set
    const updatedTool = msg.parts![0] as ToolPart;
    expect(updatedTool.pendingQuestion).toBeUndefined();
    expect(updatedTool.hitlResponse).toBeDefined();
    expect(updatedTool.hitlResponse!.answerText).toBe("yes");
    expect(updatedTool.hitlResponse!.displayText).toBe("Yes");
    expect(updatedTool.hitlResponse!.cancelled).toBe(false);
  });

  test("multiple text-tool-text sequences create separate parts in order", () => {
    // Simulate: text1 → tool1 → text2 → tool2 → text3
    let msg = createMockMessage();
    
    // Text before first tool
    msg = handleTextDelta(msg, "Before tool 1");
    msg.content = "Before tool 1";
    
    expect(msg.parts).toHaveLength(1);
    expect((msg.parts![0] as TextPart).content).toBe("Before tool 1");
    expect((msg.parts![0] as TextPart).isStreaming).toBe(true);
    
    // First tool start (finalize text, create tool)
    let parts = [...msg.parts!];
    let lastTextIdx = findLastPartIndex(parts, p => p.type === "text" && (p as TextPart).isStreaming);
    if (lastTextIdx >= 0) {
      parts[lastTextIdx] = { ...parts[lastTextIdx], isStreaming: false } as TextPart;
    }
    
    const tool1: ToolPart = {
      id: createPartId(),
      type: "tool",
      toolCallId: "tool_1",
      toolName: "bash",
      input: { command: "ls" },
      state: { status: "running", startedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    parts = upsertPart(parts, tool1);
    msg.parts = parts;
    
    expect(msg.parts).toHaveLength(2);
    expect((msg.parts![0] as TextPart).isStreaming).toBe(false);
    expect(msg.parts![1]!.type).toBe("tool");
    
    // Text after first tool (creates new TextPart)
    msg = handleTextDelta(msg, "After tool 1, before tool 2");
    msg.content = "Before tool 1After tool 1, before tool 2";
    
    expect(msg.parts).toHaveLength(3);
    expect(msg.parts![2]!.type).toBe("text");
    expect((msg.parts![2] as TextPart).content).toBe("After tool 1, before tool 2");
    expect((msg.parts![2] as TextPart).isStreaming).toBe(true);
    
    // Second tool start (finalize text, create tool)
    parts = [...msg.parts!];
    lastTextIdx = findLastPartIndex(parts, p => p.type === "text" && (p as TextPart).isStreaming);
    if (lastTextIdx >= 0) {
      parts[lastTextIdx] = { ...parts[lastTextIdx], isStreaming: false } as TextPart;
    }
    
    const tool2: ToolPart = {
      id: createPartId(),
      type: "tool",
      toolCallId: "tool_2",
      toolName: "view",
      input: { path: "/test.txt" },
      state: { status: "running", startedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    parts = upsertPart(parts, tool2);
    msg.parts = parts;
    
    expect(msg.parts).toHaveLength(4);
    expect((msg.parts![2] as TextPart).isStreaming).toBe(false);
    expect(msg.parts![3]!.type).toBe("tool");
    
    // Text after second tool (creates another new TextPart)
    msg = handleTextDelta(msg, "After tool 2");
    msg.content = "Before tool 1After tool 1, before tool 2After tool 2";
    
    expect(msg.parts).toHaveLength(5);
    expect(msg.parts![4]!.type).toBe("text");
    expect((msg.parts![4] as TextPart).content).toBe("After tool 2");
    expect((msg.parts![4] as TextPart).isStreaming).toBe(true);
    
    // Verify final structure: text → tool → text → tool → text
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("text");
    expect(msg.parts![3]!.type).toBe("tool");
    expect(msg.parts![4]!.type).toBe("text");
    
    // Verify all text parts have correct content
    expect((msg.parts![0] as TextPart).content).toBe("Before tool 1");
    expect((msg.parts![2] as TextPart).content).toBe("After tool 1, before tool 2");
    expect((msg.parts![4] as TextPart).content).toBe("After tool 2");
    
    // Verify first two TextParts are finalized, last is streaming
    expect((msg.parts![0] as TextPart).isStreaming).toBe(false);
    expect((msg.parts![2] as TextPart).isStreaming).toBe(false);
    expect((msg.parts![4] as TextPart).isStreaming).toBe(true);
  });

  test("AgentPart updates preserve existing parts", () => {
    // Simulate text + agent updates
    let msg = createMockMessage();
    
    // Add some text
    msg = handleTextDelta(msg, "Starting agents...");
    msg.content = "Starting agents...";
    
    // Add first agent
    const agent1 = {
      id: "agent_1",
      name: "explorer",
      description: "Finding files",
      status: "running" as const,
      result: null,
      type: "agent",
    };
    
    let agentPart: AgentPart = {
      id: createPartId(),
      type: "agent",
      agents: [agent1],
      createdAt: new Date().toISOString(),
    };
    msg.parts = upsertPart(msg.parts ?? [], agentPart);
    
    expect(msg.parts).toHaveLength(2); // text + agent
    
    // Update agent (add second agent)
    const agent2 = {
      id: "agent_2",
      name: "codebase-analyzer",
      description: "Analyzing code",
      status: "running" as const,
      result: null,
      type: "agent",
    };
    
    const existingAgentPartIdx = msg.parts!.findIndex(p => p.type === "agent");
    agentPart = {
      ...(msg.parts![existingAgentPartIdx] as AgentPart),
      agents: [agent1, agent2],
    };
    msg.parts = upsertPart(msg.parts!, agentPart);
    
    // Verify: still 2 parts, agent part updated
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("agent");
    
    const updatedAgent = msg.parts![1] as AgentPart;
    expect(updatedAgent.agents).toHaveLength(2);
    expect(updatedAgent.agents[0]!.name).toBe("explorer");
    expect(updatedAgent.agents[1]!.name).toBe("codebase-analyzer");
  });
});
