import { describe, expect, test } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from "fs/promises";
import { prepareOpenCodeConfigDir } from "@/services/config/opencode-config.ts";
import { buildProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";

describe("prepareOpenCodeConfigDir", () => {
  test("returns null when ~/.opencode is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-opencode-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const mergedDir = join(homeDir, ".atomic", ".tmp", "merged");

    await mkdir(homeDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    try {
      const result = await prepareOpenCodeConfigDir({
        homeDir,
        projectRoot,
        mergedDir,
      });
      expect(result).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects non-opencode discovery plans", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-opencode-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const mergedDir = join(homeDir, ".atomic", ".tmp", "merged");
    const claudePlan = buildProviderDiscoveryPlan("claude", {
      homeDir,
      projectRoot,
    });

    await mkdir(homeDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    try {
      await expect(
        prepareOpenCodeConfigDir({
          providerDiscoveryPlan: claudePlan,
          mergedDir,
        }),
      ).rejects.toThrow(
        "prepareOpenCodeConfigDir expected opencode provider plan, received claude",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("merges roots using deterministic provider discovery precedence", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-opencode-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const xdgConfigHome = join(homeDir, ".xdg-config");
    const mergedDir = join(homeDir, ".atomic", ".tmp", "merged");

    const canonicalAgent = join(xdgConfigHome, ".opencode", "agents", "example.md");
    const homeAgent = join(homeDir, ".opencode", "agents", "example.md");
    const projectAgent = join(projectRoot, ".opencode", "agents", "example.md");

    const userPrecedenceCanonical = join(
      xdgConfigHome,
      ".opencode",
      "agents",
      "user-precedence.md",
    );
    const userPrecedenceHome = join(
      homeDir,
      ".opencode",
      "agents",
      "user-precedence.md",
    );

    const homeOnlyAgent = join(homeDir, ".opencode", "agents", "home-only.md");

    const discoveryPlan = buildProviderDiscoveryPlan("opencode", {
      homeDir,
      projectRoot,
      xdgConfigHome,
    });

    await mkdir(join(xdgConfigHome, ".opencode", "agents"), { recursive: true });
    await mkdir(join(homeDir, ".opencode", "agents"), { recursive: true });
    await mkdir(join(projectRoot, ".opencode", "agents"), { recursive: true });

    await writeFile(canonicalAgent, "canonical", "utf-8");
    await writeFile(homeAgent, "home", "utf-8");
    await writeFile(projectAgent, "project", "utf-8");

    await writeFile(userPrecedenceCanonical, "canonical", "utf-8");
    await writeFile(userPrecedenceHome, "home", "utf-8");
    await writeFile(homeOnlyAgent, "home-only", "utf-8");

    try {
      const result = await prepareOpenCodeConfigDir({
        providerDiscoveryPlan: discoveryPlan,
        mergedDir,
      });
      expect(result).toBe(mergedDir);

      const mergedExample = await readFile(join(mergedDir, "agents", "example.md"), "utf-8");
      const mergedUserPrecedence = await readFile(
        join(mergedDir, "agents", "user-precedence.md"),
        "utf-8",
      );
      const mergedHomeOnly = await readFile(join(mergedDir, "agents", "home-only.md"), "utf-8");

      expect(mergedExample).toBe("project");
      expect(mergedUserPrecedence).toBe("canonical");
      expect(mergedHomeOnly).toBe("home-only");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects merged output paths that traverse outside ~/.atomic", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-opencode-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const escapedMergedDir = join(homeDir, ".atomic", "..", "escaped-merged");

    await mkdir(join(homeDir, ".opencode"), { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    try {
      await expect(
        prepareOpenCodeConfigDir({
          homeDir,
          projectRoot,
          mergedDir: escapedMergedDir,
        }),
      ).rejects.toThrow("OpenCode merged config directory escapes allowed root");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects overlay symlinks that resolve outside allowed roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-opencode-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const xdgConfigHome = join(homeDir, ".config");
    const outsideDir = join(root, "outside");
    const mergedDir = join(homeDir, ".atomic", ".tmp", "merged");

    await mkdir(join(homeDir, ".opencode", "agents"), {
      recursive: true,
    });
    await mkdir(projectRoot, { recursive: true });
    await mkdir(join(outsideDir, "agents"), { recursive: true });
    await writeFile(join(outsideDir, "agents", "escape.md"), "outside", "utf-8");

    await mkdir(xdgConfigHome, { recursive: true });
    await symlink(outsideDir, join(xdgConfigHome, ".opencode"));

    const discoveryPlan = buildProviderDiscoveryPlan("opencode", {
      homeDir,
      projectRoot,
      xdgConfigHome,
    });

    try {
      await expect(
        prepareOpenCodeConfigDir({
          providerDiscoveryPlan: discoveryPlan,
          mergedDir,
        }),
      ).rejects.toThrow("OpenCode XDG config root resolves outside allowed root");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("copies in-root symlinked files from overlays", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-opencode-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const mergedDir = join(homeDir, ".atomic", ".tmp", "merged");

    await mkdir(join(homeDir, ".opencode", "agents"), {
      recursive: true,
    });
    await mkdir(join(projectRoot, ".opencode", "agents"), {
      recursive: true,
    });

    const targetFile = join(projectRoot, ".opencode", "agents", "target.md");
    const linkedFile = join(projectRoot, ".opencode", "agents", "linked.md");
    await writeFile(targetFile, "inside-root", "utf-8");
    await symlink(targetFile, linkedFile);

    try {
      const result = await prepareOpenCodeConfigDir({
        homeDir,
        projectRoot,
        mergedDir,
      });

      expect(result).toBe(mergedDir);
      expect(await readFile(join(mergedDir, "agents", "linked.md"), "utf-8")).toBe("inside-root");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
