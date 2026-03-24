import { describe, expect, test } from "bun:test";
import { buildAgentListView } from "@/lib/ui/agent-list-output.ts";
import type { AgentInfo } from "@/services/agent-discovery/types.ts";

function makeAgent(overrides: Partial<AgentInfo> & Pick<AgentInfo, "name" | "description" | "source">): AgentInfo {
  return { filePath: "/fake/path", ...overrides } as AgentInfo;
}

describe("buildAgentListView", () => {
  test("empty agents array returns correct structure with empty arrays", () => {
    const view = buildAgentListView([]);
    expect(view).toEqual({
      heading: "Agents",
      totalCount: 0,
      projectAgents: [],
      globalAgents: [],
    });
  });

  test('agents with source "project" go into projectAgents', () => {
    const agent = makeAgent({ name: "proj-agent", description: "A project agent.", source: "project" });
    const view = buildAgentListView([agent]);

    expect(view.projectAgents).toHaveLength(1);
    expect(view.projectAgents[0]!.name).toBe("proj-agent");
    expect(view.projectAgents[0]!.source).toBe("project");
    expect(view.globalAgents).toHaveLength(0);
  });

  test('agents with source "user" go into globalAgents', () => {
    const agent = makeAgent({ name: "user-agent", description: "A user agent.", source: "user" });
    const view = buildAgentListView([agent]);

    expect(view.globalAgents).toHaveLength(1);
    expect(view.globalAgents[0]!.name).toBe("user-agent");
    expect(view.globalAgents[0]!.source).toBe("user");
    expect(view.projectAgents).toHaveLength(0);
  });

  test("agents with unrecognized source types are excluded from both arrays but counted in totalCount", () => {
    // Force an invalid source via type assertion to test the else branch
    const agent = { name: "builtin-agent", description: "A builtin agent.", source: "builtin", filePath: "/fake" } as unknown as AgentInfo;
    const view = buildAgentListView([agent]);

    expect(view.totalCount).toBe(1);
    expect(view.projectAgents).toHaveLength(0);
    expect(view.globalAgents).toHaveLength(0);
  });

  test("multiple agents of mixed types are correctly separated", () => {
    const agents: AgentInfo[] = [
      makeAgent({ name: "p1", description: "Project one.", source: "project" }),
      makeAgent({ name: "u1", description: "User one.", source: "user" }),
      makeAgent({ name: "p2", description: "Project two.", source: "project" }),
      makeAgent({ name: "u2", description: "User two.", source: "user" }),
      { name: "b1", description: "Builtin one.", source: "builtin", filePath: "/fake" } as unknown as AgentInfo,
    ];
    const view = buildAgentListView(agents);

    expect(view.totalCount).toBe(5);
    expect(view.projectAgents).toHaveLength(2);
    expect(view.globalAgents).toHaveLength(2);
    expect(view.projectAgents.map((a) => a.name)).toEqual(["p1", "p2"]);
    expect(view.globalAgents.map((a) => a.name)).toEqual(["u1", "u2"]);
  });

  test("heading is always 'Agents'", () => {
    const view = buildAgentListView([]);
    expect(view.heading).toBe("Agents");
  });
});

describe("firstSentence (via buildAgentListView)", () => {
  test("extracts first sentence ending with period followed by space", () => {
    const agent = makeAgent({ name: "a", description: "First sentence. Second sentence.", source: "project" });
    const view = buildAgentListView([agent]);

    expect(view.projectAgents[0]!.description).toBe("First sentence.");
  });

  test("returns full text when no period followed by space exists", () => {
    const agent = makeAgent({ name: "a", description: "No period here", source: "project" });
    const view = buildAgentListView([agent]);

    expect(view.projectAgents[0]!.description).toBe("No period here");
  });

  test("returns full text when period is at the very end (no trailing space)", () => {
    const agent = makeAgent({ name: "a", description: "Only one sentence.", source: "project" });
    const view = buildAgentListView([agent]);

    // The regex requires `. ` (period + space) — a trailing period with no space won't match
    expect(view.projectAgents[0]!.description).toBe("Only one sentence.");
  });

  test("handles multiline descriptions by collapsing newlines to spaces", () => {
    const agent = makeAgent({ name: "a", description: "Line one.\nLine two. Line three.", source: "project" });
    const view = buildAgentListView([agent]);

    // After newline replacement: "Line one. Line two. Line three."
    // First sentence match: "Line one."
    expect(view.projectAgents[0]!.description).toBe("Line one.");
  });

  test("trims leading/trailing whitespace before extracting", () => {
    const agent = makeAgent({ name: "a", description: "  Spaced out. More text.  ", source: "project" });
    const view = buildAgentListView([agent]);

    expect(view.projectAgents[0]!.description).toBe("Spaced out.");
  });
});
