import { describe, expect, test } from "bun:test";
import { join, resolve } from "path";
import {
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
});
