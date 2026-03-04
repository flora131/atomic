import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  getProviderDiscoveryContract,
  getProviderDiscoveryRootById,
  getProviderDiscoveryRootsInPrecedenceOrder,
  type DiscoveryProvider,
  type ProviderDiscoveryCompatibility,
  type ProviderDiscoveryRootWithPrecedence,
  type ProviderDiscoveryTier,
  type ProviderRuntimeBinding,
} from "./provider-discovery-contract.ts";

const PROJECT_TEMPLATE_PREFIX = "<project>/";

export interface ProviderDiscoveryPlanOptions {
  projectRoot?: string;
  homeDir?: string;
  xdgConfigHome?: string | null;
  appDataDir?: string | null;
  platform?: NodeJS.Platform;
  opencodeCanonicalUserRoot?: string;
  copilotCanonicalUserRoot?: string;
  pathExists?: (path: string) => boolean;
}

interface TemplateResolutionContext {
  projectRoot: string;
  homeDir: string;
  opencodeCanonicalUserRoot: string;
  copilotCanonicalUserRoot: string;
}

export interface PlannedProviderDiscoveryRoot
  extends ProviderDiscoveryRootWithPrecedence {
  resolvedPath: string;
  exists: boolean;
}

export interface ProviderDiscoveryPathSet {
  atomicBaseline: readonly string[];
  userGlobal: readonly string[];
  projectLocal: readonly string[];
}

export interface ProviderDiscoveryCompatibilitySets {
  nativeRootIds: ReadonlySet<string>;
  compatibilityRootIds: ReadonlySet<string>;
  nativePaths: readonly string[];
  compatibilityPaths: readonly string[];
}

export interface ProviderDiscoveryPlan {
  provider: DiscoveryProvider;
  runtime: ProviderRuntimeBinding;
  paths: ProviderDiscoveryPathSet;
  rootsInPrecedenceOrder: readonly PlannedProviderDiscoveryRoot[];
  rootsById: ReadonlyMap<string, PlannedProviderDiscoveryRoot>;
  existingRoots: readonly PlannedProviderDiscoveryRoot[];
  compatibilitySets: ProviderDiscoveryCompatibilitySets;
}

export type ProviderCompatibilitySelection =
  | ProviderDiscoveryCompatibility
  | "all";

export interface ProviderDiscoveryCandidate<TValue> {
  key: string;
  rootId: string;
  value: TValue;
}

function dedupePaths(paths: readonly string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    if (seen.has(path)) {
      continue;
    }
    deduped.push(path);
    seen.add(path);
  }

  return deduped;
}

function resolveTemplatePath(
  pathTemplate: string,
  context: TemplateResolutionContext,
): string {
  if (pathTemplate === "<opencode-canonical-user-root>") {
    return context.opencodeCanonicalUserRoot;
  }
  if (pathTemplate === "<copilot-canonical-user-root>") {
    return context.copilotCanonicalUserRoot;
  }

  if (pathTemplate === "~") {
    return context.homeDir;
  }
  if (pathTemplate.startsWith("~/")) {
    return resolve(context.homeDir, pathTemplate.slice(2));
  }

  if (pathTemplate === "<project>") {
    return context.projectRoot;
  }
  if (pathTemplate.startsWith(PROJECT_TEMPLATE_PREFIX)) {
    return resolve(
      context.projectRoot,
      pathTemplate.slice(PROJECT_TEMPLATE_PREFIX.length),
    );
  }

  const unresolvedToken = pathTemplate.match(/<[^>]+>/);
  if (unresolvedToken) {
    throw new Error(
      `Unsupported discovery path template token: ${unresolvedToken[0]}`,
    );
  }

  return resolve(pathTemplate);
}

function buildTemplateResolutionContext(
  options: ProviderDiscoveryPlanOptions,
): TemplateResolutionContext {
  const resolvedHomeDir = resolve(options.homeDir ?? homedir());
  const resolvedProjectRoot = resolve(options.projectRoot ?? process.cwd());
  const resolvedPlatform = options.platform ?? process.platform;
  const resolvedConfigHome = resolve(
    resolveDefaultConfigHome({
      homeDir: resolvedHomeDir,
      xdgConfigHome: options.xdgConfigHome,
      appDataDir: options.appDataDir,
      platform: resolvedPlatform,
    }),
  );

  const opencodeCanonicalUserRoot = resolve(
    options.opencodeCanonicalUserRoot ??
      join(resolvedConfigHome, ".opencode"),
  );

  const copilotCanonicalUserRoot = resolve(
    options.copilotCanonicalUserRoot ??
      join(resolvedConfigHome, ".copilot"),
  );

  return {
    projectRoot: resolvedProjectRoot,
    homeDir: resolvedHomeDir,
    opencodeCanonicalUserRoot,
    copilotCanonicalUserRoot,
  };
}

interface ResolveDefaultConfigHomeOptions {
  homeDir: string;
  xdgConfigHome?: string | null;
  appDataDir?: string | null;
  platform?: NodeJS.Platform;
}

export function resolveDefaultConfigHome(
  options: ResolveDefaultConfigHomeOptions,
): string {
  const resolvedPlatform = options.platform ?? process.platform;

  if (resolvedPlatform === "win32") {
    if (options.appDataDir !== undefined) {
      return options.appDataDir ?? join(options.homeDir, "AppData", "Roaming");
    }

    return process.env.APPDATA ??
      join(options.homeDir, "AppData", "Roaming");
  }

  if (options.xdgConfigHome !== undefined) {
    return options.xdgConfigHome ??
      join(options.homeDir, ".config");
  }

  return process.env.XDG_CONFIG_HOME ??
    join(options.homeDir, ".config");
}

