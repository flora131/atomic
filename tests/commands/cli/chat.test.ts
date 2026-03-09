import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  buildProviderDiscoveryPlanDebugOutput,
  buildChatStartupDiscoveryPlan,
  hasProjectScmSkills,
  hasProjectScmSkillsInSync,
  logActiveProviderDiscoveryPlan,
  resolveChatAdditionalInstructions,
  shouldAutoInitChat,
} from "@/commands/cli/chat.ts";
import { ENHANCED_SYSTEM_PROMPT } from "@/services/agents/enhanced-system-prompt.ts";
import { upsertTrustedWorkspacePath } from "@/services/config/settings.ts";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "atomic-chat-test-"));
  const previousSettingsHome = process.env.ATOMIC_SETTINGS_HOME;
  try {
    process.env.ATOMIC_SETTINGS_HOME = join(dir, "home");
    await run(dir);
  } finally {
    if (previousSettingsHome === undefined) {
      delete process.env.ATOMIC_SETTINGS_HOME;
    } else {
      process.env.ATOMIC_SETTINGS_HOME = previousSettingsHome;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

async function makeSkillDir(baseDir: string, skillName: string): Promise<void> {
  const skillPath = join(baseDir, skillName, "SKILL.md");
  await mkdir(join(skillPath, ".."), { recursive: true });
  await writeFile(skillPath, `${skillName}\n`, "utf-8");
}

async function createTemplateScmSkills(configRoot: string, agentFolder: string): Promise<void> {
  const skillsDir = join(configRoot, agentFolder, "skills");
  for (const skill of ["gh-commit", "gh-create-pr", "sl-commit", "sl-submit-diff"]) {
    await makeSkillDir(skillsDir, skill);
  }
}

async function writeProjectScmSetting(projectRoot: string, scm: "github" | "sapling"): Promise<void> {
  const settingsPath = join(projectRoot, ".atomic", "settings.json");
  await mkdir(join(settingsPath, ".."), { recursive: true });
  await writeFile(
    settingsPath,
    JSON.stringify({ version: 1, scm }, null, 2) + "\n",
    "utf-8"
  );
}

async function writeClaudeOnboardingFiles(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, ".claude"), { recursive: true });
  await writeFile(
    join(projectRoot, ".claude", "settings.json"),
    JSON.stringify({ permissions: { allow: ["Bash"] } }, null, 2) + "\n",
    "utf-8",
  );
  await writeFile(
    join(projectRoot, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        deepwiki: { type: "http", url: "https://mcp.deepwiki.com/mcp" },
      },
    }, null, 2) + "\n",
    "utf-8",
  );
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

test("hasProjectScmSkillsInSync returns false when selected SCM skills are incomplete", async () => {
  await withTempDir(async (dir) => {
    const configRoot = join(dir, "config");
    const projectRoot = join(dir, "project");

    await createTemplateScmSkills(configRoot, ".claude");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-commit");

    await expect(
      hasProjectScmSkillsInSync("claude", "github", projectRoot, configRoot)
    ).resolves.toBe(false);
  });
});

test("hasProjectScmSkillsInSync preserves opposite managed variants when selected skills exist", async () => {
  await withTempDir(async (dir) => {
    const configRoot = join(dir, "config");
    const projectRoot = join(dir, "project");

    await createTemplateScmSkills(configRoot, ".claude");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-commit");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-create-pr");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "sl-commit");

    await expect(
      hasProjectScmSkillsInSync("claude", "github", projectRoot, configRoot)
    ).resolves.toBe(true);
  });
});

test("hasProjectScmSkillsInSync ignores user custom scm-prefixed skills", async () => {
  await withTempDir(async (dir) => {
    const configRoot = join(dir, "config");
    const projectRoot = join(dir, "project");

    await createTemplateScmSkills(configRoot, ".claude");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-commit");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-create-pr");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "sl-user-custom");

    await expect(
      hasProjectScmSkillsInSync("claude", "github", projectRoot, configRoot)
    ).resolves.toBe(true);
  });
});

test("shouldAutoInitChat returns true when no managed SCM skills are configured", async () => {
  await withTempDir(async (dir) => {
    await writeClaudeOnboardingFiles(dir);
    upsertTrustedWorkspacePath(dir, "claude");
    await expect(shouldAutoInitChat("claude", dir)).resolves.toBe(true);
  });
});

test("shouldAutoInitChat returns true when workspace is not trusted", async () => {
  await withTempDir(async (dir) => {
    await writeClaudeOnboardingFiles(dir);
    const commitSkillPath = join(dir, ".claude", "skills", "sl-commit", "SKILL.md");
    await mkdir(join(commitSkillPath, ".."), { recursive: true });
    await writeFile(commitSkillPath, "sapling commit", "utf-8");

    await expect(shouldAutoInitChat("claude", dir)).resolves.toBe(true);
  });
});

test("shouldAutoInitChat returns true when onboarding files are missing", async () => {
  await withTempDir(async (dir) => {
    upsertTrustedWorkspacePath(dir, "claude");
    const commitSkillPath = join(dir, ".claude", "skills", "sl-commit", "SKILL.md");
    await mkdir(join(commitSkillPath, ".."), { recursive: true });
    await writeFile(commitSkillPath, "sapling commit", "utf-8");

    await expect(shouldAutoInitChat("claude", dir)).resolves.toBe(true);
  });
});

test("shouldAutoInitChat returns false when workspace is trusted, onboarded, and SCM skills are configured", async () => {
  await withTempDir(async (dir) => {
    await writeClaudeOnboardingFiles(dir);
    upsertTrustedWorkspacePath(dir, "claude");
    const commitSkillPath = join(dir, ".claude", "skills", "sl-commit", "SKILL.md");
    await mkdir(join(commitSkillPath, ".."), { recursive: true });
    await writeFile(commitSkillPath, "sapling commit", "utf-8");

    await expect(shouldAutoInitChat("claude", dir)).resolves.toBe(false);
  });
});

