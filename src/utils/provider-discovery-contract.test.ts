import { describe, expect, test } from "bun:test";
import {
  PROVIDER_DISCOVERY_CONTRACTS,
  PROVIDER_DISCOVERY_TIERS,
  getProviderDiscoveryContract,
  getProviderDiscoveryRootById,
  getProviderDiscoveryRootsInPrecedenceOrder,
  getProviderDiscoveryTierRank,
  shouldOverrideByDiscoveryTier,
  shouldOverrideByProviderRoot,
} from "./provider-discovery-contract.ts";

describe("provider-discovery-contract", () => {
  test("defines contracts for claude, opencode, and copilot", () => {
    const providers = Object.keys(PROVIDER_DISCOVERY_CONTRACTS).sort();
    expect(providers).toEqual(["claude", "copilot", "opencode"]);
  });

  test("uses atomic -> user -> project tier precedence", () => {
    expect(PROVIDER_DISCOVERY_TIERS).toEqual([
      "atomicBaseline",
      "userGlobal",
      "projectLocal",
    ]);

    expect(getProviderDiscoveryTierRank("atomicBaseline")).toBeLessThan(
      getProviderDiscoveryTierRank("userGlobal"),
    );
    expect(getProviderDiscoveryTierRank("userGlobal")).toBeLessThan(
      getProviderDiscoveryTierRank("projectLocal"),
    );

    expect(shouldOverrideByDiscoveryTier("projectLocal", "userGlobal")).toBe(
      true,
    );
    expect(shouldOverrideByDiscoveryTier("userGlobal", "projectLocal")).toBe(
      false,
    );
  });

  test("assigns unique root IDs per provider", () => {
    for (const provider of Object.keys(PROVIDER_DISCOVERY_CONTRACTS) as Array<
      keyof typeof PROVIDER_DISCOVERY_CONTRACTS
    >) {
      const ordered = getProviderDiscoveryRootsInPrecedenceOrder(provider);
      const ids = ordered.map((root) => root.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("claude contract includes deterministic runtime env binding", () => {
    const contract = getProviderDiscoveryContract("claude");
    expect(contract.runtime).toEqual({
      mode: "mergedConfigDir",
      envVar: "CLAUDE_CONFIG_DIR",
    });

    const orderedRootIds = getProviderDiscoveryRootsInPrecedenceOrder(
      "claude",
    ).map((root) => root.id);
    expect(orderedRootIds).toEqual([
      "claude_atomic",
      "claude_user",
      "claude_project",
    ]);
  });

  test("opencode contract keeps home root above canonical within user globals", () => {
    const contract = getProviderDiscoveryContract("opencode");
    expect(contract.runtime).toEqual({
      mode: "mergedConfigDir",
      envVar: "OPENCODE_CONFIG_DIR",
    });

    const userRootIds = contract.roots.userGlobal.map((root) => root.id);
    expect(userRootIds).toEqual([
      "opencode_user_canonical_xdg",
      "opencode_user_home_native",
    ]);
  });

  test("copilot contract encodes native-over-compat precedence in each tier", () => {
    const contract = getProviderDiscoveryContract("copilot");
    expect(contract.runtime).toEqual({
      mode: "manualInjection",
      injects: ["customAgents", "skillDirectories", "instructions"],
    });

    expect(
      shouldOverrideByProviderRoot(
        "copilot",
        "copilot_atomic_native",
        "copilot_atomic_claude_compat",
      ),
    ).toBe(true);
    expect(
      shouldOverrideByProviderRoot(
        "copilot",
        "copilot_user_home_native",
        "copilot_user_canonical_native",
      ),
    ).toBe(true);
    expect(
      shouldOverrideByProviderRoot(
        "copilot",
        "copilot_user_canonical_native",
        "copilot_atomic_native",
      ),
    ).toBe(true);
    expect(
      shouldOverrideByProviderRoot(
        "copilot",
        "copilot_project_native",
        "copilot_project_opencode_compat",
      ),
    ).toBe(true);
  });

  test("can resolve root metadata by provider and root id", () => {
    const root = getProviderDiscoveryRootById(
      "copilot",
      "copilot_user_canonical_native",
    );
    expect(root).not.toBeNull();
    expect(root?.tier).toBe("userGlobal");
    expect(root?.pathTemplate).toBe("<copilot-canonical-user-root>");
    expect(root?.compatibility).toBe("native");

    const missing = getProviderDiscoveryRootById("copilot", "missing-root");
    expect(missing).toBeNull();
  });
});
