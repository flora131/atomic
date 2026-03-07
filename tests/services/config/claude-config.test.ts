import { describe, expect, test } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from "fs/promises";
import { prepareClaudeConfigDir } from "@/services/config/claude-config.ts";
import { pathExists } from "@/services/system/copy.ts";

describe("prepareClaudeConfigDir", () => {
  test("returns null when ~/.atomic/.claude is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const mergedDir = join(homeDir, ".atomic", ".tmp", "merged");

    await mkdir(homeDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    try {
      const result = await prepareClaudeConfigDir({ homeDir, projectRoot, mergedDir });
      expect(result).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("merges Claude roots in deterministic precedence order", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const mergedDir = join(homeDir, ".atomic", ".tmp", "merged");

    await mkdir(join(homeDir, ".atomic", ".claude", "agents"), {
      recursive: true,
    });
    await mkdir(join(homeDir, ".claude", "agents"), {
      recursive: true,
    });
    await mkdir(join(projectRoot, ".claude", "agents"), {
      recursive: true,
    });
    await mkdir(join(homeDir, ".atomic", ".claude", "skills"), {
      recursive: true,
    });
    await mkdir(join(homeDir, ".claude", "skills"), {
      recursive: true,
    });
    await mkdir(join(projectRoot, ".claude"), { recursive: true });

    await writeFile(
      join(homeDir, ".atomic", ".claude", "agents", "example.md"),
      "atomic",
      "utf-8",
    );
    await writeFile(
      join(homeDir, ".claude", "agents", "example.md"),
      "user",
      "utf-8",
    );
    await writeFile(
      join(projectRoot, ".claude", "agents", "example.md"),
      "project",
      "utf-8",
    );
    await writeFile(
      join(homeDir, ".atomic", ".claude", "agents", "atomic-only.md"),
      "atomic-only",
      "utf-8",
    );
    await writeFile(join(homeDir, ".claude", "skills", "user-only.md"), "user-only", "utf-8");
    await writeFile(join(homeDir, ".atomic", ".claude", "settings.json"), "atomic-settings", "utf-8");
    await writeFile(join(homeDir, ".claude", "settings.json"), "user-settings", "utf-8");
    await writeFile(join(projectRoot, ".claude", "settings.json"), "project-settings", "utf-8");

    try {
      const result = await prepareClaudeConfigDir({ homeDir, projectRoot, mergedDir });
      expect(result).toBe(mergedDir);

      const mergedAgent = await readFile(join(mergedDir, "agents", "example.md"), "utf-8");
      const mergedAtomicOnly = await readFile(join(mergedDir, "agents", "atomic-only.md"), "utf-8");
      const mergedUserOnly = await readFile(join(mergedDir, "skills", "user-only.md"), "utf-8");
      const mergedSettings = await readFile(join(mergedDir, "settings.json"), "utf-8");

      expect(mergedAgent).toBe("project");
      expect(mergedAtomicOnly).toBe("atomic-only");
      expect(mergedUserOnly).toBe("user-only");
      expect(mergedSettings).toBe("project-settings");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("defaults merged output to ~/.atomic/.tmp/claude-config-merged", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");

    await mkdir(join(homeDir, ".atomic", ".claude", "agents"), { recursive: true });
    await mkdir(join(homeDir, ".claude", "agents"), { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(homeDir, ".claude", "agents", "example.md"), "legacy-agent", "utf-8");

    try {
      const result = await prepareClaudeConfigDir({ homeDir, projectRoot });
      const expectedMergedPath = join(homeDir, ".atomic", ".tmp", "claude-config-merged");
      expect(result).toBe(expectedMergedPath);
      expect(await readFile(join(expectedMergedPath, "agents", "example.md"), "utf-8")).toBe("legacy-agent");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not copy root ~/.claude.json into merged output", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const mergedDir = join(homeDir, ".atomic", ".tmp", "merged");

    await mkdir(join(homeDir, ".atomic", ".claude"), { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(homeDir, ".claude.json"), JSON.stringify({ key: "value" }), "utf-8");

    try {
      const result = await prepareClaudeConfigDir({ homeDir, projectRoot, mergedDir });
      expect(result).toBe(mergedDir);
      expect(await pathExists(join(mergedDir, ".claude.json"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("excludes nested .git directories from merged roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const mergedDir = join(homeDir, ".atomic", ".tmp", "merged");

    await mkdir(join(homeDir, ".atomic", ".claude"), { recursive: true });
    await mkdir(projectRoot, { recursive: true });
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
      const result = await prepareClaudeConfigDir({ homeDir, projectRoot, mergedDir });
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

  test("rejects merged output paths that traverse outside ~/.atomic", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const escapedMergedDir = join(homeDir, ".atomic", "..", "escaped-merged");

    await mkdir(join(homeDir, ".atomic", ".claude"), { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    try {
      await expect(
        prepareClaudeConfigDir({ homeDir, projectRoot, mergedDir: escapedMergedDir }),
      ).rejects.toThrow("Claude merged config directory escapes allowed root");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects project config symlinks that resolve outside the project root", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-claude-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const outsideDir = join(root, "outside");
    const mergedDir = join(homeDir, ".atomic", ".tmp", "merged");

    await mkdir(join(homeDir, ".atomic", ".claude"), { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await mkdir(join(outsideDir, "agents"), { recursive: true });
    await writeFile(join(outsideDir, "agents", "escape.md"), "outside", "utf-8");
    await symlink(outsideDir, join(projectRoot, ".claude"));

    try {
      await expect(
        prepareClaudeConfigDir({ homeDir, projectRoot, mergedDir }),
      ).rejects.toThrow("Project Claude config root resolves outside allowed root");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
