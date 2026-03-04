import { beforeEach, describe, expect, test } from "bun:test";
import { buildProviderDiscoveryPlan } from "./provider-discovery-plan.ts";
import {
  clearProviderDiscoverySessionCache,
  getProviderDiscoverySessionCacheValue,
  getStartupProviderDiscoveryPlan,
  invalidateProviderDiscoveryCaches,
  registerProviderDiscoveryCacheInvalidator,
  setProviderDiscoverySessionCacheValue,
  startProviderDiscoverySessionCache,
} from "./provider-discovery-cache.ts";

beforeEach(() => {
  clearProviderDiscoverySessionCache();
});

describe("provider-discovery-cache", () => {
  test("stores startup plan and cache entries for current project root", () => {
    const projectRoot = process.cwd();
    const startupPlan = buildProviderDiscoveryPlan("copilot", {
      projectRoot,
      homeDir: "/tmp/provider-discovery-cache-home-a",
      pathExists: () => false,
    });

    startProviderDiscoverySessionCache({
      projectRoot,
      startupPlan,
    });
    setProviderDiscoverySessionCacheValue("example", { ok: true });

    expect(getStartupProviderDiscoveryPlan("copilot", { projectRoot })).toBe(startupPlan);
    expect(getProviderDiscoverySessionCacheValue<{ ok: boolean }>("example")).toEqual({
      ok: true,
    });
  });

  test("invalidateProviderDiscoveryCaches clears session entries and runs invalidators", () => {
    startProviderDiscoverySessionCache({
      projectRoot: process.cwd(),
    });

    let invalidatorCalls = 0;
    const unregister = registerProviderDiscoveryCacheInvalidator(() => {
      invalidatorCalls += 1;
    });

    try {
      setProviderDiscoverySessionCacheValue("example", "value");

      invalidateProviderDiscoveryCaches();

      expect(getProviderDiscoverySessionCacheValue("example")).toBeUndefined();
      expect(invalidatorCalls).toBe(1);
    } finally {
      unregister();
    }
  });

  test("resets cached entries when startup plan fingerprint changes", () => {
    const projectRoot = process.cwd();
    const firstPlan = buildProviderDiscoveryPlan("claude", {
      projectRoot,
      homeDir: "/tmp/provider-discovery-cache-home-a",
      pathExists: () => false,
    });
    const secondPlan = buildProviderDiscoveryPlan("claude", {
      projectRoot,
      homeDir: "/tmp/provider-discovery-cache-home-b",
      pathExists: () => false,
    });

    startProviderDiscoverySessionCache({
      projectRoot,
      startupPlan: firstPlan,
    });
    setProviderDiscoverySessionCacheValue("example", "first");

    startProviderDiscoverySessionCache({
      projectRoot,
      startupPlan: secondPlan,
    });

    expect(getProviderDiscoverySessionCacheValue("example")).toBeUndefined();
    expect(getStartupProviderDiscoveryPlan("claude", { projectRoot })).toBe(secondPlan);
  });
});
