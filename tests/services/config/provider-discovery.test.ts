import { afterEach, describe, expect, test } from "bun:test";
import {
  getProviderDiscoveryRootsInPrecedenceOrder,
  getProviderDiscoveryRootById,
  shouldOverrideByProviderRoot,
} from "@/services/config/provider-discovery-contract.ts";

import {
  registerProviderDiscoveryCacheInvalidator,
  invalidateProviderDiscoveryCaches,
  clearProviderDiscoverySessionCache,
} from "@/services/config/provider-discovery-cache.ts";

describe("provider-discovery cache invalidation", () => {
  afterEach(() => {
    clearProviderDiscoverySessionCache();
  });

  test("registerProviderDiscoveryCacheInvalidator returns unregister function", () => {
    const unregister = registerProviderDiscoveryCacheInvalidator(() => {});
    expect(typeof unregister).toBe("function");
    unregister();
  });

  test("invalidateProviderDiscoveryCaches calls all registered invalidators", () => {
    let callCountA = 0;
    let callCountB = 0;

    const unregA = registerProviderDiscoveryCacheInvalidator(() => {
      callCountA += 1;
    });
    const unregB = registerProviderDiscoveryCacheInvalidator(() => {
      callCountB += 1;
    });

    invalidateProviderDiscoveryCaches();

    expect(callCountA).toBe(1);
    expect(callCountB).toBe(1);

    invalidateProviderDiscoveryCaches();

    expect(callCountA).toBe(2);
    expect(callCountB).toBe(2);

    unregA();
    unregB();
  });

  test("unregister function prevents future invalidation calls", () => {
    let callCount = 0;
    const unregister = registerProviderDiscoveryCacheInvalidator(() => {
      callCount += 1;
    });

    invalidateProviderDiscoveryCaches();
    expect(callCount).toBe(1);

    unregister();

    invalidateProviderDiscoveryCaches();
    expect(callCount).toBe(1);
  });

  test("clearProviderDiscoverySessionCache does not throw", () => {
    expect(() => clearProviderDiscoverySessionCache()).not.toThrow();
    // Calling it multiple times should also be safe
    expect(() => clearProviderDiscoverySessionCache()).not.toThrow();
  });
});

describe("getProviderDiscoveryRootsInPrecedenceOrder", () => {
  test("claude roots are returned in order (userGlobal before projectLocal)", () => {
    const roots = getProviderDiscoveryRootsInPrecedenceOrder("claude");

    expect(roots.length).toBe(2);
    expect(roots[0]!.id).toBe("claude_user");
    expect(roots[0]!.tier).toBe("userGlobal");
    expect(roots[0]!.precedence).toBe(0);

    expect(roots[1]!.id).toBe("claude_project");
    expect(roots[1]!.tier).toBe("projectLocal");
    expect(roots[1]!.precedence).toBe(1);

    // Verify precedence is strictly increasing
    for (let i = 1; i < roots.length; i++) {
      expect(roots[i]!.precedence).toBeGreaterThan(roots[i - 1]!.precedence);
    }
  });

  test("opencode roots include user home, user xdg, and project roots", () => {
    const roots = getProviderDiscoveryRootsInPrecedenceOrder("opencode");

    expect(roots.length).toBe(3);

    const rootIds = roots.map((r) => r.id);
    expect(rootIds).toEqual([
      "opencode_user_home",
      "opencode_user_xdg",
      "opencode_project",
    ]);

    // userGlobal roots come before projectLocal
    const userGlobalRoots = roots.filter((r) => r.tier === "userGlobal");
    const projectLocalRoots = roots.filter((r) => r.tier === "projectLocal");

    expect(userGlobalRoots.length).toBe(2);
    expect(projectLocalRoots.length).toBe(1);

    const maxUserPrecedence = Math.max(
      ...userGlobalRoots.map((r) => r.precedence),
    );
    const minProjectPrecedence = Math.min(
      ...projectLocalRoots.map((r) => r.precedence),
    );
    expect(maxUserPrecedence).toBeLessThan(minProjectPrecedence);
  });

  test("copilot roots include all tiers", () => {
    const roots = getProviderDiscoveryRootsInPrecedenceOrder("copilot");

    expect(roots.length).toBe(3);

    const rootIds = roots.map((r) => r.id);
    expect(rootIds).toEqual([
      "copilot_user_home",
      "copilot_user_xdg",
      "copilot_project",
    ]);

    // Verify tiers are assigned correctly
    expect(roots[0]!.tier).toBe("userGlobal");
    expect(roots[1]!.tier).toBe("userGlobal");
    expect(roots[2]!.tier).toBe("projectLocal");

    // Verify precedence ordering across all roots
    for (let i = 1; i < roots.length; i++) {
      expect(roots[i]!.precedence).toBeGreaterThan(roots[i - 1]!.precedence);
    }
  });
});

describe("getProviderDiscoveryRootById", () => {
  test("finds existing root by ID", () => {
    const root = getProviderDiscoveryRootById("claude", "claude_user");

    expect(root).not.toBeNull();
    expect(root!.id).toBe("claude_user");
    expect(root!.tier).toBe("userGlobal");
    expect(root!.pathTemplate).toBe("~/.claude");
    expect(root!.compatibility).toBe("native");
    expect(root!.description).toBe("User Claude config");
    expect(typeof root!.precedence).toBe("number");
  });

  test("returns null for unknown root ID", () => {
    const result = getProviderDiscoveryRootById("claude", "nonexistent_root");
    expect(result).toBeNull();
  });
});

describe("shouldOverrideByProviderRoot", () => {
  test("projectLocal root overrides userGlobal root", () => {
    const result = shouldOverrideByProviderRoot(
      "claude",
      "claude_project",
      "claude_user",
    );
    expect(result).toBe(true);
  });

  test("userGlobal root does not override projectLocal root", () => {
    const result = shouldOverrideByProviderRoot(
      "claude",
      "claude_user",
      "claude_project",
    );
    expect(result).toBe(false);
  });

  test("throws for unknown root IDs", () => {
    expect(() =>
      shouldOverrideByProviderRoot("claude", "unknown_root", "claude_user"),
    ).toThrow("Unknown discovery root for claude: unknown_root");

    expect(() =>
      shouldOverrideByProviderRoot("claude", "claude_user", "unknown_root"),
    ).toThrow("Unknown discovery root for claude: unknown_root");
  });
});
