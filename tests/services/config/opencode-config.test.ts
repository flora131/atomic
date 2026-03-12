import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "path";
import {
  loadOpenCodeAgents,
  resolveOpenCodeAgentDirectories,
  resolveOpenCodeArtifactPlan,
  resolveOpenCodeSkillDirectories,
} from "@/services/config/opencode-config.ts";
import { buildProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";

describe("opencode-config", () => {
  test("resolves OpenCode discovery plan from AGENTS.md paths only", () => {
    const homeDir = "/tmp/opencode-home";
    const projectRoot = "/tmp/opencode-project";
    const xdgConfigHome = "/tmp/opencode-xdg";
    const plan = resolveOpenCodeArtifactPlan({ homeDir, projectRoot, xdgConfigHome });

    expect(plan.rootsInPrecedenceOrder.map((root) => root.id)).toEqual([
      "opencode_user_home",
      "opencode_user_xdg",
      "opencode_project",
    ]);
  });

  test("resolves OpenCode agent and skill directories in AGENTS.md precedence order", () => {
    const homeDir = "/tmp/opencode-home";
    const projectRoot = "/tmp/opencode-project";
    const xdgConfigHome = "/tmp/opencode-xdg";

    const plan = buildProviderDiscoveryPlan("opencode", {
      homeDir,
      projectRoot,
      xdgConfigHome,
      platform: "linux",
    });

    expect(
      resolveOpenCodeAgentDirectories({
        homeDir,
        projectRoot,
        xdgConfigHome,
        providerDiscoveryPlan: plan,
      }),
    ).toEqual([
      resolve(projectRoot, ".opencode", "agents"),
      resolve(xdgConfigHome, ".opencode", "agents"),
      resolve(homeDir, ".opencode", "agents"),
    ]);

    expect(
      resolveOpenCodeSkillDirectories({
        homeDir,
        projectRoot,
        xdgConfigHome,
        providerDiscoveryPlan: plan,
      }),
    ).toEqual([
      resolve(projectRoot, ".opencode", "skills"),
      resolve(xdgConfigHome, ".opencode", "skills"),
      resolve(homeDir, ".opencode", "skills"),
    ]);
  });

  test("loads OpenCode agent tool toggles from frontmatter", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-agent-test-"));
    try {
      await mkdir(join(root, ".opencode", "agents"), { recursive: true });
      await writeFile(
        join(root, ".opencode", "agents", "debugger.md"),
        `---
name: debugger
description: Debugger agent
tools:
  bash: true
  webfetch: false
  docs_*: false
---
Debug the repository.`,
        "utf-8",
      );

      const agents = await loadOpenCodeAgents({
        projectRoot: root,
        homeDir: join(root, "home"),
        xdgConfigHome: join(root, "xdg"),
      });
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        name: "debugger",
        description: "Debugger agent",
        systemPrompt: "Debug the repository.",
        source: "local",
      });
      expect(agents[0]?.tools).toEqual({
        bash: true,
        webfetch: false,
        "docs_*": false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
