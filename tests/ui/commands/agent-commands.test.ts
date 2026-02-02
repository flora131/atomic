/**
 * Tests for Agent Commands
 *
 * Verifies agent definition interfaces and type constraints.
 */

import { test, expect, describe } from "bun:test";
import type {
  AgentDefinition,
  AgentSource,
  AgentModel,
  AgentFrontmatter,
} from "../../../src/ui/commands/agent-commands.ts";
import {
  AGENT_DISCOVERY_PATHS,
  GLOBAL_AGENT_PATHS,
} from "../../../src/ui/commands/agent-commands.ts";

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
