import { expect, test, describe, beforeEach, afterEach, spyOn } from "bun:test";
import type { AgentInfo } from "@/services/agent-discovery/index.ts";
import * as discovery from "@/services/agent-discovery/index.ts";
import { listAgentsCommand } from "@/commands/cli/list.ts";

function makeAgent(
  overrides: Partial<AgentInfo> & { name: string },
): AgentInfo {
  return {
    description: `Agent: ${overrides.name}`,
    source: "project",
    filePath: `/fake/${overrides.name}.md`,
    ...overrides,
  };
}

describe("listAgentsCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let discoverSpy: ReturnType<typeof spyOn>;
  let logs: string[];
  const originalColumns = process.stdout.columns;

  beforeEach(() => {
    logs = [];
    logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    discoverSpy = spyOn(discovery, "discoverAgentInfos").mockReturnValue([]);
    // Use a known terminal width for deterministic tests
    Object.defineProperty(process.stdout, "columns", { value: 80, writable: true, configurable: true });
  });

  afterEach(() => {
    logSpy.mockRestore();
    discoverSpy.mockRestore();
    Object.defineProperty(process.stdout, "columns", { value: originalColumns, writable: true, configurable: true });
  });

  test("prints 'no agents' message when none are discovered", async () => {
    discoverSpy.mockReturnValue([]);

    await listAgentsCommand();

    const output = logs.join("\n");
    expect(output).toContain("No agent definitions found");
    expect(output).toContain(".claude/agents/");
  });

  test("does not print agent table when no agents found", async () => {
    discoverSpy.mockReturnValue([]);

    await listAgentsCommand();

    const output = logs.join("\n");
    expect(output).not.toContain("Discovered Agents");
    expect(output).not.toContain("Total:");
  });

  test("displays project agents section", async () => {
    discoverSpy.mockReturnValue([
      makeAgent({ name: "builder", description: "Builds things. Fast." }),
      makeAgent({ name: "tester", description: "Runs test suites." }),
    ]);

    await listAgentsCommand();

    const output = logs.join("\n");
    expect(output).toContain("Discovered Agents");
    expect(output).toContain("Project agents");
    expect(output).toContain("(2)");
    expect(output).toContain("builder");
    expect(output).toContain("tester");
  });

  test("displays global agents section", async () => {
    discoverSpy.mockReturnValue([
      makeAgent({
        name: "global-helper",
        description: "Helps globally.",
        source: "user",
      }),
    ]);

    await listAgentsCommand();

    const output = logs.join("\n");
    expect(output).toContain("Global agents");
    expect(output).toContain("(1)");
    expect(output).toContain("global-helper");
    expect(output).not.toContain("Project agents");
  });

  test("displays both project and global sections when both exist", async () => {
    discoverSpy.mockReturnValue([
      makeAgent({ name: "proj-agent", source: "project" }),
      makeAgent({ name: "user-agent", source: "user" }),
    ]);

    await listAgentsCommand();

    const output = logs.join("\n");
    expect(output).toContain("Project agents");
    expect(output).toContain("(1)");
    expect(output).toContain("Global agents");
    expect(output).toContain("proj-agent");
    expect(output).toContain("user-agent");
  });

  test("prints total count and usage hint", async () => {
    discoverSpy.mockReturnValue([
      makeAgent({ name: "a1" }),
      makeAgent({ name: "a2", source: "user" }),
      makeAgent({ name: "a3" }),
    ]);

    await listAgentsCommand();

    const output = logs.join("\n");
    expect(output).toContain("Total: 3 agent(s)");
    expect(output).toContain('.stage({ agent: "<name>" })');
  });

  test("truncates long descriptions to fit terminal width", async () => {
    // With columns=80 and name="verbose" (7 chars), available = 80 - 4 - 7 = 69
    const longDesc = "A".repeat(100);
    discoverSpy.mockReturnValue([
      makeAgent({
        name: "verbose",
        description: longDesc,
      }),
    ]);

    await listAgentsCommand();

    const output = logs.join("\n");
    expect(output).not.toContain(longDesc);
    expect(output).toContain("...");
  });

  test("keeps short descriptions intact", async () => {
    discoverSpy.mockReturnValue([
      makeAgent({
        name: "minimal",
        description: "Short desc",
      }),
    ]);

    await listAgentsCommand();

    const output = logs.join("\n");
    expect(output).toContain("Short desc");
  });

  test("handles description with newlines by collapsing them", async () => {
    discoverSpy.mockReturnValue([
      makeAgent({
        name: "multiline",
        description: "First line.\nSecond line.\nThird line.",
      }),
    ]);

    await listAgentsCommand();

    const output = logs.join("\n");
    // Newlines should be collapsed to spaces
    expect(output).toContain("First line. Second line. Third line.");
  });

  test("handles description ending with period but no trailing space", async () => {
    discoverSpy.mockReturnValue([
      makeAgent({
        name: "edge",
        description: "Only sentence.",
      }),
    ]);

    await listAgentsCommand();

    const output = logs.join("\n");
    expect(output).toContain("Only sentence.");
  });
});
