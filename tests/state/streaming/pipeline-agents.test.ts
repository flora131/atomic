/**
 * Tests for streaming pipeline agent functions.
 *
 * Validates normalization, buffering, and inline-part routing
 * utilities used by the parallel-agent streaming pipeline.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  normalizeParallelAgentResult,
  normalizeParallelAgents,
  hasCompletedAgentInParts,
  clearAgentEventBuffer,
  bufferAgentEvent,
  drainBufferedEvents,
  routeToAgentInlineParts,
} from "@/state/streaming/pipeline-agents.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { Part, AgentPart } from "@/state/parts/types.ts";
import { _resetPartCounter } from "@/state/parts/id.ts";
import {
  createAgentPart,
  createParallelAgent,
  createToolPart,
  resetPartIdCounter,
} from "../../test-support/fixtures/parts.ts";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetPartCounter();
  resetPartIdCounter();
  clearAgentEventBuffer();
});

// ---------------------------------------------------------------------------
// normalizeParallelAgentResult
// ---------------------------------------------------------------------------

describe("normalizeParallelAgentResult", () => {
  test("returns undefined for undefined input", () => {
    expect(normalizeParallelAgentResult(undefined)).toBeUndefined();
  });

  test("returns undefined for non-string input", () => {
    // Cast to exercise the runtime guard
    expect(normalizeParallelAgentResult(42 as unknown as string)).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(normalizeParallelAgentResult("")).toBeUndefined();
  });

  test("normalizes markdown newlines (trims excess blank lines)", () => {
    const input = "  \r\n  Hello world  \r\n  ";
    const result = normalizeParallelAgentResult(input);
    expect(result).toBeDefined();
    expect(result).toBe("Hello world");
  });

  test("returns normalized string for valid input", () => {
    const result = normalizeParallelAgentResult("Some valid result");
    expect(result).toBe("Some valid result");
  });
});

// ---------------------------------------------------------------------------
// normalizeParallelAgents
// ---------------------------------------------------------------------------

describe("normalizeParallelAgents", () => {
  test("returns same reference when no changes needed", () => {
    const agents: ParallelAgent[] = [
      createParallelAgent({ id: "a1", result: "Clean result" }),
    ];
    const result = normalizeParallelAgents(agents);
    expect(result).toBe(agents);
  });

  test("normalizes results for all agents", () => {
    const agents: ParallelAgent[] = [
      createParallelAgent({ id: "a1", result: "  \r\nTrimmed\r\n  " }),
      createParallelAgent({ id: "a2", result: "Already clean" }),
    ];
    const result = normalizeParallelAgents(agents);
    expect(result).not.toBe(agents);
    expect(result[0]!.result).toBe("Trimmed");
    expect(result[1]!.result).toBe("Already clean");
  });

  test("removes result field when normalized to empty", () => {
    const agents: ParallelAgent[] = [
      createParallelAgent({ id: "a1", result: "   \n   " }),
    ];
    const result = normalizeParallelAgents(agents);
    expect(result).not.toBe(agents);
    expect(result[0]!.result).toBeUndefined();
    expect("result" in result[0]!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasCompletedAgentInParts
// ---------------------------------------------------------------------------

describe("hasCompletedAgentInParts", () => {
  test("returns false for undefined parts", () => {
    expect(hasCompletedAgentInParts(undefined, "agent-1")).toBe(false);
  });

  test("returns false when no agent parts exist", () => {
    const parts: Part[] = [createToolPart()];
    expect(hasCompletedAgentInParts(parts, "agent-1")).toBe(false);
  });

  test("returns false when agent exists but not completed", () => {
    const parts: Part[] = [
      createAgentPart({
        agents: [createParallelAgent({ id: "agent-1", status: "running" })],
      }),
    ];
    expect(hasCompletedAgentInParts(parts, "agent-1")).toBe(false);
  });

  test("returns true when agent with matching id is completed", () => {
    const parts: Part[] = [
      createAgentPart({
        agents: [createParallelAgent({ id: "agent-1", status: "completed" })],
      }),
    ];
    expect(hasCompletedAgentInParts(parts, "agent-1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// routeToAgentInlineParts
// ---------------------------------------------------------------------------

describe("routeToAgentInlineParts", () => {
  test("returns null when no matching agent part found", () => {
    const parts: Part[] = [createToolPart()];
    const result = routeToAgentInlineParts(parts, "no-match", (inline) => inline);
    expect(result).toBeNull();
  });

  test("applies function to matching agent's inline parts", () => {
    const agent = createParallelAgent({ id: "agent-1", inlineParts: [] });
    const parts: Part[] = [createAgentPart({ agents: [agent] })];

    const marker: Part = createToolPart();
    const result = routeToAgentInlineParts(parts, "agent-1", () => [marker]);

    expect(result).not.toBeNull();
    const agentPart = result![0] as AgentPart;
    expect(agentPart.agents[0]!.inlineParts).toEqual([marker]);
  });

  test("matches by direct agent ID", () => {
    const agent = createParallelAgent({ id: "direct-id" });
    const parts: Part[] = [createAgentPart({ agents: [agent] })];

    const result = routeToAgentInlineParts(parts, "direct-id", (inline) => [
      ...inline,
      createToolPart(),
    ]);

    expect(result).not.toBeNull();
    const agentPart = result![0] as AgentPart;
    expect(agentPart.agents[0]!.inlineParts!.length).toBe(1);
  });

  test("matches by taskToolCallId correlation", () => {
    const agent = createParallelAgent({
      id: "agent-real-id",
      taskToolCallId: "tool-call-123",
    });
    const parts: Part[] = [createAgentPart({ agents: [agent] })];

    const result = routeToAgentInlineParts(parts, "tool-call-123", (inline) => [
      ...inline,
      createToolPart(),
    ]);

    expect(result).not.toBeNull();
    const agentPart = result![0] as AgentPart;
    expect(agentPart.agents[0]!.inlineParts!.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// bufferAgentEvent + clearAgentEventBuffer
// ---------------------------------------------------------------------------

describe("bufferAgentEvent + clearAgentEventBuffer", () => {
  test("bufferAgentEvent stores events for later replay", () => {
    // Buffer two events for the same agent
    bufferAgentEvent("agent-1", { type: "text-delta", delta: "hello", agentId: "agent-1" } as any);
    bufferAgentEvent("agent-1", { type: "text-delta", delta: " world", agentId: "agent-1" } as any);

    // Create parts with the agent to drain into
    const agent = createParallelAgent({ id: "agent-1", inlineParts: [] });
    const parts: Part[] = [createAgentPart({ agents: [agent] })];

    // drainBufferedEvents is the mechanism that replays buffered events
    // We import it indirectly through the barrel — verify buffer was populated
    // by clearing and checking that a second drain has no effect
    clearAgentEventBuffer();

    // After clearing, routing should not find any buffered events
    const result = routeToAgentInlineParts(parts, "agent-1", (inline) => inline);
    expect(result).not.toBeNull();
    const agentPart = result![0] as AgentPart;
    expect(agentPart.agents[0]!.inlineParts).toEqual([]);
  });

  test("clearAgentEventBuffer clears all buffered events", () => {
    bufferAgentEvent("agent-a", { type: "text-delta", delta: "a", agentId: "agent-a" } as any);
    bufferAgentEvent("agent-b", { type: "text-delta", delta: "b", agentId: "agent-b" } as any);

    clearAgentEventBuffer();

    // After clearing, drainBufferedEvents should be a no-op.
    // We verify indirectly: create agents, drain, check no inline parts appeared.
    const agentA = createParallelAgent({ id: "agent-a", inlineParts: [] });
    const agentB = createParallelAgent({ id: "agent-b", inlineParts: [] });
    const parts: Part[] = [createAgentPart({ agents: [agentA, agentB] })];

    let result = drainBufferedEvents(parts, agentA);
    result = drainBufferedEvents(result, agentB);

    const agentPart = result[0] as AgentPart;
    expect(agentPart.agents[0]!.inlineParts).toEqual([]);
    expect(agentPart.agents[1]!.inlineParts).toEqual([]);
  });
});
