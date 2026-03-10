import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentsFromDir } from "@/services/config/copilot-config.ts";

describe("loadAgentsFromDir", () => {
  test("loads agent with frontmatter", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "test-agent.md"),
        `---
name: Test Agent
description: A test agent
tools:
  - bash
  - edit
---
You are a test agent.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");
      expect(agents.length).toBe(1);
      expect(agents[0]).toMatchObject({
        name: "Test Agent",
        description: "A test agent",
        tools: ["bash", "edit"],
        systemPrompt: "You are a test agent.",
        source: "local",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("loads agent without frontmatter using filename as name", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "simple-agent.md"),
        "You are a simple agent without frontmatter.",
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "global");
      expect(agents.length).toBe(1);
      expect(agents[0]).toMatchObject({
        name: "simple-agent",
        description: "Agent: simple-agent",
        systemPrompt: "You are a simple agent without frontmatter.",
        source: "global",
      });
      expect(agents[0]?.tools).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses filename as fallback when frontmatter lacks name", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "fallback-name.md"),
        `---
description: Agent with no name field
---
Agent content here.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");
      expect(agents.length).toBe(1);
      expect(agents[0]?.name).toBe("fallback-name");
      expect(agents[0]?.description).toBe("Agent with no name field");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("generates default description when frontmatter lacks description", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "no-desc.md"),
        `---
name: NoDesc Agent
---
Agent without description.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");
      expect(agents.length).toBe(1);
      expect(agents[0]?.description).toBe("Agent: NoDesc Agent");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("filters out non-string tools from frontmatter tools array", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "mixed-tools.md"),
        `---
name: Mixed Tools
description: Agent with mixed tool types
tools:
  - bash
  - edit
---
Agent with tools.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");
      expect(agents.length).toBe(1);
      expect(agents[0]?.tools).toEqual(["bash", "edit"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses flow-sequence tool arrays without retaining quote characters", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "flow-tools.md"),
        `---
name: Flow Tools
description: Agent with flow-sequence tools
tools: ["execute", "agent", "edit", "search", "read"]
---
Agent with flow tools.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");
      expect(agents.length).toBe(1);
      expect(agents[0]?.tools).toEqual(["execute", "agent", "edit", "search", "read"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("preserves optional Copilot agent metadata from frontmatter", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "metadata-agent.md"),
        `---
name: metadata-agent
displayName: Metadata Agent
description: Agent with provider-specific metadata
tools: ["execute", "read"]
infer: false
mcp-servers:
  deepwiki:
    type: http
    url: https://mcp.deepwiki.com/mcp
    tools: ["ask_question"]
---
Agent with extra metadata.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        name: "metadata-agent",
        displayName: "Metadata Agent",
        description: "Agent with provider-specific metadata",
        tools: ["execute", "read"],
        infer: false,
        systemPrompt: "Agent with extra metadata.",
        source: "local",
      });
      expect(agents[0]?.mcpServers).toEqual([
        {
          name: "deepwiki",
          type: "http",
          url: "https://mcp.deepwiki.com/mcp",
          tools: ["ask_question"],
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ignores non-markdown files", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(join(root, "agents", "agent.md"), "---\nname: Valid\n---\nContent", "utf-8");
      await writeFile(join(root, "agents", "readme.txt"), "Not a markdown file", "utf-8");
      await writeFile(join(root, "agents", "config.json"), "{}", "utf-8");

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");
      expect(agents.length).toBe(1);
      expect(agents[0]?.name).toBe("Valid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns empty array when directory does not exist", async () => {
    const agents = await loadAgentsFromDir("/non/existent/directory", "local");
    expect(agents).toEqual([]);
  });

  test("skips unreadable or invalid files without failing", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(join(root, "agents", "valid.md"), "---\nname: Valid\n---\nContent", "utf-8");
      await writeFile(join(root, "agents", "invalid.md"), "\x00\x01\x02", "utf-8");

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");
      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.some((agent) => agent.name === "Valid")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
