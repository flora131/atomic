import { resolve } from "node:path";
import type { DiscoveryProvider } from "./provider-discovery-contract.ts";
import type { ProviderDiscoveryPlan } from "./provider-discovery-plan.ts";

type DiscoveryCacheInvalidator = () => void;

interface ProviderDiscoverySessionState {
  projectRoot: string;
  startupPlansByProvider: Map<DiscoveryProvider, ProviderDiscoveryPlan>;
  startupPlanFingerprintsByProvider: Map<DiscoveryProvider, string>;
  cacheEntries: Map<string, unknown>;
}

const cacheInvalidators = new Set<DiscoveryCacheInvalidator>();
let providerDiscoverySessionState: ProviderDiscoverySessionState | null = null;

function resolveProjectRoot(projectRoot?: string): string {
  return resolve(projectRoot ?? process.cwd());
}

function fingerprintDiscoveryPlan(plan: ProviderDiscoveryPlan): string {
  return plan.rootsInPrecedenceOrder
    .map((root) => `${root.id}:${root.resolvedPath}:${root.exists ? "1" : "0"}`)
    .join("|");
}

function shouldResetProviderDiscoverySession(
  currentState: ProviderDiscoverySessionState | null,
  projectRoot: string,
  startupPlan?: ProviderDiscoveryPlan,
): boolean {
  if (!currentState) {
    return true;
  }

  if (currentState.projectRoot !== projectRoot) {
    return true;
  }

  if (!startupPlan) {
    return false;
  }

  const currentFingerprint = currentState.startupPlanFingerprintsByProvider.get(
    startupPlan.provider,
  );
  return currentFingerprint !== fingerprintDiscoveryPlan(startupPlan);
}

function createProviderDiscoverySessionState(
  projectRoot: string,
): ProviderDiscoverySessionState {
  return {
    projectRoot,
    startupPlansByProvider: new Map(),
    startupPlanFingerprintsByProvider: new Map(),
    cacheEntries: new Map(),
  };
}

export function registerProviderDiscoveryCacheInvalidator(
  invalidator: DiscoveryCacheInvalidator,
): () => void {
  cacheInvalidators.add(invalidator);
  return () => {
    cacheInvalidators.delete(invalidator);
  };
}

export function invalidateProviderDiscoveryCaches(): void {
  providerDiscoverySessionState?.cacheEntries.clear();

  for (const invalidator of cacheInvalidators) {
    try {
      invalidator();
    } catch {
      // Cache invalidation is best-effort by design.
    }
  }
}

export function startProviderDiscoverySessionCache(
  options: {
    projectRoot?: string;
    startupPlan?: ProviderDiscoveryPlan;
  } = {},
): void {
  const projectRoot = resolveProjectRoot(options.projectRoot);

  if (
    shouldResetProviderDiscoverySession(
      providerDiscoverySessionState,
      projectRoot,
      options.startupPlan,
    )
  ) {
    invalidateProviderDiscoveryCaches();
    providerDiscoverySessionState = createProviderDiscoverySessionState(projectRoot);
  }

  if (!options.startupPlan) {
    return;
  }

  if (!providerDiscoverySessionState) {
    providerDiscoverySessionState = createProviderDiscoverySessionState(projectRoot);
  }

  providerDiscoverySessionState.startupPlansByProvider.set(
    options.startupPlan.provider,
    options.startupPlan,
  );
  providerDiscoverySessionState.startupPlanFingerprintsByProvider.set(
    options.startupPlan.provider,
    fingerprintDiscoveryPlan(options.startupPlan),
  );
}

export function clearProviderDiscoverySessionCache(): void {
  invalidateProviderDiscoveryCaches();
  providerDiscoverySessionState = null;
}

export function getStartupProviderDiscoveryPlan(
  provider: DiscoveryProvider,
  options: { projectRoot?: string } = {},
): ProviderDiscoveryPlan | undefined {
  if (!providerDiscoverySessionState) {
    return undefined;
  }

  const projectRoot = resolveProjectRoot(options.projectRoot);
  if (providerDiscoverySessionState.projectRoot !== projectRoot) {
    return undefined;
  }

  return providerDiscoverySessionState.startupPlansByProvider.get(provider);
}

export function getProviderDiscoverySessionCacheValue<T>(
  cacheKey: string,
  options: { projectRoot?: string } = {},
): T | undefined {
  if (!providerDiscoverySessionState) {
    return undefined;
  }

  if (
    providerDiscoverySessionState.projectRoot !==
      resolveProjectRoot(options.projectRoot)
  ) {
    return undefined;
  }

  return providerDiscoverySessionState.cacheEntries.get(cacheKey) as T | undefined;
}

export function setProviderDiscoverySessionCacheValue<T>(
  cacheKey: string,
  value: T,
  options: { projectRoot?: string } = {},
): T {
  const projectRoot = resolveProjectRoot(options.projectRoot);

  if (
    !providerDiscoverySessionState ||
    providerDiscoverySessionState.projectRoot !== projectRoot
  ) {
    providerDiscoverySessionState = createProviderDiscoverySessionState(
      projectRoot,
    );
  }

  providerDiscoverySessionState.cacheEntries.set(cacheKey, value as unknown);
  return value;
}
