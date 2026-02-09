/**
 * Tests for Agent Commands
 *
 * Verifies agent definition interfaces and type constraints.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import type {
  AgentDefinition,
  AgentSource,
  AgentModel,
  AgentFrontmatter,
  DiscoveredAgentFile,
} from "../../../src/ui/commands/agent-commands.ts";
import {
  AGENT_DISCOVERY_PATHS,
  GLOBAL_AGENT_PATHS,
  BUILTIN_AGENTS,
  getBuiltinAgent,
  parseMarkdownFrontmatter,
  normalizeModel,
  normalizeTools,
  parseAgentFrontmatter,
  expandTildePath,
  determineAgentSource,
  discoverAgentFilesInPath,
  discoverAgentFiles,
  parseAgentFile,
  discoverAgents,
  shouldAgentOverride,
  createAgentCommand,
  builtinAgentCommands,
  registerBuiltinAgents,
  registerAgentCommands,
} from "../../../src/ui/commands/agent-commands.ts";
import { globalRegistry } from "../../../src/ui/commands/registry.ts";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ============================================================================
// TESTS
// ============================================================================

describe("AgentDefinition interface", () => {
  test("valid AgentDefinition has all required fields", () => {
    const agent: AgentDefinition = {
      name: "test-agent",
      description: "A test agent for verification",
      prompt: "You are a test agent.",
      source: "builtin",
    };

    expect(agent.name).toBe("test-agent");
    expect(agent.description).toBe("A test agent for verification");
    expect(agent.prompt).toBe("You are a test agent.");
    expect(agent.source).toBe("builtin");
  });

  test("AgentDefinition supports optional tools array", () => {
    const agentWithTools: AgentDefinition = {
      name: "analyzer",
      description: "Analyzes code",
      prompt: "You analyze code.",
      source: "builtin",
      tools: ["Glob", "Grep", "Read", "LS", "Bash"],
    };

    expect(agentWithTools.tools).toBeDefined();
    expect(agentWithTools.tools).toHaveLength(5);
    expect(agentWithTools.tools).toContain("Glob");
    expect(agentWithTools.tools).toContain("Bash");
  });

  test("AgentDefinition supports optional model field", () => {
    const agentWithModel: AgentDefinition = {
      name: "fast-agent",
      description: "A fast agent",
      prompt: "You are fast.",
      source: "builtin",
      model: "haiku",
    };

    expect(agentWithModel.model).toBe("haiku");

    const opusAgent: AgentDefinition = {
      name: "smart-agent",
      description: "A smart agent",
      prompt: "You are smart.",
      source: "builtin",
      model: "opus",
    };

    expect(opusAgent.model).toBe("opus");

    const sonnetAgent: AgentDefinition = {
      name: "balanced-agent",
      description: "A balanced agent",
      prompt: "You are balanced.",
      source: "builtin",
      model: "sonnet",
    };

    expect(sonnetAgent.model).toBe("sonnet");
  });

  test("AgentDefinition with all optional fields", () => {
    const fullAgent: AgentDefinition = {
      name: "full-agent",
      description: "A fully-configured agent",
      prompt: "You are a full agent with all options.",
      source: "project",
      tools: ["Read", "Write", "Edit"],
      model: "opus",
    };

    expect(fullAgent.name).toBe("full-agent");
    expect(fullAgent.description).toBe("A fully-configured agent");
    expect(fullAgent.prompt).toBe("You are a full agent with all options.");
    expect(fullAgent.source).toBe("project");
    expect(fullAgent.tools).toEqual(["Read", "Write", "Edit"]);
    expect(fullAgent.model).toBe("opus");
  });

  test("AgentDefinition without optional fields", () => {
    const minimalAgent: AgentDefinition = {
      name: "minimal-agent",
      description: "A minimal agent",
      prompt: "You are minimal.",
      source: "user",
    };

    expect(minimalAgent.name).toBe("minimal-agent");
    expect(minimalAgent.tools).toBeUndefined();
    expect(minimalAgent.model).toBeUndefined();
  });
});

describe("AgentSource type", () => {
  test("supports builtin source", () => {
    const source: AgentSource = "builtin";
    expect(source).toBe("builtin");
  });

  test("supports project source", () => {
    const source: AgentSource = "project";
    expect(source).toBe("project");
  });

  test("supports user source", () => {
    const source: AgentSource = "user";
    expect(source).toBe("user");
  });
});

describe("AgentModel type", () => {
  test("supports sonnet model", () => {
    const model: AgentModel = "sonnet";
    expect(model).toBe("sonnet");
  });

  test("supports opus model", () => {
    const model: AgentModel = "opus";
    expect(model).toBe("opus");
  });

  test("supports haiku model", () => {
    const model: AgentModel = "haiku";
    expect(model).toBe("haiku");
  });
});

describe("AgentFrontmatter interface", () => {
  test("Claude format with tools as string array", () => {
    const frontmatter: AgentFrontmatter = {
      name: "codebase-analyzer",
      description: "Analyzes codebase implementation details",
      tools: ["Glob", "Grep", "Read", "LS", "Bash"],
      model: "opus",
    };

    expect(frontmatter.name).toBe("codebase-analyzer");
    expect(frontmatter.description).toBe("Analyzes codebase implementation details");
    expect(Array.isArray(frontmatter.tools)).toBe(true);
    expect(frontmatter.tools).toContain("Glob");
    expect(frontmatter.model).toBe("opus");
    expect(frontmatter.mode).toBeUndefined();
  });

  test("OpenCode format with tools as Record<string, boolean>", () => {
    const frontmatter: AgentFrontmatter = {
      name: "code-writer",
      description: "Writes and edits code",
      tools: {
        glob: true,
        grep: true,
        read: true,
        write: true,
        edit: true,
        bash: false,
      },
      model: "anthropic/claude-3-sonnet",
      mode: "subagent",
    };

    expect(frontmatter.name).toBe("code-writer");
    expect(frontmatter.description).toBe("Writes and edits code");
    expect(Array.isArray(frontmatter.tools)).toBe(false);
    expect((frontmatter.tools as Record<string, boolean>).glob).toBe(true);
    expect((frontmatter.tools as Record<string, boolean>).bash).toBe(false);
    expect(frontmatter.model).toBe("anthropic/claude-3-sonnet");
    expect(frontmatter.mode).toBe("subagent");
  });

  test("OpenCode format with mode field", () => {
    const subagentFrontmatter: AgentFrontmatter = {
      description: "A sub-agent",
      mode: "subagent",
    };

    expect(subagentFrontmatter.mode).toBe("subagent");

    const primaryFrontmatter: AgentFrontmatter = {
      description: "A primary agent",
      mode: "primary",
    };

    expect(primaryFrontmatter.mode).toBe("primary");
  });

  test("frontmatter with optional name field omitted", () => {
    // Name can be derived from filename in some SDKs
    const frontmatter: AgentFrontmatter = {
      description: "An agent without explicit name",
      tools: ["Read", "Write"],
      model: "sonnet",
    };

    expect(frontmatter.name).toBeUndefined();
    expect(frontmatter.description).toBe("An agent without explicit name");
  });

  test("frontmatter with only required description field", () => {
    const minimalFrontmatter: AgentFrontmatter = {
      description: "Minimal agent frontmatter",
    };

    expect(minimalFrontmatter.description).toBe("Minimal agent frontmatter");
    expect(minimalFrontmatter.name).toBeUndefined();
    expect(minimalFrontmatter.tools).toBeUndefined();
    expect(minimalFrontmatter.model).toBeUndefined();
    expect(minimalFrontmatter.mode).toBeUndefined();
  });

  test("Copilot format with tools as string array", () => {
    const frontmatter: AgentFrontmatter = {
      name: "copilot-agent",
      description: "A Copilot agent",
      tools: ["search", "file_read", "file_write"],
      model: "gpt-4",
    };

    expect(frontmatter.name).toBe("copilot-agent");
    expect(Array.isArray(frontmatter.tools)).toBe(true);
    expect(frontmatter.tools).toHaveLength(3);
    expect(frontmatter.model).toBe("gpt-4");
  });

  test("frontmatter with all optional fields", () => {
    const fullFrontmatter: AgentFrontmatter = {
      name: "full-agent",
      description: "An agent with all fields",
      tools: ["Read", "Write", "Edit"],
      model: "opus",
      mode: "subagent",
    };

    expect(fullFrontmatter.name).toBe("full-agent");
    expect(fullFrontmatter.description).toBe("An agent with all fields");
    expect(fullFrontmatter.tools).toEqual(["Read", "Write", "Edit"]);
    expect(fullFrontmatter.model).toBe("opus");
    expect(fullFrontmatter.mode).toBe("subagent");
  });
});

describe("AgentDefinition examples", () => {
  test("codebase-analyzer agent definition is valid", () => {
    const codebaseAnalyzer: AgentDefinition = {
      name: "codebase-analyzer",
      description: "Analyzes codebase implementation details. Call when you need to find detailed information about specific components.",
      tools: ["Glob", "Grep", "NotebookRead", "Read", "LS", "Bash"],
      model: "opus",
      prompt: `You are a codebase analysis specialist. Your role is to analyze and explain code implementation details.

When analyzing code:
1. Identify the main components and their responsibilities
2. Trace data flow and control flow
3. Note dependencies and integration points
4. Highlight patterns and anti-patterns
5. Provide actionable insights`,
      source: "builtin",
    };

    expect(codebaseAnalyzer.name).toBe("codebase-analyzer");
    expect(codebaseAnalyzer.tools).toContain("Glob");
    expect(codebaseAnalyzer.tools).toContain("Grep");
    expect(codebaseAnalyzer.model).toBe("opus");
    expect(codebaseAnalyzer.source).toBe("builtin");
  });

  test("codebase-locator agent definition is valid", () => {
    const codebaseLocator: AgentDefinition = {
      name: "codebase-locator",
      description: "Locates files, directories, and components relevant to a feature or task.",
      tools: ["Glob", "Grep", "NotebookRead", "Read", "LS", "Bash"],
      model: "opus",
      prompt: "You are a file locator specialist. Find relevant files and components quickly.",
      source: "builtin",
    };

    expect(codebaseLocator.name).toBe("codebase-locator");
    expect(codebaseLocator.model).toBe("opus");
    expect(codebaseLocator.source).toBe("builtin");
  });

  test("debugger agent definition is valid", () => {
    const debugger_agent: AgentDefinition = {
      name: "debugger",
      description: "Debugging specialist for errors, test failures, and unexpected behavior.",
      tools: ["Bash", "Task", "AskUserQuestion", "Edit", "Glob", "Grep", "NotebookEdit", "NotebookRead", "Read", "TodoWrite", "Write", "ListMcpResourcesTool", "ReadMcpResourceTool", "mcp__deepwiki__ask_question", "WebFetch", "WebSearch"],
      model: "opus",
      prompt: "You are a debugging specialist. Analyze errors, identify root causes, and provide fixes.",
      source: "builtin",
    };

    expect(debugger_agent.name).toBe("debugger");
    expect(debugger_agent.tools).toContain("Edit");
    expect(debugger_agent.tools).toContain("Write");
    expect(debugger_agent.model).toBe("opus");
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

  test("parses frontmatter with boolean values", () => {
    const content = `---
name: hidden-agent
hidden: true
---
Secret agent.`;

    const result = parseMarkdownFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.hidden).toBe(true);
  });

  test("parses frontmatter with numeric values", () => {
    const content = `---
name: agent
priority: 42
---
Body.`;

    const result = parseMarkdownFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.priority).toBe(42);
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

  test("handles multiline body content", () => {
    const content = `---
name: agent
---
Line 1
Line 2

Line 4`;
    const result = parseMarkdownFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.body).toBe("Line 1\nLine 2\n\nLine 4");
  });
});

describe("normalizeModel", () => {
  test("returns undefined for undefined input", () => {
    expect(normalizeModel(undefined)).toBeUndefined();
  });

  test("returns direct match for sonnet", () => {
    expect(normalizeModel("sonnet")).toBe("sonnet");
    expect(normalizeModel("SONNET")).toBe("sonnet");
    expect(normalizeModel("Sonnet")).toBe("sonnet");
  });

  test("returns direct match for opus", () => {
    expect(normalizeModel("opus")).toBe("opus");
    expect(normalizeModel("OPUS")).toBe("opus");
  });

  test("returns direct match for haiku", () => {
    expect(normalizeModel("haiku")).toBe("haiku");
    expect(normalizeModel("HAIKU")).toBe("haiku");
  });

  test("extracts sonnet from OpenCode format", () => {
    expect(normalizeModel("anthropic/claude-3-sonnet")).toBe("sonnet");
    expect(normalizeModel("anthropic/claude-3.5-sonnet")).toBe("sonnet");
  });

  test("extracts opus from OpenCode format", () => {
    expect(normalizeModel("anthropic/claude-3-opus")).toBe("opus");
  });

  test("extracts haiku from OpenCode format", () => {
    expect(normalizeModel("anthropic/claude-3-haiku")).toBe("haiku");
  });

  test("returns undefined for unknown model", () => {
    expect(normalizeModel("gpt-4")).toBeUndefined();
    expect(normalizeModel("unknown-model")).toBeUndefined();
  });
});

describe("normalizeTools", () => {
  test("returns undefined for undefined input", () => {
    expect(normalizeTools(undefined)).toBeUndefined();
  });

  test("passes through array format (Claude/Copilot)", () => {
    const tools = ["Glob", "Grep", "Read"];
    expect(normalizeTools(tools)).toEqual(["Glob", "Grep", "Read"]);
  });

  test("converts object format to array (OpenCode)", () => {
    const tools = { glob: true, grep: true, write: false, bash: true };
    const normalized = normalizeTools(tools);
    expect(normalized).toContain("glob");
    expect(normalized).toContain("grep");
    expect(normalized).toContain("bash");
    expect(normalized).not.toContain("write");
  });

  test("returns empty array when all tools are disabled", () => {
    const tools = { glob: false, grep: false };
    expect(normalizeTools(tools)).toEqual([]);
  });
});

describe("parseAgentFrontmatter", () => {
  test("creates AgentDefinition with all fields", () => {
    const frontmatter = {
      name: "test-agent",
      description: "A test agent",
      tools: ["Glob", "Grep"],
      model: "opus",
    };
    const body = "You are a test agent.";
    const source: AgentSource = "builtin";
    const filename = "test-agent";

    const result = parseAgentFrontmatter(frontmatter, body, source, filename);

    expect(result.name).toBe("test-agent");
    expect(result.description).toBe("A test agent");
    expect(result.tools).toEqual(["Glob", "Grep"]);
    expect(result.model).toBe("opus");
    expect(result.prompt).toBe("You are a test agent.");
    expect(result.source).toBe("builtin");
  });

  test("uses filename as name when not in frontmatter", () => {
    const frontmatter = {
      description: "An agent",
    };
    const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "my-agent");
    expect(result.name).toBe("my-agent");
  });

  test("uses default description when not in frontmatter", () => {
    const frontmatter = {};
    const result = parseAgentFrontmatter(frontmatter, "prompt", "user", "analyzer");
    expect(result.description).toBe("Agent: analyzer");
  });

  test("normalizes OpenCode tools format", () => {
    const frontmatter = {
      description: "Agent",
      tools: { glob: true, grep: false, read: true },
    };
    const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "agent");
    expect(result.tools).toContain("glob");
    expect(result.tools).toContain("read");
    expect(result.tools).not.toContain("grep");
  });

  test("normalizes OpenCode model format", () => {
    const frontmatter = {
      description: "Agent",
      model: "anthropic/claude-3-opus",
    };
    const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "agent");
    expect(result.model).toBe("opus");
  });

  test("trims body content", () => {
    const frontmatter = { description: "Agent" };
    const body = "  \n  Trimmed content  \n  ";
    const result = parseAgentFrontmatter(frontmatter, body, "project", "agent");
    expect(result.prompt).toBe("Trimmed content");
  });
});

// ============================================================================
// PATH UTILITIES TESTS
// ============================================================================

describe("expandTildePath", () => {
  test("expands ~/ to home directory", () => {
    const result = expandTildePath("~/.claude/agents");
    expect(result).toBe(join(homedir(), ".claude/agents"));
  });

  test("expands standalone ~ to home directory", () => {
    const result = expandTildePath("~");
    expect(result).toBe(homedir());
  });

  test("returns absolute path unchanged", () => {
    const result = expandTildePath("/usr/local/bin");
    expect(result).toBe("/usr/local/bin");
  });

  test("returns relative path unchanged", () => {
    const result = expandTildePath(".claude/agents");
    expect(result).toBe(".claude/agents");
  });
});

describe("determineAgentSource", () => {
  test("returns user for global paths with ~", () => {
    expect(determineAgentSource("~/.claude/agents")).toBe("user");
    expect(determineAgentSource("~/.opencode/agents")).toBe("user");
    expect(determineAgentSource("~/.copilot/agents")).toBe("user");
  });

  test("returns project for local paths", () => {
    expect(determineAgentSource(".claude/agents")).toBe("project");
    expect(determineAgentSource(".opencode/agents")).toBe("project");
    expect(determineAgentSource(".github/agents")).toBe("project");
  });
});

describe("shouldAgentOverride", () => {
  test("project overrides all other sources", () => {
    expect(shouldAgentOverride("project", "user")).toBe(true);
    expect(shouldAgentOverride("project", "builtin")).toBe(true);
  });

  test("user overrides only builtin", () => {
    expect(shouldAgentOverride("user", "builtin")).toBe(true);
  });

  test("lower priority does not override higher", () => {
    expect(shouldAgentOverride("builtin", "project")).toBe(false);
    expect(shouldAgentOverride("user", "project")).toBe(false);
  });

  test("same priority does not override", () => {
    expect(shouldAgentOverride("project", "project")).toBe(false);
    expect(shouldAgentOverride("user", "user")).toBe(false);
    expect(shouldAgentOverride("builtin", "builtin")).toBe(false);
  });
});

// ============================================================================
// AGENT DISCOVERY TESTS
// ============================================================================

describe("discoverAgentFilesInPath", () => {
  const testDir = "/tmp/test-agent-discovery-" + Date.now();

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "agent1.md"), "# Agent 1");
    writeFileSync(join(testDir, "agent2.md"), "# Agent 2");
    writeFileSync(join(testDir, "readme.txt"), "Not an agent");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("discovers .md files in directory", () => {
    const files = discoverAgentFilesInPath(testDir, "project");
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.filename)).toContain("agent1");
    expect(files.map((f) => f.filename)).toContain("agent2");
  });

  test("ignores non-.md files", () => {
    const files = discoverAgentFilesInPath(testDir, "project");
    expect(files.map((f) => f.filename)).not.toContain("readme");
  });

  test("assigns correct source to discovered files", () => {
    const files = discoverAgentFilesInPath(testDir, "user");
    for (const file of files) {
      expect(file.source).toBe("user");
    }
  });

  test("returns empty array for non-existent directory", () => {
    const files = discoverAgentFilesInPath("/non/existent/path", "project");
    expect(files).toEqual([]);
  });
});

describe("parseAgentFile", () => {
  const testDir = "/tmp/test-parse-agent-" + Date.now();

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });

    // Full agent with frontmatter
    writeFileSync(
      join(testDir, "full-agent.md"),
      `---
name: my-analyzer
description: Analyzes code
tools:
  - Glob
  - Grep
model: opus
---
You are a code analyzer.`
    );

    // Agent without frontmatter
    writeFileSync(join(testDir, "simple-agent.md"), "You are a simple agent.");

    // Invalid file
    writeFileSync(join(testDir, "invalid.md"), "---\nname: broken");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("parses agent with full frontmatter", () => {
    const file: DiscoveredAgentFile = {
      path: join(testDir, "full-agent.md"),
      source: "project",
      filename: "full-agent",
    };

    const agent = parseAgentFile(file);
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe("my-analyzer");
    expect(agent!.description).toBe("Analyzes code");
    expect(agent!.tools).toEqual(["Glob", "Grep"]);
    expect(agent!.model).toBe("opus");
    expect(agent!.prompt).toBe("You are a code analyzer.");
    expect(agent!.source).toBe("project");
  });

  test("parses agent without frontmatter", () => {
    const file: DiscoveredAgentFile = {
      path: join(testDir, "simple-agent.md"),
      source: "user",
      filename: "simple-agent",
    };

    const agent = parseAgentFile(file);
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe("simple-agent");
    expect(agent!.description).toBe("Agent: simple-agent");
    expect(agent!.prompt).toBe("You are a simple agent.");
    expect(agent!.source).toBe("user");
  });

  test("returns null for non-existent file", () => {
    const file: DiscoveredAgentFile = {
      path: join(testDir, "does-not-exist.md"),
      source: "project",
      filename: "does-not-exist",
    };

    const agent = parseAgentFile(file);
    expect(agent).toBeNull();
  });
});

describe("discoverAgents", () => {
  const testLocalDir = "/tmp/test-discover-agents-local-" + Date.now();
  const testLocalAgentDir = join(testLocalDir, ".claude", "agents");

  beforeAll(() => {
    // Create local test directory structure
    mkdirSync(testLocalAgentDir, { recursive: true });

    writeFileSync(
      join(testLocalAgentDir, "local-agent.md"),
      `---
name: local-agent
description: A local agent
---
Local prompt.`
    );

    // Change to test directory for discovery
    process.chdir(testLocalDir);
  });

  afterAll(() => {
    process.chdir("/tmp");
    rmSync(testLocalDir, { recursive: true, force: true });
  });

  test("discovers agents from local directories", async () => {
    const agents = await discoverAgents();
    const localAgent = agents.find((a) => a.name === "local-agent");
    expect(localAgent).toBeDefined();
    expect(localAgent!.description).toBe("A local agent");
    expect(localAgent!.source).toBe("project");
  });

  test("returns array of AgentDefinition objects", async () => {
    const agents = await discoverAgents();
    for (const agent of agents) {
      expect(agent).toHaveProperty("name");
      expect(agent).toHaveProperty("description");
      expect(agent).toHaveProperty("prompt");
      expect(agent).toHaveProperty("source");
    }
  });
});

// ============================================================================
// BUILTIN AGENTS TESTS
// ============================================================================

describe("BUILTIN_AGENTS array", () => {
  test("is an array", () => {
    expect(Array.isArray(BUILTIN_AGENTS)).toBe(true);
  });

  test("contains at least one agent", () => {
    expect(BUILTIN_AGENTS.length).toBeGreaterThanOrEqual(1);
  });

  test("all agents have required fields", () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(agent).toHaveProperty("name");
      expect(agent).toHaveProperty("description");
      expect(agent).toHaveProperty("prompt");
      expect(agent).toHaveProperty("source");
      expect(typeof agent.name).toBe("string");
      expect(typeof agent.description).toBe("string");
      expect(typeof agent.prompt).toBe("string");
      expect(agent.source).toBe("builtin");
    }
  });

  test("all agents have unique names", () => {
    const names = BUILTIN_AGENTS.map((a) => a.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  test("contains codebase-analyzer agent", () => {
    const analyzer = BUILTIN_AGENTS.find((a) => a.name === "codebase-analyzer");
    expect(analyzer).toBeDefined();
  });

  test("contains codebase-locator agent", () => {
    const locator = BUILTIN_AGENTS.find((a) => a.name === "codebase-locator");
    expect(locator).toBeDefined();
  });

  test("contains codebase-pattern-finder agent", () => {
    const patternFinder = BUILTIN_AGENTS.find((a) => a.name === "codebase-pattern-finder");
    expect(patternFinder).toBeDefined();
  });

  test("contains codebase-online-researcher agent", () => {
    const researcher = BUILTIN_AGENTS.find((a) => a.name === "codebase-online-researcher");
    expect(researcher).toBeDefined();
  });

  test("contains codebase-research-analyzer agent", () => {
    const researchAnalyzer = BUILTIN_AGENTS.find((a) => a.name === "codebase-research-analyzer");
    expect(researchAnalyzer).toBeDefined();
  });
});

describe("codebase-analyzer builtin agent", () => {
  const analyzer = BUILTIN_AGENTS.find((a) => a.name === "codebase-analyzer");

  test("exists in BUILTIN_AGENTS", () => {
    expect(analyzer).toBeDefined();
  });

  test("has correct name", () => {
    expect(analyzer!.name).toBe("codebase-analyzer");
  });

  test("has appropriate description", () => {
    expect(analyzer!.description).toContain("Analyzes");
    expect(analyzer!.description).toContain("codebase");
  });

  test("has tools array with analysis tools", () => {
    expect(analyzer!.tools).toBeDefined();
    expect(analyzer!.tools).toContain("Glob");
    expect(analyzer!.tools).toContain("Grep");
    expect(analyzer!.tools).toContain("Read");
    expect(analyzer!.tools).toContain("LS");
    expect(analyzer!.tools).toContain("Bash");
  });

  test("has opus model", () => {
    expect(analyzer!.model).toBe("opus");
  });

  test("has comprehensive system prompt", () => {
    expect(analyzer!.prompt.length).toBeGreaterThan(500);
    expect(analyzer!.prompt).toContain("analysis");
    expect(analyzer!.prompt).toContain("code");
  });

  test("prompt includes analysis process steps", () => {
    expect(analyzer!.prompt).toContain("Read Entry Points");
    expect(analyzer!.prompt).toContain("Follow the Code Path");
    expect(analyzer!.prompt).toContain("Document Key Logic");
  });

  test("prompt includes output format guidelines", () => {
    expect(analyzer!.prompt).toContain("Overview");
    expect(analyzer!.prompt).toContain("Entry Points");
    expect(analyzer!.prompt).toContain("Core Implementation");
  });

  test("has builtin source", () => {
    expect(analyzer!.source).toBe("builtin");
  });
});

describe("codebase-locator builtin agent", () => {
  const locator = BUILTIN_AGENTS.find((a) => a.name === "codebase-locator");

  test("exists in BUILTIN_AGENTS", () => {
    expect(locator).toBeDefined();
  });

  test("has correct name", () => {
    expect(locator!.name).toBe("codebase-locator");
  });

  test("has appropriate description", () => {
    expect(locator!.description).toContain("Locates");
    expect(locator!.description).toContain("files");
  });

  test("has tools array with navigation tools", () => {
    expect(locator!.tools).toBeDefined();
    expect(locator!.tools).toContain("Glob");
    expect(locator!.tools).toContain("Grep");
    expect(locator!.tools).toContain("Read");
    expect(locator!.tools).toContain("LS");
    expect(locator!.tools).toContain("Bash");
    expect(locator!.tools).toContain("NotebookRead");
  });

  test("has opus model", () => {
    expect(locator!.model).toBe("opus");
  });

  test("has comprehensive system prompt", () => {
    expect(locator!.prompt.length).toBeGreaterThan(500);
    expect(locator!.prompt).toContain("finding WHERE code lives");
    expect(locator!.prompt).toContain("locate");
  });

  test("prompt includes search strategy steps", () => {
    expect(locator!.prompt).toContain("Find Files by Topic/Feature");
    expect(locator!.prompt).toContain("Categorize Findings");
    expect(locator!.prompt).toContain("Return Structured Results");
    expect(locator!.prompt).toContain("Initial Broad Search");
    expect(locator!.prompt).toContain("Refine by Language/Framework");
  });

  test("prompt includes common file patterns", () => {
    expect(locator!.prompt).toContain("components");
    expect(locator!.prompt).toContain("services");
    expect(locator!.prompt).toContain("lib");
  });

  test("prompt includes output format guidelines", () => {
    expect(locator!.prompt).toContain("Implementation Files");
    expect(locator!.prompt).toContain("Test Files");
    expect(locator!.prompt).toContain("Related Directories");
  });

  test("has builtin source", () => {
    expect(locator!.source).toBe("builtin");
  });
});

describe("getBuiltinAgent", () => {
  test("finds agent by exact name", () => {
    const agent = getBuiltinAgent("codebase-analyzer");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-analyzer");
  });

  test("finds agent case-insensitively", () => {
    const agent1 = getBuiltinAgent("CODEBASE-ANALYZER");
    const agent2 = getBuiltinAgent("Codebase-Analyzer");
    expect(agent1).toBeDefined();
    expect(agent2).toBeDefined();
    expect(agent1!.name).toBe("codebase-analyzer");
    expect(agent2!.name).toBe("codebase-analyzer");
  });

  test("returns undefined for non-existent agent", () => {
    const agent = getBuiltinAgent("non-existent-agent");
    expect(agent).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    const agent = getBuiltinAgent("");
    expect(agent).toBeUndefined();
  });

  test("finds codebase-locator by name", () => {
    const agent = getBuiltinAgent("codebase-locator");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-locator");
    expect(agent!.model).toBe("opus");
  });

  test("finds codebase-locator case-insensitively", () => {
    const agent = getBuiltinAgent("CODEBASE-LOCATOR");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-locator");
  });

  test("finds codebase-pattern-finder by name", () => {
    const agent = getBuiltinAgent("codebase-pattern-finder");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-pattern-finder");
    expect(agent!.model).toBe("opus");
  });

  test("finds codebase-pattern-finder case-insensitively", () => {
    const agent = getBuiltinAgent("CODEBASE-PATTERN-FINDER");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-pattern-finder");
  });

  test("finds codebase-online-researcher by name", () => {
    const agent = getBuiltinAgent("codebase-online-researcher");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-online-researcher");
    expect(agent!.model).toBe("opus");
  });

  test("finds codebase-online-researcher case-insensitively", () => {
    const agent = getBuiltinAgent("CODEBASE-ONLINE-RESEARCHER");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-online-researcher");
  });
});

describe("codebase-pattern-finder builtin agent", () => {
  const patternFinder = BUILTIN_AGENTS.find((a) => a.name === "codebase-pattern-finder");

  test("exists in BUILTIN_AGENTS", () => {
    expect(patternFinder).toBeDefined();
  });

  test("has correct name", () => {
    expect(patternFinder!.name).toBe("codebase-pattern-finder");
  });

  test("has appropriate description", () => {
    expect(patternFinder!.description).toContain("finding similar implementations");
    expect(patternFinder!.description).toContain("patterns");
  });

  test("has tools array with pattern finding tools", () => {
    expect(patternFinder!.tools).toBeDefined();
    expect(patternFinder!.tools).toContain("Glob");
    expect(patternFinder!.tools).toContain("Grep");
    expect(patternFinder!.tools).toContain("Read");
    expect(patternFinder!.tools).toContain("LS");
    expect(patternFinder!.tools).toContain("Bash");
    expect(patternFinder!.tools).toContain("NotebookRead");
  });

  test("has sonnet model", () => {
    expect(patternFinder!.model).toBe("opus");
  });

  test("has comprehensive system prompt", () => {
    expect(patternFinder!.prompt.length).toBeGreaterThan(500);
    expect(patternFinder!.prompt).toContain("pattern");
    expect(patternFinder!.prompt).toContain("code");
  });

  test("prompt includes pattern finding strategy steps", () => {
    expect(patternFinder!.prompt).toContain("Identify Pattern Types");
    expect(patternFinder!.prompt).toContain("Read and Extract");
    expect(patternFinder!.prompt).toContain("Find Similar Implementations");
  });

  test("prompt includes pattern categories", () => {
    expect(patternFinder!.prompt).toContain("API Patterns");
    expect(patternFinder!.prompt).toContain("Data Patterns");
    expect(patternFinder!.prompt).toContain("Component Patterns");
    expect(patternFinder!.prompt).toContain("Testing Patterns");
  });

  test("prompt includes output format guidelines", () => {
    expect(patternFinder!.prompt).toContain("Pattern Examples");
    expect(patternFinder!.prompt).toContain("Key aspects");
    expect(patternFinder!.prompt).toContain("Pattern Usage in Codebase");
    expect(patternFinder!.prompt).toContain("Related Utilities");
  });

  test("has builtin source", () => {
    expect(patternFinder!.source).toBe("builtin");
  });
});

describe("codebase-online-researcher builtin agent", () => {
  const researcher = BUILTIN_AGENTS.find((a) => a.name === "codebase-online-researcher");

  test("exists in BUILTIN_AGENTS", () => {
    expect(researcher).toBeDefined();
  });

  test("has correct name", () => {
    expect(researcher!.name).toBe("codebase-online-researcher");
  });

  test("has appropriate description", () => {
    expect(researcher!.description).toContain("information");
    expect(researcher!.description).toContain("web");
  });

  test("has tools array with web research tools", () => {
    expect(researcher!.tools).toBeDefined();
    expect(researcher!.tools).toContain("Glob");
    expect(researcher!.tools).toContain("Grep");
    expect(researcher!.tools).toContain("Read");
    expect(researcher!.tools).toContain("LS");
    expect(researcher!.tools).toContain("WebFetch");
    expect(researcher!.tools).toContain("WebSearch");
    expect(researcher!.tools).toContain("mcp__deepwiki__ask_question");
  });

  test("has opus model", () => {
    expect(researcher!.model).toBe("opus");
  });

  test("has comprehensive system prompt", () => {
    expect(researcher!.prompt.length).toBeGreaterThan(500);
    expect(researcher!.prompt).toContain("research");
    expect(researcher!.prompt).toContain("web");
  });

  test("prompt includes research strategy steps", () => {
    expect(researcher!.prompt).toContain("Analyze the Query");
    expect(researcher!.prompt).toContain("Execute Strategic Searches");
    expect(researcher!.prompt).toContain("Fetch and Analyze Content");
    expect(researcher!.prompt).toContain("Synthesize Findings");
  });

  test("prompt includes output format guidelines", () => {
    expect(researcher!.prompt).toContain("Summary");
    expect(researcher!.prompt).toContain("Detailed Findings");
    expect(researcher!.prompt).toContain("Additional Resources");
    expect(researcher!.prompt).toContain("Gaps or Limitations");
  });

  test("prompt mentions DeepWiki tool", () => {
    expect(researcher!.prompt).toContain("DeepWiki");
    expect(researcher!.prompt).toContain("ask_question");
  });

  test("has builtin source", () => {
    expect(researcher!.source).toBe("builtin");
  });
});

describe("codebase-research-analyzer builtin agent", () => {
  const researchAnalyzer = BUILTIN_AGENTS.find((a) => a.name === "codebase-research-analyzer");

  test("exists in BUILTIN_AGENTS", () => {
    expect(researchAnalyzer).toBeDefined();
  });

  test("has correct name", () => {
    expect(researchAnalyzer!.name).toBe("codebase-research-analyzer");
  });

  test("has appropriate description", () => {
    expect(researchAnalyzer!.description).toContain("research");
    expect(researchAnalyzer!.description).toContain("codebase-analyzer");
  });

  test("has tools array with research analysis tools", () => {
    expect(researchAnalyzer!.tools).toBeDefined();
    expect(researchAnalyzer!.tools).toContain("Read");
    expect(researchAnalyzer!.tools).toContain("Grep");
    expect(researchAnalyzer!.tools).toContain("Glob");
    expect(researchAnalyzer!.tools).toContain("LS");
    expect(researchAnalyzer!.tools).toContain("Bash");
  });

  test("has opus model", () => {
    expect(researchAnalyzer!.model).toBe("opus");
  });

  test("has comprehensive system prompt", () => {
    expect(researchAnalyzer!.prompt.length).toBeGreaterThan(500);
    expect(researchAnalyzer!.prompt).toContain("insights");
    expect(researchAnalyzer!.prompt).toContain("documents");
  });

  test("prompt includes research analysis strategy steps", () => {
    expect(researchAnalyzer!.prompt).toContain("Read with Purpose");
    expect(researchAnalyzer!.prompt).toContain("Extract Strategically");
    expect(researchAnalyzer!.prompt).toContain("Filter Ruthlessly");
  });

  test("prompt includes quality filters", () => {
    expect(researchAnalyzer!.prompt).toContain("Include Only If");
    expect(researchAnalyzer!.prompt).toContain("Exclude If");
  });

  test("prompt includes output format guidelines", () => {
    expect(researchAnalyzer!.prompt).toContain("Document Context");
    expect(researchAnalyzer!.prompt).toContain("Key Decisions");
    expect(researchAnalyzer!.prompt).toContain("Critical Constraints");
    expect(researchAnalyzer!.prompt).toContain("Actionable Insights");
    expect(researchAnalyzer!.prompt).toContain("Relevance Assessment");
  });

  test("has builtin source", () => {
    expect(researchAnalyzer!.source).toBe("builtin");
  });
});

describe("getBuiltinAgent for codebase-research-analyzer", () => {
  test("finds codebase-research-analyzer by name", () => {
    const agent = getBuiltinAgent("codebase-research-analyzer");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-research-analyzer");
    expect(agent!.model).toBe("opus");
  });

  test("finds codebase-research-analyzer case-insensitively", () => {
    const agent = getBuiltinAgent("CODEBASE-RESEARCH-ANALYZER");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-research-analyzer");
  });
});

// ============================================================================
// CODEBASE-RESEARCH-LOCATOR BUILTIN AGENT TESTS
// ============================================================================

describe("BUILTIN_AGENTS array - codebase-research-locator", () => {
  test("contains codebase-research-locator agent", () => {
    const researchLocator = BUILTIN_AGENTS.find((a) => a.name === "codebase-research-locator");
    expect(researchLocator).toBeDefined();
  });
});

describe("codebase-research-locator builtin agent", () => {
  const researchLocator = BUILTIN_AGENTS.find((a) => a.name === "codebase-research-locator");

  test("exists in BUILTIN_AGENTS", () => {
    expect(researchLocator).toBeDefined();
  });

  test("has correct name", () => {
    expect(researchLocator!.name).toBe("codebase-research-locator");
  });

  test("has appropriate description", () => {
    expect(researchLocator!.description).toContain("Discovers");
    expect(researchLocator!.description).toContain("research");
  });

  test("has tools array with research locator tools", () => {
    expect(researchLocator!.tools).toBeDefined();
    expect(researchLocator!.tools).toContain("Read");
    expect(researchLocator!.tools).toContain("Grep");
    expect(researchLocator!.tools).toContain("Glob");
    expect(researchLocator!.tools).toContain("LS");
    expect(researchLocator!.tools).toContain("Bash");
  });

  test("has opus model", () => {
    expect(researchLocator!.model).toBe("opus");
  });

  test("has comprehensive system prompt", () => {
    expect(researchLocator!.prompt.length).toBeGreaterThan(500);
    expect(researchLocator!.prompt).toContain("research");
    expect(researchLocator!.prompt).toContain("document");
  });

  test("prompt includes document discovery strategy steps", () => {
    expect(researchLocator!.prompt).toContain("Search research/ directory structure");
    expect(researchLocator!.prompt).toContain("Categorize findings by type");
    expect(researchLocator!.prompt).toContain("Return organized results");
  });

  test("prompt includes research directory structure", () => {
    expect(researchLocator!.prompt).toContain("tickets/");
    expect(researchLocator!.prompt).toContain("docs/");
    expect(researchLocator!.prompt).toContain("notes/");
  });

  test("prompt includes output format guidelines", () => {
    expect(researchLocator!.prompt).toContain("Related Tickets");
    expect(researchLocator!.prompt).toContain("Related Documents");
    expect(researchLocator!.prompt).toContain("Related Discussions");
  });

  test("has builtin source", () => {
    expect(researchLocator!.source).toBe("builtin");
  });
});

describe("getBuiltinAgent for codebase-research-locator", () => {
  test("finds codebase-research-locator by name", () => {
    const agent = getBuiltinAgent("codebase-research-locator");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-research-locator");
    expect(agent!.model).toBe("opus");
  });

  test("finds codebase-research-locator case-insensitively", () => {
    const agent = getBuiltinAgent("CODEBASE-RESEARCH-LOCATOR");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("codebase-research-locator");
  });
});

// ============================================================================
// DEBUGGER BUILTIN AGENT TESTS
// ============================================================================

describe("BUILTIN_AGENTS array - debugger", () => {
  test("contains debugger agent", () => {
    const debuggerAgent = BUILTIN_AGENTS.find((a) => a.name === "debugger");
    expect(debuggerAgent).toBeDefined();
  });
});

describe("debugger builtin agent", () => {
  const debuggerAgent = BUILTIN_AGENTS.find((a) => a.name === "debugger");

  test("exists in BUILTIN_AGENTS", () => {
    expect(debuggerAgent).toBeDefined();
  });

  test("has correct name", () => {
    expect(debuggerAgent!.name).toBe("debugger");
  });

  test("has appropriate description", () => {
    expect(debuggerAgent!.description).toContain("Debugging");
    expect(debuggerAgent!.description).toContain("errors");
  });

  test("has tools array with debugging tools", () => {
    expect(debuggerAgent!.tools).toBeDefined();
    expect(debuggerAgent!.tools).toContain("Bash");
    expect(debuggerAgent!.tools).toContain("Task");
    expect(debuggerAgent!.tools).toContain("AskUserQuestion");
    expect(debuggerAgent!.tools).toContain("Edit");
    expect(debuggerAgent!.tools).toContain("Glob");
    expect(debuggerAgent!.tools).toContain("Grep");
    expect(debuggerAgent!.tools).toContain("Read");
    expect(debuggerAgent!.tools).toContain("Write");
    expect(debuggerAgent!.tools).toContain("WebFetch");
    expect(debuggerAgent!.tools).toContain("WebSearch");
  });

  test("has opus model", () => {
    expect(debuggerAgent!.model).toBe("opus");
  });

  test("has comprehensive system prompt", () => {
    expect(debuggerAgent!.prompt.length).toBeGreaterThan(500);
    expect(debuggerAgent!.prompt).toContain("debugging");
    expect(debuggerAgent!.prompt).toContain("error");
  });

  test("prompt includes debugging process steps", () => {
    expect(debuggerAgent!.prompt).toContain("Capture error message and stack trace");
    expect(debuggerAgent!.prompt).toContain("Identify reproduction steps");
    expect(debuggerAgent!.prompt).toContain("Isolate the failure location");
    expect(debuggerAgent!.prompt).toContain("debugging report");
  });

  test("prompt includes debugging techniques", () => {
    expect(debuggerAgent!.prompt).toContain("Analyze error messages and logs");
    expect(debuggerAgent!.prompt).toContain("Form and test hypotheses");
    expect(debuggerAgent!.prompt).toContain("Inspect variable states");
  });

  test("prompt includes output requirements", () => {
    expect(debuggerAgent!.prompt).toContain("Root cause explanation");
    expect(debuggerAgent!.prompt).toContain("Evidence supporting the diagnosis");
    expect(debuggerAgent!.prompt).toContain("Suggested code fix");
    expect(debuggerAgent!.prompt).toContain("Prevention recommendations");
  });

  test("has builtin source", () => {
    expect(debuggerAgent!.source).toBe("builtin");
  });
});

describe("getBuiltinAgent for debugger", () => {
  test("finds debugger by name", () => {
    const agent = getBuiltinAgent("debugger");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("debugger");
    expect(agent!.model).toBe("opus");
  });

  test("finds debugger case-insensitively", () => {
    const agent = getBuiltinAgent("DEBUGGER");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("debugger");
  });
});

// ============================================================================
// AGENT COMMAND REGISTRATION TESTS
// ============================================================================

describe("createAgentCommand", () => {
  test("creates CommandDefinition from AgentDefinition", () => {
    const agent: AgentDefinition = {
      name: "test-agent",
      description: "A test agent",
      prompt: "You are a test agent.",
      source: "builtin",
    };

    const command = createAgentCommand(agent);

    expect(command.name).toBe("test-agent");
    expect(command.description).toBe("A test agent");
    expect(command.category).toBe("agent");
    expect(command.hidden).toBe(false);
    expect(typeof command.execute).toBe("function");
  });

  test("creates CommandDefinition for agent with all fields", () => {
    const agent: AgentDefinition = {
      name: "full-agent",
      description: "A fully configured agent",
      tools: ["Glob", "Grep", "Read"],
      model: "opus",
      prompt: "You are a full agent.",
      source: "builtin",
    };

    const command = createAgentCommand(agent);

    expect(command.name).toBe("full-agent");
    expect(command.description).toBe("A fully configured agent");
    expect(command.category).toBe("agent");
  });

  test("execute handler calls sendSilentMessage with agent prompt", async () => {
    const agent: AgentDefinition = {
      name: "message-agent",
      description: "Agent that sends message",
      prompt: "You are a helpful agent.",
      source: "builtin",
    };

    const command = createAgentCommand(agent);

    let sentMessage = "";
    const mockContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: () => {},
      sendSilentMessage: (content: string) => {
        sentMessage = content;
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await command.execute("", mockContext);

    expect(result.success).toBe(true);
    expect(sentMessage).toBe("You are a helpful agent.");
  });

  test("execute handler appends user args to prompt", async () => {
    const agent: AgentDefinition = {
      name: "args-agent",
      description: "Agent with args",
      prompt: "You are a helpful agent.",
      source: "builtin",
    };

    const command = createAgentCommand(agent);

    let sentMessage = "";
    const mockContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: () => {},
      sendSilentMessage: (content: string) => {
        sentMessage = content;
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await command.execute("analyze the login flow", mockContext);

    expect(result.success).toBe(true);
    expect(sentMessage).toContain("You are a helpful agent.");
    expect(sentMessage).toContain("## User Request");
    expect(sentMessage).toContain("analyze the login flow");
  });

  test("execute handler trims user args", () => {
    const agent: AgentDefinition = {
      name: "trim-agent",
      description: "Agent that trims args",
      prompt: "Test prompt.",
      source: "builtin",
    };

    const command = createAgentCommand(agent);

    let sentMessage = "";
    const mockContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: () => {},
      sendSilentMessage: (content: string) => {
        sentMessage = content;
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    // Empty whitespace args should not append User Request section
    command.execute("   ", mockContext);
    expect(sentMessage).toBe("Test prompt.");
    expect(sentMessage).not.toContain("## User Request");
  });
});

describe("builtinAgentCommands", () => {
  test("is an array", () => {
    expect(Array.isArray(builtinAgentCommands)).toBe(true);
  });

  test("has same length as BUILTIN_AGENTS", () => {
    expect(builtinAgentCommands.length).toBe(BUILTIN_AGENTS.length);
  });

  test("all commands have agent category", () => {
    for (const command of builtinAgentCommands) {
      expect(command.category).toBe("agent");
    }
  });

  test("all commands have execute function", () => {
    for (const command of builtinAgentCommands) {
      expect(typeof command.execute).toBe("function");
    }
  });

  test("each command corresponds to a builtin agent", () => {
    for (const command of builtinAgentCommands) {
      const agent = BUILTIN_AGENTS.find((a) => a.name === command.name);
      expect(agent).toBeDefined();
      expect(command.description).toBe(agent!.description);
    }
  });

  test("includes codebase-analyzer command", () => {
    const command = builtinAgentCommands.find((c) => c.name === "codebase-analyzer");
    expect(command).toBeDefined();
    expect(command!.category).toBe("agent");
  });

  test("includes debugger command", () => {
    const command = builtinAgentCommands.find((c) => c.name === "debugger");
    expect(command).toBeDefined();
    expect(command!.category).toBe("agent");
  });
});

describe("registerBuiltinAgents", () => {
  beforeAll(() => {
    // Clear registry before tests
    globalRegistry.clear();
  });

  afterAll(() => {
    // Clean up after tests
    globalRegistry.clear();
  });

  test("registers all builtin agents", () => {
    globalRegistry.clear();
    registerBuiltinAgents();

    for (const agent of BUILTIN_AGENTS) {
      expect(globalRegistry.has(agent.name)).toBe(true);
    }
  });

  test("registered commands have agent category", () => {
    globalRegistry.clear();
    registerBuiltinAgents();

    for (const agent of BUILTIN_AGENTS) {
      const command = globalRegistry.get(agent.name);
      expect(command).toBeDefined();
      expect(command!.category).toBe("agent");
    }
  });

  test("is idempotent", () => {
    globalRegistry.clear();

    // Register twice
    registerBuiltinAgents();
    const countAfterFirst = globalRegistry.size();

    registerBuiltinAgents();
    const countAfterSecond = globalRegistry.size();

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  test("registered commands can be executed", async () => {
    globalRegistry.clear();
    registerBuiltinAgents();

    const command = globalRegistry.get("codebase-analyzer");
    expect(command).toBeDefined();

    let sentMessage = "";
    const mockContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: () => {},
      sendSilentMessage: (content: string) => {
        sentMessage = content;
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await command!.execute("test args", mockContext);

    expect(result.success).toBe(true);
    expect(sentMessage.length).toBeGreaterThan(0);
  });
});

describe("registerAgentCommands", () => {
  const testLocalDir = "/tmp/test-register-agents-" + Date.now();
  const testLocalAgentDir = join(testLocalDir, ".claude", "agents");

  beforeAll(() => {
    // Create local test directory structure
    mkdirSync(testLocalAgentDir, { recursive: true });

    writeFileSync(
      join(testLocalAgentDir, "custom-agent.md"),
      `---
name: custom-agent
description: A custom agent for testing
---
You are a custom agent.`
    );

    // Change to test directory for discovery
    process.chdir(testLocalDir);
    globalRegistry.clear();
  });

  afterAll(() => {
    process.chdir("/tmp");
    rmSync(testLocalDir, { recursive: true, force: true });
    globalRegistry.clear();
  });

  test("registers all builtin agents", async () => {
    globalRegistry.clear();
    await registerAgentCommands();

    for (const agent of BUILTIN_AGENTS) {
      expect(globalRegistry.has(agent.name)).toBe(true);
    }
  });

  test("discovers and registers custom agents from disk", async () => {
    globalRegistry.clear();
    await registerAgentCommands();

    const customAgent = globalRegistry.get("custom-agent");
    expect(customAgent).toBeDefined();
    expect(customAgent!.category).toBe("agent");
    expect(customAgent!.description).toBe("A custom agent for testing");
  });

  test("is idempotent", async () => {
    globalRegistry.clear();

    // Register twice
    await registerAgentCommands();
    const countAfterFirst = globalRegistry.size();

    await registerAgentCommands();
    const countAfterSecond = globalRegistry.size();

    expect(countAfterSecond).toBe(countAfterFirst);
  });
});

// ============================================================================
// SUB-AGENT DISCOVERY FROM AGENT DIRECTORIES TESTS
// ============================================================================

describe("Sub-agent discovery from agent directories", () => {
  const testDir = "/tmp/test-subagent-discovery-" + Date.now();
  const claudeAgentDir = join(testDir, ".claude", "agents");
  const opencodeAgentDir = join(testDir, ".opencode", "agents");
  const githubAgentDir = join(testDir, ".github", "agents");

  beforeAll(() => {
    // Create all agent directories
    mkdirSync(claudeAgentDir, { recursive: true });
    mkdirSync(opencodeAgentDir, { recursive: true });
    mkdirSync(githubAgentDir, { recursive: true });

    // Create test agent in .claude/agents/
    writeFileSync(
      join(claudeAgentDir, "claude-analyzer.md"),
      `---
name: claude-analyzer
description: A Claude-specific code analyzer
tools:
  - Glob
  - Grep
  - Read
model: opus
---
You are a Claude-specific code analyzer agent.
Analyze code with precision and provide detailed insights.`
    );

    // Create test agent in .opencode/agents/
    writeFileSync(
      join(opencodeAgentDir, "opencode-writer.md"),
      `---
name: opencode-writer
description: An OpenCode-specific code writer
tools:
  glob: true
  grep: true
  write: true
  edit: true
  bash: false
model: anthropic/claude-3-sonnet
mode: subagent
---
You are an OpenCode-specific code writer agent.
Write clean, maintainable code following best practices.`
    );

    // Create test agent in .github/agents/
    writeFileSync(
      join(githubAgentDir, "github-reviewer.md"),
      `---
name: github-reviewer
description: A GitHub-specific code reviewer
tools:
  - Glob
  - Grep
  - Read
  - Bash
model: sonnet
---
You are a GitHub-specific code reviewer agent.
Review pull requests and provide constructive feedback.`
    );

    // Change to test directory
    process.chdir(testDir);
  });

  afterAll(() => {
    process.chdir("/tmp");
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("discoverAgentFiles finds agents in .claude/agents/", () => {
    test("discovers .md files in .claude/agents/", () => {
      const files = discoverAgentFilesInPath(claudeAgentDir, "project");
      expect(files).toHaveLength(1);
      expect(files[0]!.filename).toBe("claude-analyzer");
    });

    test("assigns project source to .claude/agents/ files", () => {
      const files = discoverAgentFilesInPath(claudeAgentDir, "project");
      expect(files[0]!.source).toBe("project");
    });

    test("includes full path to .claude/agents/ files", () => {
      const files = discoverAgentFilesInPath(claudeAgentDir, "project");
      expect(files[0]!.path).toBe(join(claudeAgentDir, "claude-analyzer.md"));
    });
  });

  describe("discoverAgentFiles finds agents in .opencode/agents/", () => {
    test("discovers .md files in .opencode/agents/", () => {
      const files = discoverAgentFilesInPath(opencodeAgentDir, "project");
      expect(files).toHaveLength(1);
      expect(files[0]!.filename).toBe("opencode-writer");
    });

    test("assigns project source to .opencode/agents/ files", () => {
      const files = discoverAgentFilesInPath(opencodeAgentDir, "project");
      expect(files[0]!.source).toBe("project");
    });

    test("includes full path to .opencode/agents/ files", () => {
      const files = discoverAgentFilesInPath(opencodeAgentDir, "project");
      expect(files[0]!.path).toBe(join(opencodeAgentDir, "opencode-writer.md"));
    });
  });

  describe("discoverAgentFiles finds agents in .github/agents/", () => {
    test("discovers .md files in .github/agents/", () => {
      const files = discoverAgentFilesInPath(githubAgentDir, "project");
      expect(files).toHaveLength(1);
      expect(files[0]!.filename).toBe("github-reviewer");
    });

    test("assigns project source to .github/agents/ files", () => {
      const files = discoverAgentFilesInPath(githubAgentDir, "project");
      expect(files[0]!.source).toBe("project");
    });

    test("includes full path to .github/agents/ files", () => {
      const files = discoverAgentFilesInPath(githubAgentDir, "project");
      expect(files[0]!.path).toBe(join(githubAgentDir, "github-reviewer.md"));
    });
  });

  describe("discoverAgents finds all agents from all paths", () => {
    test("discovers agents from all three directories", async () => {
      const agents = await discoverAgents();

      const claudeAgent = agents.find((a) => a.name === "claude-analyzer");
      const opencodeAgent = agents.find((a) => a.name === "opencode-writer");
      const githubAgent = agents.find((a) => a.name === "github-reviewer");

      expect(claudeAgent).toBeDefined();
      expect(opencodeAgent).toBeDefined();
      expect(githubAgent).toBeDefined();
    });

    test("parses Claude format frontmatter correctly", async () => {
      const agents = await discoverAgents();
      const claudeAgent = agents.find((a) => a.name === "claude-analyzer");

      expect(claudeAgent).toBeDefined();
      expect(claudeAgent!.description).toBe("A Claude-specific code analyzer");
      expect(claudeAgent!.tools).toEqual(["Glob", "Grep", "Read"]);
      expect(claudeAgent!.model).toBe("opus");
      expect(claudeAgent!.prompt).toContain("Claude-specific code analyzer agent");
    });

    test("parses OpenCode format frontmatter correctly", async () => {
      const agents = await discoverAgents();
      const opencodeAgent = agents.find((a) => a.name === "opencode-writer");

      expect(opencodeAgent).toBeDefined();
      expect(opencodeAgent!.description).toBe("An OpenCode-specific code writer");
      // OpenCode tools format: Record<string, boolean> normalized to array
      expect(opencodeAgent!.tools).toContain("glob");
      expect(opencodeAgent!.tools).toContain("grep");
      expect(opencodeAgent!.tools).toContain("write");
      expect(opencodeAgent!.tools).toContain("edit");
      expect(opencodeAgent!.tools).not.toContain("bash"); // bash: false
      // Model normalized from anthropic/claude-3-sonnet to sonnet
      expect(opencodeAgent!.model).toBe("sonnet");
      expect(opencodeAgent!.prompt).toContain("OpenCode-specific code writer agent");
    });

    test("parses GitHub format frontmatter correctly", async () => {
      const agents = await discoverAgents();
      const githubAgent = agents.find((a) => a.name === "github-reviewer");

      expect(githubAgent).toBeDefined();
      expect(githubAgent!.description).toBe("A GitHub-specific code reviewer");
      expect(githubAgent!.tools).toEqual(["Glob", "Grep", "Read", "Bash"]);
      expect(githubAgent!.model).toBe("sonnet");
      expect(githubAgent!.prompt).toContain("GitHub-specific code reviewer agent");
    });
  });

  describe("agents from all paths have correct sources", () => {
    test("agent from .claude/agents/ has project source", async () => {
      const agents = await discoverAgents();
      const claudeAgent = agents.find((a) => a.name === "claude-analyzer");

      expect(claudeAgent).toBeDefined();
      expect(claudeAgent!.source).toBe("project");
    });

    test("agent from .opencode/agents/ has project source", async () => {
      const agents = await discoverAgents();
      const opencodeAgent = agents.find((a) => a.name === "opencode-writer");

      expect(opencodeAgent).toBeDefined();
      expect(opencodeAgent!.source).toBe("project");
    });

    test("agent from .github/agents/ has project source", async () => {
      const agents = await discoverAgents();
      const githubAgent = agents.find((a) => a.name === "github-reviewer");

      expect(githubAgent).toBeDefined();
      expect(githubAgent!.source).toBe("project");
    });
  });

  describe("discoverAgentFiles correctly identifies .claude/agents path", () => {
    test("discoverAgentFiles includes .claude/agents in search", () => {
      // AGENT_DISCOVERY_PATHS should contain .claude/agents
      expect(AGENT_DISCOVERY_PATHS).toContain(".claude/agents");
    });

    test("discoverAgentFiles returns files with correct metadata", () => {
      const files = discoverAgentFilesInPath(".claude/agents", "project");
      if (files.length > 0) {
        const file = files[0]!;
        expect(file).toHaveProperty("path");
        expect(file).toHaveProperty("source");
        expect(file).toHaveProperty("filename");
      }
    });
  });

  describe("discoverAgentFiles correctly identifies .opencode/agents path", () => {
    test("discoverAgentFiles includes .opencode/agents in search", () => {
      // AGENT_DISCOVERY_PATHS should contain .opencode/agents
      expect(AGENT_DISCOVERY_PATHS).toContain(".opencode/agents");
    });

    test("discoverAgentFiles returns files with correct metadata", () => {
      const files = discoverAgentFilesInPath(".opencode/agents", "project");
      if (files.length > 0) {
        const file = files[0]!;
        expect(file).toHaveProperty("path");
        expect(file).toHaveProperty("source");
        expect(file).toHaveProperty("filename");
      }
    });
  });

  describe("discoverAgentFiles correctly identifies .github/agents path", () => {
    test("discoverAgentFiles includes .github/agents in search", () => {
      // AGENT_DISCOVERY_PATHS should contain .github/agents
      expect(AGENT_DISCOVERY_PATHS).toContain(".github/agents");
    });

    test("discoverAgentFiles returns files with correct metadata", () => {
      const files = discoverAgentFilesInPath(".github/agents", "project");
      if (files.length > 0) {
        const file = files[0]!;
        expect(file).toHaveProperty("path");
        expect(file).toHaveProperty("source");
        expect(file).toHaveProperty("filename");
      }
    });
  });
});

describe("Sub-agent discovery with multiple agents per directory", () => {
  const testDir = "/tmp/test-multi-agent-discovery-" + Date.now();
  const claudeAgentDir = join(testDir, ".claude", "agents");
  const githubAgentDir = join(testDir, ".github", "agents");

  beforeAll(() => {
    mkdirSync(claudeAgentDir, { recursive: true });
    mkdirSync(githubAgentDir, { recursive: true });

    // Create multiple agents in .claude/agents/
    writeFileSync(
      join(claudeAgentDir, "agent-one.md"),
      `---
name: agent-one
description: First Claude agent
---
First agent prompt.`
    );
    writeFileSync(
      join(claudeAgentDir, "agent-two.md"),
      `---
name: agent-two
description: Second Claude agent
---
Second agent prompt.`
    );
    writeFileSync(
      join(claudeAgentDir, "agent-three.md"),
      `---
name: agent-three
description: Third Claude agent
---
Third agent prompt.`
    );

    // Create multiple agents in .github/agents/
    writeFileSync(
      join(githubAgentDir, "github-one.md"),
      `---
name: github-one
description: First GitHub agent
---
GitHub one prompt.`
    );
    writeFileSync(
      join(githubAgentDir, "github-two.md"),
      `---
name: github-two
description: Second GitHub agent
---
GitHub two prompt.`
    );

    process.chdir(testDir);
  });

  afterAll(() => {
    process.chdir("/tmp");
    rmSync(testDir, { recursive: true, force: true });
  });

  test("discovers all agents in .claude/agents/", () => {
    const files = discoverAgentFilesInPath(claudeAgentDir, "project");
    expect(files).toHaveLength(3);
    const filenames = files.map((f) => f.filename);
    expect(filenames).toContain("agent-one");
    expect(filenames).toContain("agent-two");
    expect(filenames).toContain("agent-three");
  });

  test("discovers all agents in .github/agents/", () => {
    const files = discoverAgentFilesInPath(githubAgentDir, "project");
    expect(files).toHaveLength(2);
    const filenames = files.map((f) => f.filename);
    expect(filenames).toContain("github-one");
    expect(filenames).toContain("github-two");
  });

  test("discoverAgents finds all agents from multiple directories", async () => {
    const agents = await discoverAgents();

    // Should find all 5 custom agents
    const agentNames = agents.map((a) => a.name);
    expect(agentNames).toContain("agent-one");
    expect(agentNames).toContain("agent-two");
    expect(agentNames).toContain("agent-three");
    expect(agentNames).toContain("github-one");
    expect(agentNames).toContain("github-two");
  });

  test("all discovered agents have correct descriptions", async () => {
    const agents = await discoverAgents();

    const agentOne = agents.find((a) => a.name === "agent-one");
    const agentTwo = agents.find((a) => a.name === "agent-two");
    const githubOne = agents.find((a) => a.name === "github-one");

    expect(agentOne?.description).toBe("First Claude agent");
    expect(agentTwo?.description).toBe("Second Claude agent");
    expect(githubOne?.description).toBe("First GitHub agent");
  });

  test("all discovered agents have correct prompts", async () => {
    const agents = await discoverAgents();

    const agentOne = agents.find((a) => a.name === "agent-one");
    const githubTwo = agents.find((a) => a.name === "github-two");

    expect(agentOne?.prompt).toBe("First agent prompt.");
    expect(githubTwo?.prompt).toBe("GitHub two prompt.");
  });
});

describe("Sub-agent discovery handles empty directories", () => {
  const testDir = "/tmp/test-empty-agent-dirs-" + Date.now();
  const emptyClaudeDir = join(testDir, ".claude", "agents");
  const emptyGithubDir = join(testDir, ".github", "agents");
  const nonEmptyOpencodeDir = join(testDir, ".opencode", "agents");

  beforeAll(() => {
    // Create empty directories
    mkdirSync(emptyClaudeDir, { recursive: true });
    mkdirSync(emptyGithubDir, { recursive: true });
    mkdirSync(nonEmptyOpencodeDir, { recursive: true });

    // Only add agent to opencode dir
    writeFileSync(
      join(nonEmptyOpencodeDir, "only-agent.md"),
      `---
name: only-agent
description: The only agent in this test
---
Only agent prompt.`
    );

    process.chdir(testDir);
  });

  afterAll(() => {
    process.chdir("/tmp");
    rmSync(testDir, { recursive: true, force: true });
  });

  test("returns empty array for empty .claude/agents/", () => {
    const files = discoverAgentFilesInPath(emptyClaudeDir, "project");
    expect(files).toHaveLength(0);
  });

  test("returns empty array for empty .github/agents/", () => {
    const files = discoverAgentFilesInPath(emptyGithubDir, "project");
    expect(files).toHaveLength(0);
  });

  test("discoverAgents still finds agents in non-empty directories", async () => {
    const agents = await discoverAgents();
    const onlyAgent = agents.find((a) => a.name === "only-agent");

    expect(onlyAgent).toBeDefined();
    expect(onlyAgent!.description).toBe("The only agent in this test");
  });

  test("discoverAgents gracefully handles mix of empty and non-empty dirs", async () => {
    const agents = await discoverAgents();

    // Should only find the one agent from opencode dir
    const customAgents = agents.filter((a) => a.name === "only-agent");
    expect(customAgents).toHaveLength(1);
  });
});

describe("Sub-agent discovery handles non-existent directories", () => {
  const testDir = "/tmp/test-nonexistent-agent-dirs-" + Date.now();
  const existingDir = join(testDir, ".opencode", "agents");

  beforeAll(() => {
    // Only create .opencode/agents, leave others non-existent
    mkdirSync(existingDir, { recursive: true });

    writeFileSync(
      join(existingDir, "existing-agent.md"),
      `---
name: existing-agent
description: Agent in existing directory
---
Existing agent prompt.`
    );

    process.chdir(testDir);
  });

  afterAll(() => {
    process.chdir("/tmp");
    rmSync(testDir, { recursive: true, force: true });
  });

  test("returns empty array for non-existent .claude/agents/", () => {
    const files = discoverAgentFilesInPath(".claude/agents", "project");
    expect(files).toHaveLength(0);
  });

  test("returns empty array for non-existent .github/agents/", () => {
    const files = discoverAgentFilesInPath(".github/agents", "project");
    expect(files).toHaveLength(0);
  });

  test("discoverAgents finds agents even when some directories don't exist", async () => {
    const agents = await discoverAgents();
    const existingAgent = agents.find((a) => a.name === "existing-agent");

    expect(existingAgent).toBeDefined();
    expect(existingAgent!.description).toBe("Agent in existing directory");
  });
});

describe("Sub-agent discovery ignores non-.md files", () => {
  const testDir = "/tmp/test-ignore-nonmd-" + Date.now();
  const claudeDir = join(testDir, ".claude", "agents");

  beforeAll(() => {
    mkdirSync(claudeDir, { recursive: true });

    // Create various file types
    writeFileSync(
      join(claudeDir, "valid-agent.md"),
      `---
name: valid-agent
description: A valid agent
---
Valid prompt.`
    );
    writeFileSync(join(claudeDir, "readme.txt"), "This is a readme");
    writeFileSync(join(claudeDir, "config.json"), '{"key": "value"}');
    writeFileSync(join(claudeDir, "script.ts"), "console.log('hello');");
    writeFileSync(join(claudeDir, ".hidden"), "hidden file");

    process.chdir(testDir);
  });

  afterAll(() => {
    process.chdir("/tmp");
    rmSync(testDir, { recursive: true, force: true });
  });

  test("only discovers .md files in agent directories", () => {
    const files = discoverAgentFilesInPath(claudeDir, "project");
    expect(files).toHaveLength(1);
    expect(files[0]!.filename).toBe("valid-agent");
  });

  test("ignores .txt files", () => {
    const files = discoverAgentFilesInPath(claudeDir, "project");
    const txtFiles = files.filter((f) => f.filename === "readme");
    expect(txtFiles).toHaveLength(0);
  });

  test("ignores .json files", () => {
    const files = discoverAgentFilesInPath(claudeDir, "project");
    const jsonFiles = files.filter((f) => f.filename === "config");
    expect(jsonFiles).toHaveLength(0);
  });

  test("ignores .ts files", () => {
    const files = discoverAgentFilesInPath(claudeDir, "project");
    const tsFiles = files.filter((f) => f.filename === "script");
    expect(tsFiles).toHaveLength(0);
  });

  test("ignores hidden files", () => {
    const files = discoverAgentFilesInPath(claudeDir, "project");
    const hiddenFiles = files.filter((f) => f.filename.startsWith("."));
    expect(hiddenFiles).toHaveLength(0);
  });
});

describe("Sub-agent discovery with name conflicts across directories", () => {
  const testDir = "/tmp/test-name-conflict-" + Date.now();
  const claudeDir = join(testDir, ".claude", "agents");
  const githubDir = join(testDir, ".github", "agents");

  beforeAll(() => {
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(githubDir, { recursive: true });

    // Same agent name in different directories
    writeFileSync(
      join(claudeDir, "shared-agent.md"),
      `---
name: shared-agent
description: Shared agent from Claude
---
Claude version of shared agent.`
    );
    writeFileSync(
      join(githubDir, "shared-agent.md"),
      `---
name: shared-agent
description: Shared agent from GitHub
---
GitHub version of shared agent.`
    );

    process.chdir(testDir);
  });

  afterAll(() => {
    process.chdir("/tmp");
    rmSync(testDir, { recursive: true, force: true });
  });

  test("handles duplicate names across directories", async () => {
    const agents = await discoverAgents();
    const sharedAgents = agents.filter((a) => a.name === "shared-agent");

    // Should only have one agent with this name (first one discovered wins)
    expect(sharedAgents).toHaveLength(1);
  });

  test("earlier discovery path takes precedence", async () => {
    const agents = await discoverAgents();
    const sharedAgent = agents.find((a) => a.name === "shared-agent");

    // .claude/agents comes before .github/agents in AGENT_DISCOVERY_PATHS
    expect(sharedAgent?.description).toBe("Shared agent from Claude");
  });
});

// ============================================================================
// AGENT FRONTMATTER PARSING ACROSS SDK FORMATS TESTS
// ============================================================================

describe("Agent frontmatter parsing across SDK formats", () => {
  describe("Claude format: tools as string array", () => {
    test("parses Claude format with tools as string array", () => {
      const frontmatter = {
        name: "claude-agent",
        description: "A Claude Code agent",
        tools: ["Glob", "Grep", "Read", "LS", "Bash"],
        model: "opus",
      };
      const body = "You are a Claude Code agent.";

      const result = parseAgentFrontmatter(frontmatter, body, "project", "claude-agent");

      expect(result.name).toBe("claude-agent");
      expect(result.description).toBe("A Claude Code agent");
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools).toEqual(["Glob", "Grep", "Read", "LS", "Bash"]);
      expect(result.model).toBe("opus");
      expect(result.prompt).toBe("You are a Claude Code agent.");
      expect(result.source).toBe("project");
    });

    test("Claude format tools array is passed through unchanged", () => {
      const tools = ["WebSearch", "WebFetch", "mcp__deepwiki__ask_question"];
      const frontmatter = {
        description: "Research agent",
        tools: tools,
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "builtin", "researcher");

      expect(result.tools).toEqual(tools);
      // Note: The implementation passes arrays by reference (same instance)
      expect(result.tools).toBe(tools);
    });

    test("Claude format with empty tools array", () => {
      const frontmatter = {
        description: "Agent with no tools",
        tools: [],
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "user", "no-tools");

      expect(result.tools).toEqual([]);
    });

    test("Claude format with single tool", () => {
      const frontmatter = {
        description: "Single tool agent",
        tools: ["Read"],
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "single-tool");

      expect(result.tools).toEqual(["Read"]);
      expect(result.tools).toHaveLength(1);
    });

    test("Claude format tools preserve case", () => {
      const frontmatter = {
        description: "Case test",
        tools: ["GLOB", "grep", "Read", "LS"],
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "case-test");

      expect(result.tools).toEqual(["GLOB", "grep", "Read", "LS"]);
    });
  });

  describe("OpenCode format: tools as Record<string, boolean>", () => {
    test("parses OpenCode format with tools as Record<string, boolean>", () => {
      const frontmatter = {
        name: "opencode-agent",
        description: "An OpenCode agent",
        tools: {
          glob: true,
          grep: true,
          read: true,
          write: true,
          edit: true,
          bash: false,
        },
        model: "anthropic/claude-3-sonnet",
        mode: "subagent",
      };
      const body = "You are an OpenCode agent.";

      const result = parseAgentFrontmatter(frontmatter, body, "project", "opencode-agent");

      expect(result.name).toBe("opencode-agent");
      expect(result.description).toBe("An OpenCode agent");
      expect(Array.isArray(result.tools)).toBe(true);
      // Only tools with true values should be included
      expect(result.tools).toContain("glob");
      expect(result.tools).toContain("grep");
      expect(result.tools).toContain("read");
      expect(result.tools).toContain("write");
      expect(result.tools).toContain("edit");
      expect(result.tools).not.toContain("bash"); // bash: false
      expect(result.model).toBe("sonnet"); // Normalized from anthropic/claude-3-sonnet
      expect(result.prompt).toBe("You are an OpenCode agent.");
      expect(result.source).toBe("project");
    });

    test("OpenCode format converts Record to array of enabled tools", () => {
      const frontmatter = {
        description: "Tool filter test",
        tools: {
          tool1: true,
          tool2: false,
          tool3: true,
          tool4: false,
          tool5: true,
        },
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "user", "filter-test");

      expect(result.tools).toContain("tool1");
      expect(result.tools).toContain("tool3");
      expect(result.tools).toContain("tool5");
      expect(result.tools).not.toContain("tool2");
      expect(result.tools).not.toContain("tool4");
      expect(result.tools).toHaveLength(3);
    });

    test("OpenCode format with all tools disabled", () => {
      const frontmatter = {
        description: "All tools disabled",
        tools: {
          glob: false,
          grep: false,
          read: false,
        },
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "disabled");

      expect(result.tools).toEqual([]);
    });

    test("OpenCode format with all tools enabled", () => {
      const frontmatter = {
        description: "All tools enabled",
        tools: {
          glob: true,
          grep: true,
          read: true,
        },
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "enabled");

      expect(result.tools).toContain("glob");
      expect(result.tools).toContain("grep");
      expect(result.tools).toContain("read");
      expect(result.tools).toHaveLength(3);
    });

    test("OpenCode format mode field is ignored in AgentDefinition", () => {
      const frontmatter = {
        description: "Mode test",
        mode: "subagent" as const,
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "mode-test");

      // AgentDefinition doesn't have a mode field - it's OpenCode-specific
      expect(result).not.toHaveProperty("mode");
      // But the agent is still created correctly
      expect(result.name).toBe("mode-test");
      expect(result.description).toBe("Mode test");
    });

    test("OpenCode format with primary mode is still parsed", () => {
      const frontmatter = {
        description: "Primary mode agent",
        mode: "primary" as const,
        tools: { read: true },
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "primary-agent");

      expect(result.name).toBe("primary-agent");
      expect(result.tools).toEqual(["read"]);
    });
  });

  describe("Model normalization: 'anthropic/claude-3-sonnet' -> 'sonnet'", () => {
    test("normalizes anthropic/claude-3-sonnet to sonnet", () => {
      expect(normalizeModel("anthropic/claude-3-sonnet")).toBe("sonnet");
    });

    test("normalizes anthropic/claude-3.5-sonnet to sonnet", () => {
      expect(normalizeModel("anthropic/claude-3.5-sonnet")).toBe("sonnet");
    });

    test("normalizes anthropic/claude-3-opus to opus", () => {
      expect(normalizeModel("anthropic/claude-3-opus")).toBe("opus");
    });

    test("normalizes anthropic/claude-3.5-opus to opus", () => {
      expect(normalizeModel("anthropic/claude-3.5-opus")).toBe("opus");
    });

    test("normalizes anthropic/claude-3-haiku to haiku", () => {
      expect(normalizeModel("anthropic/claude-3-haiku")).toBe("haiku");
    });

    test("normalizes anthropic/claude-3.5-haiku to haiku", () => {
      expect(normalizeModel("anthropic/claude-3.5-haiku")).toBe("haiku");
    });

    test("normalizes direct model names (sonnet)", () => {
      expect(normalizeModel("sonnet")).toBe("sonnet");
      expect(normalizeModel("Sonnet")).toBe("sonnet");
      expect(normalizeModel("SONNET")).toBe("sonnet");
    });

    test("normalizes direct model names (opus)", () => {
      expect(normalizeModel("opus")).toBe("opus");
      expect(normalizeModel("Opus")).toBe("opus");
      expect(normalizeModel("OPUS")).toBe("opus");
    });

    test("normalizes direct model names (haiku)", () => {
      expect(normalizeModel("haiku")).toBe("haiku");
      expect(normalizeModel("Haiku")).toBe("haiku");
      expect(normalizeModel("HAIKU")).toBe("haiku");
    });

    test("model normalization in parseAgentFrontmatter", () => {
      const frontmatter = {
        description: "Agent with OpenCode model format",
        model: "anthropic/claude-3-opus",
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "model-test");

      expect(result.model).toBe("opus");
    });

    test("model normalization handles partial matches", () => {
      // Models containing "sonnet" somewhere
      expect(normalizeModel("claude-sonnet")).toBe("sonnet");
      expect(normalizeModel("my-custom-sonnet-model")).toBe("sonnet");

      // Models containing "opus" somewhere
      expect(normalizeModel("claude-opus")).toBe("opus");
      expect(normalizeModel("custom-opus-v2")).toBe("opus");

      // Models containing "haiku" somewhere
      expect(normalizeModel("claude-haiku")).toBe("haiku");
      expect(normalizeModel("fast-haiku-model")).toBe("haiku");
    });

    test("model normalization returns undefined for unknown models", () => {
      expect(normalizeModel("gpt-4")).toBeUndefined();
      expect(normalizeModel("gpt-3.5-turbo")).toBeUndefined();
      expect(normalizeModel("llama-2-70b")).toBeUndefined();
      expect(normalizeModel("unknown-model")).toBeUndefined();
      expect(normalizeModel("")).toBeUndefined();
    });

    test("model normalization returns undefined for undefined input", () => {
      expect(normalizeModel(undefined)).toBeUndefined();
    });
  });

  describe("Missing optional fields use defaults", () => {
    test("missing name uses filename as default", () => {
      const frontmatter = {
        description: "Agent without explicit name",
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "my-custom-agent");

      expect(result.name).toBe("my-custom-agent");
    });

    test("missing description uses default description", () => {
      const frontmatter = {
        name: "agent-name",
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "agent-name");

      expect(result.description).toBe("Agent: agent-name");
    });

    test("missing description with only filename uses filename in default", () => {
      const frontmatter = {};

      const result = parseAgentFrontmatter(frontmatter, "prompt", "user", "special-helper");

      expect(result.name).toBe("special-helper");
      expect(result.description).toBe("Agent: special-helper");
    });

    test("missing tools field results in undefined tools", () => {
      const frontmatter = {
        description: "Agent without tools",
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "no-tools");

      expect(result.tools).toBeUndefined();
    });

    test("missing model field results in undefined model", () => {
      const frontmatter = {
        description: "Agent without model",
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "project", "no-model");

      expect(result.model).toBeUndefined();
    });

    test("minimal frontmatter with only required source creates valid agent", () => {
      const frontmatter = {};

      const result = parseAgentFrontmatter(frontmatter, "Simple prompt", "builtin", "minimal-agent");

      expect(result.name).toBe("minimal-agent");
      expect(result.description).toBe("Agent: minimal-agent");
      expect(result.prompt).toBe("Simple prompt");
      expect(result.source).toBe("builtin");
      expect(result.tools).toBeUndefined();
      expect(result.model).toBeUndefined();
    });

    test("empty body results in empty prompt string", () => {
      const frontmatter = {
        description: "Agent with empty body",
      };

      const result = parseAgentFrontmatter(frontmatter, "", "project", "empty-body");

      expect(result.prompt).toBe("");
    });

    test("whitespace-only body is trimmed to empty string", () => {
      const frontmatter = {
        description: "Agent with whitespace body",
      };

      const result = parseAgentFrontmatter(frontmatter, "   \n\t\n   ", "project", "whitespace-body");

      expect(result.prompt).toBe("");
    });
  });

  describe("Invalid frontmatter handled gracefully", () => {
    test("parseMarkdownFrontmatter returns null for content without frontmatter delimiters", () => {
      const content = "This is just regular content without any frontmatter.";

      const result = parseMarkdownFrontmatter(content);

      expect(result).toBeNull();
    });

    test("parseMarkdownFrontmatter returns null for unclosed frontmatter", () => {
      const content = `---
name: broken-agent
description: Missing closing delimiter
This becomes part of the frontmatter`;

      const result = parseMarkdownFrontmatter(content);

      expect(result).toBeNull();
    });

    test("parseMarkdownFrontmatter returns null for frontmatter without opening delimiter", () => {
      const content = `name: broken-agent
description: No opening delimiter
---
Body content here.`;

      const result = parseMarkdownFrontmatter(content);

      expect(result).toBeNull();
    });

    test("parseAgentFile returns agent with defaults for content without frontmatter", () => {
      const testDir = "/tmp/test-invalid-frontmatter-" + Date.now();
      mkdirSync(testDir, { recursive: true });

      // File without any frontmatter
      writeFileSync(join(testDir, "no-frontmatter.md"), "Just a plain markdown file.");

      const file: DiscoveredAgentFile = {
        path: join(testDir, "no-frontmatter.md"),
        source: "project",
        filename: "no-frontmatter",
      };

      const result = parseAgentFile(file);

      expect(result).not.toBeNull();
      expect(result!.name).toBe("no-frontmatter");
      expect(result!.description).toBe("Agent: no-frontmatter");
      expect(result!.prompt).toBe("Just a plain markdown file.");
      expect(result!.source).toBe("project");

      rmSync(testDir, { recursive: true, force: true });
    });

    test("parseAgentFile returns null for non-existent file", () => {
      const file: DiscoveredAgentFile = {
        path: "/non/existent/path/agent.md",
        source: "project",
        filename: "agent",
      };

      const result = parseAgentFile(file);

      expect(result).toBeNull();
    });

    test("parseAgentFrontmatter handles undefined values gracefully", () => {
      const frontmatter = {
        name: undefined,
        description: undefined,
        tools: undefined,
        model: undefined,
      };

      // Should not throw
      const result = parseAgentFrontmatter(
        frontmatter as unknown as Record<string, unknown>,
        "prompt",
        "user",
        "fallback-name"
      );

      expect(result.name).toBe("fallback-name");
      expect(result.description).toBe("Agent: fallback-name");
      expect(result.tools).toBeUndefined();
      expect(result.model).toBeUndefined();
    });

    test("parseAgentFrontmatter handles null values gracefully", () => {
      const frontmatter = {
        name: null,
        description: null,
        tools: null,
        model: null,
      };

      const result = parseAgentFrontmatter(
        frontmatter as unknown as Record<string, unknown>,
        "prompt",
        "project",
        "null-agent"
      );

      // Null values should be treated as missing
      expect(result.name).toBe("null-agent");
      expect(result.description).toBe("Agent: null-agent");
    });

    test("parseAgentFrontmatter handles wrong types for tools field", () => {
      // Note: The current implementation doesn't validate types strictly
      // Strings are iterable, so "not-an-array" would be treated as an array
      const frontmatter = {
        description: "Valid description",
        tools: { tool1: true, tool2: false }, // Valid object format
      };

      const result = parseAgentFrontmatter(
        frontmatter as unknown as Record<string, unknown>,
        "prompt",
        "project",
        "type-test"
      );

      expect(result.name).toBe("type-test");
      expect(result.description).toBe("Valid description");
      expect(result.tools).toContain("tool1");
      expect(result.tools).not.toContain("tool2");
    });

    test("normalizeTools passes through arrays", () => {
      // Array input is passed through
      const tools = ["Glob", "Grep"];
      expect(normalizeTools(tools)).toEqual(["Glob", "Grep"]);
    });

    test("normalizeTools converts object to array of enabled tools", () => {
      // Object input is converted
      const tools = { glob: true, grep: false, read: true };
      const result = normalizeTools(tools);
      expect(result).toContain("glob");
      expect(result).toContain("read");
      expect(result).not.toContain("grep");
    });

    test("normalizeTools returns undefined for undefined input", () => {
      expect(normalizeTools(undefined)).toBeUndefined();
    });

    test("normalizeModel returns undefined for empty string", () => {
      expect(normalizeModel("")).toBeUndefined();
    });

    test("parseMarkdownFrontmatter handles empty frontmatter section", () => {
      // Note: The regex requires at least one newline in the frontmatter section
      const content = `---

---
Body content here.`;

      const result = parseMarkdownFrontmatter(content);

      expect(result).not.toBeNull();
      expect(result!.frontmatter).toEqual({});
      expect(result!.body).toBe("Body content here.");
    });

    test("parseMarkdownFrontmatter returns null for truly empty frontmatter (no newline)", () => {
      // This edge case: `---\n---` without anything in between
      const content = `---
---
Body content here.`;

      const result = parseMarkdownFrontmatter(content);

      // The regex pattern ^---\n([\s\S]*?)\n---\n? requires content + newline before closing ---
      expect(result).toBeNull();
    });

    test("parseMarkdownFrontmatter handles malformed YAML in frontmatter", () => {
      const content = `---
name: agent
description:
  - this
  - is
  - invalid for description
---
Body content.`;

      // The parser should still attempt to parse what it can
      const result = parseMarkdownFrontmatter(content);

      expect(result).not.toBeNull();
      expect(result!.frontmatter.name).toBe("agent");
    });

    test("parseMarkdownFrontmatter handles frontmatter with only comments", () => {
      const content = `---
# This is a comment
# Another comment
---
Body content.`;

      const result = parseMarkdownFrontmatter(content);

      expect(result).not.toBeNull();
      expect(result!.frontmatter).toEqual({});
      expect(result!.body).toBe("Body content.");
    });
  });

  describe("Copilot format compatibility", () => {
    test("parses Copilot format with string array tools", () => {
      const frontmatter = {
        name: "copilot-agent",
        description: "A GitHub Copilot agent",
        tools: ["search", "file_read", "file_write", "terminal"],
        model: "gpt-4",
      };

      const result = parseAgentFrontmatter(frontmatter, "Copilot prompt", "project", "copilot-agent");

      expect(result.name).toBe("copilot-agent");
      expect(result.description).toBe("A GitHub Copilot agent");
      expect(result.tools).toEqual(["search", "file_read", "file_write", "terminal"]);
      // gpt-4 is not a Claude model, so model should be undefined
      expect(result.model).toBeUndefined();
    });

    test("Copilot format tools are preserved as-is", () => {
      const frontmatter = {
        description: "Copilot tools test",
        tools: ["custom_tool_1", "custom_tool_2"],
      };

      const result = parseAgentFrontmatter(frontmatter, "prompt", "user", "copilot-tools");

      expect(result.tools).toEqual(["custom_tool_1", "custom_tool_2"]);
    });
  });

  describe("Full parsing flow with parseAgentFile", () => {
    const testDir = "/tmp/test-full-parsing-" + Date.now();

    beforeAll(() => {
      mkdirSync(testDir, { recursive: true });

      // Claude format file
      writeFileSync(
        join(testDir, "claude-style.md"),
        `---
name: claude-style-agent
description: Agent using Claude Code format
tools:
  - Glob
  - Grep
  - Read
model: opus
---
You are a Claude-style agent with full formatting.

## Capabilities
- Search files with Glob
- Search content with Grep
- Read file contents

## Guidelines
Be thorough and precise.`
      );

      // OpenCode format file
      writeFileSync(
        join(testDir, "opencode-style.md"),
        `---
name: opencode-style-agent
description: Agent using OpenCode format
tools:
  glob: true
  grep: true
  read: true
  write: false
  bash: false
model: anthropic/claude-3.5-sonnet
mode: subagent
---
You are an OpenCode-style agent.

Read-only access to files.`
      );

      // Minimal format file
      writeFileSync(
        join(testDir, "minimal-style.md"),
        `---
description: Minimal agent
---
Minimal prompt content.`
      );
    });

    afterAll(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    test("parseAgentFile correctly parses Claude format file", () => {
      const file: DiscoveredAgentFile = {
        path: join(testDir, "claude-style.md"),
        source: "project",
        filename: "claude-style",
      };

      const result = parseAgentFile(file);

      expect(result).not.toBeNull();
      expect(result!.name).toBe("claude-style-agent");
      expect(result!.description).toBe("Agent using Claude Code format");
      expect(result!.tools).toEqual(["Glob", "Grep", "Read"]);
      expect(result!.model).toBe("opus");
      expect(result!.prompt).toContain("You are a Claude-style agent");
      expect(result!.prompt).toContain("## Capabilities");
      expect(result!.source).toBe("project");
    });

    test("parseAgentFile correctly parses OpenCode format file", () => {
      const file: DiscoveredAgentFile = {
        path: join(testDir, "opencode-style.md"),
        source: "project",
        filename: "opencode-style",
      };

      const result = parseAgentFile(file);

      expect(result).not.toBeNull();
      expect(result!.name).toBe("opencode-style-agent");
      expect(result!.description).toBe("Agent using OpenCode format");
      // Tools should be normalized to array of enabled tools
      expect(result!.tools).toContain("glob");
      expect(result!.tools).toContain("grep");
      expect(result!.tools).toContain("read");
      expect(result!.tools).not.toContain("write");
      expect(result!.tools).not.toContain("bash");
      expect(result!.tools).toHaveLength(3);
      // Model should be normalized
      expect(result!.model).toBe("sonnet");
      expect(result!.prompt).toContain("You are an OpenCode-style agent");
      expect(result!.source).toBe("project");
    });

    test("parseAgentFile correctly parses minimal format file", () => {
      const file: DiscoveredAgentFile = {
        path: join(testDir, "minimal-style.md"),
        source: "user",
        filename: "minimal-style",
      };

      const result = parseAgentFile(file);

      expect(result).not.toBeNull();
      // Name should come from filename since not in frontmatter
      expect(result!.name).toBe("minimal-style");
      expect(result!.description).toBe("Minimal agent");
      expect(result!.tools).toBeUndefined();
      expect(result!.model).toBeUndefined();
      expect(result!.prompt).toBe("Minimal prompt content.");
      expect(result!.source).toBe("user");
    });
  });
});
