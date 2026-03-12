import { describe, expect, test } from "bun:test";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import {
  loadClaudeAgents,
  resolveClaudeAgentDirectories,
  resolveClaudeSkillDirectories,
} from "@/services/config/claude-config.ts";

describe("claude-config", () => {
  test("resolves Claude agent and skill directories in AGENTS.md precedence order", () => {
    const homeDir = "/tmp/claude-home";
    const projectRoot = "/tmp/claude-project";

    expect(
      resolveClaudeAgentDirectories({ homeDir, projectRoot }),
    ).toEqual([
      resolve(projectRoot, ".claude", "agents"),
      resolve(homeDir, ".claude", "agents"),
    ]);

    expect(
      resolveClaudeSkillDirectories({ homeDir, projectRoot }),
    ).toEqual([
      resolve(projectRoot, ".claude", "skills"),
      resolve(homeDir, ".claude", "skills"),
    ]);
  });

  test("loads Claude agents only from ~/.claude and <project>/.claude with project override", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");

    await mkdir(join(homeDir, ".claude", "agents"), { recursive: true });
    await mkdir(join(projectRoot, ".claude", "agents"), { recursive: true });
    await mkdir(join(projectRoot, ".github", "agents"), { recursive: true });

    await writeFile(
      join(homeDir, ".claude", "agents", "reviewer.md"),
      "---\nname: reviewer\ndescription: Global reviewer\n---\nGlobal reviewer prompt",
      "utf-8",
    );
    await writeFile(
      join(projectRoot, ".claude", "agents", "reviewer.md"),
      "---\nname: reviewer\ndescription: Project reviewer\n---\nProject reviewer prompt",
      "utf-8",
    );
    await writeFile(
      join(projectRoot, ".github", "agents", "copilot-only.md"),
      "Copilot-only prompt",
      "utf-8",
    );

    try {
      const agents = await loadClaudeAgents({ homeDir, projectRoot });
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        name: "reviewer",
        description: "Project reviewer",
        prompt: "Project reviewer prompt",
        source: "local",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses Claude agent schema fields from markdown agent files", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const projectRoot = join(root, "project");

    await mkdir(join(projectRoot, ".claude", "agents"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "agents", "debugger.md"),
      `---
name: debugger
description: Debug repository issues
tools: Bash, Read, Grep
disallowed-tools: Task, Edit
model: opus
skills: research, testing
max-turns: 7
critical-system-reminder: Never skip repro steps
mcp-servers:
  deepwiki:
    type: http
    url: https://mcp.deepwiki.com/mcp
---
Debug the repository.`,
      "utf-8",
    );

    try {
      const agents = await loadClaudeAgents({ projectRoot, homeDir: join(root, "home") });
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        name: "debugger",
        description: "Debug repository issues",
        prompt: "Debug the repository.",
        tools: ["Bash", "Read", "Grep"],
        disallowedTools: ["Task", "Edit"],
        model: "opus",
        skills: ["research", "testing"],
        maxTurns: 7,
        criticalSystemReminder_EXPERIMENTAL: "Never skip repro steps",
        source: "local",
      });
      expect(agents[0]?.mcpServers).toEqual([
        {
          deepwiki: {
            type: "http",
            url: "https://mcp.deepwiki.com/mcp",
            headers: undefined,
          },
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
