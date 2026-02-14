/**
 * Tests for Sub-Agent Output Propagation Fixes
 *
 * Covers the following spec deliverables:
 * - Transcript formatter shows agent.result instead of "Done" for completed agents
 * - ID-based result attribution via toolCallToAgentMap (SDK-level IDs + FIFO fallback)
 * - Fallback to reverse heuristic when no mapping is available
 *
 * Reference: specs/subagent-output-propagation-fix.md
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { formatTranscript, type FormatTranscriptOptions } from "../utils/transcript-formatter.ts";
import type { ChatMessage } from "../chat.tsx";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import type {
  CodingAgentClient,
  EventType,
  EventHandler,
  AgentEvent,
  Session,
  SessionConfig,
  AgentMessage,
  ToolDefinition,
  ModelDisplayInfo,
} from "../../sdk/types.ts";

// ============================================================================
// HELPERS
// ============================================================================

function makeAgent(overrides: Partial<ParallelAgent> = {}): ParallelAgent {
  return {
    id: "agent-1",
    name: "Explore",
    task: "Search the codebase",
    status: "completed",
    startedAt: "2026-02-14T12:00:00.000Z",
    durationMs: 5000,
    toolUses: 3,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "Here are the results.",
    timestamp: "2026-02-14T12:00:00.000Z",
    streaming: false,
    ...overrides,
  } as ChatMessage;
}

// ============================================================================
// TRANSCRIPT FORMATTER: AGENT RESULT DISPLAY
// ============================================================================

describe("Transcript Formatter — Agent Result Display", () => {
  test("shows agent.result instead of 'Done' for completed agents with result", () => {
    const agent = makeAgent({
      result: "Found 15 API endpoints across 3 files",
    });
    const message = makeMessage({
      parallelAgents: [agent],
    });

    const options: FormatTranscriptOptions = {
      messages: [message],
      isStreaming: false,
    };

    const lines = formatTranscript(options);
    const substatusLines = lines.filter((l) => l.type === "agent-substatus");

    expect(substatusLines).toHaveLength(1);
    const substatusContent = substatusLines[0]!.content;
    expect(substatusContent).toContain("Found 15 API endpoints across 3 files");
    expect(substatusContent).not.toContain('"Done"');
  });

  test("shows 'Done' for completed agents without result", () => {
    const agent = makeAgent({ result: undefined });
    const message = makeMessage({
      parallelAgents: [agent],
    });

    const options: FormatTranscriptOptions = {
      messages: [message],
      isStreaming: false,
    };

    const lines = formatTranscript(options);
    const substatusLines = lines.filter((l) => l.type === "agent-substatus");

    expect(substatusLines).toHaveLength(1);
    expect(substatusLines[0]!.content).toContain("Done");
  });

  test("truncates long agent.result to 60 characters", () => {
    const longResult = "A".repeat(100);
    const agent = makeAgent({ result: longResult });
    const message = makeMessage({
      parallelAgents: [agent],
    });

    const options: FormatTranscriptOptions = {
      messages: [message],
      isStreaming: false,
    };

    const lines = formatTranscript(options);
    const substatusLines = lines.filter((l) => l.type === "agent-substatus");

    expect(substatusLines).toHaveLength(1);
    // truncateText(longResult, 60) should produce a string shorter than 100 chars
    expect(substatusLines[0]!.content).not.toContain(longResult);
    expect(substatusLines[0]!.content.length).toBeLessThan(longResult.length + 50);
  });

  test("shows metrics alongside result text", () => {
    const agent = makeAgent({
      result: "Analysis complete",
      toolUses: 5,
      durationMs: 12000,
    });
    const message = makeMessage({
      parallelAgents: [agent],
    });

    const options: FormatTranscriptOptions = {
      messages: [message],
      isStreaming: false,
    };

    const lines = formatTranscript(options);
    const substatusLines = lines.filter((l) => l.type === "agent-substatus");

    expect(substatusLines).toHaveLength(1);
    const content = substatusLines[0]!.content;
    expect(content).toContain("Analysis complete");
    expect(content).toContain("5 tool uses");
  });

  test("handles multiple agents with mixed result states", () => {
    const agents = [
      makeAgent({ id: "a1", result: "Result A" }),
      makeAgent({ id: "a2", result: undefined }),
      makeAgent({ id: "a3", result: "Result C" }),
    ];
    const message = makeMessage({
      parallelAgents: agents,
    });

    const options: FormatTranscriptOptions = {
      messages: [message],
      isStreaming: false,
    };

    const lines = formatTranscript(options);
    const substatusLines = lines.filter((l) => l.type === "agent-substatus");

    expect(substatusLines).toHaveLength(3);
    expect(substatusLines[0]!.content).toContain("Result A");
    expect(substatusLines[1]!.content).toContain("Done");
    expect(substatusLines[2]!.content).toContain("Result C");
  });
});

// ============================================================================
// MOCK CLIENT FOR ID-BASED ATTRIBUTION TESTS
// ============================================================================

function createMockClient(): CodingAgentClient & {
  emit: <T extends EventType>(eventType: T, event: AgentEvent<T>) => void;
} {
  const handlers = new Map<EventType, Array<EventHandler<EventType>>>();

  return {
    agentType: "claude" as const,

    async createSession(_config?: SessionConfig): Promise<Session> {
      return {
        id: "mock-session",
        async send(_msg: string): Promise<AgentMessage> {
          return { type: "text", content: "mock", role: "assistant" };
        },
        async *stream(_msg: string): AsyncIterable<AgentMessage> {
          yield { type: "text", content: "mock", role: "assistant" };
        },
        async summarize(): Promise<void> {},
        async getContextUsage() {
          return { inputTokens: 0, outputTokens: 0, maxTokens: 100000, usagePercentage: 0 };
        },
        getSystemToolsTokens() { return 0; },
        async destroy(): Promise<void> {},
      };
    },

    async resumeSession(_id: string): Promise<Session | null> {
      return null;
    },

    on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
      if (!handlers.has(eventType)) {
        handlers.set(eventType, []);
      }
      handlers.get(eventType)!.push(handler as EventHandler<EventType>);
      return () => {
        const arr = handlers.get(eventType);
        if (arr) {
          const idx = arr.indexOf(handler as EventHandler<EventType>);
          if (idx >= 0) arr.splice(idx, 1);
        }
      };
    },

    registerTool(_tool: ToolDefinition): void {},
    async start(): Promise<void> {},
    async stop(): Promise<void> {},
    async getModelDisplayInfo(_hint?: string): Promise<ModelDisplayInfo> {
      return { model: "Mock", tier: "Mock" };
    },
    getSystemToolsTokens() { return null; },

    emit<T extends EventType>(eventType: T, event: AgentEvent<T>): void {
      const arr = handlers.get(eventType);
      if (arr) {
        for (const handler of arr) {
          handler(event as AgentEvent<EventType>);
        }
      }
    },
  };
}

// ============================================================================
// ID-BASED RESULT ATTRIBUTION
// ============================================================================

/**
 * Simulates the ID-based result attribution logic from subscribeToToolEvents()
 * to test the correlation mapping in isolation.
 */
