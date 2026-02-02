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
