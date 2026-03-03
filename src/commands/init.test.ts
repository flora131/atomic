import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { reconcileScmVariants, syncProjectScmSkills, initCommand } from "./init";

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
    const sourceDir = join(configRoot, ".claude", "skills");
    const targetSkillsDir = join(targetDir, ".claude", "skills");

    for (const skill of ["gh-commit", "gh-create-pr", "sl-commit", "sl-submit-diff"]) {
      await makeSkillDir(sourceDir, skill);
      await makeSkillDir(targetSkillsDir, skill);
    }

    await makeSkillDir(targetSkillsDir, "custom-command");
    await makeSkillDir(targetSkillsDir, "gh-user-custom");

    await reconcileScmVariants({
      scmType: "sapling",
      agentFolder: ".claude",
      skillsSubfolder: "skills",
      targetDir,
      configRoot,
    });

    expect(existsSync(join(targetSkillsDir, "sl-commit"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "sl-submit-diff"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "gh-commit"))).toBe(false);
    expect(existsSync(join(targetSkillsDir, "gh-create-pr"))).toBe(false);
    expect(existsSync(join(targetSkillsDir, "custom-command"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "gh-user-custom"))).toBe(true);
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
      skillsSubfolder: "skills",
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
        skillsSubfolder: "skills",
        targetDir,
        configRoot,
      })
    ).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("isManagedScmEntry recognizes az- prefixed skills", async () => {
  // Test via reconcileScmVariants: az-* dirs survive when scmType is azure-devops
  const root = await mkdtemp(join(tmpdir(), "atomic-init-az-entry-"));

  try {
    const configRoot = join(root, "config");
    const targetDir = join(root, "target");
    const sourceDir = join(configRoot, ".claude", "skills");
    const targetSkillsDir = join(targetDir, ".claude", "skills");

    for (const skill of ["gh-commit", "gh-create-pr", "az-commit", "az-create-pr"]) {
      await makeSkillDir(sourceDir, skill);
      await makeSkillDir(targetSkillsDir, skill);
    }

    await reconcileScmVariants({
      scmType: "azure-devops",
      agentFolder: ".claude",
      skillsSubfolder: "skills",
      targetDir,
      configRoot,
    });

    expect(existsSync(join(targetSkillsDir, "az-commit"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "az-create-pr"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "gh-commit"))).toBe(false);
    expect(existsSync(join(targetSkillsDir, "gh-create-pr"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("syncProjectScmSkills copies az-* skill dirs for azure-devops", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-init-sync-az-"));

  try {
    const sourceSkillsDir = join(root, "source", "skills");
    const targetSkillsDir = join(root, "target", "skills");

    for (const skill of ["az-commit", "az-create-pr", "gh-commit", "gh-create-pr"]) {
      await makeSkillDir(sourceSkillsDir, skill);
    }

    const count = await syncProjectScmSkills({
      scmType: "azure-devops",
      sourceSkillsDir,
      targetSkillsDir,
    });

    expect(count).toBe(2);
    expect(existsSync(join(targetSkillsDir, "az-commit"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "az-create-pr"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "gh-commit"))).toBe(false);
    expect(existsSync(join(targetSkillsDir, "gh-create-pr"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reconcileScmVariants removes gh-*/sl-* dirs and preserves user-custom dirs when scm is azure-devops", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-init-az-reconcile-"));

  try {
    const configRoot = join(root, "config");
    const targetDir = join(root, "target");
    const sourceDir = join(configRoot, ".claude", "skills");
    const targetSkillsDir = join(targetDir, ".claude", "skills");

    for (const skill of ["gh-commit", "gh-create-pr", "sl-commit", "sl-submit-diff", "az-commit", "az-create-pr"]) {
      await makeSkillDir(sourceDir, skill);
      await makeSkillDir(targetSkillsDir, skill);
    }
    await makeSkillDir(targetSkillsDir, "custom-tool");
    await makeSkillDir(targetSkillsDir, "my-team-script");

    await reconcileScmVariants({
      scmType: "azure-devops",
      agentFolder: ".claude",
      skillsSubfolder: "skills",
      targetDir,
      configRoot,
    });

    expect(existsSync(join(targetSkillsDir, "az-commit"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "az-create-pr"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "gh-commit"))).toBe(false);
    expect(existsSync(join(targetSkillsDir, "gh-create-pr"))).toBe(false);
    expect(existsSync(join(targetSkillsDir, "sl-commit"))).toBe(false);
    expect(existsSync(join(targetSkillsDir, "sl-submit-diff"))).toBe(false);
    expect(existsSync(join(targetSkillsDir, "custom-tool"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "my-team-script"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initCommand with --scm azure-devops completes without error", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-init-ado-e2e-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(root);

    await initCommand({
      showBanner: false,
      preSelectedAgent: "claude",
      preSelectedScm: "azure-devops",
      yes: true,
    });

    // Verify az-* skills were installed to the target directory
    expect(existsSync(join(root, ".claude", "skills", "az-commit"))).toBe(true);
    expect(existsSync(join(root, ".claude", "skills", "az-create-pr"))).toBe(true);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});