function wireResultAttribution(
  client: ReturnType<typeof createMockClient>,
): {
  getAgents: () => ParallelAgent[];
  setStreaming: (v: boolean) => void;
  onStreamComplete: () => void;
} {
  let agents: ParallelAgent[] = [];
  let isStreaming = true;

  // Maps from subscribeToToolEvents()
  const pendingTaskEntries: Array<{ toolId: string }> = [];
  const toolCallToAgentMap = new Map<string, string>();
  const toolNameToIds = new Map<string, string[]>();
  let toolIdCounter = 0;

  // tool.start handler (simplified)
  client.on("tool.start", (event) => {
    const data = event.data as { toolName?: string; toolInput?: unknown; toolUseId?: string; toolUseID?: string };
    if (!data.toolName) return;

    const toolId = `tool_${++toolIdCounter}`;
    const ids = toolNameToIds.get(data.toolName) ?? [];
    ids.push(toolId);
    toolNameToIds.set(data.toolName, ids);

    if (data.toolName === "Task" || data.toolName === "task") {
      pendingTaskEntries.push({ toolId });
    }
  });

  // subagent.start handler (from our implementation)
  client.on("subagent.start", (event) => {
    const data = event.data as {
      subagentId?: string;
      subagentType?: string;
      task?: string;
      toolUseID?: string;
      toolCallId?: string;
    };

    if (!isStreaming || !data.subagentId) return;

    const newAgent: ParallelAgent = {
      id: data.subagentId,
      name: data.subagentType ?? "agent",
      task: data.task ?? "",
      status: "running",
      startedAt: event.timestamp ?? new Date().toISOString(),
    };
    agents = [...agents, newAgent];

    // SDK-level correlation
    const sdkCorrelationId = data.toolUseID ?? data.toolCallId;
    if (sdkCorrelationId) {
      toolCallToAgentMap.set(sdkCorrelationId, data.subagentId);
    }
    // FIFO fallback
    const fifoToolId = pendingTaskEntries.shift()?.toolId;
    if (fifoToolId) {
      toolCallToAgentMap.set(fifoToolId, data.subagentId);
    }
  });

  // subagent.complete handler
  client.on("subagent.complete", (event) => {
    const data = event.data as { subagentId?: string; success?: boolean };
    if (!data.subagentId) return;

    agents = agents.map((a) =>
      a.id === data.subagentId
        ? { ...a, status: (data.success !== false ? "completed" : "error") as ParallelAgent["status"] }
        : a
    );
  });

  // tool.complete handler (our ID-based implementation)
  client.on("tool.complete", (event) => {
    const data = event.data as {
      toolName?: string;
      toolResult?: unknown;
      toolUseID?: string;
      toolCallId?: string;
      toolUseId?: string;
    };

    if (data.toolName !== "Task" && data.toolName !== "task") return;
    if (!data.toolResult || agents.length === 0) return;

    const resultStr = typeof data.toolResult === "string"
      ? data.toolResult
      : JSON.stringify(data.toolResult);

    // Resolve internal toolId via FIFO
    const ids = toolNameToIds.get(data.toolName);
    const toolId = ids?.shift() ?? `tool_${toolIdCounter}`;
    const pendingIdx = pendingTaskEntries.findIndex((entry) => entry.toolId === toolId);
    if (pendingIdx !== -1) {
      pendingTaskEntries.splice(pendingIdx, 1);
    }

    // Try ID-based correlation
    const sdkCorrelationId = data.toolUseID ?? data.toolCallId ?? data.toolUseId;
    const agentId = (sdkCorrelationId && toolCallToAgentMap.get(sdkCorrelationId))
      || toolCallToAgentMap.get(toolId);

    if (agentId) {
      agents = agents.map((a) =>
        a.id === agentId ? { ...a, result: resultStr } : a
      );
      if (sdkCorrelationId) toolCallToAgentMap.delete(sdkCorrelationId);
      toolCallToAgentMap.delete(toolId);
    } else {
      // Fallback: reverse heuristic
      const agentToUpdate = [...agents]
        .reverse()
        .find((a) => a.status === "completed" && !a.result);
      if (agentToUpdate) {
        agents = agents.map((a) =>
          a.id === agentToUpdate.id ? { ...a, result: resultStr } : a
        );
      }
    }
  });

  return {
    getAgents: () => agents,
    setStreaming: (v: boolean) => { isStreaming = v; },
    onStreamComplete: () => {
      // Match fixed behavior: don't clear completed agents if Task result
      // correlation is still pending after stream completion.
      const hasActiveAgents = agents.some((a) => a.status === "running" || a.status === "pending");
      const hasPendingCorrelations =
        pendingTaskEntries.length > 0 || toolCallToAgentMap.size > 0;
      if (!hasActiveAgents && !hasPendingCorrelations) {
        agents = [];
      }
      isStreaming = false;
    },
  };
}

