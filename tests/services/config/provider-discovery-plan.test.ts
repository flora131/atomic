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
      mode: "mergedConfigDir",
      envVar: "CLAUDE_CONFIG_DIR",
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

  test("resolves opencode user roots and precedence comparisons", () => {
    const plan = buildProviderDiscoveryPlan("opencode", {
      homeDir: "/home/tester",
      projectRoot: "/workspace/repo",
      xdgConfigHome: "/xdg/config",
      platform: "linux",
      pathExists: () => true,
    });

    expect(plan.paths.userGlobal).toEqual([
      resolve("/home/tester", ".opencode"),
      resolve("/xdg/config", ".opencode"),
    ]);

    const resolved = resolveProviderDiscoveryCandidates(plan, [
      {
        key: "lint",
        rootId: "opencode_user_canonical_xdg",
        value: "canonical",
      },
      {
        key: "lint",
        rootId: "opencode_user_home_native",
        value: "home",
      },
      {
        key: "lint",
        rootId: "opencode_project",
        value: "project",
      },
    ]);

    expect(resolved.get("lint")?.value).toBe("project");
  });

  test("builds copilot compatibility sets and canonical config-home paths", () => {
    const plan = buildProviderDiscoveryPlan("copilot", {
      homeDir: "/home/alice",
      projectRoot: "/workspace/repo",
      xdgConfigHome: "/xdg/root",
      platform: "linux",
      pathExists: () => true,
    });

    expect(plan.runtime).toEqual({
      mode: "manualInjection",
      injects: ["customAgents", "skillDirectories", "instructions"],
    });

    expect(plan.paths.userGlobal).toEqual([
      resolve("/home/alice", ".copilot"),
      resolve("/xdg/root", ".copilot"),
    ]);

    expect(Array.from(plan.compatibilitySets.nativeRootIds).sort()).toEqual([
      "copilot_project_native",
      "copilot_user_canonical_native",
      "copilot_user_home_native",
    ]);
    expect(Array.from(plan.compatibilitySets.compatibilityRootIds).sort()).toEqual([
      "copilot_project_claude_compat",
      "copilot_project_opencode_compat",
    ]);

    expect(isRootInCompatibilitySet(plan, "copilot_project_native", "native")).toBe(
      true,
    );
    expect(
      isRootInCompatibilitySet(plan, "copilot_project_native", "compatibility"),
    ).toBe(false);
    expect(
      isRootInCompatibilitySet(plan, "copilot_project_native", "all"),
    ).toBe(true);

    expect(
      getCompatibleDiscoveryRoots(plan, "native").map((root) => root.id),
    ).toEqual([
      "copilot_user_home_native",
      "copilot_user_canonical_native",
      "copilot_project_native",
    ]);
  });

  test("keeps home-root precedence on Windows", () => {
    const plan = buildProviderDiscoveryPlan("copilot", {
      homeDir: "/Users/alice",
      xdgConfigHome: "/Users/alice/custom-xdg",
      platform: "win32",
      projectRoot: "/repo",
      pathExists: () => false,
    });

    expect(plan.paths.userGlobal).toEqual([
      resolve("/Users/alice", ".copilot"),
    ]);
  });

  test("resolves candidate conflicts by precedence across compatibility classes", () => {
    const plan = buildProviderDiscoveryPlan("copilot", {
      homeDir: "/home/alice",
      projectRoot: "/workspace/repo",
      pathExists: () => true,
    });

    const resolved = resolveProviderDiscoveryCandidates(plan, [
      {
        key: "review",
        rootId: "copilot_user_canonical_native",
        value: "user-native",
      },
      {
        key: "review",
        rootId: "copilot_user_home_native",
        value: "user-home",
      },
      {
        key: "review",
        rootId: "copilot_project_claude_compat",
        value: "project-compat",
      },
      {
        key: "fix",
        rootId: "copilot_user_home_native",
        value: "home-native",
      },
      {
        key: "fix",
        rootId: "copilot_user_canonical_native",
        value: "canonical-native",
      },
    ]);

    expect(resolved.get("review")?.value).toBe("project-compat");
    expect(resolved.get("fix")?.value).toBe("canonical-native");
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
