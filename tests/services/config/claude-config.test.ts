import { describe, expect, test } from "bun:test";
import { join } from "path";
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
      join(projectRoot, ".claude", "agents"),
      join(homeDir, ".claude", "agents"),
    ]);

    expect(
      resolveClaudeSkillDirectories({ homeDir, projectRoot }),
    ).toEqual([
      join(projectRoot, ".claude", "skills"),
      join(homeDir, ".claude", "skills"),
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
        systemPrompt: "Project reviewer prompt",
        source: "local",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
