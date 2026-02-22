import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { hasProjectScmSkills, shouldAutoInitChat } from "./chat.ts";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "atomic-chat-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("hasProjectScmSkills returns false when skills directory has no managed SCM skills", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".github", "skills", "init"), { recursive: true });
    await writeFile(join(dir, ".github", "skills", "init", "SKILL.md"), "init", "utf-8");

    await expect(hasProjectScmSkills("copilot", dir)).resolves.toBe(false);
  });
});

test("hasProjectScmSkills returns true when managed SCM skill exists", async () => {
  await withTempDir(async (dir) => {
    const commitSkillPath = join(dir, ".github", "skills", "gh-commit", "SKILL.md");
    await mkdir(join(commitSkillPath, ".."), { recursive: true });
    await writeFile(commitSkillPath, "commit skill", "utf-8");

    await expect(hasProjectScmSkills("copilot", dir)).resolves.toBe(true);
  });
});

test("shouldAutoInitChat returns true when no managed SCM skills are configured", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await expect(shouldAutoInitChat("claude", dir)).resolves.toBe(true);
  });
});

test("shouldAutoInitChat returns false when managed SCM skills are configured", async () => {
  await withTempDir(async (dir) => {
    const commitSkillPath = join(dir, ".claude", "skills", "sl-commit", "SKILL.md");
    await mkdir(join(commitSkillPath, ".."), { recursive: true });
    await writeFile(commitSkillPath, "sapling commit", "utf-8");

    await expect(shouldAutoInitChat("claude", dir)).resolves.toBe(false);
  });
});
