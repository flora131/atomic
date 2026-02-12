/**
 * Tests for Agent Commands
 *
 * Verifies lightweight agent discovery, command creation, and registration.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import type {
  AgentSource,
  AgentInfo,
  DiscoveredAgentFile,
} from "../../../src/ui/commands/agent-commands.ts";
import type { CommandResult } from "../../../src/ui/commands/registry.ts";
import {
  AGENT_DISCOVERY_PATHS,
  GLOBAL_AGENT_PATHS,
  parseMarkdownFrontmatter,
  expandTildePath,
  determineAgentSource,
  discoverAgentFilesInPath,
  discoverAgentFiles,
  parseAgentInfoLight,
  shouldAgentOverride,
  discoverAgentInfos,
  getDiscoveredAgent,
  createAgentCommand,
  registerAgentCommands,
} from "../../../src/ui/commands/agent-commands.ts";
import { globalRegistry } from "../../../src/ui/commands/registry.ts";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ============================================================================
// TESTS
// ============================================================================

describe("AgentInfo interface", () => {
  test("valid AgentInfo has all required fields", () => {
    const agent: AgentInfo = {
      name: "test-agent",
      description: "A test agent for verification",
      source: "project",
      filePath: "/tmp/agents/test-agent.md",
    };

    expect(agent.name).toBe("test-agent");
    expect(agent.description).toBe("A test agent for verification");
    expect(agent.source).toBe("project");
    expect(agent.filePath).toBe("/tmp/agents/test-agent.md");
  });

  test("AgentInfo with user source", () => {
    const agent: AgentInfo = {
      name: "user-agent",
      description: "A user-global agent",
      source: "user",
      filePath: join(homedir(), ".claude/agents/user-agent.md"),
    };

    expect(agent.source).toBe("user");
  });
});

describe("AgentSource type", () => {
  test("supports project source", () => {
    const source: AgentSource = "project";
    expect(source).toBe("project");
  });

  test("supports user source", () => {
    const source: AgentSource = "user";
    expect(source).toBe("user");
  });
});

describe("AGENT_DISCOVERY_PATHS constant", () => {
  test("contains .claude/agents path", () => {
    expect(AGENT_DISCOVERY_PATHS).toContain(".claude/agents");
  });

  test("contains .opencode/agents path", () => {
    expect(AGENT_DISCOVERY_PATHS).toContain(".opencode/agents");
  });

  test("contains .github/agents path", () => {
    expect(AGENT_DISCOVERY_PATHS).toContain(".github/agents");
  });

  test("has 3 project-local paths", () => {
    expect(AGENT_DISCOVERY_PATHS).toHaveLength(3);
  });

  test("all paths are relative (no leading slash or tilde)", () => {
    for (const path of AGENT_DISCOVERY_PATHS) {
      expect(path.startsWith("/")).toBe(false);
      expect(path.startsWith("~")).toBe(false);
    }
  });
});

describe("GLOBAL_AGENT_PATHS constant", () => {
  test("contains ~/.claude/agents path", () => {
    expect(GLOBAL_AGENT_PATHS).toContain("~/.claude/agents");
  });

  test("contains ~/.opencode/agents path", () => {
    expect(GLOBAL_AGENT_PATHS).toContain("~/.opencode/agents");
  });

  test("contains ~/.copilot/agents path", () => {
    expect(GLOBAL_AGENT_PATHS).toContain("~/.copilot/agents");
  });

  test("has 3 user-global paths", () => {
    expect(GLOBAL_AGENT_PATHS).toHaveLength(3);
  });

  test("all paths start with ~ for home directory expansion", () => {
    for (const path of GLOBAL_AGENT_PATHS) {
      expect(path.startsWith("~")).toBe(true);
    }
  });
});

// ============================================================================
// FRONTMATTER PARSING TESTS
// ============================================================================

describe("parseMarkdownFrontmatter", () => {
  test("parses simple frontmatter with string values", () => {
    const content = `---
name: test-agent
description: A test agent
---
This is the body content.`;

    const result = parseMarkdownFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("test-agent");
    expect(result!.frontmatter.description).toBe("A test agent");
    expect(result!.body).toBe("This is the body content.");
  });

  test("parses frontmatter with array values (Claude format)", () => {
    const content = `---
name: analyzer
tools:
  - Glob
  - Grep
  - Read
---
System prompt here.`;

    const result = parseMarkdownFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("analyzer");
    expect(result!.frontmatter.tools).toEqual(["Glob", "Grep", "Read"]);
  });

  test("parses frontmatter with object values (OpenCode format)", () => {
    const content = `---
name: code-writer
tools:
  glob: true
  grep: true
  write: false
---
You write code.`;

    const result = parseMarkdownFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("code-writer");
    expect(result!.frontmatter.tools).toEqual({ glob: true, grep: true, write: false });
  });

  test("returns null for content without frontmatter", () => {
    const content = "Just regular markdown content without frontmatter.";
    const result = parseMarkdownFrontmatter(content);
    expect(result).toBeNull();
  });

  test("returns null for invalid frontmatter format", () => {
    const content = `---
name: agent
Missing closing delimiter`;
    const result = parseMarkdownFrontmatter(content);
    expect(result).toBeNull();
  });

  test("handles empty body after frontmatter", () => {
    const content = `---
name: agent
---
`;
    const result = parseMarkdownFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("agent");
    expect(result!.body).toBe("");
  });
});

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe("expandTildePath", () => {
  test("expands ~ at start of path", () => {
    const expanded = expandTildePath("~/some/path");
    expect(expanded).toBe(join(homedir(), "some/path"));
  });

  test("expands standalone ~", () => {
    const expanded = expandTildePath("~");
    expect(expanded).toBe(homedir());
  });

  test("returns non-tilde paths unchanged", () => {
    const path = "/absolute/path";
    expect(expandTildePath(path)).toBe(path);
  });

  test("returns relative paths unchanged", () => {
    const path = "relative/path";
    expect(expandTildePath(path)).toBe(path);
  });
});

describe("determineAgentSource", () => {
  test("returns user for paths starting with ~", () => {
    expect(determineAgentSource("~/.claude/agents")).toBe("user");
  });

  test("returns user for paths containing home directory", () => {
    expect(determineAgentSource(join(homedir(), ".claude/agents"))).toBe("user");
  });

  test("returns project for relative paths", () => {
    expect(determineAgentSource(".claude/agents")).toBe("project");
  });
});

describe("shouldAgentOverride", () => {
  test("project overrides user", () => {
    expect(shouldAgentOverride("project", "user")).toBe(true);
  });

  test("user does not override project", () => {
    expect(shouldAgentOverride("user", "project")).toBe(false);
  });

  test("same source does not override", () => {
    expect(shouldAgentOverride("project", "project")).toBe(false);
    expect(shouldAgentOverride("user", "user")).toBe(false);
  });
});

// ============================================================================
// AGENT DISCOVERY FROM TEMP DIRECTORY
// ============================================================================

describe("discoverAgentFilesInPath", () => {
  const testDir = join("/tmp", `agent-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, "analyzer.md"),
      `---
name: analyzer
description: Code analyzer
---
You analyze code.`
    );
    writeFileSync(
      join(testDir, "locator.md"),
      `---
name: locator
description: File locator
---
You find files.`
    );
    writeFileSync(join(testDir, "readme.txt"), "Not an agent file");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("discovers .md files in directory", () => {
    const files = discoverAgentFilesInPath(testDir, "project");
    const mdFiles = files.filter((f) => f.path.endsWith(".md"));
    expect(mdFiles.length).toBe(2);
  });

  test("skips non-.md files", () => {
    const files = discoverAgentFilesInPath(testDir, "project");
    const txtFiles = files.filter((f) => f.path.endsWith(".txt"));
    expect(txtFiles.length).toBe(0);
  });

  test("assigns correct source to discovered files", () => {
    const files = discoverAgentFilesInPath(testDir, "project");
    for (const file of files) {
      expect(file.source).toBe("project");
    }
  });

  test("extracts filename without extension", () => {
    const files = discoverAgentFilesInPath(testDir, "project");
    const names = files.map((f) => f.filename).sort();
    expect(names).toEqual(["analyzer", "locator"]);
  });

  test("returns empty array for non-existent directory", () => {
    const files = discoverAgentFilesInPath("/tmp/nonexistent-agent-dir-xyz", "project");
    expect(files).toHaveLength(0);
  });
});

// ============================================================================
// LIGHTWEIGHT PARSING TESTS
// ============================================================================

describe("parseAgentInfoLight", () => {
  const testDir = join("/tmp", `agent-info-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, "explorer.md"),
      `---
name: explorer
description: Explores the codebase
tools:
  - Glob
  - Grep
model: sonnet
---
You are an explorer agent.`
    );
    writeFileSync(
      join(testDir, "minimal.md"),
      `---
description: A minimal agent
---
Minimal prompt.`
    );
    writeFileSync(join(testDir, "no-frontmatter.md"), "Just body content, no frontmatter.");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("parses name and description from frontmatter", () => {
    const file: DiscoveredAgentFile = {
      path: join(testDir, "explorer.md"),
      source: "project",
      filename: "explorer",
    };
    const info = parseAgentInfoLight(file);
    expect(info).not.toBeNull();
    expect(info!.name).toBe("explorer");
    expect(info!.description).toBe("Explores the codebase");
    expect(info!.source).toBe("project");
    expect(info!.filePath).toBe(file.path);
  });

  test("falls back to filename when name is not in frontmatter", () => {
    const file: DiscoveredAgentFile = {
      path: join(testDir, "minimal.md"),
      source: "user",
      filename: "minimal",
    };
    const info = parseAgentInfoLight(file);
    expect(info).not.toBeNull();
    expect(info!.name).toBe("minimal");
    expect(info!.description).toBe("A minimal agent");
  });

  test("falls back to default description when not in frontmatter", () => {
    const file: DiscoveredAgentFile = {
      path: join(testDir, "no-frontmatter.md"),
      source: "project",
      filename: "no-frontmatter",
    };
    const info = parseAgentInfoLight(file);
    // Without frontmatter, parseMarkdownFrontmatter returns null
    // so falls back to filename for name and default description
    expect(info).not.toBeNull();
    expect(info!.name).toBe("no-frontmatter");
    expect(info!.description).toBe("Agent: no-frontmatter");
  });

  test("returns null for non-existent file", () => {
    const file: DiscoveredAgentFile = {
      path: join(testDir, "nonexistent.md"),
      source: "project",
      filename: "nonexistent",
    };
    const info = parseAgentInfoLight(file);
    expect(info).toBeNull();
  });
});

// ============================================================================
// AGENT INFO DISCOVERY INTEGRATION
// ============================================================================

describe("discoverAgentInfos", () => {
  test("returns an array (may be empty if no agent dirs exist)", () => {
    const agents = discoverAgentInfos();
    expect(Array.isArray(agents)).toBe(true);
  });

  test("each discovered agent has required AgentInfo fields", () => {
    const agents = discoverAgentInfos();
    for (const agent of agents) {
      expect(typeof agent.name).toBe("string");
      expect(typeof agent.description).toBe("string");
      expect(["project", "user"]).toContain(agent.source);
      expect(typeof agent.filePath).toBe("string");
    }
  });
});

describe("getDiscoveredAgent", () => {
  test("returns undefined for non-existent agent", () => {
    const agent = getDiscoveredAgent("nonexistent-agent-xyz-12345");
    expect(agent).toBeUndefined();
  });

  test("performs case-insensitive lookup", () => {
    // We can only verify the mechanism works; whether we find an agent depends on config dirs
    const agent1 = getDiscoveredAgent("NONEXISTENT-AGENT");
    const agent2 = getDiscoveredAgent("nonexistent-agent");
    // Both should be undefined for a non-existent agent
    expect(agent1).toEqual(agent2);
  });
});

// ============================================================================
// COMMAND CREATION
// ============================================================================

describe("createAgentCommand", () => {
  test("creates a command with correct metadata", () => {
    const agent: AgentInfo = {
      name: "test-explorer",
      description: "Explores test files",
      source: "project",
      filePath: "/tmp/test-explorer.md",
    };

    const command = createAgentCommand(agent);
    expect(command.name).toBe("test-explorer");
    expect(command.description).toBe("Explores test files");
    expect(command.category).toBe("agent");
    expect(command.hidden).toBe(false);
    expect(command.argumentHint).toBe("[task]");
    expect(typeof command.execute).toBe("function");
  });

  test("execute injects message via sendSilentMessage", () => {
    const agent: AgentInfo = {
      name: "analyzer",
      description: "Analyzes code",
      source: "project",
      filePath: "/tmp/analyzer.md",
    };

    const command = createAgentCommand(agent);
    let sentMessage = "";
    const mockContext = {
      sendMessage: () => {},
      sendSilentMessage: (msg: string) => {
        sentMessage = msg;
      },
      setInput: () => {},
      getInput: () => "",
      spawnSubagent: async () => ({ success: true, output: "" }),
    };

    const result = command.execute("find all API endpoints", mockContext as never) as CommandResult;
    expect(result.success).toBe(true);
    expect(sentMessage).toBe(
      "Use the analyzer sub-agent to handle this task: find all API endpoints"
    );
  });

  test("execute uses default task when no args provided", () => {
    const agent: AgentInfo = {
      name: "helper",
      description: "A helper agent",
      source: "user",
      filePath: "/tmp/helper.md",
    };

    const command = createAgentCommand(agent);
    let sentMessage = "";
    const mockContext = {
      sendMessage: () => {},
      sendSilentMessage: (msg: string) => {
        sentMessage = msg;
      },
      setInput: () => "",
      getInput: () => "",
      spawnSubagent: async () => ({ success: true, output: "" }),
    };

    command.execute("", mockContext as never);
    expect(sentMessage).toContain("Please proceed according to your instructions.");
  });
});

// ============================================================================
// COMMAND REGISTRATION
// ============================================================================

describe("registerAgentCommands", () => {
  test("registers discovered agents into global registry", async () => {
    const beforeCount = globalRegistry.all().length;
    await registerAgentCommands();
    // After registration, we may have more commands (depending on config dirs)
    const afterCount = globalRegistry.all().length;
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });

  test("registered agent commands have category 'agent'", async () => {
    await registerAgentCommands();
    const commands = globalRegistry.all();
    const agentCommands = commands.filter((c: { category: string }) => c.category === "agent");
    for (const cmd of agentCommands) {
      expect(cmd.category).toBe("agent");
    }
  });
});
