import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { buildAgentListView } from "@/lib/ui/agent-list-output.ts";
import type { AgentInfo } from "@/services/agent-discovery/types.ts";

function makeAgent(overrides: Partial<AgentInfo> & Pick<AgentInfo, "name" | "description" | "source">): AgentInfo {
  return { filePath: "/fake/path", ...overrides } as AgentInfo;
}

describe("buildAgentListView", () => {
  const originalColumns = process.stdout.columns;

  beforeEach(() => {
    Object.defineProperty(process.stdout, "columns", { value: 80, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "columns", { value: originalColumns, writable: true, configurable: true });
  });

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

describe("description truncation (via buildAgentListView)", () => {
  const originalColumns = process.stdout.columns;

  beforeEach(() => {
    Object.defineProperty(process.stdout, "columns", { value: 80, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "columns", { value: originalColumns, writable: true, configurable: true });
  });

  test("truncates long descriptions to fit terminal width", () => {
    // name "a" (1 char) → available = 80 - 4 - 1 = 75
    const longDesc = "X".repeat(100);
    const agent = makeAgent({ name: "a", description: longDesc, source: "project" });
    const view = buildAgentListView([agent]);

    expect(view.projectAgents[0]!.description.length).toBeLessThanOrEqual(75);
    expect(view.projectAgents[0]!.description).toEndWith("...");
  });

  test("keeps short descriptions intact", () => {
    const agent = makeAgent({ name: "a", description: "Short text", source: "project" });
    const view = buildAgentListView([agent]);

    expect(view.projectAgents[0]!.description).toBe("Short text");
  });

  test("returns full text when description is short enough", () => {
    const agent = makeAgent({ name: "a", description: "Only one sentence.", source: "project" });
    const view = buildAgentListView([agent]);

    expect(view.projectAgents[0]!.description).toBe("Only one sentence.");
  });

  test("handles multiline descriptions by collapsing newlines to spaces", () => {
    const agent = makeAgent({ name: "a", description: "Line one.\nLine two. Line three.", source: "project" });
    const view = buildAgentListView([agent]);

    expect(view.projectAgents[0]!.description).toContain("Line one. Line two.");
  });

  test("trims leading/trailing whitespace before truncating", () => {
    const agent = makeAgent({ name: "a", description: "  Spaced out. More text.  ", source: "project" });
    const view = buildAgentListView([agent]);

    expect(view.projectAgents[0]!.description).toStartWith("Spaced out.");
  });
});
