/**
 * Tests for workflow DSL agent resolution.
 *
 * Validates that stage IDs are matched against discovered agent
 * definitions, and that agent file bodies are resolved as system prompts.
 *
 * Covers:
 * - readAgentBody: reads markdown body from agent files, handles missing/empty files
 * - readAgentFrontmatterModel: reads model field from agent frontmatter
 * - buildAgentLookup: discovers agents from project, caches results
 * - clearAgentLookupCache: invalidates cached lookup
 * - validateStageAgents: matches stage IDs, case-insensitive, error messages
 * - resolveStageSystemPrompt: resolves body as system prompt, case-insensitive
 * - resolveStageAgentModel: resolves model from agent frontmatter, case-insensitive
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  readAgentBody,
  readAgentFrontmatterModel,
  inferAgentTypeFromFilePath,
  resolveStageAgentModelConfig,
  validateStageAgents,
  resolveStageSystemPrompt,
  resolveStageAgentModel,
  buildAgentLookup,
  clearAgentLookupCache,
} from "@/services/workflows/dsl/agent-resolution.ts";
import type { AgentInfo } from "@/services/agent-discovery/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLookup(agents: Array<{ name: string; filePath: string }>): Map<string, AgentInfo> {
  const lookup = new Map<string, AgentInfo>();
  for (const agent of agents) {
    lookup.set(agent.name.toLowerCase(), {
      name: agent.name,
      description: `Agent: ${agent.name}`,
      source: "project",
      filePath: agent.filePath,
    });
  }
  return lookup;
}

/** Create a temporary file with the given content and return its path. */
function createTempFile(name: string, content: string): string {
  const dir = join(tmpdir(), `agent-resolution-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// validateStageAgents
// ---------------------------------------------------------------------------

describe("validateStageAgents", () => {
  test("returns no errors when all stages match discovered agents", () => {
    const lookup = makeLookup([
      { name: "planner", filePath: "/fake/planner.md" },
      { name: "orchestrator", filePath: "/fake/orchestrator.md" },
    ]);
    const errors = validateStageAgents(["planner", "orchestrator"], lookup);
    expect(errors).toHaveLength(0);
  });

  test("returns errors for unmatched stage IDs", () => {
    const lookup = makeLookup([
      { name: "planner", filePath: "/fake/planner.md" },
    ]);
    const errors = validateStageAgents(["planner", "executor"], lookup);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("executor");
    expect(errors[0]).toContain("no matching agent definition");
  });

  test("matches case-insensitively", () => {
    const lookup = makeLookup([
      { name: "Planner", filePath: "/fake/planner.md" },
    ]);
    const errors = validateStageAgents(["planner"], lookup);
    expect(errors).toHaveLength(0);
  });

  test("matches with mixed case stage ID against lowercase lookup", () => {
    const lookup = makeLookup([
      { name: "planner", filePath: "/fake/planner.md" },
    ]);
    const errors = validateStageAgents(["PLANNER"], lookup);
    expect(errors).toHaveLength(0);
  });

  test("returns errors for all unmatched stages", () => {
    const lookup = makeLookup([]);
    const errors = validateStageAgents(["s1", "s2", "s3"], lookup);
    expect(errors).toHaveLength(3);
  });

  test("error message includes available agent names when agents exist", () => {
    const lookup = makeLookup([
      { name: "planner", filePath: "/fake/planner.md" },
      { name: "reviewer", filePath: "/fake/reviewer.md" },
    ]);
    const errors = validateStageAgents(["unknown-agent"], lookup);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Available agents:");
    expect(errors[0]).toContain("planner");
    expect(errors[0]).toContain("reviewer");
  });

  test("error message notes when no agent definitions exist", () => {
    const lookup = makeLookup([]);
    const errors = validateStageAgents(["missing"], lookup);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("No agent definitions found");
  });

  test("returns empty array for empty stage list", () => {
    const lookup = makeLookup([
      { name: "planner", filePath: "/fake/planner.md" },
    ]);
    const errors = validateStageAgents([], lookup);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// readAgentBody
// ---------------------------------------------------------------------------

describe("readAgentBody", () => {
  test("reads body from a real agent definition file", () => {
    // Use an actual agent file from the project
    const body = readAgentBody(`${process.cwd()}/.claude/agents/planner.md`);
    expect(body).not.toBeNull();
    expect(body!.length).toBeGreaterThan(0);
    expect(body).toContain("planner");
  });

  test("returns null for nonexistent file", () => {
    const body = readAgentBody("/nonexistent/agent.md");
    expect(body).toBeNull();
  });

  test("reads body from a file with frontmatter", () => {
    const filePath = createTempFile(
      "agent-with-fm.md",
      "---\nname: test-agent\ndescription: A test agent\n---\nYou are a test agent.\n\nDo testing.",
    );
    const body = readAgentBody(filePath);
    expect(body).toBe("You are a test agent.\n\nDo testing.");
    rmSync(filePath);
  });

  test("reads full content when file has no frontmatter", () => {
    const filePath = createTempFile(
      "agent-no-fm.md",
      "You are an agent without frontmatter.\n\nJust instructions.",
    );
    const body = readAgentBody(filePath);
    expect(body).toBe("You are an agent without frontmatter.\n\nJust instructions.");
    rmSync(filePath);
  });

  test("returns null when file has frontmatter but empty body", () => {
    const filePath = createTempFile(
      "agent-empty-body.md",
      "---\nname: empty-body\n---\n",
    );
    const body = readAgentBody(filePath);
    expect(body).toBeNull();
    rmSync(filePath);
  });

  test("returns null when file is completely empty", () => {
    const filePath = createTempFile("agent-empty.md", "");
    const body = readAgentBody(filePath);
    expect(body).toBeNull();
    rmSync(filePath);
  });

  test("returns null for whitespace-only body after frontmatter", () => {
    const filePath = createTempFile(
      "agent-whitespace.md",
      "---\nname: whitespace\n---\n   \n  \n",
    );
    const body = readAgentBody(filePath);
    expect(body).toBeNull();
    rmSync(filePath);
  });
});

// ---------------------------------------------------------------------------
// resolveStageSystemPrompt
// ---------------------------------------------------------------------------

describe("resolveStageSystemPrompt", () => {
  test("resolves system prompt from matching agent file", () => {
    const lookup = makeLookup([
      { name: "planner", filePath: `${process.cwd()}/.claude/agents/planner.md` },
    ]);
    const prompt = resolveStageSystemPrompt("planner", lookup);
    expect(prompt).not.toBeNull();
    expect(prompt!.length).toBeGreaterThan(0);
  });

  test("returns null when no matching agent exists", () => {
    const lookup = makeLookup([]);
    const prompt = resolveStageSystemPrompt("nonexistent", lookup);
    expect(prompt).toBeNull();
  });

  test("matches case-insensitively", () => {
    const lookup = makeLookup([
      { name: "planner", filePath: `${process.cwd()}/.claude/agents/planner.md` },
    ]);
    const prompt = resolveStageSystemPrompt("PLANNER", lookup);
    expect(prompt).not.toBeNull();
  });

  test("returns null when matched agent file has empty body", () => {
    const filePath = createTempFile(
      "empty-agent.md",
      "---\nname: empty-agent\n---\n",
    );
    const lookup = makeLookup([
      { name: "empty-agent", filePath },
    ]);
    const prompt = resolveStageSystemPrompt("empty-agent", lookup);
    expect(prompt).toBeNull();
    rmSync(filePath);
  });

  test("returns body content for agent file without frontmatter", () => {
    const filePath = createTempFile(
      "plain-agent.md",
      "You are a plain agent.",
    );
    const lookup = makeLookup([
      { name: "plain-agent", filePath },
    ]);
    const prompt = resolveStageSystemPrompt("plain-agent", lookup);
    expect(prompt).toBe("You are a plain agent.");
    rmSync(filePath);
  });
});

// ---------------------------------------------------------------------------
// buildAgentLookup and clearAgentLookupCache
// ---------------------------------------------------------------------------

describe("buildAgentLookup", () => {
  beforeEach(() => {
    clearAgentLookupCache();
  });

  test("discovers agents from project directories", () => {
    const lookup = buildAgentLookup();
    // The project has agent files in .claude/agents/, .opencode/agents/, .github/agents/
    expect(lookup.size).toBeGreaterThan(0);
    expect(lookup.has("planner")).toBe(true);
    expect(lookup.has("worker")).toBe(true);
  });

  test("returns the same cached instance on subsequent calls", () => {
    const lookup1 = buildAgentLookup();
    const lookup2 = buildAgentLookup();
    expect(lookup1).toBe(lookup2);
  });

  test("stores agent names in lowercase", () => {
    const lookup = buildAgentLookup();
    for (const key of lookup.keys()) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  test("each entry has a valid AgentInfo structure", () => {
    const lookup = buildAgentLookup();
    for (const [_key, info] of lookup) {
      expect(typeof info.name).toBe("string");
      expect(typeof info.description).toBe("string");
      expect(typeof info.filePath).toBe("string");
      expect(typeof info.source).toBe("string");
    }
  });
});

describe("clearAgentLookupCache", () => {
  test("clears the cache so next buildAgentLookup creates a fresh map", () => {
    const lookup1 = buildAgentLookup();
    clearAgentLookupCache();
    const lookup2 = buildAgentLookup();
    // After clearing, a new Map instance should be returned
    expect(lookup1).not.toBe(lookup2);
    // But they should have the same content
    expect(lookup2.size).toBe(lookup1.size);
  });

  test("can be called multiple times without error", () => {
    clearAgentLookupCache();
    clearAgentLookupCache();
    clearAgentLookupCache();
    // Should not throw
    const lookup = buildAgentLookup();
    expect(lookup.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// readAgentFrontmatterModel
// ---------------------------------------------------------------------------

describe("readAgentFrontmatterModel", () => {
  test("reads model from frontmatter", () => {
    const filePath = createTempFile(
      "agent-with-model.md",
      "---\nname: test-agent\nmodel: opus\n---\nYou are a test agent.",
    );
    const model = readAgentFrontmatterModel(filePath);
    expect(model).toBe("opus");
    rmSync(filePath);
  });

  test("returns null when frontmatter has no model field", () => {
    const filePath = createTempFile(
      "agent-no-model.md",
      "---\nname: test-agent\n---\nYou are a test agent.",
    );
    const model = readAgentFrontmatterModel(filePath);
    expect(model).toBeNull();
    rmSync(filePath);
  });

  test("returns null when file has no frontmatter", () => {
    const filePath = createTempFile(
      "agent-plain.md",
      "You are a plain agent.",
    );
    const model = readAgentFrontmatterModel(filePath);
    expect(model).toBeNull();
    rmSync(filePath);
  });

  test("returns null for nonexistent file", () => {
    const model = readAgentFrontmatterModel("/nonexistent/agent.md");
    expect(model).toBeNull();
  });

  test("returns null when model is an empty string", () => {
    const filePath = createTempFile(
      "agent-empty-model.md",
      "---\nname: test-agent\nmodel: \"\"\n---\nYou are a test agent.",
    );
    const model = readAgentFrontmatterModel(filePath);
    expect(model).toBeNull();
    rmSync(filePath);
  });

  test("trims whitespace from model value", () => {
    const filePath = createTempFile(
      "agent-whitespace-model.md",
      "---\nname: test-agent\nmodel: \"  sonnet  \"\n---\nYou are a test agent.",
    );
    const model = readAgentFrontmatterModel(filePath);
    expect(model).toBe("sonnet");
    rmSync(filePath);
  });

  test("returns null when model is a non-string value", () => {
    const filePath = createTempFile(
      "agent-numeric-model.md",
      "---\nname: test-agent\nmodel: 42\n---\nYou are a test agent.",
    );
    const model = readAgentFrontmatterModel(filePath);
    expect(model).toBeNull();
    rmSync(filePath);
  });
});

// ---------------------------------------------------------------------------
// resolveStageAgentModel
// ---------------------------------------------------------------------------

describe("resolveStageAgentModel", () => {
  test("resolves model from matching agent file frontmatter", () => {
    const filePath = createTempFile(
      "model-agent.md",
      "---\nname: model-agent\nmodel: haiku\n---\nYou are an agent.",
    );
    const lookup = makeLookup([{ name: "model-agent", filePath }]);
    const model = resolveStageAgentModel("model-agent", lookup);
    expect(model).toBe("haiku");
    rmSync(filePath);
  });

  test("returns null when no matching agent exists", () => {
    const lookup = makeLookup([]);
    const model = resolveStageAgentModel("nonexistent", lookup);
    expect(model).toBeNull();
  });

  test("returns null when matched agent has no model in frontmatter", () => {
    const filePath = createTempFile(
      "no-model-agent.md",
      "---\nname: no-model-agent\n---\nYou are an agent.",
    );
    const lookup = makeLookup([{ name: "no-model-agent", filePath }]);
    const model = resolveStageAgentModel("no-model-agent", lookup);
    expect(model).toBeNull();
    rmSync(filePath);
  });

  test("matches case-insensitively", () => {
    const filePath = createTempFile(
      "case-agent.md",
      "---\nname: case-agent\nmodel: opus\n---\nYou are an agent.",
    );
    const lookup = makeLookup([{ name: "case-agent", filePath }]);
    const model = resolveStageAgentModel("CASE-AGENT", lookup);
    expect(model).toBe("opus");
    rmSync(filePath);
  });
});

// ---------------------------------------------------------------------------
// inferAgentTypeFromFilePath
// ---------------------------------------------------------------------------

describe("inferAgentTypeFromFilePath", () => {
  test("returns 'claude' for .claude/ directory paths", () => {
    expect(inferAgentTypeFromFilePath("/home/user/.claude/agents/planner.md")).toBe("claude");
    expect(inferAgentTypeFromFilePath("/project/.claude/agents/worker.md")).toBe("claude");
  });

  test("returns 'opencode' for .opencode/ directory paths", () => {
    expect(inferAgentTypeFromFilePath("/home/user/.opencode/agents/planner.md")).toBe("opencode");
    expect(inferAgentTypeFromFilePath("/project/.opencode/agents/worker.md")).toBe("opencode");
  });

  test("returns 'copilot' for .github/ directory paths", () => {
    expect(inferAgentTypeFromFilePath("/project/.github/agents/planner.md")).toBe("copilot");
  });

  test("returns 'copilot' for .copilot/ directory paths", () => {
    expect(inferAgentTypeFromFilePath("/home/user/.copilot/agents/planner.md")).toBe("copilot");
  });

  test("returns null for unrecognized directory paths", () => {
    expect(inferAgentTypeFromFilePath("/tmp/random/agents/planner.md")).toBeNull();
  });

  test("handles deeply nested .claude/ paths", () => {
    expect(inferAgentTypeFromFilePath("/a/b/c/.claude/agents/deep/nested/agent.md")).toBe("claude");
  });

  test("matches first provider segment when path contains multiple provider dirs", () => {
    // .claude/ appears first, so "claude" wins
    expect(inferAgentTypeFromFilePath("/project/.claude/backup/.opencode/agents/test.md")).toBe("claude");
  });
});

// ---------------------------------------------------------------------------
// resolveStageAgentModelConfig
// ---------------------------------------------------------------------------

/**
 * Create an agent file inside a provider-specific temp directory and
 * return the full path. Caller must clean up with rmSync(baseDir, { recursive: true }).
 */
function createProviderAgentFile(
  providerDir: string,
  agentName: string,
  content: string,
): { filePath: string; baseDir: string } {
  const baseDir = join(tmpdir(), `agent-res-${providerDir.replace(/[/.]/g, "_")}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const dir = join(baseDir, providerDir, "agents");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${agentName}.md`);
  writeFileSync(filePath, content, "utf-8");
  return { filePath, baseDir };
}

describe("resolveStageAgentModelConfig", () => {
  test("returns per-agent-type model config for .claude/ agent", () => {
    const { filePath, baseDir } = createProviderAgentFile(
      ".claude", "model-agent",
      "---\nname: model-agent\nmodel: opus\n---\nYou are an agent.",
    );
    const lookup = makeLookup([{ name: "model-agent", filePath }]);
    const config = resolveStageAgentModelConfig("model-agent", lookup);
    expect(config).toEqual({ claude: "opus" });
    rmSync(baseDir, { recursive: true });
  });

  test("returns per-agent-type model config for .opencode/ agent", () => {
    const { filePath, baseDir } = createProviderAgentFile(
      ".opencode", "model-agent",
      "---\nname: model-agent\nmodel: gpt-5\n---\nYou are an agent.",
    );
    const lookup = makeLookup([{ name: "model-agent", filePath }]);
    const config = resolveStageAgentModelConfig("model-agent", lookup);
    expect(config).toEqual({ opencode: "gpt-5" });
    rmSync(baseDir, { recursive: true });
  });

  test("returns per-agent-type model config for .github/ agent", () => {
    const { filePath, baseDir } = createProviderAgentFile(
      ".github", "model-agent",
      "---\nname: model-agent\nmodel: gpt-4o\n---\nYou are an agent.",
    );
    const lookup = makeLookup([{ name: "model-agent", filePath }]);
    const config = resolveStageAgentModelConfig("model-agent", lookup);
    expect(config).toEqual({ copilot: "gpt-4o" });
    rmSync(baseDir, { recursive: true });
  });

  test("returns per-agent-type model config for .copilot/ agent", () => {
    const { filePath, baseDir } = createProviderAgentFile(
      ".copilot", "model-agent",
      "---\nname: model-agent\nmodel: claude-sonnet-4.6\n---\nYou are an agent.",
    );
    const lookup = makeLookup([{ name: "model-agent", filePath }]);
    const config = resolveStageAgentModelConfig("model-agent", lookup);
    expect(config).toEqual({ copilot: "claude-sonnet-4.6" });
    rmSync(baseDir, { recursive: true });
  });

  test("returns null when agent has no model in frontmatter", () => {
    const { filePath, baseDir } = createProviderAgentFile(
      ".claude", "no-model",
      "---\nname: no-model\n---\nYou are an agent.",
    );
    const lookup = makeLookup([{ name: "no-model", filePath }]);
    const config = resolveStageAgentModelConfig("no-model", lookup);
    expect(config).toBeNull();
    rmSync(baseDir, { recursive: true });
  });

  test("returns null when no matching agent exists", () => {
    const lookup = makeLookup([]);
    const config = resolveStageAgentModelConfig("nonexistent", lookup);
    expect(config).toBeNull();
  });

  test("returns null when agent path has unrecognized provider directory", () => {
    const filePath = createTempFile(
      "unknown-agent.md",
      "---\nname: unknown-agent\nmodel: opus\n---\nYou are an agent.",
    );
    const lookup = makeLookup([{ name: "unknown-agent", filePath }]);
    const config = resolveStageAgentModelConfig("unknown-agent", lookup);
    expect(config).toBeNull();
    rmSync(filePath);
  });

  test("matches case-insensitively for stage ID lookup", () => {
    const { filePath, baseDir } = createProviderAgentFile(
      ".claude", "case-agent",
      "---\nname: case-agent\nmodel: haiku\n---\nYou are an agent.",
    );
    const lookup = makeLookup([{ name: "case-agent", filePath }]);
    const config = resolveStageAgentModelConfig("CASE-AGENT", lookup);
    expect(config).toEqual({ claude: "haiku" });
    rmSync(baseDir, { recursive: true });
  });
});
