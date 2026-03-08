/**
 * Provider discovery contract.
 *
 * This module is the single source of truth for discovery precedence across
 * providers. Later entries in a provider's precedence order override earlier
 * entries when the same skill/agent name is discovered multiple times.
 */

export const PROVIDER_DISCOVERY_TIERS = [
  "atomicBaseline",
  "userGlobal",
  "projectLocal",
] as const;

export type ProviderDiscoveryTier =
  (typeof PROVIDER_DISCOVERY_TIERS)[number];

export const PROVIDER_IDS = ["claude", "opencode", "copilot"] as const;

export type DiscoveryProvider = (typeof PROVIDER_IDS)[number];

export type ProviderDiscoveryCompatibility = "native" | "compatibility";

export interface ProviderDiscoveryRoot {
  id: string;
  pathTemplate: string;
  compatibility: ProviderDiscoveryCompatibility;
  description: string;
}

export interface ProviderDiscoveryRoots {
  atomicBaseline: readonly ProviderDiscoveryRoot[];
  userGlobal: readonly ProviderDiscoveryRoot[];
  projectLocal: readonly ProviderDiscoveryRoot[];
}

export type ProviderRuntimeBinding =
  | {
      mode: "mergedConfigDir";
      envVar: "CLAUDE_CONFIG_DIR" | "OPENCODE_CONFIG_DIR";
    }
  | {
      mode: "manualInjection";
      injects: readonly ["customAgents", "skillDirectories", "instructions"];
    };

export interface ProviderDiscoveryContract {
  provider: DiscoveryProvider;
  precedence: readonly ProviderDiscoveryTier[];
  roots: ProviderDiscoveryRoots;
  runtime: ProviderRuntimeBinding;
}

const TIER_RANK: Record<ProviderDiscoveryTier, number> = {
  atomicBaseline: 0,
  userGlobal: 1,
  projectLocal: 2,
};

export const PROVIDER_DISCOVERY_CONTRACTS = {
  claude: {
    provider: "claude",
    precedence: PROVIDER_DISCOVERY_TIERS,
    runtime: {
      mode: "mergedConfigDir",
      envVar: "CLAUDE_CONFIG_DIR",
    },
    roots: {
      atomicBaseline: [],
      userGlobal: [
        {
          id: "claude_user",
          pathTemplate: "~/.claude",
          compatibility: "native",
          description: "User Claude config",
        },
      ],
      projectLocal: [
        {
          id: "claude_project",
          pathTemplate: "<project>/.claude",
          compatibility: "native",
          description: "Project Claude config",
        },
      ],
    },
  },
  opencode: {
    provider: "opencode",
    precedence: PROVIDER_DISCOVERY_TIERS,
    runtime: {
      mode: "mergedConfigDir",
      envVar: "OPENCODE_CONFIG_DIR",
    },
    roots: {
      atomicBaseline: [],
      userGlobal: [
        {
          id: "opencode_user_home_native",
          pathTemplate: "~/.opencode",
          compatibility: "native",
          description: "User OpenCode home config root",
        },
        {
          id: "opencode_user_canonical_xdg",
          pathTemplate: "<opencode-canonical-user-root>",
          compatibility: "native",
          description:
            "Canonical OpenCode root resolved from the platform config home",
        },
      ],
      projectLocal: [
        {
          id: "opencode_project",
          pathTemplate: "<project>/.opencode",
          compatibility: "native",
          description: "Project OpenCode config",
        },
      ],
    },
  },
  copilot: {
    provider: "copilot",
    precedence: PROVIDER_DISCOVERY_TIERS,
    runtime: {
      mode: "manualInjection",
      injects: ["customAgents", "skillDirectories", "instructions"],
    },
    roots: {
      atomicBaseline: [],
      userGlobal: [
        {
          id: "copilot_user_home_native",
          pathTemplate: "~/.copilot",
          compatibility: "native",
          description: "User Copilot home config root",
        },
        {
          id: "copilot_user_canonical_native",
          pathTemplate: "<copilot-canonical-user-root>",
          compatibility: "native",
          description: "Canonical Copilot root resolved from the platform config home",
        },
      ],
      projectLocal: [
        {
          id: "copilot_project_claude_compat",
          pathTemplate: "<project>/.claude",
          compatibility: "compatibility",
          description: "Project Claude compatibility root",
        },
        {
          id: "copilot_project_opencode_compat",
          pathTemplate: "<project>/.opencode",
          compatibility: "compatibility",
          description: "Project OpenCode compatibility root",
        },
        {
          id: "copilot_project_native",
          pathTemplate: "<project>/.github",
          compatibility: "native",
          description: "Project Copilot native root",
        },
      ],
    },
  },
} as const satisfies Record<DiscoveryProvider, ProviderDiscoveryContract>;

export interface ProviderDiscoveryRootWithPrecedence
  extends ProviderDiscoveryRoot {
  tier: ProviderDiscoveryTier;
  precedence: number;
}

export function getProviderDiscoveryContract(
  provider: DiscoveryProvider,
): ProviderDiscoveryContract {
  return PROVIDER_DISCOVERY_CONTRACTS[provider];
}

export function getProviderDiscoveryTierRank(
  tier: ProviderDiscoveryTier,
): number {
  return TIER_RANK[tier];
}

export function shouldOverrideByDiscoveryTier(
  incomingTier: ProviderDiscoveryTier,
  existingTier: ProviderDiscoveryTier,
): boolean {
  return getProviderDiscoveryTierRank(incomingTier) > getProviderDiscoveryTierRank(existingTier);
}

export function getProviderDiscoveryRootsInPrecedenceOrder(
  provider: DiscoveryProvider,
): ProviderDiscoveryRootWithPrecedence[] {
  const contract = getProviderDiscoveryContract(provider);
  const ordered: ProviderDiscoveryRootWithPrecedence[] = [];
  let precedence = 0;

  for (const tier of contract.precedence) {
    for (const root of contract.roots[tier]) {
      ordered.push({
        ...root,
        tier,
        precedence,
      });
      precedence += 1;
    }
  }

  return ordered;
}

export function getProviderDiscoveryRootById(
  provider: DiscoveryProvider,
  rootId: string,
): ProviderDiscoveryRootWithPrecedence | null {
  return (
    getProviderDiscoveryRootsInPrecedenceOrder(provider).find(
      (root) => root.id === rootId,
    ) ?? null
  );
}

export function shouldOverrideByProviderRoot(
  provider: DiscoveryProvider,
  incomingRootId: string,
  existingRootId: string,
): boolean {
  const incoming = getProviderDiscoveryRootById(provider, incomingRootId);
  const existing = getProviderDiscoveryRootById(provider, existingRootId);

  if (!incoming) {
    throw new Error(`Unknown discovery root for ${provider}: ${incomingRootId}`);
  }
  if (!existing) {
    throw new Error(`Unknown discovery root for ${provider}: ${existingRootId}`);
  }

  return incoming.precedence > existing.precedence;
}
