import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  resolveOpenCodeAgentDirectories,
  resolveOpenCodeArtifactPlan,
  resolveOpenCodeSkillDirectories,
} from "@/services/config/opencode-config.ts";

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

    expect(
      resolveOpenCodeAgentDirectories({
        homeDir,
        projectRoot,
        xdgConfigHome,
      }),
    ).toEqual([
      join(projectRoot, ".opencode", "agents"),
      join(xdgConfigHome, ".opencode", "agents"),
      join(homeDir, ".opencode", "agents"),
    ]);

    expect(
      resolveOpenCodeSkillDirectories({
        homeDir,
        projectRoot,
        xdgConfigHome,
      }),
    ).toEqual([
      join(projectRoot, ".opencode", "skills"),
      join(xdgConfigHome, ".opencode", "skills"),
      join(homeDir, ".opencode", "skills"),
    ]);
  });
});
