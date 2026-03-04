import { describe, expect, test } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "fs/promises";
import { prepareClaudeConfigDir } from "./claude-config.ts";
import { pathExists } from "./copy.ts";

describe("prepareClaudeConfigDir", () => {
  test("returns null when ~/.atomic/.claude is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const mergedDir = join(root, "merged");

    await mkdir(homeDir, { recursive: true });

    try {
      const result = await prepareClaudeConfigDir({ homeDir, mergedDir });
      expect(result).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("overlays only agents/skills/commands from ~/.claude", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const mergedDir = join(root, "merged");

    await mkdir(join(homeDir, ".atomic", ".claude", "skills", "prompt-engineer"), {
      recursive: true,
    });
    await mkdir(join(homeDir, ".claude", "skills", "prompt-engineer"), {
      recursive: true,
    });
    await mkdir(join(homeDir, ".atomic", ".claude", "commands"), {
      recursive: true,
    });
    await mkdir(join(homeDir, ".claude", "commands"), {
      recursive: true,
    });

    await writeFile(
      join(homeDir, ".atomic", ".claude", "skills", "prompt-engineer", "SKILL.md"),
      "atomic-skill",
      "utf-8",
    );
    await writeFile(
      join(homeDir, ".claude", "skills", "prompt-engineer", "SKILL.md"),
      "legacy-skill",
      "utf-8",
    );
    await writeFile(join(homeDir, ".atomic", ".claude", "settings.json"), "atomic-settings", "utf-8");
    await writeFile(join(homeDir, ".claude", "settings.json"), "legacy-settings", "utf-8");
    await writeFile(join(homeDir, ".claude", "commands", "my-command.md"), "legacy-command", "utf-8");

    try {
      const result = await prepareClaudeConfigDir({ homeDir, mergedDir });
      expect(result).toBe(mergedDir);

      const mergedSkill = await readFile(
        join(mergedDir, "skills", "prompt-engineer", "SKILL.md"),
        "utf-8",
      );
      const mergedSettings = await readFile(join(mergedDir, "settings.json"), "utf-8");
      const mergedCommand = await readFile(join(mergedDir, "commands", "my-command.md"), "utf-8");

      expect(mergedSkill).toBe("legacy-skill");
      expect(mergedSettings).toBe("atomic-settings");
      expect(mergedCommand).toBe("legacy-command");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("defaults merged output to ~/.atomic/.claude", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");

    await mkdir(join(homeDir, ".atomic", ".claude", "agents"), { recursive: true });
    await mkdir(join(homeDir, ".claude", "agents"), { recursive: true });
    await writeFile(join(homeDir, ".claude", "agents", "example.md"), "legacy-agent", "utf-8");

    try {
      const result = await prepareClaudeConfigDir({ homeDir });
      const expectedMergedPath = join(homeDir, ".atomic", ".claude");
      expect(result).toBe(expectedMergedPath);
      expect(await readFile(join(expectedMergedPath, "agents", "example.md"), "utf-8")).toBe("legacy-agent");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not copy root ~/.claude.json into merged output", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const mergedDir = join(root, "merged");

    await mkdir(join(homeDir, ".atomic", ".claude"), { recursive: true });
    await writeFile(join(homeDir, ".claude.json"), JSON.stringify({ key: "value" }), "utf-8");

    try {
      const result = await prepareClaudeConfigDir({ homeDir, mergedDir });
      expect(result).toBe(mergedDir);
      expect(await pathExists(join(mergedDir, ".claude.json"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("excludes nested .git directories from selected sync paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const mergedDir = join(root, "merged");

    await mkdir(join(homeDir, ".atomic", ".claude"), { recursive: true });
    await mkdir(join(homeDir, ".claude", "skills", "my-skill", ".git", "objects"), {
      recursive: true,
    });
    await writeFile(
      join(homeDir, ".claude", "skills", "my-skill", ".git", "objects", "packfile"),
      "git-pack",
      "utf-8",
    );
    await writeFile(join(homeDir, ".claude", "skills", "my-skill", "SKILL.md"), "skill", "utf-8");

    try {
      const result = await prepareClaudeConfigDir({ homeDir, mergedDir });
      expect(result).toBe(mergedDir);
      expect(await pathExists(join(mergedDir, "skills", "my-skill", "SKILL.md"))).toBe(true);
      expect(
        await pathExists(
          join(mergedDir, "skills", "my-skill", ".git", "objects", "packfile"),
        ),
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