export function buildProviderDiscoveryPlan(
  provider: DiscoveryProvider,
  options: ProviderDiscoveryPlanOptions = {},
): ProviderDiscoveryPlan {
  const contract = getProviderDiscoveryContract(provider);
  const resolveContext = buildTemplateResolutionContext(options);
  const doesPathExist = options.pathExists ?? existsSync;

  const rootsInPrecedenceOrder = getProviderDiscoveryRootsInPrecedenceOrder(
    provider,
  ).map((root) => {
    const resolvedPath = resolveTemplatePath(root.pathTemplate, resolveContext);
    return {
      ...root,
      resolvedPath,
      exists: doesPathExist(resolvedPath),
    };
  });

  const rootsByTier: Record<ProviderDiscoveryTier, PlannedProviderDiscoveryRoot[]> = {
    atomicBaseline: [],
    userGlobal: [],
    projectLocal: [],
  };

  for (const root of rootsInPrecedenceOrder) {
    rootsByTier[root.tier].push(root);
  }

  const paths: ProviderDiscoveryPathSet = {
    atomicBaseline: dedupePaths(
      rootsByTier.atomicBaseline.map((root) => root.resolvedPath),
    ),
    userGlobal: dedupePaths(
      rootsByTier.userGlobal.map((root) => root.resolvedPath),
    ),
    projectLocal: dedupePaths(
      rootsByTier.projectLocal.map((root) => root.resolvedPath),
    ),
  };

  const nativeRoots = rootsInPrecedenceOrder.filter(
    (root) => root.compatibility === "native",
  );
  const compatibilityRoots = rootsInPrecedenceOrder.filter(
    (root) => root.compatibility === "compatibility",
  );

  const rootsById = new Map<string, PlannedProviderDiscoveryRoot>(
    rootsInPrecedenceOrder.map((root) => [root.id, root]),
  );

  return {
    provider,
    runtime: contract.runtime,
    paths,
    rootsInPrecedenceOrder,
    rootsById,
    existingRoots: rootsInPrecedenceOrder.filter((root) => root.exists),
    compatibilitySets: {
      nativeRootIds: new Set(nativeRoots.map((root) => root.id)),
      compatibilityRootIds: new Set(compatibilityRoots.map((root) => root.id)),
      nativePaths: dedupePaths(nativeRoots.map((root) => root.resolvedPath)),
      compatibilityPaths: dedupePaths(
        compatibilityRoots.map((root) => root.resolvedPath),
      ),
    },
  };
}

export function getCompatibleDiscoveryRoots(
  plan: ProviderDiscoveryPlan,
  compatibility: ProviderCompatibilitySelection = "all",
  options: { existingOnly?: boolean } = {},
): PlannedProviderDiscoveryRoot[] {
  const includeExistingOnly = options.existingOnly ?? false;

  return plan.rootsInPrecedenceOrder.filter((root) => {
    if (includeExistingOnly && !root.exists) {
      return false;
    }

    if (compatibility === "all") {
      return true;
    }

    return root.compatibility === compatibility;
  });
}

export function isRootInCompatibilitySet(
  plan: ProviderDiscoveryPlan,
  rootId: string,
  compatibility: ProviderCompatibilitySelection = "all",
): boolean {
  if (compatibility === "all") {
    return plan.rootsById.has(rootId);
  }

  if (compatibility === "native") {
    return plan.compatibilitySets.nativeRootIds.has(rootId);
  }

  return plan.compatibilitySets.compatibilityRootIds.has(rootId);
}

export function comparePlannedRootPrecedence(
  plan: ProviderDiscoveryPlan,
  incomingRootId: string,
  existingRootId: string,
): number {
  const incomingRoot = plan.rootsById.get(incomingRootId);
  const existingRoot = plan.rootsById.get(existingRootId);

  if (!incomingRoot) {
    throw new Error(
      `Unknown discovery root for ${plan.provider}: ${incomingRootId}`,
    );
  }
  if (!existingRoot) {
    throw new Error(
      `Unknown discovery root for ${plan.provider}: ${existingRootId}`,
    );
  }

  return incomingRoot.precedence - existingRoot.precedence;
}

export function resolveProviderDiscoveryCandidates<TValue>(
  plan: ProviderDiscoveryPlan,
  candidates: readonly ProviderDiscoveryCandidate<TValue>[],
): Map<string, ProviderDiscoveryCandidate<TValue>> {
  const resolved = new Map<string, ProviderDiscoveryCandidate<TValue>>();

  for (const candidate of candidates) {
    const knownRoot = getProviderDiscoveryRootById(plan.provider, candidate.rootId);
    if (!knownRoot) {
      throw new Error(
        `Unknown discovery root for ${plan.provider}: ${candidate.rootId}`,
      );
    }

    const existing = resolved.get(candidate.key);
    if (!existing) {
      resolved.set(candidate.key, candidate);
      continue;
    }

    const incomingPrecedenceDelta = comparePlannedRootPrecedence(
      plan,
      candidate.rootId,
      existing.rootId,
    );

    // On ties, prefer the latest candidate to preserve deterministic
    // "last write wins" semantics from discovery order.
    if (incomingPrecedenceDelta >= 0) {
      resolved.set(candidate.key, candidate);
    }
  }

  return resolved;
}
