import { describe, it, expect } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events/index.ts";
import type { EnrichedBusEvent } from "@/services/events/bus-events/types.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import { createCopilotStreamAdapterState } from "@/services/events/adapters/providers/copilot/state.ts";
import {
  buildCopilotCorrelationContext,
} from "@/services/events/adapters/providers/copilot/support.ts";
import {
  cleanupCopilotOrphanedTools,
  flushCopilotOrphanedAgentCompletions,
  publishCopilotBufferedEvent,
} from "@/services/events/adapters/providers/copilot/buffer.ts";
import type { CopilotSyntheticForegroundAgent } from "@/services/events/adapters/providers/copilot/types.ts";

describe("buildCopilotCorrelationContext", () => {
  it("returns empty context when adapter state has no tracked agents", () => {
    const context = buildCopilotCorrelationContext({
      activeSubagentToolsById: new Map(),
      toolCallIdToSubagentId: new Map(),
      syntheticForegroundAgent: null,
    });

    expect(context.subagentRegistry.size).toBe(0);
    expect(context.toolToAgent.size).toBe(0);
    expect(context.subAgentTools.size).toBe(0);
    expect(context.mainAgentId).toBeNull();
  });

  it("derives toolToAgent from activeSubagentToolsById", () => {
    const activeSubagentToolsById = new Map([
      ["tool-1", { parentAgentId: "agent-1", toolName: "bash" }],
      ["tool-2", { parentAgentId: "agent-1", toolName: "read" }],
      ["tool-3", { parentAgentId: "agent-2", toolName: "write" }],
    ]);

    const context = buildCopilotCorrelationContext({
      activeSubagentToolsById,
      toolCallIdToSubagentId: new Map(),
      syntheticForegroundAgent: null,
    });

    expect(context.toolToAgent.get("tool-1")).toBe("agent-1");
    expect(context.toolToAgent.get("tool-2")).toBe("agent-1");
    expect(context.toolToAgent.get("tool-3")).toBe("agent-2");
    expect(context.toolToAgent.size).toBe(3);
  });

  it("derives subAgentTools from activeSubagentToolsById keys", () => {
    const activeSubagentToolsById = new Map([
      ["tool-1", { parentAgentId: "agent-1", toolName: "bash" }],
      ["tool-2", { parentAgentId: "agent-2", toolName: "read" }],
    ]);

    const context = buildCopilotCorrelationContext({
      activeSubagentToolsById,
      toolCallIdToSubagentId: new Map(),
      syntheticForegroundAgent: null,
    });

    expect(context.subAgentTools.has("tool-1")).toBe(true);
    expect(context.subAgentTools.has("tool-2")).toBe(true);
    expect(context.subAgentTools.size).toBe(2);
  });

  it("resolves mainAgentId from active synthetic foreground agent", () => {
    const syntheticForegroundAgent: CopilotSyntheticForegroundAgent = {
      id: "synthetic-fg-1",
      name: "worker",
      task: "test task",
      started: true,
      completed: false,
      sawNativeSubagentStart: false,
    };

    const context = buildCopilotCorrelationContext({
      activeSubagentToolsById: new Map(),
      toolCallIdToSubagentId: new Map(),
      syntheticForegroundAgent,
    });

    expect(context.mainAgentId).toBe("synthetic-fg-1");
  });

  it("returns null mainAgentId when synthetic agent is completed", () => {
    const syntheticForegroundAgent: CopilotSyntheticForegroundAgent = {
      id: "synthetic-fg-1",
      name: "worker",
      task: "test task",
      started: true,
      completed: true,
      sawNativeSubagentStart: false,
    };

    const context = buildCopilotCorrelationContext({
      activeSubagentToolsById: new Map(),
      toolCallIdToSubagentId: new Map(),
      syntheticForegroundAgent,
    });

    expect(context.mainAgentId).toBeNull();
  });

  it("returns null mainAgentId when native subagent was observed", () => {
    const syntheticForegroundAgent: CopilotSyntheticForegroundAgent = {
      id: "synthetic-fg-1",
      name: "worker",
      task: "test task",
      started: true,
      completed: false,
      sawNativeSubagentStart: true,
    };

    const context = buildCopilotCorrelationContext({
      activeSubagentToolsById: new Map(),
      toolCallIdToSubagentId: new Map(),
      syntheticForegroundAgent,
    });

    expect(context.mainAgentId).toBeNull();
  });

  it("builds subagent registry with synthetic agent as parent", () => {
    const syntheticForegroundAgent: CopilotSyntheticForegroundAgent = {
      id: "synthetic-fg-1",
      name: "worker",
      task: "test task",
      started: true,
      completed: false,
      sawNativeSubagentStart: false,
    };

    const toolCallIdToSubagentId = new Map([
      ["tool-call-1", "subagent-1"],
      ["tool-call-2", "subagent-2"],
    ]);

    const context = buildCopilotCorrelationContext({
      activeSubagentToolsById: new Map(),
      toolCallIdToSubagentId,
      syntheticForegroundAgent,
    });

    expect(context.subagentRegistry.get("subagent-1")).toEqual({
      parentAgentId: "synthetic-fg-1",
    });
    expect(context.subagentRegistry.get("subagent-2")).toEqual({
      parentAgentId: "synthetic-fg-1",
    });
  });

  it("does not build subagent registry when no main agent is active", () => {
    const toolCallIdToSubagentId = new Map([
      ["tool-call-1", "subagent-1"],
    ]);

    const context = buildCopilotCorrelationContext({
      activeSubagentToolsById: new Map(),
      toolCallIdToSubagentId,
      syntheticForegroundAgent: null,
    });

    expect(context.subagentRegistry.size).toBe(0);
  });

  it("deduplicates subagent entries when multiple tools map to same subagent", () => {
    const syntheticForegroundAgent: CopilotSyntheticForegroundAgent = {
      id: "synthetic-fg-1",
      name: "worker",
      task: "test task",
      started: true,
      completed: false,
      sawNativeSubagentStart: false,
    };

    const toolCallIdToSubagentId = new Map([
      ["tool-call-1", "subagent-1"],
      ["tool-call-2", "subagent-1"],
    ]);

    const context = buildCopilotCorrelationContext({
      activeSubagentToolsById: new Map(),
      toolCallIdToSubagentId,
      syntheticForegroundAgent,
    });

    expect(context.subagentRegistry.size).toBe(1);
    expect(context.subagentRegistry.get("subagent-1")).toEqual({
      parentAgentId: "synthetic-fg-1",
    });
  });
});