describe("ID-Based Result Attribution", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  test("attributes result via FIFO toolId correlation (in-order completion)", () => {
    const { getAgents } = wireResultAttribution(client);

    // Spawn two agents
    client.emit("tool.start", {
      type: "tool.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", toolInput: { prompt: "Task A" } },
    });
    client.emit("tool.start", {
      type: "tool.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", toolInput: { prompt: "Task B" } },
    });

    client.emit("subagent.start", {
      type: "subagent.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-A", subagentType: "Explore", task: "Task A" },
    });
    client.emit("subagent.start", {
      type: "subagent.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-B", subagentType: "Plan", task: "Task B" },
    });

    // Complete in order
    client.emit("subagent.complete", {
      type: "subagent.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-A", success: true },
    });
    client.emit("tool.complete", {
      type: "tool.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", success: true, toolResult: "Result for A" },
    });

    client.emit("subagent.complete", {
      type: "subagent.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-B", success: true },
    });
    client.emit("tool.complete", {
      type: "tool.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", success: true, toolResult: "Result for B" },
    });

    const agents = getAgents();
    expect(agents).toHaveLength(2);
    expect(agents.find((a) => a.id === "agent-A")?.result).toBe("Result for A");
    expect(agents.find((a) => a.id === "agent-B")?.result).toBe("Result for B");
  });

  test("attributes result via SDK-level toolCallId (Copilot-style)", () => {
    const { getAgents } = wireResultAttribution(client);

    // Copilot uses toolCallId as both the subagentId and the tool correlation ID
    client.emit("tool.start", {
      type: "tool.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", toolInput: { prompt: "Analyze code" } },
    });

    client.emit("subagent.start", {
      type: "subagent.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: {
        subagentId: "copilot-tc-123",
        subagentType: "codebase-analyzer",
        toolCallId: "copilot-tc-123", // Copilot: subagentId === toolCallId
      },
    });

    client.emit("subagent.complete", {
      type: "subagent.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "copilot-tc-123", success: true },
    });

    client.emit("tool.complete", {
      type: "tool.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: {
        toolName: "Task",
        success: true,
        toolResult: "Found 10 patterns",
        toolCallId: "copilot-tc-123",
      },
    });

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.result).toBe("Found 10 patterns");
  });

  test("attributes result via SDK-level toolUseID (Claude-style)", () => {
    const { getAgents } = wireResultAttribution(client);

    client.emit("tool.start", {
      type: "tool.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", toolInput: { prompt: "Debug error" } },
    });

    client.emit("subagent.start", {
      type: "subagent.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: {
        subagentId: "claude-agent-abc",
        subagentType: "debugger",
        toolUseID: "toolu_xyz", // Claude: parent Task tool's use ID
      },
    });

    client.emit("subagent.complete", {
      type: "subagent.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "claude-agent-abc", success: true },
    });

    client.emit("tool.complete", {
      type: "tool.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: {
        toolName: "Task",
        success: true,
        toolResult: "Bug found in auth.ts:42",
        toolUseID: "toolu_xyz",
      },
    });

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.result).toBe("Bug found in auth.ts:42");
  });

  test("falls back to reverse heuristic when no mapping is available", () => {
    const { getAgents } = wireResultAttribution(client);

    // Manually add agents (simulating no tool.start events)
    client.emit("subagent.start", {
      type: "subagent.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-X", subagentType: "Explore", task: "Find files" },
    });

    client.emit("subagent.complete", {
      type: "subagent.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-X", success: true },
    });

    // tool.complete with no SDK IDs and no FIFO mapping
    client.emit("tool.complete", {
      type: "tool.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", success: true, toolResult: "Fallback result" },
    });

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.result).toBe("Fallback result");
  });

  test("does not attribute result to agents that already have one", () => {
    const { getAgents } = wireResultAttribution(client);

    // Agent 1: already has result
    client.emit("subagent.start", {
      type: "subagent.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-1", subagentType: "Explore" },
    });
    client.emit("subagent.complete", {
      type: "subagent.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-1", success: true },
    });

    // Agent 2: no result yet
    client.emit("subagent.start", {
      type: "subagent.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-2", subagentType: "Plan" },
    });
    client.emit("subagent.complete", {
      type: "subagent.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-2", success: true },
    });

    // First tool.complete → goes to agent-2 via reverse heuristic (last without result)
    client.emit("tool.complete", {
      type: "tool.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", success: true, toolResult: "Result 2" },
    });

    // Second tool.complete → goes to agent-1 (only remaining without result)
    client.emit("tool.complete", {
      type: "tool.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", success: true, toolResult: "Result 1" },
    });

    const agents = getAgents();
    expect(agents.find((a) => a.id === "agent-2")?.result).toBe("Result 2");
    expect(agents.find((a) => a.id === "agent-1")?.result).toBe("Result 1");
  });

  test("retains completed agents for late Task result after stream completion", () => {
    const { getAgents, onStreamComplete } = wireResultAttribution(client);

    client.emit("tool.start", {
      type: "tool.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", toolInput: { prompt: "Late result task" } },
    });

    client.emit("subagent.start", {
      type: "subagent.start",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-late", subagentType: "Explore", task: "Late result task" },
    });

    client.emit("subagent.complete", {
      type: "subagent.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-late", success: true },
    });

    // Main stream ends before Task tool.complete arrives.
    onStreamComplete();

    // Late Task completion should still backfill sub-agent result.
    client.emit("tool.complete", {
      type: "tool.complete",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", success: true, toolResult: "Late-arriving result" },
    });

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe("agent-late");
    expect(agents[0]?.result).toBe("Late-arriving result");
  });
});
