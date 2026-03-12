import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  buildProviderDiscoveryPlan,
  getCompatibleDiscoveryRoots,
  isRootInCompatibilitySet,
  resolveProviderDiscoveryCandidates,
} from "@/services/config/provider-discovery-plan.ts";

function createPathExists(paths: readonly string[]): (path: string) => boolean {
  const existing = new Set(paths);
  return (path: string) => existing.has(path);
}

describe("provider-discovery-plan", () => {
  test("builds claude plan with deterministic tier paths and existing roots", () => {
    const resolvedHome = resolve("/home/tester/.claude");
    const resolvedProject = resolve("/workspace/repo/.claude");
    const plan = buildProviderDiscoveryPlan("claude", {
      homeDir: "/home/tester",
      projectRoot: "/workspace/repo",
      pathExists: createPathExists([
        resolvedHome,
        resolvedProject,
      ]),
    });

    expect(plan.runtime).toEqual({
      mode: "nativeConfig",
    });

    expect(plan.paths).toEqual({
      atomicBaseline: [],
      userGlobal: [resolvedHome],
      projectLocal: [resolvedProject],
    });

    expect(plan.existingRoots.map((root) => root.id)).toEqual([
      "claude_user",
      "claude_project",
    ]);

    expect(Array.from(plan.compatibilitySets.nativeRootIds).sort()).toEqual([
      "claude_project",
      "claude_user",
    ]);
    expect(Array.from(plan.compatibilitySets.compatibilityRootIds)).toEqual([]);
  });

  test("resolves opencode home, XDG, and project roots with project precedence", () => {
    const plan = buildProviderDiscoveryPlan("opencode", {
      homeDir: "/home/tester",
      projectRoot: "/workspace/repo",
      xdgConfigHome: "/home/tester/.config",
      pathExists: () => true,
      platform: "linux",
    });

    expect(plan.paths.userGlobal).toEqual([
      resolve("/home/tester", ".opencode"),
      resolve("/home/tester/.config", ".opencode"),
    ]);

    const resolved = resolveProviderDiscoveryCandidates(plan, [
      {
        key: "lint",
        rootId: "opencode_user_home",
        value: "home",
      },
      {
        key: "lint",
        rootId: "opencode_user_xdg",
        value: "xdg",
      },
      {
        key: "lint",
        rootId: "opencode_project",
        value: "project",
      },
    ]);

    expect(resolved.get("lint")?.value).toBe("project");
  });

  test("builds copilot plan with AGENTS.md home, XDG, and project roots", () => {
    const plan = buildProviderDiscoveryPlan("copilot", {
      homeDir: "/home/alice",
      projectRoot: "/workspace/repo",
      xdgConfigHome: "/home/alice/.config",
      pathExists: () => true,
      platform: "linux",
    });

    expect(plan.runtime).toEqual({
      mode: "manualInjection",
      injects: ["customAgents", "skillDirectories", "instructions"],
    });

    expect(plan.paths.userGlobal).toEqual([
      resolve("/home/alice", ".copilot"),
      resolve("/home/alice/.config", ".copilot"),
    ]);

    expect(Array.from(plan.compatibilitySets.nativeRootIds).sort()).toEqual([
      "copilot_project",
      "copilot_user_home",
      "copilot_user_xdg",
    ]);
    expect(Array.from(plan.compatibilitySets.compatibilityRootIds)).toEqual([]);

    expect(isRootInCompatibilitySet(plan, "copilot_project", "native")).toBe(
      true,
    );
    expect(
      isRootInCompatibilitySet(plan, "copilot_project", "compatibility"),
    ).toBe(false);
    expect(
      isRootInCompatibilitySet(plan, "copilot_project", "all"),
    ).toBe(true);

    expect(
      getCompatibleDiscoveryRoots(plan, "native").map((root) => root.id),
    ).toEqual([
      "copilot_user_home",
      "copilot_user_xdg",
      "copilot_project",
    ]);
  });

  test("keeps home-root precedence on Windows", () => {
    const plan = buildProviderDiscoveryPlan("copilot", {
      homeDir: "/Users/alice",
      projectRoot: "/repo",
      pathExists: () => false,
    });

    expect(plan.paths.userGlobal).toEqual([
      resolve("/Users/alice", ".copilot"),
    ]);
  });

  test("resolves candidate conflicts by precedence across AGENTS.md roots", () => {
    const plan = buildProviderDiscoveryPlan("copilot", {
      homeDir: "/home/alice",
      projectRoot: "/workspace/repo",
      pathExists: () => true,
    });

    const resolved = resolveProviderDiscoveryCandidates(plan, [
      {
        key: "review",
        rootId: "copilot_user_home",
        value: "home",
      },
      {
        key: "review",
        rootId: "copilot_user_xdg",
        value: "xdg",
      },
      {
        key: "review",
        rootId: "copilot_project",
        value: "project",
      },
      {
        key: "fix",
        rootId: "copilot_user_xdg",
        value: "xdg",
      },
    ]);

    expect(resolved.get("review")?.value).toBe("project");
    expect(resolved.get("fix")?.value).toBe("xdg");
  });

  test("throws when candidate references an unknown root", () => {
    const plan = buildProviderDiscoveryPlan("claude", {
      homeDir: "/home/tester",
      projectRoot: "/workspace/repo",
      pathExists: () => true,
    });

    expect(() =>
      resolveProviderDiscoveryCandidates(plan, [
        {
          key: "test",
          rootId: "does-not-exist",
          value: "invalid",
        },
      ]),
    ).toThrow("Unknown discovery root for claude: does-not-exist");
  });
});