test("shouldAutoInitChat returns true when configured SCM skills are out of sync", async () => {
  await withTempDir(async (dir) => {
    const configRoot = join(dir, "config");
    const projectRoot = join(dir, "project");

    await createTemplateScmSkills(configRoot, ".claude");
    await writeClaudeOnboardingFiles(projectRoot);
    upsertTrustedWorkspacePath(projectRoot, "claude");
    await writeProjectScmSetting(projectRoot, "github");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-commit");

    await expect(shouldAutoInitChat("claude", projectRoot, { configRoot })).resolves.toBe(true);
  });
});

test("shouldAutoInitChat returns false when configured SCM skills are in sync", async () => {
  await withTempDir(async (dir) => {
    const configRoot = join(dir, "config");
    const projectRoot = join(dir, "project");

    await createTemplateScmSkills(configRoot, ".claude");
    await writeClaudeOnboardingFiles(projectRoot);
    upsertTrustedWorkspacePath(projectRoot, "claude");
    await writeProjectScmSetting(projectRoot, "github");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-commit");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-create-pr");

    await expect(shouldAutoInitChat("claude", projectRoot, { configRoot })).resolves.toBe(false);
  });
});

test("buildChatStartupDiscoveryPlan keeps Copilot AGENTS.md precedence with XDG global root", () => {
  const projectRoot = "/tmp/atomic-chat-startup-project";
  const homeDir = "/tmp/atomic-chat-startup-home";
  const xdgConfigHome = "/tmp/atomic-chat-startup-xdg";

  const plan = buildChatStartupDiscoveryPlan("copilot", {
    projectRoot,
    homeDir,
    xdgConfigHome,
    pathExists: () => false,
    platform: "linux",
  });

  expect(plan.provider).toBe("copilot");
  expect(plan.rootsInPrecedenceOrder[0]?.id).toBe("copilot_user_home");
  expect(plan.rootsInPrecedenceOrder[plan.rootsInPrecedenceOrder.length - 1]?.id).toBe(
    "copilot_project"
  );
  expect(plan.paths.userGlobal).toEqual([
    resolve(homeDir, ".copilot"),
    resolve(xdgConfigHome, ".copilot"),
  ]);
  expect(plan.compatibilitySets.nativeRootIds.has("copilot_user_home")).toBe(true);
  expect(plan.compatibilitySets.nativeRootIds.has("copilot_user_xdg")).toBe(true);
});

test("buildProviderDiscoveryPlanDebugOutput redacts absolute discovery paths", () => {
  const projectRoot = "/tmp/atomic-chat-debug-project";
  const homeDir = "/tmp/atomic-chat-debug-home";
  const externalXdgConfigHome = "/tmp/atomic-chat-external-xdg";

  const plan = buildChatStartupDiscoveryPlan("copilot", {
    projectRoot,
    homeDir,
    xdgConfigHome: externalXdgConfigHome,
    pathExists: () => false,
    platform: "linux",
  });

  const debugOutput = buildProviderDiscoveryPlanDebugOutput(plan, {
    projectRoot,
    homeDir,
  });

  const serialized = JSON.stringify(debugOutput);
  expect(serialized.includes(projectRoot)).toBe(false);
  expect(serialized.includes(homeDir)).toBe(false);
  expect(serialized.includes(externalXdgConfigHome)).toBe(false);

  const projectRootEntry = debugOutput.rootsInPrecedenceOrder.find(
    (root) => root.id === "copilot_project"
  );
  expect(projectRootEntry?.resolvedPath).toBe("<project>/.github");

  const externalRootEntry = debugOutput.rootsInPrecedenceOrder.find(
    (root) => root.id === "copilot_user_xdg"
  );
  expect(externalRootEntry?.resolvedPath).toBe("<external-path>");
});

test("logActiveProviderDiscoveryPlan only emits when DEBUG=1", () => {
  const originalDebug = process.env.DEBUG;
  const projectRoot = "/tmp/atomic-chat-log-project";
  const homeDir = "/tmp/atomic-chat-log-home";

  const plan = buildChatStartupDiscoveryPlan("claude", {
    projectRoot,
    homeDir,
    pathExists: () => false,
  });

  const messages: string[] = [];

  try {
    delete process.env.DEBUG;

    logActiveProviderDiscoveryPlan(plan, {
      projectRoot,
      homeDir,
      logFn: (message) => messages.push(message),
    });

    expect(messages).toHaveLength(0);

    process.env.DEBUG = "1";

    logActiveProviderDiscoveryPlan(plan, {
      projectRoot,
      homeDir,
      logFn: (message) => messages.push(message),
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.startsWith("[chat.discovery.plan]")).toBe(true);
    expect(messages[0]?.includes('"provider": "claude"')).toBe(true);
  } finally {
    if (originalDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebug;
    }
  }
});

test("resolveChatAdditionalInstructions defaults to the enhanced system prompt", () => {
  expect(resolveChatAdditionalInstructions({})).toBe(ENHANCED_SYSTEM_PROMPT);
});

test("resolveChatAdditionalInstructions appends explicit text to the enhanced system prompt", () => {
  expect(
    resolveChatAdditionalInstructions({
      additionalInstructions: "Use short answers.",
    })
  ).toBe(`${ENHANCED_SYSTEM_PROMPT}\n\nUse short answers.`);
});

test("resolveChatAdditionalInstructions ignores blank appended instructions", () => {
  expect(
    resolveChatAdditionalInstructions({
      additionalInstructions: "   ",
    })
  ).toBe(ENHANCED_SYSTEM_PROMPT);
});
