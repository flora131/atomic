import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyManagedOnboardingFiles, reconcileScmVariants } from "@/commands/cli/init.ts";

async function makeFile(path: string, content = "test"): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf-8");
}

async function makeSkillDir(baseDir: string, name: string): Promise<void> {
  const dir = join(baseDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `# ${name}\n`, "utf-8");
}

test("reconcileScmVariants preserves managed GitHub and Sapling variants", async () => {
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
    expect(existsSync(join(targetSkillsDir, "gh-commit"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "gh-create-pr"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "custom-command"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "gh-user-custom"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reconcileScmVariants preserves existing directory-based Copilot skills", async () => {
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
    expect(existsSync(join(targetSkillsDir, "sl-commit"))).toBe(true);
    expect(existsSync(join(targetSkillsDir, "sl-submit-diff"))).toBe(true);
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

test("applyManagedOnboardingFiles merges Claude MCP and settings into project targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-init-claude-onboarding-"));

  try {
    const configRoot = join(root, "config");
    const projectRoot = join(root, "project");

    await makeFile(
      join(configRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          deepwiki: { type: "http", url: "https://mcp.deepwiki.com/mcp" },
        },
      }, null, 2) + "\n",
    );
    await makeFile(
      join(configRoot, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2) + "\n",
    );
    await makeFile(
      join(projectRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          existing: { type: "stdio", command: "existing-server" },
        },
      }, null, 2) + "\n",
    );
    await makeFile(
      join(projectRoot, ".claude", "settings.json"),
      JSON.stringify({ hooks: { PostToolUse: ["existing-hook"] } }, null, 2) + "\n",
    );

    await applyManagedOnboardingFiles("claude", projectRoot, configRoot);

    const mergedMcp = JSON.parse(await readFile(join(projectRoot, ".mcp.json"), "utf-8")) as {
      mcpServers: Record<string, unknown>;
    };
    const mergedSettings = JSON.parse(
      await readFile(join(projectRoot, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;

    expect(mergedMcp.mcpServers.existing).toBeDefined();
    expect(mergedMcp.mcpServers.deepwiki).toBeDefined();
    expect(mergedSettings.hooks).toEqual({ PostToolUse: ["existing-hook"] });
    expect(mergedSettings.permissions).toEqual({ allow: ["Read"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applyManagedOnboardingFiles merges OpenCode and Copilot onboarding targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-init-provider-onboarding-"));

  try {
    const configRoot = join(root, "config");
    const projectRoot = join(root, "project");

    await makeFile(
      join(configRoot, ".opencode", "opencode.json"),
      JSON.stringify({ permission: "allow" }, null, 2) + "\n",
    );
    await makeFile(
      join(configRoot, ".vscode", "mcp.json"),
      JSON.stringify({
        servers: {
          deepwiki: { type: "http", url: "https://mcp.deepwiki.com/mcp" },
        },
      }, null, 2) + "\n",
    );
    await makeFile(
      join(projectRoot, ".opencode", "opencode.json"),
      JSON.stringify({ providers: { openai: { model: "gpt-5" } } }, null, 2) + "\n",
    );
    await makeFile(
      join(projectRoot, ".vscode", "mcp.json"),
      JSON.stringify({
        servers: {
          existing: { type: "local", command: "existing-server" },
        },
      }, null, 2) + "\n",
    );

    await applyManagedOnboardingFiles("opencode", projectRoot, configRoot);
    await applyManagedOnboardingFiles("copilot", projectRoot, configRoot);

    const mergedOpencode = JSON.parse(
      await readFile(join(projectRoot, ".opencode", "opencode.json"), "utf-8"),
    ) as Record<string, unknown>;
    const mergedCopilot = JSON.parse(
      await readFile(join(projectRoot, ".vscode", "mcp.json"), "utf-8"),
    ) as {
      servers: Record<string, unknown>;
    };

    expect(mergedOpencode.providers).toEqual({ openai: { model: "gpt-5" } });
    expect(mergedOpencode.permission).toBe("allow");
    expect(mergedCopilot.servers.existing).toBeDefined();
    expect(mergedCopilot.servers.deepwiki).toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
