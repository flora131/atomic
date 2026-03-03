import { describe, expect, test } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "fs/promises";
import { prepareClaudeConfigDir } from "./claude-config.ts";

describe("prepareClaudeConfigDir", () => {
  test("returns null when ~/.atomic/.claude is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const mergedDir = join(root, "merged");

    await mkdir(homeDir, { recursive: true });

    try {
      const result = await prepareClaudeConfigDir({
        homeDir,
        mergedDir,
      });
      expect(result).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("loads ~/.atomic/.claude and overlays ~/.claude", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const mergedDir = join(root, "merged");

    const atomicSkill = join(homeDir, ".atomic", ".claude", "skills", "prompt-engineer", "SKILL.md");
    const legacySkill = join(homeDir, ".claude", "skills", "prompt-engineer", "SKILL.md");
    const atomicOnlySkill = join(homeDir, ".atomic", ".claude", "skills", "research-codebase", "SKILL.md");

    await mkdir(join(homeDir, ".atomic", ".claude", "skills", "prompt-engineer"), {
      recursive: true,
    });
    await mkdir(join(homeDir, ".claude", "skills", "prompt-engineer"), {
      recursive: true,
    });
    await mkdir(join(homeDir, ".atomic", ".claude", "skills", "research-codebase"), {
      recursive: true,
    });

    await writeFile(atomicSkill, "atomic", "utf-8");
    await writeFile(legacySkill, "legacy", "utf-8");
    await writeFile(atomicOnlySkill, "atomic-only", "utf-8");

    try {
      const result = await prepareClaudeConfigDir({
        homeDir,
        mergedDir,
      });
      expect(result).toBe(mergedDir);

      const mergedSkill = await readFile(
        join(mergedDir, "skills", "prompt-engineer", "SKILL.md"),
        "utf-8",
      );
      const mergedAtomicOnlySkill = await readFile(
        join(mergedDir, "skills", "research-codebase", "SKILL.md"),
        "utf-8",
      );

      expect(mergedSkill).toBe("legacy");
      expect(mergedAtomicOnlySkill).toBe("atomic-only");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
