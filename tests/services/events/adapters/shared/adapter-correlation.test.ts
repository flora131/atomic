import { describe, it, expect } from "bun:test";
import {
  correlate,
  extractAgentId,
  resolveCorrelationIds,
  type AdapterCorrelationContext,
  type SubagentRegistryEntry,
} from "@/services/events/adapters/shared/adapter-correlation.ts";
import type { BusEvent } from "@/services/events/bus-events/index.ts";

function makeContext(
  overrides: Partial<AdapterCorrelationContext> = {},
): AdapterCorrelationContext {
  return {
    subagentRegistry: overrides.subagentRegistry ?? new Map(),
    toolToAgent: overrides.toolToAgent ?? new Map(),
    subAgentTools: overrides.subAgentTools ?? new Set(),
    mainAgentId: overrides.mainAgentId ?? null,
  };
}

function makeEvent<T extends BusEvent["type"]>(
  type: T,
  data: Record<string, unknown>,
): BusEvent {
  return {
    type,
    sessionId: "session-1",
    runId: 1,
    timestamp: Date.now(),
    data,
  } as BusEvent;
}

describe("extractAgentId", () => {
  it("extracts agentId from stream.agent.start", () => {
    const event = makeEvent("stream.agent.start", {
      agentId: "agent-1",
      toolCallId: "tool-1",
      agentType: "worker",
      task: "test",
      isBackground: false,
    });
    expect(extractAgentId(event)).toBe("agent-1");
  });

  it("extracts agentId from stream.agent.update", () => {
    const event = makeEvent("stream.agent.update", { agentId: "agent-2" });
    expect(extractAgentId(event)).toBe("agent-2");
  });

  it("extracts agentId from stream.agent.complete", () => {
    const event = makeEvent("stream.agent.complete", {
      agentId: "agent-3",
      success: true,
    });
    expect(extractAgentId(event)).toBe("agent-3");
  });

  it("extracts parentAgentId from stream.tool.start", () => {
    const event = makeEvent("stream.tool.start", {
      toolId: "tool-1",
      toolName: "bash",
      toolInput: {},
      parentAgentId: "agent-4",
    });
    expect(extractAgentId(event)).toBe("agent-4");
  });

  it("returns undefined for stream.tool.start without parentAgentId", () => {
    const event = makeEvent("stream.tool.start", {
      toolId: "tool-1",
      toolName: "bash",
      toolInput: {},
    });
    expect(extractAgentId(event)).toBeUndefined();
  });

  it("extracts parentAgentId from stream.tool.complete", () => {
    const event = makeEvent("stream.tool.complete", {
      toolId: "tool-1",
      toolName: "bash",
      toolResult: null,
      success: true,
      parentAgentId: "agent-5",
    });
    expect(extractAgentId(event)).toBe("agent-5");
  });

  it("extracts parentAgentId from stream.tool.partial_result", () => {
    const event = makeEvent("stream.tool.partial_result", {
      toolCallId: "tool-1",
      partialOutput: "...",
      parentAgentId: "agent-6",
    });
    expect(extractAgentId(event)).toBe("agent-6");
  });

  it("extracts agentId from stream.text.delta", () => {
    const event = makeEvent("stream.text.delta", {
      delta: "hello",
      messageId: "msg-1",
      agentId: "agent-7",
    });
    expect(extractAgentId(event)).toBe("agent-7");
  });

  it("extracts agentId from stream.thinking.delta", () => {
    const event = makeEvent("stream.thinking.delta", {
      delta: "...",
      sourceKey: "key-1",
      messageId: "msg-1",
      agentId: "agent-8",
    });
    expect(extractAgentId(event)).toBe("agent-8");
  });

  it("extracts agentId from stream.usage", () => {
    const event = makeEvent("stream.usage", {
      inputTokens: 100,
      outputTokens: 50,
      agentId: "agent-9",
    });
    expect(extractAgentId(event)).toBe("agent-9");
  });

  it("returns undefined for event types without agent correlation", () => {
    const event = makeEvent("stream.session.start", {});
    expect(extractAgentId(event)).toBeUndefined();
  });
});

