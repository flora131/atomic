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
} from "@/services/config/provider-discovery-contract.ts";

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

  test("claude contract uses native config loading with home and project roots", () => {
    const contract = getProviderDiscoveryContract("claude");
    expect(contract.runtime).toEqual({
      mode: "nativeConfig",
    });

    const orderedRootIds = getProviderDiscoveryRootsInPrecedenceOrder(
      "claude",
    ).map((root) => root.id);
    expect(orderedRootIds).toEqual([
      "claude_user",
      "claude_project",
    ]);
  });

  test("opencode contract uses AGENTS.md global and project roots", () => {
    const contract = getProviderDiscoveryContract("opencode");
    expect(contract.runtime).toEqual({
      mode: "nativeConfig",
    });

    const userRootIds = contract.roots.userGlobal.map((root) => root.id);
    expect(userRootIds).toEqual([
      "opencode_user_home",
      "opencode_user_xdg",
    ]);
  });

  test("copilot contract uses only AGENTS.md roots", () => {
    const contract = getProviderDiscoveryContract("copilot");
    expect(contract.runtime).toEqual({
      mode: "manualInjection",
      injects: ["customAgents", "skillDirectories", "instructions"],
    });

    expect(
      shouldOverrideByProviderRoot(
        "copilot",
        "copilot_project",
        "copilot_user_xdg",
      ),
    ).toBe(true);
    expect(
      shouldOverrideByProviderRoot(
        "copilot",
        "copilot_user_xdg",
        "copilot_user_home",
      ),
    ).toBe(true);
  });

  test("can resolve root metadata by provider and root id", () => {
    const root = getProviderDiscoveryRootById(
      "copilot",
      "copilot_user_xdg",
    );
    expect(root).not.toBeNull();
    expect(root?.tier).toBe("userGlobal");
    expect(root?.pathTemplate).toBe("<copilot-xdg-user-root>");
    expect(root?.compatibility).toBe("native");

    const missing = getProviderDiscoveryRootById("copilot", "missing-root");
    expect(missing).toBeNull();
  });
});
