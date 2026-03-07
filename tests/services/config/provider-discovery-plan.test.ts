import { describe, expect, test } from "bun:test";
import {
  buildProviderDiscoveryPlan,
  getCompatibleDiscoveryRoots,
  isRootInCompatibilitySet,
  resolveDefaultConfigHome,
  resolveProviderDiscoveryCandidates,
} from "@/services/config/provider-discovery-plan.ts";

function createPathExists(paths: readonly string[]): (path: string) => boolean {
  const existing = new Set(paths);
  return (path: string) => existing.has(path);
}

describe("provider-discovery-plan", () => {
  test("builds claude plan with deterministic tier paths and existing roots", () => {
    const plan = buildProviderDiscoveryPlan("claude", {
      homeDir: "/home/tester",
      projectRoot: "/workspace/repo",
      pathExists: createPathExists([
        "/home/tester/.atomic/.claude",
        "/workspace/repo/.claude",
      ]),
    });

    expect(plan.runtime).toEqual({
      mode: "mergedConfigDir",
      envVar: "CLAUDE_CONFIG_DIR",
    });

    expect(plan.paths).toEqual({
      atomicBaseline: ["/home/tester/.atomic/.claude"],
      userGlobal: ["/home/tester/.claude"],
      projectLocal: ["/workspace/repo/.claude"],
    });

    expect(plan.existingRoots.map((root) => root.id)).toEqual([
      "claude_atomic",
      "claude_project",
    ]);

    expect(Array.from(plan.compatibilitySets.nativeRootIds).sort()).toEqual([
      "claude_atomic",
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
      pathExists: () => true,
    });

    expect(plan.paths.userGlobal).toEqual([
      "/xdg/config/.opencode",
      "/home/tester/.opencode",
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
      pathExists: () => true,
    });

    expect(plan.runtime).toEqual({
      mode: "manualInjection",
      injects: ["customAgents", "skillDirectories", "instructions"],
    });

    expect(plan.paths.userGlobal).toEqual([
      "/xdg/root/.copilot",
      "/home/alice/.copilot",
    ]);

    expect(Array.from(plan.compatibilitySets.nativeRootIds).sort()).toEqual([
      "copilot_atomic_native",
      "copilot_project_native",
      "copilot_user_canonical_native",
      "copilot_user_home_native",
    ]);
    expect(Array.from(plan.compatibilitySets.compatibilityRootIds).sort()).toEqual([
      "copilot_atomic_claude_compat",
      "copilot_atomic_opencode_compat",
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
      "copilot_atomic_native",
      "copilot_user_canonical_native",
      "copilot_user_home_native",
      "copilot_project_native",
    ]);
  });

  test("uses APPDATA as default config home on Windows", () => {
    expect(
      resolveDefaultConfigHome({
        homeDir: "/Users/alice",
        appDataDir: "/Users/alice/AppData/Roaming",
        platform: "win32",
      }),
    ).toBe("/Users/alice/AppData/Roaming");

    const plan = buildProviderDiscoveryPlan("copilot", {
      homeDir: "/Users/alice",
      appDataDir: "/Users/alice/AppData/Roaming",
      platform: "win32",
      projectRoot: "/repo",
      pathExists: () => false,
    });

    expect(plan.paths.userGlobal).toEqual([
      "/Users/alice/AppData/Roaming/.copilot",
      "/Users/alice/.copilot",
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
        rootId: "copilot_atomic_claude_compat",
        value: "atomic-compat",
      },
      {
        key: "fix",
        rootId: "copilot_atomic_native",
        value: "atomic-native",
      },
      {
        key: "fix",
        rootId: "copilot_atomic_native",
        value: "atomic-native-newer",
      },
    ]);

    expect(resolved.get("review")?.value).toBe("project-compat");
    expect(resolved.get("fix")?.value).toBe("atomic-native-newer");
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
