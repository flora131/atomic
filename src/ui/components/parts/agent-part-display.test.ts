import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "../parallel-agents-tree.tsx";
import {
  getAgentTreeDisplayMode,
  getBackgroundTreeAgents,
  getForegroundTreeAgents,
  hasActiveForegroundTreeAgents,
} from "./agent-part-display.tsx";

function makeAgent(overrides: Partial<ParallelAgent> & { id: string }): ParallelAgent {
  return {
    name: "debugger",
    task: "Inspect state",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
    id: overrides.id,
  };
}

describe("AgentPartDisplay tree partitioning", () => {
  test("splits foreground and background agents", () => {
    const agents: ParallelAgent[] = [
      makeAgent({ id: "fg-1", status: "running" }),
      makeAgent({ id: "bg-1", status: "background", background: true }),
      makeAgent({ id: "bg-2", status: "running", background: true }),
    ];

    const foreground = getForegroundTreeAgents(agents);
    const background = getBackgroundTreeAgents(agents);

    expect(foreground.map((a) => a.id)).toEqual(["fg-1"]);
    expect(background.map((a) => a.id).sort()).toEqual(["bg-1", "bg-2"]);
  });

  test("returns mixed mode when both foreground and background exist", () => {
    const foreground = [makeAgent({ id: "fg-1", status: "running" })];
    const background = [makeAgent({ id: "bg-1", status: "background", background: true })];
    expect(getAgentTreeDisplayMode(foreground, background)).toBe("mixed");
  });

  test("returns background mode when only background exists", () => {
    const background = [makeAgent({ id: "bg-1", status: "background", background: true })];
    expect(getAgentTreeDisplayMode([], background)).toBe("background");
  });

  test("returns foreground mode when only foreground exists", () => {
    const foreground = [makeAgent({ id: "fg-1", status: "running" })];
    expect(getAgentTreeDisplayMode(foreground, [])).toBe("foreground");
  });

  test("filters shadow foreground agents when mirrored background agents exist", () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const agents: ParallelAgent[] = [
      makeAgent({
        id: "tool_1",
        taskToolCallId: "tool_1",
        name: "codebase-analyzer",
        task: "Analyze Ctrl+C interrupt handling",
        status: "background",
        background: true,
        startedAt,
      }),
      makeAgent({
        id: "subagent_1",
        name: "codebase-analyzer",
        task: "Analyzes codebase implementation details. Call ...",
        status: "running",
        startedAt,
      }),
    ];

    const foreground = getForegroundTreeAgents(agents);
    const background = getBackgroundTreeAgents(agents);

    expect(foreground).toHaveLength(0);
    expect(background.map((a) => a.id)).toEqual(["tool_1"]);
    expect(getAgentTreeDisplayMode(foreground, background)).toBe("background");
    expect(hasActiveForegroundTreeAgents(agents)).toBe(false);
  });

  test("foreground active check ignores background-only activity", () => {
    const backgroundOnly = [makeAgent({ id: "bg-1", status: "background", background: true })];
    expect(hasActiveForegroundTreeAgents(backgroundOnly)).toBe(false);
  });
});