describe("correlate", () => {
  describe("agent lifecycle events", () => {
    it("sets resolvedAgentId for stream.agent.start", () => {
      const event = makeEvent("stream.agent.start", {
        agentId: "agent-1",
        toolCallId: "tool-1",
        agentType: "worker",
        task: "test",
        isBackground: false,
      });
      const result = correlate(event, makeContext());
      expect(result.resolvedAgentId).toBe("agent-1");
      expect(result.isSubagentTool).toBe(false);
    });

    it("resolves parentAgentId from subagent registry for agent.start", () => {
      const registry = new Map<string, SubagentRegistryEntry>([
        ["agent-1", { parentAgentId: "parent-1" }],
      ]);
      const event = makeEvent("stream.agent.start", {
        agentId: "agent-1",
        toolCallId: "tool-1",
        agentType: "worker",
        task: "test",
        isBackground: false,
      });
      const result = correlate(event, makeContext({ subagentRegistry: registry }));
      expect(result.resolvedAgentId).toBe("agent-1");
      expect(result.parentAgentId).toBe("parent-1");
    });

    it("sets resolvedAgentId for stream.agent.update", () => {
      const event = makeEvent("stream.agent.update", { agentId: "agent-2" });
      const result = correlate(event, makeContext());
      expect(result.resolvedAgentId).toBe("agent-2");
    });

    it("resolves parentAgentId from subagent registry for agent.complete", () => {
      const registry = new Map<string, SubagentRegistryEntry>([
        ["agent-3", { parentAgentId: "parent-2" }],
      ]);
      const event = makeEvent("stream.agent.complete", {
        agentId: "agent-3",
        success: true,
      });
      const result = correlate(event, makeContext({ subagentRegistry: registry }));
      expect(result.parentAgentId).toBe("parent-2");
    });
  });

  describe("tool events", () => {
    it("sets resolvedToolId and resolvedAgentId for tool.start with parentAgentId", () => {
      const event = makeEvent("stream.tool.start", {
        toolId: "tool-1",
        toolName: "bash",
        toolInput: {},
        parentAgentId: "agent-1",
      });
      const result = correlate(event, makeContext());
      expect(result.resolvedToolId).toBe("tool-1");
      expect(result.resolvedAgentId).toBe("agent-1");
      expect(result.isSubagentTool).toBe(true);
    });

    it("falls back to mainAgentId for tool.start without parentAgentId", () => {
      const event = makeEvent("stream.tool.start", {
        toolId: "tool-1",
        toolName: "bash",
        toolInput: {},
      });
      const result = correlate(event, makeContext({ mainAgentId: "main-1" }));
      expect(result.resolvedToolId).toBe("tool-1");
      expect(result.resolvedAgentId).toBe("main-1");
      expect(result.isSubagentTool).toBe(false);
    });

    it("resolves parent from subagent registry for tool.start", () => {
      const registry = new Map<string, SubagentRegistryEntry>([
        ["agent-1", { parentAgentId: "parent-1" }],
      ]);
      const event = makeEvent("stream.tool.start", {
        toolId: "tool-1",
        toolName: "bash",
        toolInput: {},
        parentAgentId: "agent-1",
      });
      const result = correlate(event, makeContext({ subagentRegistry: registry }));
      expect(result.parentAgentId).toBe("parent-1");
      expect(result.isSubagentTool).toBe(true);
    });

    it("resolves tool.complete via toolToAgent map", () => {
      const toolToAgent = new Map([["tool-1", "agent-1"]]);
      const event = makeEvent("stream.tool.complete", {
        toolId: "tool-1",
        toolName: "bash",
        toolResult: "ok",
        success: true,
      });
      const result = correlate(event, makeContext({ toolToAgent }));
      expect(result.resolvedToolId).toBe("tool-1");
      expect(result.resolvedAgentId).toBe("agent-1");
    });

    it("marks tool.complete as subagent tool when in subAgentTools set", () => {
      const toolToAgent = new Map([["tool-1", "agent-1"]]);
      const subAgentTools = new Set(["tool-1"]);
      const event = makeEvent("stream.tool.complete", {
        toolId: "tool-1",
        toolName: "bash",
        toolResult: "ok",
        success: true,
      });
      const result = correlate(event, makeContext({ toolToAgent, subAgentTools }));
      expect(result.isSubagentTool).toBe(true);
    });

    it("falls back to parentAgentId for tool.complete when not in toolToAgent", () => {
      const event = makeEvent("stream.tool.complete", {
        toolId: "tool-1",
        toolName: "bash",
        toolResult: "ok",
        success: true,
        parentAgentId: "agent-2",
      });
      const result = correlate(event, makeContext());
      expect(result.resolvedAgentId).toBe("agent-2");
      expect(result.isSubagentTool).toBe(true);
    });

    it("resolves tool.partial_result via toolToAgent map", () => {
      const toolToAgent = new Map([["tool-1", "agent-1"]]);
      const event = makeEvent("stream.tool.partial_result", {
        toolCallId: "tool-1",
        partialOutput: "partial...",
      });
      const result = correlate(event, makeContext({ toolToAgent }));
      expect(result.resolvedToolId).toBe("tool-1");
      expect(result.resolvedAgentId).toBe("agent-1");
    });

    it("falls back to parentAgentId for tool.partial_result", () => {
      const event = makeEvent("stream.tool.partial_result", {
        toolCallId: "tool-1",
        partialOutput: "partial...",
        parentAgentId: "agent-3",
      });
      const result = correlate(event, makeContext());
      expect(result.resolvedAgentId).toBe("agent-3");
      expect(result.isSubagentTool).toBe(true);
    });
  });

  describe("text events", () => {
    it("resolves subagent for text.delta with agentId", () => {
      const registry = new Map<string, SubagentRegistryEntry>([
        ["agent-1", { parentAgentId: "parent-1" }],
      ]);
      const event = makeEvent("stream.text.delta", {
        delta: "hello",
        messageId: "msg-1",
        agentId: "agent-1",
      });
      const result = correlate(event, makeContext({ subagentRegistry: registry }));
      expect(result.resolvedAgentId).toBe("agent-1");
      expect(result.parentAgentId).toBe("parent-1");
    });

    it("falls back to mainAgentId for text.delta without subagent match", () => {
      const event = makeEvent("stream.text.delta", {
        delta: "hello",
        messageId: "msg-1",
        agentId: "unknown-agent",
      });
      const result = correlate(event, makeContext({ mainAgentId: "main-1" }));
      expect(result.resolvedAgentId).toBe("main-1");
    });

    it("falls back to mainAgentId for text.delta without agentId", () => {
      const event = makeEvent("stream.text.delta", {
        delta: "hello",
        messageId: "msg-1",
      });
      const result = correlate(event, makeContext({ mainAgentId: "main-1" }));
      expect(result.resolvedAgentId).toBe("main-1");
    });

    it("suppresses text.complete with subagent- messageId prefix", () => {
      const registry = new Map<string, SubagentRegistryEntry>([
        ["agent-1", { parentAgentId: "parent-1" }],
      ]);
      const event = makeEvent("stream.text.complete", {
        messageId: "subagent-agent-1",
        fullText: "done",
      });
      const result = correlate(event, makeContext({ subagentRegistry: registry }));
      expect(result.suppressFromMainChat).toBe(true);
      expect(result.resolvedAgentId).toBe("agent-1");
      expect(result.parentAgentId).toBe("parent-1");
    });

    it("does not suppress text.complete without subagent- prefix", () => {
      const event = makeEvent("stream.text.complete", {
        messageId: "msg-1",
        fullText: "done",
      });
      const result = correlate(event, makeContext({ mainAgentId: "main-1" }));
      expect(result.suppressFromMainChat).toBe(false);
      expect(result.resolvedAgentId).toBe("main-1");
    });
  });

  describe("thinking events", () => {
    it("resolves subagent for thinking.delta with agentId", () => {
      const registry = new Map<string, SubagentRegistryEntry>([
        ["agent-1", { parentAgentId: "parent-1" }],
      ]);
      const event = makeEvent("stream.thinking.delta", {
        delta: "...",
        sourceKey: "key-1",
        messageId: "msg-1",
        agentId: "agent-1",
      });
      const result = correlate(event, makeContext({ subagentRegistry: registry }));
      expect(result.resolvedAgentId).toBe("agent-1");
      expect(result.parentAgentId).toBe("parent-1");
    });

    it("falls back to mainAgentId for thinking.delta without subagent match", () => {
      const event = makeEvent("stream.thinking.delta", {
        delta: "...",
        sourceKey: "key-1",
        messageId: "msg-1",
      });
      const result = correlate(event, makeContext({ mainAgentId: "main-1" }));
      expect(result.resolvedAgentId).toBe("main-1");
    });
  });

  describe("usage events", () => {
    it("resolves subagent for usage with agentId", () => {
      const registry = new Map<string, SubagentRegistryEntry>([
        ["agent-1", { parentAgentId: "parent-1" }],
      ]);
      const event = makeEvent("stream.usage", {
        inputTokens: 100,
        outputTokens: 50,
        agentId: "agent-1",
      });
      const result = correlate(event, makeContext({ subagentRegistry: registry }));
      expect(result.resolvedAgentId).toBe("agent-1");
      expect(result.parentAgentId).toBe("parent-1");
    });

    it("falls back to mainAgentId for usage without subagent match", () => {
      const event = makeEvent("stream.usage", {
        inputTokens: 100,
        outputTokens: 50,
      });
      const result = correlate(event, makeContext({ mainAgentId: "main-1" }));
      expect(result.resolvedAgentId).toBe("main-1");
    });
  });

  describe("unhandled event types", () => {
    it("returns event with default enrichment for session events", () => {
      const event = makeEvent("stream.session.start", {});
      const result = correlate(event, makeContext());
      expect(result.resolvedAgentId).toBeUndefined();
      expect(result.resolvedToolId).toBeUndefined();
      expect(result.isSubagentTool).toBe(false);
      expect(result.suppressFromMainChat).toBe(false);
    });
  });

  describe("preserves original event", () => {
    it("does not mutate the original event", () => {
      const event = makeEvent("stream.agent.start", {
        agentId: "agent-1",
        toolCallId: "tool-1",
        agentType: "worker",
        task: "test",
        isBackground: false,
      });
      const original = { ...event, data: { ...event.data } };
      correlate(event, makeContext());
      expect(event).toEqual(original);
    });
  });
});

