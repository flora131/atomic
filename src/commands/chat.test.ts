import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildProviderDiscoveryPlanDebugOutput,
  buildChatStartupDiscoveryPlan,
  hasProjectScmSkills,
  hasProjectScmSkillsInSync,
  logActiveProviderDiscoveryPlan,
  prepareClaudeRuntimeForChat,
  prepareOpenCodeRuntimeConfigForChat,
  shouldAutoInitChat,
} from "./chat.ts";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "atomic-chat-test-"));
  try {
    await run(dir);
  } finally {
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
    JSON.stringify({ version: 1, agent: "claude", scm }, null, 2) + "\n",
    "utf-8"
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

test("hasProjectScmSkillsInSync returns false when opposite managed variant is present", async () => {
  await withTempDir(async (dir) => {
    const configRoot = join(dir, "config");
    const projectRoot = join(dir, "project");

    await createTemplateScmSkills(configRoot, ".claude");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-commit");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-create-pr");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "sl-commit");

    await expect(
      hasProjectScmSkillsInSync("claude", "github", projectRoot, configRoot)
    ).resolves.toBe(false);
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

test("shouldAutoInitChat returns true when configured SCM skills are out of sync", async () => {
  await withTempDir(async (dir) => {
    const configRoot = join(dir, "config");
    const projectRoot = join(dir, "project");

    await createTemplateScmSkills(configRoot, ".claude");
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
    await writeProjectScmSetting(projectRoot, "github");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-commit");
    await makeSkillDir(join(projectRoot, ".claude", "skills"), "gh-create-pr");

    await expect(shouldAutoInitChat("claude", projectRoot, { configRoot })).resolves.toBe(false);
  });
});

test("buildChatStartupDiscoveryPlan keeps Copilot precedence and compatibility contract", () => {
  const projectRoot = "/tmp/atomic-chat-startup-project";
  const homeDir = "/tmp/atomic-chat-startup-home";

  const plan = buildChatStartupDiscoveryPlan("copilot", {
    projectRoot,
    homeDir,
    xdgConfigHome: join(homeDir, ".config"),
    pathExists: () => false,
  });

  expect(plan.provider).toBe("copilot");
  expect(plan.rootsInPrecedenceOrder[0]?.id).toBe("copilot_atomic_claude_compat");
  expect(plan.rootsInPrecedenceOrder[plan.rootsInPrecedenceOrder.length - 1]?.id).toBe(
    "copilot_project_native"
  );
  expect(plan.compatibilitySets.nativeRootIds.has("copilot_user_canonical_native")).toBe(true);
});

test("buildProviderDiscoveryPlanDebugOutput redacts absolute discovery paths", () => {
  const projectRoot = "/tmp/atomic-chat-debug-project";
  const homeDir = "/tmp/atomic-chat-debug-home";
  const externalCanonicalRoot = "/tmp/atomic-chat-external-canonical";

  const plan = buildChatStartupDiscoveryPlan("copilot", {
    projectRoot,
    homeDir,
    copilotCanonicalUserRoot: externalCanonicalRoot,
    pathExists: () => false,
  });

  const debugOutput = buildProviderDiscoveryPlanDebugOutput(plan, {
    projectRoot,
    homeDir,
  });

  const serialized = JSON.stringify(debugOutput);
  expect(serialized.includes(projectRoot)).toBe(false);
  expect(serialized.includes(homeDir)).toBe(false);
  expect(serialized.includes(externalCanonicalRoot)).toBe(false);

  const projectRootEntry = debugOutput.rootsInPrecedenceOrder.find(
    (root) => root.id === "copilot_project_native"
  );
  expect(projectRootEntry?.resolvedPath).toBe("<project>/.github");

  const externalRootEntry = debugOutput.rootsInPrecedenceOrder.find(
    (root) => root.id === "copilot_user_canonical_native"
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

test("prepareClaudeRuntimeForChat sets CLAUDE_CONFIG_DIR from merged runtime path", async () => {
  const previousValue = process.env.CLAUDE_CONFIG_DIR;
  const projectRoot = "/tmp/atomic-chat-claude-project";
  const mergedDir = "/tmp/atomic-chat-claude-merged";
  const plan = buildChatStartupDiscoveryPlan("claude", {
    homeDir: "/tmp/atomic-chat-claude-home",
    projectRoot,
    pathExists: () => false,
  });

  let capturedProjectRoot: string | undefined;
  let capturedPlanProvider: string | undefined;

  try {
    const result = await prepareClaudeRuntimeForChat({
      projectRoot,
      providerDiscoveryPlan: plan,
      prepareClaudeConfigDir: async (options) => {
        capturedProjectRoot = options?.projectRoot;
        capturedPlanProvider = options?.discoveryPlan?.provider;
        return mergedDir;
      },
    });

    expect(result).toBe(mergedDir);
    expect(capturedProjectRoot).toBe(projectRoot);
    expect(capturedPlanProvider).toBe("claude");
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(mergedDir);
  } finally {
    if (previousValue === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousValue;
    }
  }
});

test("prepareClaudeRuntimeForChat throws when merged runtime cannot be prepared", async () => {
  const previousValue = process.env.CLAUDE_CONFIG_DIR;
  const projectRoot = "/tmp/atomic-chat-claude-project";
  const plan = buildChatStartupDiscoveryPlan("claude", {
    homeDir: "/tmp/atomic-chat-claude-home",
    projectRoot,
    pathExists: () => false,
  });

  try {
    await expect(
      prepareClaudeRuntimeForChat({
        projectRoot,
        providerDiscoveryPlan: plan,
        prepareClaudeConfigDir: async () => null,
      })
    ).rejects.toThrow("Unable to prepare Claude runtime config from ~/.atomic/.claude");
  } finally {
    if (previousValue === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousValue;
    }
  }
});

test("prepareOpenCodeRuntimeConfigForChat sets OPENCODE_CONFIG_DIR from merged runtime path", async () => {
  const projectRoot = "/tmp/atomic-chat-opencode-project";
  const mergedDir = "/tmp/atomic-chat-opencode-merged";
  const plan = buildChatStartupDiscoveryPlan("opencode", {
    homeDir: "/tmp/atomic-chat-opencode-home",
    projectRoot,
    xdgConfigHome: "/tmp/atomic-chat-opencode-home/.config",
    pathExists: () => false,
  });
  const env: NodeJS.ProcessEnv = {};

  let capturedProjectRoot: string | undefined;
  let capturedPlanProvider: string | undefined;

  const result = await prepareOpenCodeRuntimeConfigForChat(projectRoot, plan, {
    env,
    prepareOpenCodeConfigDir: async (options) => {
      capturedProjectRoot = options?.projectRoot;
      capturedPlanProvider = options?.providerDiscoveryPlan?.provider;
      return mergedDir;
    },
  });

  expect(result).toBe(mergedDir);
  expect(capturedProjectRoot).toBe(projectRoot);
  expect(capturedPlanProvider).toBe("opencode");
  expect(env.OPENCODE_CONFIG_DIR).toBe(mergedDir);
});

test("prepareOpenCodeRuntimeConfigForChat leaves env unchanged when merge is unavailable", async () => {
  const projectRoot = "/tmp/atomic-chat-opencode-project";
  const plan = buildChatStartupDiscoveryPlan("opencode", {
    homeDir: "/tmp/atomic-chat-opencode-home",
    projectRoot,
    xdgConfigHome: "/tmp/atomic-chat-opencode-home/.config",
    pathExists: () => false,
  });
  const env: NodeJS.ProcessEnv = {};

  const result = await prepareOpenCodeRuntimeConfigForChat(projectRoot, plan, {
    env,
    prepareOpenCodeConfigDir: async () => null,
  });

  expect(result).toBeNull();
  expect(env.OPENCODE_CONFIG_DIR).toBeUndefined();
});

test("prepareOpenCodeRuntimeConfigForChat rejects non-opencode discovery plans", async () => {
  const claudePlan = buildChatStartupDiscoveryPlan("claude", {
    homeDir: "/tmp/atomic-chat-claude-home",
    projectRoot: "/tmp/atomic-chat-claude-project",
    pathExists: () => false,
  });

  await expect(
    prepareOpenCodeRuntimeConfigForChat("/tmp/atomic-chat-claude-project", claudePlan)
  ).rejects.toThrow(
    "OpenCode runtime prep requires an OpenCode discovery plan, received claude",
  );
});
