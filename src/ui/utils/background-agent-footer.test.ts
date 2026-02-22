import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import {
  formatBackgroundAgentFooterStatus,
  getActiveBackgroundAgents,
  resolveBackgroundAgentsForFooter,
} from "./background-agent-footer.ts";

function createAgent(overrides: Partial<ParallelAgent> = {}): ParallelAgent {
  return {
    id: "agent-1",
    name: "researcher",
    task: "Research repository",
    status: "running",
    startedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("background agent footer helpers", () => {
  test("detects active background agents from flag and legacy status", () => {
    const agents = [
      createAgent({ id: "active-flag", background: true, status: "running" }),
      createAgent({ id: "active-status", status: "background" }),
      createAgent({ id: "completed", background: true, status: "completed" }),
    ];

    const active = getActiveBackgroundAgents(agents);
    expect(active.map((agent) => agent.id)).toEqual(["active-flag", "active-status"]);
  });

  test("includes pending/running background agents and excludes foreground ones", () => {
    const agents = [
      createAgent({ id: "bg-running", background: true, status: "running" }),
      createAgent({ id: "bg-pending", background: true, status: "pending" }),
      createAgent({ id: "legacy", status: "background" }),
      createAgent({ id: "fg-running", background: false, status: "running" }),
    ];

    const active = getActiveBackgroundAgents(agents);
    expect(active.map((agent) => agent.id)).toEqual([
      "bg-running",
      "bg-pending",
      "legacy",
    ]);
  });

  test("prefers live background state when available", () => {
    const liveAgents = [
      createAgent({ id: "live", background: true, status: "background" }),
    ];
    const messages = [
      {
        parallelAgents: [
          createAgent({ id: "snapshot", background: true, status: "background" }),
        ],
      },
    ];

    const selected = resolveBackgroundAgentsForFooter(liveAgents, messages);
    expect(selected.map((agent) => agent.id)).toEqual(["live"]);
  });

  test("falls back to latest message snapshot in absence of live state", () => {
    const selected = resolveBackgroundAgentsForFooter([], [
      {
        parallelAgents: [
          createAgent({ id: "old", background: true, status: "background" }),
        ],
      },
      {
        parallelAgents: [
          createAgent({ id: "latest", background: true, status: "background" }),
        ],
      },
    ]);

    expect(selected.map((agent) => agent.id)).toEqual(["latest"]);
  });

  test("walks back snapshots until active background agents are found", () => {
    const selected = resolveBackgroundAgentsForFooter([], [
      {
        parallelAgents: [
          createAgent({ id: "newest-complete", background: true, status: "completed" }),
        ],
      },
      {
        parallelAgents: [
          createAgent({ id: "middle-empty", background: false, status: "running" }),
        ],
      },
      {
        parallelAgents: [
          createAgent({ id: "old-active", background: true, status: "background" }),
        ],
      },
    ]);

    expect(selected.map((agent) => agent.id)).toEqual(["old-active"]);
  });

  test("does not surface completed-only snapshots", () => {
    const selected = resolveBackgroundAgentsForFooter([], [
      {
        parallelAgents: [
          createAgent({ id: "done", background: true, status: "completed" }),
        ],
      },
    ]);

    expect(selected).toHaveLength(0);
    expect(formatBackgroundAgentFooterStatus(selected)).toBe("");
  });

  test("formats singular and plural footer labels", () => {
    expect(
      formatBackgroundAgentFooterStatus([
        createAgent({ id: "one", background: true, status: "background" }),
      ]),
    ).toBe("1 background agent running");

    expect(
      formatBackgroundAgentFooterStatus([
        createAgent({ id: "one", background: true, status: "background" }),
        createAgent({ id: "two", background: true, status: "background" }),
      ]),
    ).toBe("2 background agents running");
  });
});
