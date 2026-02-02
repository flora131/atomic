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
} from "../../../src/ui/commands/agent-commands.ts";
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

  test("supports atomic source", () => {
    const source: AgentSource = "atomic";
    expect(source).toBe("atomic");
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
      model: "haiku",
      prompt: "You are a file locator specialist. Find relevant files and components quickly.",
      source: "builtin",
    };

    expect(codebaseLocator.name).toBe("codebase-locator");
    expect(codebaseLocator.model).toBe("haiku");
    expect(codebaseLocator.source).toBe("builtin");
  });

  test("debugger agent definition is valid", () => {
    const debugger_agent: AgentDefinition = {
      name: "debugger",
      description: "Debugging specialist for errors, test failures, and unexpected behavior.",
      tools: ["Bash", "Task", "AskUserQuestion", "Edit", "Glob", "Grep", "Read", "Write", "WebFetch", "WebSearch"],
      model: "sonnet",
      prompt: "You are a debugging specialist. Analyze errors, identify root causes, and provide fixes.",
      source: "builtin",
    };

    expect(debugger_agent.name).toBe("debugger");
    expect(debugger_agent.tools).toContain("Edit");
    expect(debugger_agent.tools).toContain("Write");
    expect(debugger_agent.model).toBe("sonnet");
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

  test("contains .atomic/agents path", () => {
    expect(AGENT_DISCOVERY_PATHS).toContain(".atomic/agents");
  });

  test("has 4 project-local paths", () => {
    expect(AGENT_DISCOVERY_PATHS).toHaveLength(4);
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

  test("contains ~/.atomic/agents path", () => {
    expect(GLOBAL_AGENT_PATHS).toContain("~/.atomic/agents");
  });

  test("has 4 user-global paths", () => {
    expect(GLOBAL_AGENT_PATHS).toHaveLength(4);
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

  test("returns atomic for global .atomic paths", () => {
    expect(determineAgentSource("~/.atomic/agents")).toBe("atomic");
  });

  test("returns project for local non-atomic paths", () => {
    expect(determineAgentSource(".claude/agents")).toBe("project");
    expect(determineAgentSource(".opencode/agents")).toBe("project");
    expect(determineAgentSource(".github/agents")).toBe("project");
  });

  test("returns atomic for local .atomic paths", () => {
    expect(determineAgentSource(".atomic/agents")).toBe("atomic");
  });
});

describe("shouldAgentOverride", () => {
  test("project overrides all other sources", () => {
    expect(shouldAgentOverride("project", "atomic")).toBe(true);
    expect(shouldAgentOverride("project", "user")).toBe(true);
    expect(shouldAgentOverride("project", "builtin")).toBe(true);
  });

  test("atomic overrides user and builtin", () => {
    expect(shouldAgentOverride("atomic", "user")).toBe(true);
    expect(shouldAgentOverride("atomic", "builtin")).toBe(true);
  });

  test("user overrides only builtin", () => {
    expect(shouldAgentOverride("user", "builtin")).toBe(true);
  });

  test("lower priority does not override higher", () => {
    expect(shouldAgentOverride("builtin", "project")).toBe(false);
    expect(shouldAgentOverride("user", "project")).toBe(false);
    expect(shouldAgentOverride("atomic", "project")).toBe(false);
    expect(shouldAgentOverride("builtin", "atomic")).toBe(false);
  });

  test("same priority does not override", () => {
    expect(shouldAgentOverride("project", "project")).toBe(false);
    expect(shouldAgentOverride("atomic", "atomic")).toBe(false);
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
  const testLocalAgentDir = join(testLocalDir, ".atomic", "agents");

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
    expect(localAgent!.source).toBe("atomic");
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
