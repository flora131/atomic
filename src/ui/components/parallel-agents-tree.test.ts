import { describe, expect, test } from "bun:test";
import {
  buildAgentHeaderLabel,
  getAgentTaskLabel,
  getStatusIndicatorColor,
} from "./parallel-agents-tree.tsx";

describe("ParallelAgentsTree status indicator colors", () => {
  const colors = {
    muted: "#888888",
    success: "#00ff00",
    warning: "#ffff00",
    error: "#ff0000",
  };

  test("renders running and pending as muted static indicators", () => {
    expect(getStatusIndicatorColor("running", colors)).toBe(colors.muted);
    expect(getStatusIndicatorColor("pending", colors)).toBe(colors.muted);
    expect(getStatusIndicatorColor("background", colors)).toBe(colors.muted);
  });

  test("renders completed as success and interrupted as warning", () => {
    expect(getStatusIndicatorColor("completed", colors)).toBe(colors.success);
    expect(getStatusIndicatorColor("interrupted", colors)).toBe(colors.warning);
  });

  test("renders error as error color", () => {
    expect(getStatusIndicatorColor("error", colors)).toBe(colors.error);
  });
});

describe("ParallelAgentsTree labeling", () => {
  test("avoids duplicate 'agent agent' header labels", () => {
    expect(buildAgentHeaderLabel(1, "agent")).toBe("1 agent");
    expect(buildAgentHeaderLabel(2, "agents")).toBe("2 agents");
    expect(buildAgentHeaderLabel(1, "codebase-online-researcher")).toBe(
      "1 codebase-online-researcher agent"
    );
  });

  test("uses agent name when task label is generic placeholder", () => {
    expect(
      getAgentTaskLabel({
        name: "codebase-online-researcher",
        task: "Sub-agent task",
      })
    ).toBe("codebase-online-researcher");
    expect(
      getAgentTaskLabel({
        name: "codebase-online-researcher",
        task: "Research Rust TUI stacks",
      })
    ).toBe("Research Rust TUI stacks");
  });
});
