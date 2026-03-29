/**
 * Tests for test fixture factories.
 *
 * Ensures every factory produces valid objects with the expected
 * shape, sensible defaults, and correct override behaviour.
 */

import { describe, test, expect, beforeEach } from "bun:test";

import {
  // Parts
  resetPartIdCounter,
  nextPartId,
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
  createParallelAgent,
  createTaskItem,
  createSkillLoad,
  createMcpSnapshotView,
  createAgentListView,
  createPendingToolState,
  createRunningToolState,
  createCompletedToolState,
  createErrorToolState,
  createInterruptedToolState,
  // Events
  resetRunIdCounter,
  createTextDeltaEvent,
  createTextCompleteEvent,
  createThinkingDeltaEvent,
  createThinkingCompleteEvent,
  createToolStartEvent,
  createToolCompleteEvent,
  createToolPartialResultEvent,
  createAgentStartEvent,
  createAgentUpdateEvent,
  createAgentCompleteEvent,
  createSessionStartEvent,
  createSessionIdleEvent,
  createSessionPartialIdleEvent,
  createSessionErrorEvent,
  createSessionRetryEvent,
  createSessionInfoEvent,
  createSessionWarningEvent,
  createSessionTitleChangedEvent,
  createSessionTruncationEvent,
  createSessionCompactionEvent,
  createTurnStartEvent,
  createTurnEndEvent,
  createPermissionRequestedEvent,
  createHumanInputRequiredEvent,
  createSkillInvokedEvent,
  createUsageEvent,
  createWorkflowStepStartEvent,
  createWorkflowStepCompleteEvent,
  createWorkflowTaskUpdateEvent,
  // Sessions
  resetSessionIdCounter,
  createSessionConfig,
  createContextUsage,
  createAgentMessage,
  createSessionCompactionState,
  createMockSession,
  // Agents
  createAgentConfig,
  createModelDisplayInfo,
  createAgentInfo,
  createMockCodingAgentClient,
} from "./index.ts";

// ===========================================================================
// Part Fixtures
// ===========================================================================

