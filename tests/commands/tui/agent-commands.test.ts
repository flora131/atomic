import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createAgentCommand,
  determineAgentSource,
  getRuntimeCompatibleAgentDiscoveryPaths,
  registerAgentCommands,
  type AgentInfo,
  validateAgentInfoIntegrity,
} from "@/commands/tui/agent-commands.ts";
import { createAllProviderDiscoveryPlans } from "@/commands/tui/definition-integrity.ts";
import { globalRegistry, type CommandContext } from "@/commands/tui/registry.ts";
import { buildProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";

interface DiscoveryEventCapture {
  event: string;
  tags: {
    provider: string;
    installType: string;
    path: string;
    rootId?: string;
    rootTier?: string;
    rootCompatibility?: string;
  };
  data?: {
    [key: string]:
      | string
      | number
      | boolean
      | null
      | readonly string[]
      | readonly number[]
      | readonly boolean[];
  };
}

function parseDiscoveryEventMessages(messages: readonly string[]): DiscoveryEventCapture[] {
  const prefix = "[discovery.event]";
  return messages
    .filter((message) => message.startsWith(prefix))
    .map((message) => JSON.parse(message.slice(prefix.length).trim()) as DiscoveryEventCapture);
}

function getDiscoveryEventDataString(
  event: DiscoveryEventCapture | undefined,
  key: string,
): string | undefined {
  const value = event?.data?.[key];
  return typeof value === "string" ? value : undefined;
}

function createContext(overrides: Partial<CommandContext>): CommandContext {
  return {
    session: null,
    state: { isStreaming: false, messageCount: 0 },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "" }),
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    clearContext: async () => {},
    setTodoItems: () => {},
    setWorkflowSessionDir: () => {},
    setWorkflowSessionId: () => {},
    setWorkflowTaskIds: () => {},
    waitForUserInput: async () => "",
    updateWorkflowState: () => {},
    ...overrides,
  };
}