describe("Copilot buffer correlation integration", () => {
  it("enriches tool.start events with correlation metadata", () => {
    const bus = new EventBus({ validatePayloads: false });
    const state = createCopilotStreamAdapterState();
    state.sessionId = "session-1";
    state.runId = 1;
    state.isActive = true;
    state.syntheticForegroundAgent = {
      id: "synthetic-fg-1",
      name: "worker",
      task: "test task",
      started: true,
      completed: false,
      sawNativeSubagentStart: false,
    };

    const published: BusEvent[] = [];
    bus.onAll((event) => published.push(event));

    publishCopilotBufferedEvent(state, bus, {
      type: "stream.tool.start",
      sessionId: "session-1",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool-1",
        toolName: "bash",
        toolInput: {},
      },
    });

    expect(published).toHaveLength(1);
    const enriched = published[0] as EnrichedBusEvent;
    expect(enriched.type).toBe("stream.tool.start");
    // When no parentAgentId is on the event, correlate() falls back to mainAgentId
    expect(enriched.resolvedAgentId).toBe("synthetic-fg-1");
    expect(enriched.resolvedToolId).toBe("tool-1");
    expect(enriched.isSubagentTool).toBe(false);
  });

  it("enriches tool.start events with subagent context", () => {
    const bus = new EventBus({ validatePayloads: false });
    const state = createCopilotStreamAdapterState();
    state.sessionId = "session-1";
    state.runId = 1;
    state.isActive = true;

    // Set up a tool belonging to a sub-agent
    state.activeSubagentToolsById.set("tool-1", {
      parentAgentId: "agent-1",
      toolName: "bash",
    });

    const published: BusEvent[] = [];
    bus.onAll((event) => published.push(event));

    publishCopilotBufferedEvent(state, bus, {
      type: "stream.tool.start",
      sessionId: "session-1",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool-1",
        toolName: "bash",
        toolInput: {},
        parentAgentId: "agent-1",
      },
    });

    expect(published).toHaveLength(1);
    const enriched = published[0] as EnrichedBusEvent;
    expect(enriched.resolvedToolId).toBe("tool-1");
    expect(enriched.resolvedAgentId).toBe("agent-1");
    expect(enriched.isSubagentTool).toBe(true);
  });

  it("enriches agent.start events with resolvedAgentId", () => {
    const bus = new EventBus({ validatePayloads: false });
    const state = createCopilotStreamAdapterState();
    state.sessionId = "session-1";
    state.runId = 1;
    state.isActive = true;

    const published: BusEvent[] = [];
    bus.onAll((event) => published.push(event));

    publishCopilotBufferedEvent(state, bus, {
      type: "stream.agent.start",
      sessionId: "session-1",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent-1",
        toolCallId: "tool-call-1",
        agentType: "worker",
        task: "test task",
        isBackground: false,
      },
    });

    expect(published).toHaveLength(1);
    const enriched = published[0] as EnrichedBusEvent;
    expect(enriched.resolvedAgentId).toBe("agent-1");
  });

  it("enriches text.delta events with mainAgentId fallback", () => {
    const bus = new EventBus({ validatePayloads: false });
    const state = createCopilotStreamAdapterState();
    state.sessionId = "session-1";
    state.runId = 1;
    state.isActive = true;
    state.syntheticForegroundAgent = {
      id: "synthetic-fg-1",
      name: "worker",
      task: "test task",
      started: true,
      completed: false,
      sawNativeSubagentStart: false,
    };

    const published: BusEvent[] = [];
    bus.onAll((event) => published.push(event));

    publishCopilotBufferedEvent(state, bus, {
      type: "stream.text.delta",
      sessionId: "session-1",
      runId: 1,
      timestamp: Date.now(),
      data: {
        delta: "hello",
        messageId: "msg-1",
      },
    });

    expect(published).toHaveLength(1);
    const enriched = published[0] as EnrichedBusEvent;
    expect(enriched.resolvedAgentId).toBe("synthetic-fg-1");
  });

  it("enriches tool.complete with toolToAgent lookup", () => {
    const bus = new EventBus({ validatePayloads: false });
    const state = createCopilotStreamAdapterState();
    state.sessionId = "session-1";
    state.runId = 1;
    state.isActive = true;

    // Register the tool as belonging to agent-1
    state.activeSubagentToolsById.set("tool-1", {
      parentAgentId: "agent-1",
      toolName: "bash",
    });

    const published: BusEvent[] = [];
    bus.onAll((event) => published.push(event));

    publishCopilotBufferedEvent(state, bus, {
      type: "stream.tool.complete",
      sessionId: "session-1",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool-1",
        toolName: "bash",
        toolResult: "ok",
        success: true,
      },
    });

    expect(published).toHaveLength(1);
    const enriched = published[0] as EnrichedBusEvent;
    expect(enriched.resolvedToolId).toBe("tool-1");
    expect(enriched.resolvedAgentId).toBe("agent-1");
    expect(enriched.isSubagentTool).toBe(true);
  });

  it("leaves session events with default enrichment (no agent correlation)", () => {
    const bus = new EventBus({ validatePayloads: false });
    const state = createCopilotStreamAdapterState();
    state.sessionId = "session-1";
    state.runId = 1;
    state.isActive = true;

    const published: BusEvent[] = [];
    bus.onAll((event) => published.push(event));

    publishCopilotBufferedEvent(state, bus, {
      type: "stream.session.start",
      sessionId: "session-1",
      runId: 1,
      timestamp: Date.now(),
      data: {},
    });

    expect(published).toHaveLength(1);
    const enriched = published[0] as EnrichedBusEvent;
    expect(enriched.resolvedAgentId).toBeUndefined();
    expect(enriched.resolvedToolId).toBeUndefined();
    expect(enriched.isSubagentTool).toBe(false);
    expect(enriched.suppressFromMainChat).toBe(false);
  });

  it("preserves parentAgentId on orphaned tool cleanup completions", () => {
    const bus = new EventBus({ validatePayloads: false });
    const state = createCopilotStreamAdapterState();
    state.sessionId = "session-1";
    state.runId = 1;
    state.isActive = true;
    state.toolNameById.set("tool-1", "bash");
    state.activeSubagentToolsById.set("tool-1", {
      parentAgentId: "agent-1",
      toolName: "bash",
    });

    const published: BusEvent[] = [];
    bus.onAll((event) => published.push(event));

    cleanupCopilotOrphanedTools(state, bus);

    const orphanedComplete = published.find(
      (event) => event.type === "stream.tool.complete",
    ) as BusEvent<"stream.tool.complete"> | undefined;
    expect(orphanedComplete?.data.parentAgentId).toBe("agent-1");
  });

  it("preserves parentAgentId on flushed orphaned subagent tool completions", () => {
    const bus = new EventBus({ validatePayloads: false });
    const state = createCopilotStreamAdapterState();
    state.sessionId = "session-1";
    state.runId = 1;
    state.isActive = true;
    state.subagentTracker = new SubagentToolTracker(bus, state.sessionId, state.runId);
    state.subagentTracker.registerAgent("agent-1");
    state.toolNameById.set("task-tool-1", "Task");
    state.toolCallIdToSubagentId.set("task-tool-1", "agent-1");
    state.activeSubagentToolsById.set("task-tool-1", {
      parentAgentId: "agent-1",
      toolName: "Task",
    });

    const published: BusEvent[] = [];
    bus.onAll((event) => published.push(event));

    cleanupCopilotOrphanedTools(state, bus);
    flushCopilotOrphanedAgentCompletions(state, bus);

    const flushedComplete = published.find((event) => {
      if (event.type !== "stream.tool.complete") {
        return false;
      }
      return (event as BusEvent<"stream.tool.complete">).data.toolId === "task-tool-1";
    }) as BusEvent<"stream.tool.complete"> | undefined;
    expect(flushedComplete?.data.parentAgentId).toBe("agent-1");
  });
});