describe("Part fixtures", () => {
  beforeEach(() => {
    resetPartIdCounter();
  });

  test("nextPartId returns deterministic, incrementing ids", () => {
    const a = nextPartId();
    const b = nextPartId();
    expect(a).toBe("part_000000000001");
    expect(b).toBe("part_000000000002");
    expect(a < b).toBe(true);
  });

  test("resetPartIdCounter resets the counter", () => {
    nextPartId();
    resetPartIdCounter();
    expect(nextPartId()).toBe("part_000000000001");
  });

  test("createTextPart returns a valid TextPart with defaults", () => {
    const part = createTextPart();
    expect(part.type).toBe("text");
    expect(part.content).toBe("Hello, world!");
    expect(part.isStreaming).toBe(false);
    expect(part.id).toStartWith("part_");
    expect(part.createdAt).toBeTruthy();
  });

  test("createTextPart accepts overrides", () => {
    const part = createTextPart({ content: "custom", isStreaming: true });
    expect(part.content).toBe("custom");
    expect(part.isStreaming).toBe(true);
    expect(part.type).toBe("text");
  });

  test("createReasoningPart returns a valid ReasoningPart", () => {
    const part = createReasoningPart();
    expect(part.type).toBe("reasoning");
    expect(part.content).toBeString();
    expect(part.durationMs).toBeGreaterThanOrEqual(0);
    expect(part.isStreaming).toBe(false);
  });

  test("createToolPart returns a valid ToolPart", () => {
    const part = createToolPart();
    expect(part.type).toBe("tool");
    expect(part.toolName).toBe("Read");
    expect(part.toolCallId).toBeString();
    expect(part.input).toHaveProperty("file_path");
    expect(part.state.status).toBe("pending");
  });

  test("createToolPart accepts state override", () => {
    const part = createToolPart({ state: createCompletedToolState() });
    expect(part.state.status).toBe("completed");
  });

  test("createAgentPart returns a valid AgentPart", () => {
    const part = createAgentPart();
    expect(part.type).toBe("agent");
    expect(part.agents).toHaveLength(1);
    expect(part.agents[0]!.status).toBe("running");
  });

  test("createTaskListPart returns a valid TaskListPart", () => {
    const part = createTaskListPart();
    expect(part.type).toBe("task-list");
    expect(part.items).toHaveLength(1);
    expect(part.expanded).toBe(false);
  });

  test("createSkillLoadPart returns a valid SkillLoadPart", () => {
    const part = createSkillLoadPart();
    expect(part.type).toBe("skill-load");
    expect(part.skills).toHaveLength(1);
    expect(part.skills[0]!.status).toBe("loaded");
  });

  test("createMcpSnapshotPart returns a valid McpSnapshotPart", () => {
    const part = createMcpSnapshotPart();
    expect(part.type).toBe("mcp-snapshot");
    expect(part.snapshot.commandLabel).toBe("/mcp");
    expect(part.snapshot.servers).toEqual([]);
  });

  test("createAgentListPart returns a valid AgentListPart", () => {
    const part = createAgentListPart();
    expect(part.type).toBe("agent-list");
    expect(part.view.heading).toBe("Available Agents");
    expect(part.view.totalCount).toBe(0);
  });

  test("createTruncationPart returns a valid TruncationPart", () => {
    const part = createTruncationPart();
    expect(part.type).toBe("truncation");
    expect(part.summary).toBeString();
  });

  test("createTaskResultPart returns a valid TaskResultPart", () => {
    const part = createTaskResultPart();
    expect(part.type).toBe("task-result");
    expect(part.status).toBe("completed");
    expect(part.title).toBeString();
    expect(part.outputText).toBeString();
  });

  test("createWorkflowStepPart returns a valid WorkflowStepPart", () => {
    const part = createWorkflowStepPart();
    expect(part.type).toBe("workflow-step");
    expect(part.workflowId).toBe("wf_test");
    expect(part.nodeId).toBe("node_research");
    expect(part.status).toBe("running");
    expect(part.startedAt).toBeString();
  });

  test("each part factory generates unique IDs", () => {
    const ids = [
      createTextPart().id,
      createReasoningPart().id,
      createToolPart().id,
      createAgentPart().id,
      createTaskListPart().id,
    ];
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe("ToolState factories", () => {
  test("createPendingToolState", () => {
    expect(createPendingToolState().status).toBe("pending");
  });

  test("createRunningToolState", () => {
    const state = createRunningToolState();
    expect(state.status).toBe("running");
    if (state.status === "running") {
      expect(state.startedAt).toBeString();
    }
  });

  test("createCompletedToolState", () => {
    const state = createCompletedToolState();
    expect(state.status).toBe("completed");
    if (state.status === "completed") {
      expect(state.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("createErrorToolState", () => {
    const state = createErrorToolState();
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.error).toBeString();
    }
  });

  test("createInterruptedToolState", () => {
    expect(createInterruptedToolState().status).toBe("interrupted");
  });
});

describe("helper factories", () => {
  test("createParallelAgent returns valid agent", () => {
    const agent = createParallelAgent();
    expect(agent.id).toBeString();
    expect(agent.name).toBe("test-agent");
    expect(agent.status).toBe("running");
  });

  test("createTaskItem returns valid item", () => {
    const item = createTaskItem();
    expect(item.description).toBeString();
    expect(item.status).toBe("pending");
  });

  test("createSkillLoad returns valid skill load", () => {
    const sl = createSkillLoad();
    expect(sl.skillName).toBe("test-skill");
    expect(sl.status).toBe("loaded");
  });

  test("createMcpSnapshotView returns valid view", () => {
    const view = createMcpSnapshotView();
    expect(view.hasConfiguredServers).toBe(false);
    expect(view.servers).toEqual([]);
  });

  test("createAgentListView returns valid view", () => {
    const view = createAgentListView();
    expect(view.totalCount).toBe(0);
    expect(view.projectAgents).toEqual([]);
    expect(view.globalAgents).toEqual([]);
  });
});

// ===========================================================================
// Event Fixtures
// ===========================================================================

describe("Event fixtures", () => {
  beforeEach(() => {
    resetRunIdCounter();
  });

  test("events have consistent envelope shape", () => {
    const event = createTextDeltaEvent();
    expect(event.type).toBe("stream.text.delta");
    expect(event.sessionId).toBe("session_test");
    expect(event.runId).toBeGreaterThan(0);
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.data).toBeDefined();
  });

  test("createTextDeltaEvent has correct data", () => {
    const e = createTextDeltaEvent();
    expect(e.data.delta).toBe("Hello");
    expect(e.data.messageId).toBe("msg_001");
  });

  test("createTextCompleteEvent", () => {
    const e = createTextCompleteEvent();
    expect(e.type).toBe("stream.text.complete");
    expect(e.data.fullText).toBe("Hello, world!");
  });

  test("createThinkingDeltaEvent", () => {
    const e = createThinkingDeltaEvent();
    expect(e.type).toBe("stream.thinking.delta");
    expect(e.data.sourceKey).toBe("thinking_0");
  });

  test("createThinkingCompleteEvent", () => {
    const e = createThinkingCompleteEvent();
    expect(e.type).toBe("stream.thinking.complete");
    expect(e.data.durationMs).toBe(200);
  });

  test("createToolStartEvent", () => {
    const e = createToolStartEvent();
    expect(e.type).toBe("stream.tool.start");
    expect(e.data.toolName).toBe("Read");
    expect(e.data.toolId).toBe("tool_001");
  });

  test("createToolCompleteEvent", () => {
    const e = createToolCompleteEvent();
    expect(e.type).toBe("stream.tool.complete");
    expect(e.data.success).toBe(true);
  });

  test("createToolPartialResultEvent", () => {
    const e = createToolPartialResultEvent();
    expect(e.type).toBe("stream.tool.partial_result");
    expect(e.data.toolCallId).toBe("tool_001");
  });

  test("createAgentStartEvent", () => {
    const e = createAgentStartEvent();
    expect(e.type).toBe("stream.agent.start");
    expect(e.data.agentId).toBe("agent_001");
    expect(e.data.isBackground).toBe(false);
  });

  test("createAgentUpdateEvent", () => {
    const e = createAgentUpdateEvent();
    expect(e.type).toBe("stream.agent.update");
  });

  test("createAgentCompleteEvent", () => {
    const e = createAgentCompleteEvent();
    expect(e.type).toBe("stream.agent.complete");
    expect(e.data.success).toBe(true);
  });

  test("createSessionStartEvent", () => {
    expect(createSessionStartEvent().type).toBe("stream.session.start");
  });

  test("createSessionIdleEvent", () => {
    expect(createSessionIdleEvent().type).toBe("stream.session.idle");
  });

  test("createSessionPartialIdleEvent", () => {
    const e = createSessionPartialIdleEvent();
    expect(e.type).toBe("stream.session.partial-idle");
    expect(e.data.activeBackgroundAgentCount).toBe(1);
  });

  test("createSessionErrorEvent", () => {
    const e = createSessionErrorEvent();
    expect(e.type).toBe("stream.session.error");
    expect(e.data.error).toBe("Something went wrong");
  });

  test("createSessionRetryEvent", () => {
    const e = createSessionRetryEvent();
    expect(e.type).toBe("stream.session.retry");
    expect(e.data.attempt).toBe(1);
  });

  test("createSessionInfoEvent", () => {
    const e = createSessionInfoEvent();
    expect(e.type).toBe("stream.session.info");
    expect(e.data.message).toBeString();
  });

  test("createSessionWarningEvent", () => {
    const e = createSessionWarningEvent();
    expect(e.type).toBe("stream.session.warning");
    expect(e.data.warningType).toBe("context_limit");
  });

  test("createSessionTitleChangedEvent", () => {
    const e = createSessionTitleChangedEvent();
    expect(e.type).toBe("stream.session.title_changed");
    expect(e.data.title).toBeString();
  });

  test("createSessionTruncationEvent", () => {
    const e = createSessionTruncationEvent();
    expect(e.type).toBe("stream.session.truncation");
    expect(e.data.tokenLimit).toBe(128000);
  });

  test("createSessionCompactionEvent", () => {
    const e = createSessionCompactionEvent();
    expect(e.type).toBe("stream.session.compaction");
    expect(e.data.phase).toBe("complete");
  });

  test("createTurnStartEvent", () => {
    const e = createTurnStartEvent();
    expect(e.type).toBe("stream.turn.start");
    expect(e.data.turnId).toBe("turn_001");
  });

  test("createTurnEndEvent", () => {
    const e = createTurnEndEvent();
    expect(e.type).toBe("stream.turn.end");
    expect(e.data.turnId).toBe("turn_001");
  });

  test("createPermissionRequestedEvent", () => {
    const e = createPermissionRequestedEvent();
    expect(e.type).toBe("stream.permission.requested");
    expect(e.data.options).toHaveLength(2);
  });

  test("createHumanInputRequiredEvent", () => {
    const e = createHumanInputRequiredEvent();
    expect(e.type).toBe("stream.human_input_required");
    expect(e.data.nodeId).toBe("node_plan");
  });

  test("createSkillInvokedEvent", () => {
    const e = createSkillInvokedEvent();
    expect(e.type).toBe("stream.skill.invoked");
    expect(e.data.skillName).toBe("commit");
  });

  test("createUsageEvent", () => {
    const e = createUsageEvent();
    expect(e.type).toBe("stream.usage");
    expect(e.data.inputTokens).toBe(1000);
    expect(e.data.outputTokens).toBe(500);
  });

  test("createWorkflowStepStartEvent", () => {
    const e = createWorkflowStepStartEvent();
    expect(e.type).toBe("workflow.step.start");
    expect(e.data.workflowId).toBe("wf_test");
    expect(e.data.indicator).toBeString();
  });

  test("createWorkflowStepCompleteEvent", () => {
    const e = createWorkflowStepCompleteEvent();
    expect(e.type).toBe("workflow.step.complete");
    expect(e.data.status).toBe("completed");
    expect(e.data.durationMs).toBe(5000);
  });

  test("createWorkflowTaskUpdateEvent", () => {
    const e = createWorkflowTaskUpdateEvent();
    expect(e.type).toBe("workflow.task.update");
    expect(e.data.tasks).toHaveLength(1);
  });

  test("event overrides apply to both envelope and data", () => {
    const e = createTextDeltaEvent({
      sessionId: "custom_session",
      data: { delta: "Custom text", messageId: "msg_custom" },
    });
    expect(e.sessionId).toBe("custom_session");
    expect(e.data.delta).toBe("Custom text");
    expect(e.data.messageId).toBe("msg_custom");
  });

  test("each event gets an incrementing runId", () => {
    const a = createTextDeltaEvent();
    const b = createToolStartEvent();
    expect(b.runId).toBeGreaterThan(a.runId);
  });
});

// ===========================================================================
// Session Fixtures
// ===========================================================================

describe("Session fixtures", () => {
  beforeEach(() => {
    resetSessionIdCounter();
  });

  test("createSessionConfig returns valid config", () => {
    const config = createSessionConfig();
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.permissionMode).toBe("auto");
  });

  test("createSessionConfig accepts overrides", () => {
    const config = createSessionConfig({ model: "gpt-4", maxTurns: 5 });
    expect(config.model).toBe("gpt-4");
    expect(config.maxTurns).toBe(5);
  });

  test("createContextUsage returns valid usage", () => {
    const usage = createContextUsage();
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.maxTokens).toBeGreaterThan(0);
    expect(usage.usagePercentage).toBeGreaterThanOrEqual(0);
  });

  test("createAgentMessage returns valid message", () => {
    const msg = createAgentMessage();
    expect(msg.type).toBe("text");
    expect(msg.content).toBeString();
    expect(msg.role).toBe("assistant");
  });

  test("createSessionCompactionState returns valid state", () => {
    const state = createSessionCompactionState();
    expect(state.isCompacting).toBe(false);
    expect(state.hasAutoCompacted).toBe(false);
  });

  test("createMockSession returns a session with deterministic ID", () => {
    const session = createMockSession();
    expect(session.id).toBe("session_0001");
  });

  test("createMockSession methods are callable", async () => {
    const session = createMockSession();
    // All methods should be callable without throwing
    const msg = await session.send("hello");
    expect(msg.type).toBe("text");

    const usage = await session.getContextUsage();
    expect(usage.maxTokens).toBe(128000);

    expect(session.getSystemToolsTokens()).toBe(0);

    await session.summarize();
    await session.destroy();
  });

  test("createMockSession accepts method overrides", async () => {
    const session = createMockSession({
      id: "custom_id",
      send: async () => createAgentMessage({ content: "overridden" }),
    });
    expect(session.id).toBe("custom_id");
    const msg = await session.send("test");
    expect(msg.content).toBe("overridden");
  });

  test("createMockSession stream is async iterable", async () => {
    const session = createMockSession();
    const messages: unknown[] = [];
    for await (const msg of session.stream("test")) {
      messages.push(msg);
    }
    expect(messages).toHaveLength(1);
  });
});

// ===========================================================================
// Agent Fixtures
// ===========================================================================

describe("Agent fixtures", () => {
  test("createAgentConfig returns valid config with maxTurns", () => {
    const config = createAgentConfig();
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.maxTurns).toBe(10);
  });

  test("createModelDisplayInfo returns valid info", () => {
    const info = createModelDisplayInfo();
    expect(info.model).toBe("claude-sonnet-4-20250514");
    expect(info.tier).toBe("standard");
    expect(info.supportsReasoning).toBe(true);
    expect(info.contextWindow).toBe(200000);
  });

  test("createAgentInfo returns valid info fixture", () => {
    const info = createAgentInfo();
    expect(info.name).toBe("test-agent");
    expect(info.agentType).toBe("claude");
    expect(info.source).toBe("project");
  });

  test("createAgentInfo accepts overrides", () => {
    const info = createAgentInfo({ agentType: "opencode", name: "custom" });
    expect(info.agentType).toBe("opencode");
    expect(info.name).toBe("custom");
  });

  test("createMockCodingAgentClient has correct agentType", () => {
    const client = createMockCodingAgentClient({ agentType: "copilot" });
    expect(client.agentType).toBe("copilot");
  });

  test("createMockCodingAgentClient methods are callable", async () => {
    const client = createMockCodingAgentClient();
    expect(client.agentType).toBe("claude");

    const session = await client.createSession();
    expect(session.id).toBeString();

    const resumed = await client.resumeSession("nonexistent");
    expect(resumed).toBeNull();

    const info = await client.getModelDisplayInfo();
    expect(info.model).toBeString();

    const unsub = client.on("session.start", () => {});
    expect(typeof unsub).toBe("function");
    unsub();

    client.registerTool({ name: "test", description: "desc", inputSchema: {}, handler: async () => ({ output: "" }) });
    await client.start();
    await client.stop();
    expect(client.getSystemToolsTokens()).toBeNull();
  });
});
