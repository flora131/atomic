import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCopilotSkillDirectories } from "@/services/config/copilot-config.ts";
import { buildProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";

describe("resolveCopilotSkillDirectories", () => {
  test("uses provided discovery plan and returns existing skill directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const projectRoot = join(root, "workspace");
      const expectedDirectories = [
        join(projectRoot, ".github", "skills"),
        join(root, ".copilot", "skills"),
      ];
      await Promise.all(expectedDirectories.map((directoryPath) => mkdir(directoryPath, { recursive: true })));

      const plan = buildProviderDiscoveryPlan("copilot", { projectRoot, homeDir: root });
      const skillDirectories = await resolveCopilotSkillDirectories(projectRoot, { providerDiscoveryPlan: plan });
      expect(skillDirectories).toEqual(expectedDirectories);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses XDG Copilot root when discovery plan resolves to XDG", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const projectRoot = join(root, "workspace");
      const xdgConfigHome = join(root, ".config");
      const expectedDirectories = [
        join(projectRoot, ".github", "skills"),
        join(xdgConfigHome, ".copilot", "skills"),
      ];
      await Promise.all(expectedDirectories.map((directoryPath) => mkdir(directoryPath, { recursive: true })));

      const plan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir: root,
        xdgConfigHome,
      });
      const skillDirectories = await resolveCopilotSkillDirectories(projectRoot, { providerDiscoveryPlan: plan });
      expect(skillDirectories).toEqual(expectedDirectories);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