describe("agent command routing", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  const baseAgent: AgentInfo = {
    name: "worker",
    description: "test agent",
    source: "project",
    filePath: ".claude/agents/worker.md",
  };

  test("routes OpenCode @agent on the normal foreground stream", () => {
    const sendSilentMessage = mock(() => {});
    const command = createAgentCommand(baseAgent);

    command.execute("do work", createContext({ agentType: "opencode", sendSilentMessage }));

    const toolInstruction = "<EXTREMELY_IMPORTANT>Use your tools to effectively complete the task rather than relying on your built-in knowledge/capabilities.</EXTREMELY_IMPORTANT>";
    expect(sendSilentMessage).toHaveBeenCalledWith(`do work ${toolInstruction}`, {
      agent: "worker",
    });
  });

  test("routes Claude @agent via natural-language delegation", () => {
    const sendSilentMessage = mock(() => {});
    const command = createAgentCommand(baseAgent);

    command.execute("do work", createContext({ agentType: "claude", sendSilentMessage }));

    const toolInstruction = "<EXTREMELY_IMPORTANT>Use your tools to effectively complete the task rather than relying on your built-in knowledge/capabilities.</EXTREMELY_IMPORTANT>";
    expect(sendSilentMessage).toHaveBeenCalledWith(
      `Use the worker sub-agent to complete the following task: do work ${toolInstruction}\n\nAfter the sub-agent completes, provide the output to the user.`,
    );
  });

  test("rejects malformed or incompatible agent definitions", () => {
    const plans = createAllProviderDiscoveryPlans({
      homeDir: "/home/tester",
      projectRoot: "/workspace/repo",
      xdgConfigHome: "/home/tester/.config",
    });

    const result = validateAgentInfoIntegrity(
      {
        name: "bad agent",
        description: "",
        source: "project",
        filePath: "/tmp/outside/agent.txt",
      },
      { discoveryPlans: plans },
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.includes("Invalid agent name")),
    ).toBe(true);
    expect(
      result.issues.some((issue) =>
        issue.includes("must be a markdown file ending in .md"),
      ),
    ).toBe(true);
    expect(
      result.issues.some((issue) =>
        issue.includes("outside configured agent discovery roots"),
      ),
    ).toBe(true);
  });

  test("accepts valid agent definitions in configured roots", () => {
    const plans = createAllProviderDiscoveryPlans({
      homeDir: "/home/tester",
      projectRoot: "/workspace/repo",
      xdgConfigHome: "/home/tester/.config",
    });

    const result = validateAgentInfoIntegrity(
      {
        name: "worker_agent",
        description: "A focused worker",
        source: "project",
        filePath: "/workspace/repo/.claude/agents/worker_agent.md",
      },
      { discoveryPlans: plans },
    );

    expect(result.valid).toBe(true);
    expect(result.discoveryMatches.length).toBeGreaterThan(0);
    expect(
      result.discoveryMatches.some(
        (match) => match.provider === "claude" && match.rootId === "claude_project",
      ),
    ).toBe(true);
  });

  test("builds runtime-compatible agent search paths from discovery plan", () => {
    const projectRoot = "/workspace/repo";
    const homeDir = "/home/tester";
    const copilotPlan = buildProviderDiscoveryPlan("copilot", {
      projectRoot,
      homeDir,
      xdgConfigHome: "/home/tester/.config",
      platform: "linux",
      pathExists: () => false,
    });

    const searchPaths = getRuntimeCompatibleAgentDiscoveryPaths([copilotPlan]);

    expect(searchPaths).toContain(resolve("/workspace/repo/.github/agents"));
    expect(searchPaths).toContain(resolve("/home/tester/.copilot/agents"));
    expect(searchPaths).toContain(resolve("/home/tester/.config/.copilot/agents"));
    expect(searchPaths).toHaveLength(3);
  });

  test("treats absolute project discovery paths as project source", () => {
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-source-detection-"));
    const tempHome = join(tempRoot, "home");
    const projectRoot = join(tempHome, "repo");

    mkdirSync(projectRoot, { recursive: true });

    try {
      process.env.HOME = tempHome;
      process.chdir(projectRoot);

      const source = determineAgentSource(join(projectRoot, ".claude", "agents"));
      expect(source).toBe("project");
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("registerAgentCommands filters registry to active runtime-compatible agents", async () => {
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

    const tempRoot = mkdtempSync(join(tmpdir(), "agent-runtime-filter-"));
    const homeDir = join(tempRoot, "home");
    const projectRoot = join(homeDir, "project");
    const xdgConfigHome = join(homeDir, ".config");

    const writeAgent = (agentFilePath: string): void => {
      mkdirSync(dirname(agentFilePath), { recursive: true });
      writeFileSync(agentFilePath, "You are a focused worker agent.");
    };

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      mkdirSync(projectRoot, { recursive: true });
      mkdirSync(xdgConfigHome, { recursive: true });
      process.env.HOME = homeDir;
      process.env.XDG_CONFIG_HOME = xdgConfigHome;
      process.chdir(projectRoot);

      writeAgent(join(projectRoot, ".claude", "agents", "claude-shared.md"));
      writeAgent(join(projectRoot, ".opencode", "agents", "opencode-shared.md"));
      writeAgent(join(projectRoot, ".github", "agents", "copilot-only.md"));

      const copilotPlan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir,
        xdgConfigHome,
      });

      await registerAgentCommands(copilotPlan);
      expect(globalRegistry.has("copilot-only")).toBe(true);
      expect(globalRegistry.has("claude-shared")).toBe(false);
      expect(globalRegistry.has("opencode-shared")).toBe(false);

      globalRegistry.clear();

      const claudePlan = buildProviderDiscoveryPlan("claude", {
        projectRoot,
        homeDir,
        xdgConfigHome,
      });

      await registerAgentCommands(claudePlan);
      expect(globalRegistry.has("claude-shared")).toBe(true);
      expect(globalRegistry.has("opencode-shared")).toBe(false);
      expect(globalRegistry.has("copilot-only")).toBe(false);
    } finally {
      warnSpy.mockRestore();
      process.chdir(originalCwd);
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalXdgConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      }
      rmSync(tempRoot, { recursive: true, force: true });
      globalRegistry.clear();
    }
  });

  test("registerAgentCommands skips malformed and incompatible agents with reasons", async () => {
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    const originalDebug = process.env.DEBUG;

    const tempRoot = mkdtempSync(join(tmpdir(), "agent-skip-reasons-"));
    const homeDir = join(tempRoot, "home");
    const projectRoot = join(homeDir, "project");
    const xdgConfigHome = join(homeDir, ".config");

    const writeAgent = (agentFilePath: string, content: string): void => {
      mkdirSync(dirname(agentFilePath), { recursive: true });
      writeFileSync(agentFilePath, content);
    };

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      mkdirSync(projectRoot, { recursive: true });
      mkdirSync(xdgConfigHome, { recursive: true });
      process.env.HOME = homeDir;
      process.env.XDG_CONFIG_HOME = xdgConfigHome;
      process.env.DEBUG = "1";
      process.chdir(projectRoot);

      writeAgent(
        join(projectRoot, ".claude", "agents", "claude-worker.md"),
        "You are a Claude worker.",
      );
      writeAgent(
        join(projectRoot, ".claude", "agents", "broken.md"),
        "---\nname: broken\ndescription: missing closing delimiter",
      );
      writeAgent(
        join(projectRoot, ".github", "agents", "copilot-only.md"),
        "You are a Copilot-only agent.",
      );

      const claudePlan = buildProviderDiscoveryPlan("claude", {
        projectRoot,
        homeDir,
        xdgConfigHome,
      });

      await registerAgentCommands(claudePlan);

      expect(globalRegistry.has("claude-worker")).toBe(true);
      expect(globalRegistry.has("broken")).toBe(false);
      expect(globalRegistry.has("copilot-only")).toBe(false);

      const warningMessages = warnSpy.mock.calls
        .map((call) => call[0])
        .filter((message): message is string => typeof message === "string");
      const discoveryEvents = parseDiscoveryEventMessages(warningMessages);
      const serializedDiscoveryEvents = JSON.stringify(discoveryEvents);

      expect(serializedDiscoveryEvents.includes(projectRoot)).toBe(false);
      expect(serializedDiscoveryEvents.includes(homeDir)).toBe(false);

      const malformedSkipEvent = discoveryEvents.find(
        (event) =>
          event.event === "discovery.definition.skipped" &&
          getDiscoveryEventDataString(event, "reason") === "parse_failed" &&
          event.tags.path.endsWith("broken.md"),
      );

      expect(malformedSkipEvent?.tags.provider).toBe("claude");
      expect(malformedSkipEvent?.tags.installType).toBe("source");
      expect(malformedSkipEvent?.tags.rootTier).toBe("projectLocal");

      const compatibilityFilteredEvent = discoveryEvents.find(
        (event) =>
          event.event === "discovery.compatibility.filtered" &&
          getDiscoveryEventDataString(event, "kind") === "agent" &&
          event.tags.path.endsWith("copilot-only.md"),
      );

      expect(compatibilityFilteredEvent).toBeUndefined();

      expect(
        warningMessages.some(
          (message) =>
            message.includes("broken.md") &&
            message.includes("Invalid markdown frontmatter block"),
        ),
      ).toBe(true);

      expect(
        warningMessages.some((message) => message.includes("copilot-only.md")),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
      process.chdir(originalCwd);
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalXdgConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      }
      if (originalDebug === undefined) {
        delete process.env.DEBUG;
      } else {
        process.env.DEBUG = originalDebug;
      }
      rmSync(tempRoot, { recursive: true, force: true });
      globalRegistry.clear();
    }
  });
});