describe("resolveCorrelationIds", () => {
  it("filters out undefined entries", () => {
    const result = resolveCorrelationIds(["a", undefined, "b", undefined]);
    expect(result).toEqual(["a", "b"]);
  });

  it("returns empty array for all-undefined input", () => {
    const result = resolveCorrelationIds([undefined, undefined]);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    const result = resolveCorrelationIds([]);
    expect(result).toEqual([]);
  });

  it("passes IDs through without resolver", () => {
    const result = resolveCorrelationIds(["tool-1", "tool-2"]);
    expect(result).toEqual(["tool-1", "tool-2"]);
  });

  it("resolves IDs through alias resolver", () => {
    const aliases = new Map([
      ["alias-1", "canonical-1"],
      ["alias-2", "canonical-2"],
    ]);
    const resolve = (id: string) => aliases.get(id);
    const result = resolveCorrelationIds(
      ["alias-1", "alias-2", "passthrough"],
      resolve,
    );
    expect(result).toEqual(["canonical-1", "canonical-2", "passthrough"]);
  });

  it("falls back to original ID when resolver returns undefined", () => {
    const resolve = (_id: string) => undefined;
    const result = resolveCorrelationIds(["tool-1", "tool-2"], resolve);
    expect(result).toEqual(["tool-1", "tool-2"]);
  });

  it("handles mixed resolved and unresolved IDs", () => {
    const aliases = new Map([["alias-1", "canonical-1"]]);
    const resolve = (id: string) => aliases.get(id);
    const result = resolveCorrelationIds(
      ["alias-1", undefined, "passthrough"],
      resolve,
    );
    expect(result).toEqual(["canonical-1", "passthrough"]);
  });
});
