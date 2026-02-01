/**
 * Provider Registry
 *
 * Central registry for source control providers.
 * Handles provider registration, lookup, and instantiation.
 */

import type {
  SourceControlProvider,
  ProviderName,
  AtomicConfig,
  SaplingOptions,
} from "./provider";
import { GitHubProvider } from "./github";
import { createSaplingProvider, SaplingProvider } from "./sapling";

// Re-export types and providers for convenience
export * from "./provider";
export { GitHubProvider } from "./github";
export { SaplingProvider, createSaplingProvider } from "./sapling";
export { commandExists } from "./utils";

/**
 * Registry of available providers
 */
const providerRegistry: Record<ProviderName, SourceControlProvider> = {
  github: GitHubProvider,
  sapling: SaplingProvider,
};

/**
 * Get a provider by name
 *
 * @param name - Provider name ('github' | 'sapling')
 * @returns The provider instance
 * @throws Error if provider is not found
 */
export function getProvider(name: ProviderName): SourceControlProvider {
  const provider = providerRegistry[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

/**
 * Get a provider configured with options from AtomicConfig
 *
 * @param config - Atomic configuration
 * @returns Configured provider instance
 */
export function getConfiguredProvider(
  config: AtomicConfig
): SourceControlProvider {
  const { provider, sapling } = config.sourceControl;

  if (provider === "sapling" && sapling) {
    return createSaplingProvider(sapling);
  }

  return getProvider(provider);
}

/**
 * Get all available provider names
 *
 * @returns Array of provider names
 */
export function getProviderNames(): ProviderName[] {
  return Object.keys(providerRegistry) as ProviderName[];
}

/**
 * Get provider display information for selection UI
 *
 * @returns Array of provider info objects for UI display
 */
export function getProviderOptions(): Array<{
  value: ProviderName;
  label: string;
  hint: string;
}> {
  return [
    {
      value: "github",
      label: "GitHub (Git)",
      hint: "Standard Git workflow with GitHub CLI integration. Uses: git, gh",
    },
    {
      value: "sapling",
      label: "Sapling",
      hint: "Stack-based workflow with smartlog visualization. Uses: sl, gh",
    },
  ];
}

/**
 * Get Sapling workflow options for selection UI
 *
 * @returns Array of workflow options for UI display
 */
export function getSaplingWorkflowOptions(): Array<{
  value: SaplingOptions["prWorkflow"];
  label: string;
  hint: string;
}> {
  return [
    {
      value: "stack",
      label: "Stack-based (Recommended)",
      hint: "Creates one PR per commit using 'sl pr submit --stack'. Best viewed with ReviewStack.",
    },
    {
      value: "branch",
      label: "Branch-based",
      hint: "Traditional workflow using 'sl push --to <branch>'. Creates single PR from branch.",
    },
  ];
}

/**
 * Check if a provider name is valid
 *
 * @param name - Name to check
 * @returns True if valid provider name
 */
export function isValidProvider(name: string): name is ProviderName {
  return name in providerRegistry;
}
