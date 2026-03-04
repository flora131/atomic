import { isAbsolute, join, relative, resolve } from "node:path";
import {
  PROVIDER_IDS,
  type DiscoveryProvider,
  type ProviderDiscoveryCompatibility,
  type ProviderDiscoveryTier,
} from "../../utils/provider-discovery-contract.ts";
import {
  buildProviderDiscoveryPlan,
  getCompatibleDiscoveryRoots,
  isRootInCompatibilitySet,
  type ProviderCompatibilitySelection,
  type ProviderDiscoveryPlan,
  type ProviderDiscoveryPlanOptions,
} from "../../utils/provider-discovery-plan.ts";
import {
  getProviderDiscoverySessionCacheValue,
  getStartupProviderDiscoveryPlan,
  setProviderDiscoverySessionCacheValue,
} from "../../utils/provider-discovery-cache.ts";

export type DefinitionKind = "skill" | "agent";

const COMMAND_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ALL_PROVIDER_DISCOVERY_PLANS_CACHE_KEY =
  "definition-integrity:all-provider-discovery-plans";

export interface DefinitionDiscoveryMatch {
  provider: DiscoveryProvider;
  rootId: string;
  tier: ProviderDiscoveryTier;
  compatibility: ProviderDiscoveryCompatibility;
  rootPath: string;
}

export interface DefinitionCompatibilityValidationResult {
  isCompatible: boolean;
  issues: readonly string[];
  matches: readonly DefinitionDiscoveryMatch[];
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function getDefinitionSubdirectory(kind: DefinitionKind): "skills" | "agents" {
  return kind === "skill" ? "skills" : "agents";
}

export function createAllProviderDiscoveryPlans(
  options: ProviderDiscoveryPlanOptions = {},
): ProviderDiscoveryPlan[] {
  const canUseSessionCache = Object.keys(options).length === 0;
  if (canUseSessionCache) {
    const cachedPlans = getProviderDiscoverySessionCacheValue<
      ProviderDiscoveryPlan[]
    >(ALL_PROVIDER_DISCOVERY_PLANS_CACHE_KEY);
    if (cachedPlans) {
      return cachedPlans;
    }
  }

  const plans = PROVIDER_IDS.map((provider) => {
    if (canUseSessionCache) {
      const startupPlan = getStartupProviderDiscoveryPlan(provider);
      if (startupPlan) {
        return startupPlan;
      }
    }

    return buildProviderDiscoveryPlan(provider, options);
  });

  if (canUseSessionCache) {
    setProviderDiscoverySessionCacheValue(
      ALL_PROVIDER_DISCOVERY_PLANS_CACHE_KEY,
      plans,
    );
  }

  return plans;
}

export function collectDefinitionDiscoveryMatches(
  definitionPath: string,
  kind: DefinitionKind,
  plans: readonly ProviderDiscoveryPlan[] = createAllProviderDiscoveryPlans(),
): DefinitionDiscoveryMatch[] {
  const resolvedDefinitionPath = resolve(definitionPath);
  const definitionSubdirectory = getDefinitionSubdirectory(kind);
  const matches: DefinitionDiscoveryMatch[] = [];
  const seen = new Set<string>();

  for (const plan of plans) {
    const roots = getCompatibleDiscoveryRoots(plan, "all");
    for (const root of roots) {
      const definitionRootPath = resolve(
        join(root.resolvedPath, definitionSubdirectory),
      );
      if (!isPathWithinRoot(definitionRootPath, resolvedDefinitionPath)) {
        continue;
      }

      const matchKey = `${plan.provider}:${root.id}:${definitionRootPath}`;
      if (seen.has(matchKey)) {
        continue;
      }

      seen.add(matchKey);
      matches.push({
        provider: plan.provider,
        rootId: root.id,
        tier: root.tier,
        compatibility: root.compatibility,
        rootPath: definitionRootPath,
      });
    }
  }

  return matches;
}

export function getRuntimeCompatibilitySelection(
  plan: ProviderDiscoveryPlan,
): ProviderCompatibilitySelection {
  if (plan.runtime.mode === "manualInjection") {
    return "all";
  }

  return "native";
}

export function filterDefinitionMatchesByRuntimeCompatibility(
  matches: readonly DefinitionDiscoveryMatch[],
  activePlans: readonly ProviderDiscoveryPlan[],
): DefinitionDiscoveryMatch[] {
  if (matches.length === 0 || activePlans.length === 0) {
    return [];
  }

  const activePlansByProvider = new Map(
    activePlans.map((plan) => [plan.provider, plan]),
  );
  const compatibleMatches: DefinitionDiscoveryMatch[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const plan = activePlansByProvider.get(match.provider);
    if (!plan) {
      continue;
    }

    if (
      !isRootInCompatibilitySet(
        plan,
        match.rootId,
        getRuntimeCompatibilitySelection(plan),
      )
    ) {
      continue;
    }

    const dedupeKey = `${match.provider}:${match.rootId}:${match.rootPath}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    compatibleMatches.push(match);
  }

  return compatibleMatches;
}

export function validateDefinitionCompatibility(
  definitionPath: string,
  kind: DefinitionKind,
  plans: readonly ProviderDiscoveryPlan[] = createAllProviderDiscoveryPlans(),
): DefinitionCompatibilityValidationResult {
  const matches = collectDefinitionDiscoveryMatches(definitionPath, kind, plans);
  const issues: string[] = [];

  if (matches.length === 0) {
    issues.push(
      `Definition path is outside configured ${kind} discovery roots: ${definitionPath}`,
    );
  } else {
    const runtimeCompatibleMatches = filterDefinitionMatchesByRuntimeCompatibility(
      matches,
      plans,
    );
    if (runtimeCompatibleMatches.length === 0) {
      const roots = matches
        .map((match) => `${match.provider}:${match.rootId}`)
        .join(", ");
      issues.push(
        `Definition is not reachable through runtime-compatible ${kind} roots (${roots}).`,
      );
    }
  }

  return {
    isCompatible: issues.length === 0,
    issues,
    matches,
  };
}

export function isValidCommandIdentifier(candidate: string): boolean {
  return COMMAND_IDENTIFIER_PATTERN.test(candidate);
}

export function getCommandIdentifierPatternDescription(): string {
  return "letters, numbers, dots, underscores, and hyphens (no spaces)";
}
