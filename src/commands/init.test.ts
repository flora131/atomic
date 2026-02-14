import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { reconcileScmVariants } from "./init";

async function makeFile(path: string, content = "test"): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf-8");
}

async function makeSkillDir(baseDir: string, name: string): Promise<void> {
  const dir = join(baseDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `# ${name}\n`, "utf-8");
}

test("reconcileScmVariants keeps Sapling variants and removes managed GitHub variants", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-init-scm-files-"));

  try {
    const configRoot = join(root, "config");
    const targetDir = join(root, "target");
    const sourceDir = join(configRoot, ".claude", "commands");
    const targetCommandsDir = join(targetDir, ".claude", "commands");

    for (const file of ["gh-commit.md", "gh-create-pr.md", "sl-commit.md", "sl-submit-diff.md"]) {
      await makeFile(join(sourceDir, file));
      await makeFile(join(targetCommandsDir, file));
    }

    await makeFile(join(targetCommandsDir, "custom-command.md"));
    await makeFile(join(targetCommandsDir, "gh-user-custom.md"));

    await reconcileScmVariants({
      scmType: "sapling-phabricator",
      agentFolder: ".claude",
      commandsSubfolder: "commands",
      targetDir,
      configRoot,
    });

    expect(existsSync(join(targetCommandsDir, "sl-commit.md"))).toBe(true);
    expect(existsSync(join(targetCommandsDir, "sl-submit-diff.md"))).toBe(true);
    expect(existsSync(join(targetCommandsDir, "gh-commit.md"))).toBe(false);
    expect(existsSync(join(targetCommandsDir, "gh-create-pr.md"))).toBe(false);
    expect(existsSync(join(targetCommandsDir, "custom-command.md"))).toBe(true);
    expect(existsSync(join(targetCommandsDir, "gh-user-custom.md"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reconcileScmVariants handles directory-based Copilot skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-init-scm-dirs-"));

  try {
    const configRoot = join(root, "config");
    const targetDir = join(root, "target");
    const sourceDir = join(configRoot, ".github", "skills");
    const targetSkillsDir = join(targetDir, ".github", "skills");

    for (const skill of ["gh-commit", "gh-create-pr", "sl-commit", "sl-submit-diff"]) {
      await makeSkillDir(sourceDir, skill);
      await makeSkillDir(targetSkillsDir, skill);
    }

    await makeSkillDir(targetSkillsDir, "sl-user-custom");
    await makeSkillDir(targetSkillsDir, "my-team-skill");

    await reconcileScmVariants({
      scmType: "github",
      agentFolder: ".github",
      commandsSubfolder: "skills",
      targetDir,
      configRoot,
    });

    expect(existsSync(join(targetSkillsDir, "gh-commit"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "gh-create-pr"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "sl-commit"))).toBe(false);
    expect(existsSync(join(targetSkillsDir, "sl-submit-diff"))).toBe(false);
    expect(existsSync(join(targetSkillsDir, "sl-user-custom"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "my-team-skill"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reconcileScmVariants is a no-op when source or target directory is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-init-scm-missing-"));

  try {
    const configRoot = join(root, "config");
    const targetDir = join(root, "target");

    await expect(
      reconcileScmVariants({
        scmType: "github",
        agentFolder: ".opencode",
        commandsSubfolder: "command",
        targetDir,
        configRoot,
      })
    ).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
